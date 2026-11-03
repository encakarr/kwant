//! Jev, TypeSafe AI's hosted decision model, picking who answers in a channel. It speaks the same
//! `/v1/systemone` API as Laya but reads meaning rather than words, so it also routes messages
//! written without spaces (Chinese, Japanese) and with words no Good-for list names ("厕所返味" for a
//! renovation advisor). Off until the person saves a key in App settings; the message, the channel
//! name and each member's name, title, persona line and Good for / Not for lists are sent to the
//! configured URL (TypeSafe, or a gateway such as OpenCode Zen).
//!
//! What the person said outright still wins: an @mention, a bot named in the message, a choice
//! they made for a similar message, a team-building request, small talk to the last speaker. When
//! Jev is off, slow or fails, routing is exactly as before.

use super::laya::normalize_base_url;
use super::team::{
    choice_keys, has_cjk, is_small_talk, lead_of, pick_member_hinted, scope_words, ChannelRoute, Hints, Pick,
    ASK_FROM, AT_MENTIONED, NAMED, ROUTE_AT,
};
use super::LayaRouter;
use crate::db::models::Kwant;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, RwLock};
use std::time::Duration;

/// OpenCode Zen's System One endpoint, which has a free Jev model for a limited time.
pub const DEFAULT_URL: &str = "https://opencode.ai/inference/systemone/v1/systemone";
pub const DEFAULT_MODEL: &str = "jev-1.13-free";
/// Like Laya's routing limit: past this the message routes by keywords instead.
pub const TIMEOUT_MS: u64 = 4000;
/// How sure Jev must be that a message only follows on from the last reply ("谢谢", "再短一点")
/// for it to stay with the bot that spoke last.
pub const FOLLOW_UP_AT: f64 = 0.7;
/// Longest persona line sent as part of a member's description.
const PERSONA_CHARS: usize = 160;

/// The person's Jev setup, saved in App settings.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct JevSettings {
    pub enabled: bool,
    /// The API root or the full `/v1/systemone` URL.
    pub url: String,
    pub api_key: String,
    pub model: String,
}

impl std::fmt::Debug for JevSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JevSettings")
            .field("enabled", &self.enabled)
            .field("url", &self.url)
            .field("api_key", &if self.api_key.is_empty() { "" } else { "••••" })
            .field("model", &self.model)
            .finish()
    }
}

impl Default for JevSettings {
    fn default() -> Self {
        Self { enabled: false, url: DEFAULT_URL.into(), api_key: String::new(), model: DEFAULT_MODEL.into() }
    }
}

impl JevSettings {
    pub fn endpoint(&self) -> String {
        format!("{}/v1/systemone", normalize_base_url(&self.url))
    }

    /// On, with a key, a URL and a model.
    pub fn usable(&self) -> bool {
        self.enabled && !self.api_key.trim().is_empty() && !self.url.trim().is_empty() && !self.model.trim().is_empty()
    }
}

/// The Jev client and its current settings, shared by every clone of the router.
#[derive(Clone)]
pub struct Jev {
    client: reqwest::Client,
    settings: Arc<RwLock<JevSettings>>,
}

impl std::fmt::Debug for Jev {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Jev").field("settings", &self.settings()).finish()
    }
}

impl Default for Jev {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(TIMEOUT_MS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { client, settings: Arc::new(RwLock::new(JevSettings::default())) }
    }
}

/// A sample request's answer, for the settings screen's Test button.
#[derive(Debug, Clone, Serialize)]
pub struct JevCheck {
    pub choice: String,
    pub confidence: f64,
    pub elapsed_ms: u64,
}

impl Jev {
    pub fn settings(&self) -> JevSettings {
        self.settings.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set_settings(&self, settings: JevSettings) {
        if let Ok(mut s) = self.settings.write() {
            *s = settings;
        }
    }

    /// The settings when Jev should be asked, else `None`.
    pub fn active(&self) -> Option<JevSettings> {
        Some(self.settings()).filter(JevSettings::usable)
    }

    /// Posts one `/v1/systemone` request and returns the body.
    pub async fn ask(&self, settings: &JevSettings, payload: &Value) -> Result<Value, String> {
        let resp = self
            .client
            .post(settings.endpoint())
            .bearer_auth(settings.api_key.trim())
            .json(payload)
            .send()
            .await
            .map_err(|e| if e.is_timeout() { format!("no answer within {TIMEOUT_MS} ms") } else { e.without_url().to_string() })?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| e.without_url().to_string())?;
        if !status.is_success() {
            let detail: String = body.chars().take(300).collect();
            return Err(format!("HTTP {status}: {detail}"));
        }
        serde_json::from_str(&body).map_err(|e| format!("unreadable answer: {e}"))
    }

    /// One sample decision with `settings`, so the person sees the key, URL and model work.
    pub async fn check(&self, settings: &JevSettings) -> Result<JevCheck, String> {
        let payload = json!({
            "model": settings.model.trim(),
            "state": {"message": "卫生间地面用什么瓷砖好？"},
            "questions": {"who": {
                "type": "choice",
                "instructions": "Which member of this channel should handle the `message`?",
                "criteria": {
                    "Frontend": "Frontend Engineer. Good for: web pages, buttons, styling",
                    "Renovation": "Renovation Advisor. Good for: tiles, plumbing, ceilings",
                }
            }}
        });
        let started = std::time::Instant::now();
        let data = self.ask(settings, &payload).await?;
        let who = &data["answers"]["who"];
        let choice = who["choice"].as_str().ok_or("the answer has no choice")?.to_string();
        Ok(JevCheck { choice, confidence: who["confidence"].as_f64().unwrap_or(0.0), elapsed_ms: started.elapsed().as_millis() as u64 })
    }
}

/// How one member reads to Jev: title (or the persona's first line), the persona's first line,
/// Good for and Not for, and for the lead, the messages no specialist takes.
fn describe(m: &Kwant, is_lead: bool, hints: &Hints) -> String {
    let title = m.title.trim();
    let persona: String = m.persona_prompt.split(['\n', '。']).next().unwrap_or("").trim().chars().take(PERSONA_CHARS).collect();
    let mut d = if title.is_empty() { persona.clone() } else { title.to_string() };
    if !title.is_empty() && !persona.is_empty() && !persona.eq_ignore_ascii_case(title) {
        d.push_str(&format!(" — {persona}"));
    }
    if let Some(scope) = hints.scopes.get(&m.id) {
        if !scope.covers.is_empty() {
            d.push_str(&format!(". Good for: {}", scope.covers.join(", ")));
        }
        if !scope.avoids.is_empty() {
            d.push_str(&format!(". Not for: {}", scope.avoids.join(", ")));
        }
    }
    if is_lead {
        d.push_str(". Channel lead: greetings, small talk, coordination, and anything no other member covers");
    }
    d
}

/// The `/v1/systemone` request: who should answer, and (when someone spoke last) whether the
/// message only follows on from that reply.
pub fn channel_payload(
    model: &str,
    prompt: &str,
    channel_name: &str,
    lead_kwant_id: &str,
    members: &[Kwant],
    has_last_speaker: bool,
    hints: &Hints,
) -> Value {
    let lead_id = &lead_of(lead_kwant_id, members).id;
    let criteria: serde_json::Map<String, Value> = choice_keys(members)
        .into_iter()
        .zip(members)
        .map(|(key, m)| (key, Value::String(describe(m, &m.id == lead_id, hints))))
        .collect();
    let mut questions = json!({
        "who": {
            "type": "choice",
            "instructions": "Which member of this channel should handle the `message`?",
            "criteria": criteria
        }
    });
    if has_last_speaker {
        questions["follow_up"] = json!({
            "type": "noul",
            "instructions": "Is the `message` only a reaction or a short follow-up to the previous reply \
                (thanks, ok, go ahead, make it shorter, what about …), rather than a new request?"
        });
    }
    json!({ "model": model, "state": {"message": prompt, "channel": channel_name}, "questions": questions })
}

/// Jev's answer: members (indices) by probability, highest first, and how likely the message is
/// a follow-up to the last reply.
#[derive(Debug, Clone, PartialEq)]
pub struct JevAnswer {
    pub ranked: Vec<(usize, f64)>,
    pub follow_up: Option<f64>,
}

pub fn parse_answer(data: &Value, members: &[Kwant]) -> Option<JevAnswer> {
    let who = data.get("answers")?.get("who")?;
    let keys = choice_keys(members);
    let index = |key: &str| keys.iter().position(|k| k.eq_ignore_ascii_case(key.trim()));
    let mut ranked: Vec<(usize, f64)> = who
        .get("probabilities")
        .and_then(Value::as_object)
        .map(|p| p.iter().filter_map(|(k, v)| Some((index(k)?, v.as_f64()?))).collect())
        .unwrap_or_default();
    if ranked.is_empty() {
        // Only a choice: as sure as the answer says
        let i = index(who.get("choice")?.as_str()?)?;
        ranked.push((i, who.get("confidence").and_then(Value::as_f64).unwrap_or(1.0)));
    }
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let follow_up = data["answers"]["follow_up"]["noul"].as_f64();
    Some(JevAnswer { ranked, follow_up })
}

/// Turns Jev's answer into the channel's pick. Members the message hits on their Not for list are
/// left out. Jev's confidence (how far the top probability stands above an even spread) is the
/// fit, so the usual rules apply: from [`ROUTE_AT`] it routes, from [`ASK_FROM`] the person picks
/// between the top two, below that the last speaker (else the lead) carries on.
pub fn route_from_answer(
    answer: &JevAnswer,
    prompt: &str,
    lead_kwant_id: &str,
    members: &[Kwant],
    last_speaker: Option<&str>,
    hints: &Hints,
) -> Option<ChannelRoute> {
    let scoped = scope_words(prompt);
    let allowed = |k: &Kwant| !hints.avoids(k, &scoped);
    let last = last_speaker.and_then(|id| members.iter().find(|m| m.id == id)).filter(|k| allowed(k));
    let route = |k: &Kwant, basis: &str, reason: String, fit: f32, choices: Vec<String>| ChannelRoute {
        kwant_id: k.id.clone(),
        reason,
        fallback: false,
        matched_terms: Vec::new(),
        basis: basis.into(),
        fit,
        choices,
    };
    if let (Some(k), Some(p)) = (last, answer.follow_up) {
        if p >= FOLLOW_UP_AT {
            let reason = format!("Your message follows on from {} ({}), who spoke last here, so it carries on", k.name, k.title);
            return Some(route(k, "last", reason, ROUTE_AT, Vec::new()));
        }
    }
    let ranked: Vec<(&Kwant, f64)> =
        answer.ranked.iter().filter_map(|&(i, p)| members.get(i).map(|k| (k, p))).filter(|(k, _)| allowed(k)).collect();
    let (top, top_p) = *ranked.first()?;
    let total: f64 = ranked.iter().map(|(_, p)| p).sum();
    let n = ranked.len() as f64;
    let confidence = if n < 2.0 || total <= 0.0 { 1.0 } else { ((top_p / total - 1.0 / n) / (1.0 - 1.0 / n)).clamp(0.0, 1.0) };
    let fit = confidence as f32;
    let choices: Vec<String> = ranked.iter().take(2).map(|(k, _)| k.id.clone()).collect();
    let sure = (confidence * 100.0).round();
    if fit >= ASK_FROM {
        let reason = format!("Jev matched this to {} ({}), {sure}% sure", top.name, top.title);
        return Some(route(top, "jev", reason, fit, choices));
    }
    match last {
        Some(k) => {
            let reason = format!("Jev wasn't sure who this is for, so {} ({}), who spoke last here, carries on", k.name, k.title);
            Some(route(k, "last", reason, fit, choices))
        }
        None => {
            let lead = lead_of(lead_kwant_id, members);
            let reason = format!("Jev wasn't sure who this is for, so it went to the channel lead, {} ({})", lead.name, lead.title);
            Some(route(lead, "lead", reason, fit, choices))
        }
    }
}

/// A pick the person made outright, which Jev never overrides: the only bot, an @mention, a bot
/// named in the message, a team-building request, a choice made for a similar message, or small
/// talk carrying on with the last speaker.
pub fn says_who(p: &Pick<'_>, prompt: &str) -> bool {
    matches!(p.basis, "only" | "team" | "learned")
        || p.reason.contains(NAMED)
        || p.reason.contains(AT_MENTIONED)
        // Two or more @mentions go to the lead with a fit of 1; several roles' words are 0.7
        || (p.basis == "several" && p.fit >= 1.0)
        || (p.basis == "last" && is_small_talk(prompt))
}

impl LayaRouter {
    /// The channel pick with Jev, or `None` when Jev is off or didn't answer (the caller then routes
    /// as before).
    pub(crate) async fn jev_route(
        &self,
        prompt: &str,
        channel_name: &str,
        lead_kwant_id: &str,
        members: &[Kwant],
        last_speaker: Option<&str>,
        hints: &Hints,
    ) -> Option<ChannelRoute> {
        let settings = self.jev.active()?;
        if members.len() < 2 {
            return None;
        }
        if let Some(p) = pick_member_hinted(prompt, lead_kwant_id, members, None, "channel lead", last_speaker, hints) {
            if says_who(&p, prompt) {
                return Some(ChannelRoute {
                    kwant_id: p.kwant.id.clone(),
                    reason: p.reason,
                    fallback: false,
                    matched_terms: p.terms,
                    basis: p.basis.into(),
                    fit: p.fit,
                    choices: p.choices.iter().map(|k| k.id.clone()).collect(),
                });
            }
        }
        let has_last = last_speaker.is_some_and(|id| members.iter().any(|m| m.id == id));
        let payload = channel_payload(settings.model.trim(), prompt, channel_name, lead_kwant_id, members, has_last, hints);
        let started = std::time::Instant::now();
        let elapsed_ms = || started.elapsed().as_millis() as u64;
        let data = match self.jev.ask(&settings, &payload).await {
            Ok(data) => data,
            Err(e) => {
                tracing::warn!(error = %e, elapsed_ms = elapsed_ms(), "Jev didn't pick the bot for this message; routing as before");
                return None;
            }
        };
        let route = parse_answer(&data, members).and_then(|a| route_from_answer(&a, prompt, lead_kwant_id, members, last_speaker, hints));
        match &route {
            Some(r) => tracing::info!(kwant_id = %r.kwant_id, basis = %r.basis, fit = r.fit, cjk = has_cjk(prompt), elapsed_ms = elapsed_ms(), "Jev picked the bot for this message"),
            None => tracing::warn!(elapsed_ms = elapsed_ms(), "Jev's answer named no member; routing as before"),
        }
        route
    }
}


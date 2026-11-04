//! The reasoning effort a codex turn asks for. Codex passes the value straight to the model and
//! each model lists the efforts it takes (`codex debug models`: `supported_reasoning_levels`, e.g.
//! low to max, some up to ultra, gpt-5.5 only to xhigh), so a level the model doesn't list steps down
//! to the highest one it does. The list is read once per codex binary.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// Codex's efforts, weakest first (see codex's `ReasoningEffort`).
const ORDER: [&str; 6] = ["low", "medium", "high", "xhigh", "max", "ultra"];

fn rank(level: &str) -> Option<usize> {
    ORDER.iter().position(|l| *l == level)
}

/// kwant's effort as codex's: the levels match up to max; anything unknown is medium.
pub fn wanted(effort: &str) -> &'static str {
    ORDER.iter().copied().find(|l| *l == effort && *l != "ultra").unwrap_or("medium")
}

/// The highest of `supported` at or below `wanted`; `wanted` itself when the model's list is unknown.
pub fn clamp(wanted: &str, supported: &[String]) -> String {
    let (Some(top), false) = (rank(wanted), supported.is_empty()) else {
        return wanted.to_string();
    };
    supported
        .iter()
        .filter_map(|s| rank(s).filter(|r| *r <= top).map(|r| (r, s)))
        .max_by_key(|(r, _)| *r)
        .map_or_else(|| wanted.to_string(), |(_, s)| s.clone())
}

/// Each model's efforts from `codex debug models` output, by slug.
pub fn parse_levels(json: &str) -> HashMap<String, Vec<String>> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json.trim()) else {
        return HashMap::new();
    };
    v["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let slug = m["slug"].as_str()?.to_string();
            let levels = m["supported_reasoning_levels"]
                .as_array()?
                .iter()
                .filter_map(|l| l["effort"].as_str().or_else(|| l.as_str()).map(str::to_string))
                .collect();
            Some((slug, levels))
        })
        .collect()
}

static LEVELS: Mutex<Option<(String, HashMap<String, Vec<String>>)>> = Mutex::new(None);

async fn levels_of(bin: &str) -> HashMap<String, Vec<String>> {
    if let Some((b, levels)) = LEVELS.lock().ok().and_then(|g| g.clone()) {
        if b == bin {
            return levels;
        }
    }
    let out = tokio::time::timeout(Duration::from_secs(10), tokio::process::Command::new(bin).args(["debug", "models"]).output()).await;
    let levels = match out {
        Ok(Ok(o)) if o.status.success() => parse_levels(&String::from_utf8_lossy(&o.stdout)),
        _ => HashMap::new(),
    };
    // An empty answer isn't kept, so the next turn asks again
    if !levels.is_empty() {
        if let Ok(mut g) = LEVELS.lock() {
            *g = Some((bin.to_string(), levels.clone()));
        }
    }
    levels
}

/// The effort to hand codex for `effort` on `model` (`None`: codex's own default model, whose
/// list isn't known, so the level goes as is).
pub async fn for_turn(bin: &str, model: Option<&str>, effort: &str) -> String {
    let want = wanted(effort);
    let Some(model) = model else { return want.to_string() };
    clamp(want, levels_of(bin).await.get(model).map(Vec::as_slice).unwrap_or(&[]))
}

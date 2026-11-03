//! App settings for Jev, the hosted decision model that can pick who answers in a channel (see
//! `crate::router::jev`). Kept in its own routes so the main settings payload stays as it was.
//!
//! - `GET /api/settings/jev`: the setup, with the key masked.
//! - `POST /api/settings/jev {enabled?, url?, api_key?, model?}` (person only): saves it. A masked
//!   key keeps the saved one; `""` removes it (and turns Jev off).
//! - `POST /api/settings/jev/test` (person only, same fields, unsaved): one sample decision.

use super::AppState;
use crate::router::jev::{JevSettings, DEFAULT_MODEL, DEFAULT_URL};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const ENABLED_SETTING: &str = "jev_enabled";
pub const URL_SETTING: &str = "jev_url";
pub const KEY_SETTING: &str = "jev_api_key";
pub const MODEL_SETTING: &str = "jev_model";
const MASK: &str = "••••••••";

/// The saved setup (defaults for anything unsaved).
pub async fn saved(state: &AppState) -> JevSettings {
    let get = |key: &'static str| async move { state.db.get_setting(key).await.ok().flatten().filter(|v| !v.trim().is_empty()) };
    let defaults = JevSettings::default();
    JevSettings {
        enabled: get(ENABLED_SETTING).await.is_some_and(|v| v == "true"),
        url: get(URL_SETTING).await.unwrap_or(defaults.url),
        api_key: get(KEY_SETTING).await.unwrap_or_default(),
        model: get(MODEL_SETTING).await.unwrap_or(defaults.model),
    }
}

/// Gives the router the saved setup (at startup).
pub async fn load(state: &AppState) {
    state.router.jev.set_settings(saved(state).await);
}

#[derive(Serialize)]
pub struct JevView {
    pub enabled: bool,
    pub url: String,
    /// Masked when one is saved, else empty.
    pub api_key: String,
    pub model: String,
    /// On and complete, so channel messages go to Jev.
    pub active: bool,
    pub default_url: &'static str,
    pub default_model: &'static str,
}

fn view(s: &JevSettings) -> JevView {
    JevView {
        enabled: s.enabled,
        url: s.url.clone(),
        api_key: if s.api_key.is_empty() { String::new() } else { MASK.into() },
        model: s.model.clone(),
        active: s.usable(),
        default_url: DEFAULT_URL,
        default_model: DEFAULT_MODEL,
    }
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct JevPayload {
    pub enabled: Option<bool>,
    pub url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

fn bad(msg: impl Into<String>) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg.into() }))).into_response()
}

/// https anywhere; plain http only to this machine (a local gateway).
fn url_error(url: &str) -> Option<&'static str> {
    let u = url.trim().to_ascii_lowercase();
    let local = ["http://localhost", "http://127.0.0.1", "http://[::1]"].iter().any(|p| u.starts_with(p));
    (!u.starts_with("https://") && !local).then_some("The URL must start with https:// (or http://localhost for a gateway on this machine)")
}

/// `current` with the payload's changes; `Err` says what's wrong.
fn merged(current: &JevSettings, p: JevPayload) -> Result<JevSettings, String> {
    let mut s = current.clone();
    if let Some(url) = p.url {
        let url = url.trim();
        s.url = if url.is_empty() { DEFAULT_URL.into() } else { url.into() };
        if let Some(e) = url_error(&s.url) {
            return Err(e.into());
        }
    }
    if let Some(model) = p.model {
        let model = model.trim();
        s.model = if model.is_empty() { DEFAULT_MODEL.into() } else { model.into() };
        if s.model.chars().count() > 100 {
            return Err("The model name is too long".into());
        }
    }
    if let Some(key) = p.api_key {
        if !key.starts_with('•') {
            s.api_key = key.trim().to_string();
        }
    }
    if let Some(on) = p.enabled {
        s.enabled = on;
    }
    if s.api_key.is_empty() {
        s.enabled = false;
    }
    Ok(s)
}

pub async fn get(State(state): State<AppState>) -> Json<JevView> {
    Json(view(&saved(&state).await))
}

pub async fn save(State(state): State<AppState>, payload: Result<Json<JevPayload>, axum::extract::rejection::JsonRejection>) -> Response {
    let Json(p) = match payload {
        Ok(p) => p,
        Err(e) => return bad(e.body_text()),
    };
    let asked_on = p.enabled == Some(true);
    let s = match merged(&saved(&state).await, p) {
        Ok(s) => s,
        Err(e) => return bad(e),
    };
    if asked_on && !s.enabled {
        return bad("Add an API key before turning Jev on");
    }
    for (key, value) in [
        (ENABLED_SETTING, if s.enabled { "true" } else { "false" }),
        (URL_SETTING, s.url.as_str()),
        (KEY_SETTING, s.api_key.as_str()),
        (MODEL_SETTING, s.model.as_str()),
    ] {
        if state.db.set_setting(key, value).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Couldn't save the Jev settings" }))).into_response();
        }
    }
    state.router.jev.set_settings(s.clone());
    Json(view(&s)).into_response()
}

pub async fn test(State(state): State<AppState>, payload: Option<Json<JevPayload>>) -> Response {
    let s = match merged(&saved(&state).await, payload.map(|Json(p)| p).unwrap_or_default()) {
        Ok(s) => s,
        Err(e) => return bad(e),
    };
    if s.api_key.is_empty() {
        return bad("Add an API key first");
    }
    match state.router.jev.check(&s).await {
        Ok(c) => Json(json!({ "ok": true, "choice": c.choice, "confidence": c.confidence, "elapsed_ms": c.elapsed_ms })).into_response(),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({ "ok": false, "error": e }))).into_response(),
    }
}


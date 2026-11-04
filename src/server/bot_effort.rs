//! A bot's fixed thinking effort (Claude Code takes every level; Codex up to what its model lists;
//! Grok up to xhigh; model APIs only use the tier), set in its settings: `auto` (the default: the router picks low,
//! medium or high for each message) or one of `low`, `medium`, `high`, `xhigh`, `max` for every
//! message. The effort also picks the model tier unless the bot pins a model: low is the fast tier,
//! medium balanced, high and above deep. Kept in the settings table, so the bots table stays as it is.
//!
//! - `GET /api/settings/bot-effort/:id` → `{effort}`.
//! - `POST /api/settings/bot-effort/:id {effort}` (person only, like every settings change).

use super::AppState;
use crate::router::RouteDecision;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

/// What a bot can be fixed at, weakest first. `xhigh` and `max` are only ever set by the person:
/// the router never picks them, they are slow and use much more of an account's limits.
pub const LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

fn key(kwant_id: &str) -> String {
    format!("bot_effort:{kwant_id}")
}

/// The bot's fixed effort, or `None` for auto.
pub async fn fixed(state: &AppState, kwant_id: &str) -> Option<&'static str> {
    let saved = state.db.get_setting(&key(kwant_id)).await.ok().flatten()?;
    LEVELS.into_iter().find(|l| *l == saved.trim())
}

/// `route` run at `level` for every message: the person's choice wins over the router's.
pub fn apply(mut route: RouteDecision, level: &str) -> RouteDecision {
    if route.effort_level != level {
        route.reasoning = format!("{} · effort fixed at {level} in the bot's settings (the router said {})", route.reasoning, route.effort_level);
        route.effort_level = level.to_string();
    }
    route
}

pub async fn get(State(state): State<AppState>, Path(id): Path<String>) -> Json<serde_json::Value> {
    Json(json!({ "effort": fixed(&state, &id).await.unwrap_or("auto") }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffortPayload {
    pub effort: String,
}

pub async fn save(State(state): State<AppState>, Path(id): Path<String>, payload: Result<Json<EffortPayload>, axum::extract::rejection::JsonRejection>) -> Response {
    let bad = |m: String| (StatusCode::BAD_REQUEST, Json(json!({ "error": m }))).into_response();
    let Json(p) = match payload {
        Ok(p) => p,
        Err(e) => return bad(e.body_text()),
    };
    let effort = p.effort.trim().to_lowercase();
    if effort != "auto" && !LEVELS.contains(&effort.as_str()) {
        return bad(format!("effort must be auto, {}", LEVELS.join(", ")));
    }
    match state.db.get_kwant(&id).await {
        Ok(Some(_)) => {}
        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "error": "no such bot" }))).into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "couldn't read the bot" }))).into_response(),
    }
    // "auto" is stored as empty, which reads back as auto
    let value = if effort == "auto" { "" } else { effort.as_str() };
    if state.db.set_setting(&key(&id), value).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "couldn't save the effort" }))).into_response();
    }
    Json(json!({ "effort": effort })).into_response()
}

//! Jev channel routing and the Chinese-aware matching around it: `GET/POST /api/settings/jev`,
//! `POST /api/settings/jev/test`, and `LayaRouter::route_channel_query_hinted` against a stand-in
//! System One server on this machine.

use axum::{
    body::{to_bytes, Body},
    extract::State as AxState,
    http::{HeaderMap, Request, StatusCode},
    routing::post,
    Json, Router,
};
use kwnt::{
    broker::PermissionBroker,
    config::Config,
    db::{models::Kwant, routing::Scope, Database},
    router::{
        handoff_targets,
        jev::{channel_payload, parse_answer, route_from_answer, says_who, JevSettings, DEFAULT_URL},
        parse_mentions_with_lookup,
        team::{alike, content_words, pick_member_hinted, settle, Hints, Settle, ASK_FROM, ROUTE_AT},
        LayaRouter, TagMention,
    },
    server::{create_router, AppState},
    tools::ToolRunner,
};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tempfile::{tempdir, TempDir};
use tower::ServiceExt;

const KEY: &str = "oc_sk_test_secret_123";

fn bot(id: &str, name: &str, title: &str) -> Kwant {
    Kwant {
        id: id.into(),
        name: name.into(),
        title: title.into(),
        persona_prompt: String::new(),
        soul: String::new(),
        avatar_sprite: String::new(),
        driver_type: "claude".into(),
        preferred_model: String::new(),
        temperature: 0.7,
        max_tokens: 4096,
        level: 1,
        turns_completed: 0,
        created_at: None,
        space_id: kwnt::db::spaces::DEFAULT_SPACE_ID.into(),
    }
}

fn team() -> Vec<Kwant> {
    vec![bot("lead", "小安", "团队负责人"), bot("fe", "小前", "前端工程师"), bot("reno", "小装", "装修顾问")]
}

fn hints() -> Hints {
    let mut h = Hints::default();
    h.scopes.insert("reno".into(), Scope { covers: vec!["瓷砖".into(), "水电改造".into()], avoids: vec![] });
    h.scopes.insert("fe".into(), Scope { covers: vec!["按钮".into()], avoids: vec!["装修".into()] });
    h
}

fn answer(pairs: &[(&str, f64)], follow_up: Option<f64>) -> Value {
    let probs: serde_json::Map<String, Value> = pairs.iter().map(|(k, p)| (k.to_string(), json!(p))).collect();
    let mut a = json!({"answers": {"who": {"type": "choice", "choice": pairs[0].0, "probabilities": probs}}});
    if let Some(f) = follow_up {
        a["answers"]["follow_up"] = json!({"type": "noul", "noul": f});
    }
    a
}

fn route(data: Value, prompt: &str, last: Option<&str>, h: &Hints) -> kwnt::router::ChannelRoute {
    let members = team();
    let a = parse_answer(&data, &members).expect("parsed");
    route_from_answer(&a, prompt, "lead", &members, last, h).expect("a route")
}

// ── Without Jev: Chinese Good for / Not for, names, @mentions and similar messages ─────────

#[test]
fn chinese_good_for_and_not_for_match_without_spaces() {
    let members = team();
    let h = hints();
    let pick = |msg: &str| pick_member_hinted(msg, "lead", &members, None, "channel lead", None, &h).expect("pick");
    let p = pick("卫生间地面用什么瓷砖好？");
    assert_eq!(p.kwant.id, "reno", "{p:?}");
    assert!(p.fit >= ROUTE_AT, "{p:?}");
    assert_eq!(pick("登录页面的按钮颜色改一下").kwant.id, "fe");
    // Not for keeps the frontend bot out of a message about 装修, even with 按钮 in it
    assert_ne!(pick("装修效果图里的按钮开关选哪种").kwant.id, "fe");
}

#[test]
fn a_chinese_name_inside_the_sentence_names_the_bot() {
    let members = team();
    let p = pick_member_hinted("小装帮我看看这个报价", "lead", &members, None, "channel lead", None, &Hints::default()).expect("pick");
    assert_eq!(p.kwant.id, "reno");
    assert!(says_who(&p, "小装帮我看看这个报价"));
}

#[test]
fn chinese_names_can_be_mentioned_with_or_without_a_space() {
    let names = ["小装", "装修顾问", "Bea"];
    assert_eq!(handoff_targets("@小装 帮我看看", &names), vec![0]);
    assert_eq!(handoff_targets("@装修顾问帮我看看报价", &names), vec![1], "the longest name wins");
    assert_eq!(handoff_targets("请@小装看看，再问@Bea帮忙", &names), vec![0, 2]);
    assert!(handoff_targets("@小前 你好", &names).is_empty());
    // English as before
    assert_eq!(handoff_targets("@Bea can you check?", &names), vec![2]);
    let lookup = |tag: &str| names.iter().any(|n| n.eq_ignore_ascii_case(tag)).then_some(false);
    assert_eq!(parse_mentions_with_lookup("@小装帮我看看", lookup), vec![TagMention::Kwant("小装".into())]);
    assert_eq!(parse_mentions_with_lookup("@Bea帮我", lookup), vec![TagMention::Kwant("Bea".into())]);
    assert!(parse_mentions_with_lookup("邮箱是 user@example.com", lookup).is_empty());
}

#[test]
fn similar_chinese_messages_are_alike_so_a_choice_carries_over() {
    assert!(alike(&content_words("卫生间地面用什么瓷砖好"), &content_words("厨房地面用什么瓷砖好")));
    assert!(!alike(&content_words("卫生间地面用什么瓷砖好"), &content_words("登录页面的按钮颜色改成蓝色")));
    assert_eq!(content_words("Is it ok to get a cake?"), ["cake"], "English as before");
}

// ── Jev's answer to a pick ──────────────────────────────────────────────────────────────

#[test]
fn a_clear_answer_routes_to_that_bot() {
    let r = route(answer(&[("小装", 0.98), ("小前", 0.01), ("小安", 0.01)], None), "厕所老是返味", None, &Hints::default());
    assert_eq!((r.kwant_id.as_str(), r.basis.as_str()), ("reno", "jev"));
    assert!(r.fit >= ROUTE_AT, "fit {}", r.fit);
    assert!(r.reason.starts_with("Jev matched this to 小装 (装修顾问)"), "{}", r.reason);
    assert_eq!(r.choices, ["reno", "fe"]);
}

#[test]
fn a_close_call_asks_and_a_guess_stays_with_the_last_speaker_or_lead() {
    // 0.7 / 0.25 / 0.05 → confidence 0.55: the person picks between the top two
    let r = route(answer(&[("小前", 0.7), ("小装", 0.25), ("小安", 0.05)], None), "页面点提交没反应", None, &Hints::default());
    assert_eq!(r.basis, "jev");
    assert!(r.fit >= ASK_FROM && r.fit < ROUTE_AT, "fit {}", r.fit);
    assert_eq!(settle(&r, false, false), Settle::Ask(vec!["fe".into(), "reno".into()]));
    // 0.55 / 0.40 / 0.05 → 0.325: a guess; the last speaker carries on
    let r = route(answer(&[("小前", 0.55), ("小装", 0.40), ("小安", 0.05)], Some(0.1)), "这个怎么弄", Some("reno"), &Hints::default());
    assert_eq!((r.kwant_id.as_str(), r.basis.as_str()), ("reno", "last"));
    // No one spoke yet: the lead
    let r = route(answer(&[("小前", 0.4), ("小装", 0.35), ("小安", 0.25)], None), "嗯", None, &Hints::default());
    assert_eq!((r.kwant_id.as_str(), r.basis.as_str()), ("lead", "lead"));
}

#[test]
fn a_follow_up_carries_on_with_the_last_speaker() {
    let r = route(answer(&[("小安", 0.9), ("小前", 0.05), ("小装", 0.05)], Some(0.92)), "谢谢，辛苦了", Some("reno"), &Hints::default());
    assert_eq!((r.kwant_id.as_str(), r.basis.as_str()), ("reno", "last"));
    assert!(r.fit >= ROUTE_AT);
}

#[test]
fn not_for_keeps_a_bot_out_even_when_jev_picks_it() {
    let mut h = Hints::default();
    h.scopes.insert("reno".into(), Scope { covers: vec![], avoids: vec!["瓷砖".into()] });
    let r = route(answer(&[("小装", 0.9), ("小前", 0.06), ("小安", 0.04)], None), "卫生间地面用什么瓷砖好？", None, &h);
    assert_ne!(r.kwant_id, "reno");
}

#[test]
fn the_payload_describes_members_with_good_for_and_marks_the_lead() {
    let p = channel_payload("jev-1.13-free", "厕所返味", "装修群", "lead", &team(), true, &hints());
    assert_eq!(p["model"], "jev-1.13-free");
    assert_eq!(p["state"]["message"], "厕所返味");
    let c = &p["questions"]["who"]["criteria"];
    assert_eq!(c["小装"], "装修顾问. Good for: 瓷砖, 水电改造");
    assert_eq!(c["小前"], "前端工程师. Good for: 按钮. Not for: 装修");
    assert!(c["小安"].as_str().unwrap_or("").contains("Channel lead"));
    assert_eq!(p["questions"]["follow_up"]["type"], "noul");
    let p = channel_payload("m", "x", "c", "lead", &team(), false, &hints());
    assert!(p["questions"].get("follow_up").is_none());
}

#[test]
fn settings_need_a_key_and_the_switch_and_never_print_the_key() {
    let mut s = JevSettings { api_key: KEY.into(), ..JevSettings::default() };
    assert!(!s.usable());
    s.enabled = true;
    assert!(s.usable());
    assert_eq!(s.endpoint(), DEFAULT_URL);
    s.url = "https://api.typesafe.ai".into();
    assert_eq!(s.endpoint(), "https://api.typesafe.ai/v1/systemone");
    assert!(!format!("{s:?}").contains(KEY));
}

// ── Against a stand-in System One server ───────────────────────────────────────────────

#[derive(Clone, Default)]
struct Fake {
    /// What the next request answers; `None` answers 500.
    reply: Arc<Mutex<Option<Value>>>,
    /// Requests seen: (Authorization header, body).
    seen: Arc<Mutex<Vec<(String, Value)>>>,
}

async fn systemone(AxState(f): AxState<Fake>, headers: HeaderMap, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    f.seen.lock().unwrap().push((auth, body));
    match f.reply.lock().unwrap().clone() {
        Some(v) => (StatusCode::OK, Json(v)),
        None => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "down"}))),
    }
}

/// The stand-in server's URL and its state.
async fn fake_jev() -> (String, Fake) {
    let fake = Fake::default();
    let app = Router::new().route("/inference/systemone/v1/systemone", post(systemone)).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://localhost:{}/inference/systemone/v1/systemone", addr.port()), fake)
}

async fn setup() -> (Router, AppState, TempDir) {
    let tmp = tempdir().unwrap();
    let db = Database::init(tmp.path()).await.unwrap();
    let config = Config { data_dir: tmp.path().to_path_buf(), ..Config::default() };
    let state = AppState::new(
        config.clone(),
        db,
        ToolRunner::new(tmp.path().join("workspace")),
        PermissionBroker::new(),
        LayaRouter::new(config.laya_url.clone()),
    );
    (create_router(state.clone()), state, tmp)
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let b = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    let req = b.body(body.map_or(Body::empty(), |v| Body::from(v.to_string()))).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[test]
fn only_the_person_changes_or_tests_the_setup() {
    use axum::http::Method;
    use kwnt::server::auth::person_only;
    assert!(person_only(&Method::POST, "/api/settings/jev"));
    assert!(person_only(&Method::POST, "/api/settings/jev/test"));
    assert!(!person_only(&Method::GET, "/api/settings/jev"));
}

#[tokio::test]
async fn settings_save_mask_and_test_the_key() {
    let (app, state, _tmp) = setup().await;
    let (url, fake) = fake_jev().await;

    let (s, v) = call(&app, "GET", "/api/settings/jev", None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!((v["enabled"].as_bool(), v["active"].as_bool(), v["api_key"].as_str()), (Some(false), Some(false), Some("")));
    assert_eq!(v["url"], DEFAULT_URL);

    let (s, v) = call(&app, "POST", "/api/settings/jev", Some(json!({"enabled": true}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let (s, _) = call(&app, "POST", "/api/settings/jev", Some(json!({"url": "http://example.com/v1/systemone"}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "plain http only to this machine");
    let (s, _) = call(&app, "POST", "/api/settings/jev", Some(json!({"colour": "blue"}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unknown fields are refused");

    let (s, v) = call(&app, "POST", "/api/settings/jev", Some(json!({"enabled": true, "url": url, "api_key": KEY, "model": "jev-1.13-free"}))).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["active"], true);
    assert!(!v.to_string().contains(KEY), "the key never comes back");
    assert!(state.router.jev.active().is_some(), "the router has it at once");

    // A masked key keeps the saved one
    let (_, v) = call(&app, "GET", "/api/settings/jev", None).await;
    let (s, v) = call(&app, "POST", "/api/settings/jev", Some(json!({"api_key": v["api_key"], "model": "jev-latest"}))).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.router.jev.settings().api_key, KEY);
    assert_eq!(state.router.jev.settings().model, "jev-latest");

    // Test: one sample decision with the saved key
    *fake.reply.lock().unwrap() = Some(json!({"answers": {"who": {"choice": "Renovation", "confidence": 1.0}}}));
    let (s, v) = call(&app, "POST", "/api/settings/jev/test", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["choice"], "Renovation");
    let (auth, body) = fake.seen.lock().unwrap().last().cloned().unwrap();
    assert_eq!(auth, format!("Bearer {KEY}"));
    assert_eq!(body["model"], "jev-latest");
    // A failing server says why
    *fake.reply.lock().unwrap() = None;
    let (s, v) = call(&app, "POST", "/api/settings/jev/test", None).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY);
    assert!(v["error"].as_str().unwrap_or("").contains("500"), "{v}");

    // Removing the key turns Jev off
    let (s, v) = call(&app, "POST", "/api/settings/jev", Some(json!({"api_key": ""}))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!((v["enabled"].as_bool(), v["active"].as_bool()), (Some(false), Some(false)));
    assert!(state.router.jev.active().is_none());
}

#[tokio::test]
async fn channel_messages_go_to_jev_and_fall_back_when_it_fails() {
    let (url, fake) = fake_jev().await;
    let router = LayaRouter::new("http://127.0.0.1:9".into());
    let members = team();
    let h = hints();

    // Off: Jev is never asked, and local Chinese matching still routes
    let r = router.route_channel_query_hinted("卫生间地面用什么瓷砖好？", "装修群", "lead", &members, None, &h).await;
    assert_eq!(r.kwant_id, "reno");
    assert!(fake.seen.lock().unwrap().is_empty());

    router.jev.set_settings(JevSettings { enabled: true, url, api_key: KEY.into(), model: "jev-1.13-free".into() });

    // On: Jev's clear pick, with Good for and the follow-up question in the request
    *fake.reply.lock().unwrap() = Some(answer(&[("小装", 0.97), ("小前", 0.02), ("小安", 0.01)], Some(0.05)));
    let r = router.route_channel_query_hinted("厕所老是返味，怎么处理", "装修群", "lead", &members, Some("fe"), &h).await;
    assert_eq!((r.kwant_id.as_str(), r.basis.as_str()), ("reno", "jev"));
    assert!(!r.fallback);
    let (auth, body) = fake.seen.lock().unwrap().last().cloned().unwrap();
    assert_eq!(auth, format!("Bearer {KEY}"));
    assert_eq!(body["state"]["message"], "厕所老是返味，怎么处理");
    assert_eq!(body["questions"]["who"]["criteria"]["小装"], "装修顾问. Good for: 瓷砖, 水电改造");
    assert_eq!(body["questions"]["follow_up"]["type"], "noul");

    // An @mention wins without asking Jev
    let asked = fake.seen.lock().unwrap().len();
    let r = router.route_channel_query_hinted("@小前 把按钮改成蓝色", "装修群", "lead", &members, None, &h).await;
    assert_eq!(r.kwant_id, "fe");
    assert_eq!(fake.seen.lock().unwrap().len(), asked);

    // Jev failing: routed as before (here by the Good for list)
    *fake.reply.lock().unwrap() = None;
    let r = router.route_channel_query_hinted("卫生间地面用什么瓷砖好？", "装修群", "lead", &members, None, &h).await;
    assert_eq!(r.kwant_id, "reno");
    assert_ne!(r.basis, "jev");
}

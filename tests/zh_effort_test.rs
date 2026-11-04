//! Thinking effort: the router's keyword rules read Chinese too, xhigh and max run on the deep
//! tier, and a bot's fixed effort (`/api/settings/bot-effort/:id`) wins over the router's pick.

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    Router,
};
use kwnt::{
    broker::PermissionBroker,
    config::Config,
    db::Database,
    drivers::engines::Tier,
    router::{
        fallback::{blend_effort, heuristic_effort},
        LayaRouter, RouteDecision,
    },
    server::{bot_effort, create_router, AppState},
    tools::ToolRunner,
};
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};
use tower::ServiceExt;

#[test]
fn chinese_requests_for_depth_reach_high_like_english_ones() {
    for (zh, en) in [
        ("帮我重构数据库访问层", "Refactor the database layer"),
        ("设计一个支付系统的架构", "Design the architecture for a payment system"),
        ("帮我分析这个崩溃的根本原因", "Find the root cause of this crash"),
    ] {
        assert_eq!(heuristic_effort(en, "chat"), "high", "{en}");
        assert_eq!(heuristic_effort(zh, "chat"), "high", "{zh}");
        assert_eq!(blend_effort(zh, "medium"), "high", "a router's medium is raised: {zh}");
    }
    assert_eq!(heuristic_effort("这个问题特别复杂，帮我想想", "chat"), "high", "特别 is not 别 (don't)");
    assert_eq!(heuristic_effort("不要忽略安全漏洞", "chat"), "high", "don't ignore = do look");
    assert_eq!(heuristic_effort("你好，帮我设计一个支付系统的架构", "chat"), "high", "a greeting first doesn't hide the work");
}

#[test]
fn negated_or_everyday_chinese_words_dont_raise_the_effort() {
    for p in ["不要重构，只改个错别字", "别重构了，直接改", "这个不复杂，帮我改一下", "帮我优化一下这段文案"] {
        assert_ne!(heuristic_effort(p, "chat"), "high", "{p}");
        assert_eq!(blend_effort(p, "medium"), "medium", "{p}");
    }
}

#[test]
fn chinese_small_talk_and_short_answers_are_low() {
    for p in ["你好", "谢谢", "讲个笑话", "你是谁", "一句话解释什么是深拷贝", "简单说一下 REST 和 GraphQL 的区别是什么"] {
        assert_eq!(heuristic_effort(p, "chat"), "low", "{p}");
        assert_eq!(blend_effort(p, "high"), "low", "{p}");
    }
    // English as before
    assert_eq!(heuristic_effort("what is a deep copy, in one line", "chat"), "low");
    assert_eq!(heuristic_effort("don't refactor anything, just fix the typo", "chat"), "medium");
}

#[test]
fn xhigh_and_max_run_on_the_deep_tier() {
    assert_eq!(Tier::from_effort("low"), Tier::Fast);
    assert_eq!(Tier::from_effort("medium"), Tier::Balanced);
    for e in ["high", "xhigh", "max"] {
        assert_eq!(Tier::from_effort(e), Tier::Deep, "{e}");
    }
}

#[test]
fn a_fixed_effort_wins_over_the_routers_and_says_so() {
    let route = RouteDecision {
        selected_model: "claude".into(),
        effort_level: "low".into(),
        confidence: 0.9,
        provider_endpoint: None,
        is_fallback: false,
        reasoning: "Jev decision router selected claude with low effort".into(),
        tier: None,
        model: None,
    };
    let fixed = bot_effort::apply(route.clone(), "max");
    assert_eq!(fixed.effort_level, "max");
    assert_eq!(fixed.selected_model, "claude", "the engine pick stays");
    assert!(fixed.reasoning.contains("effort fixed at max"), "{}", fixed.reasoning);
    assert_eq!(bot_effort::apply(route.clone(), "low"), route, "the same level changes nothing");
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

#[tokio::test]
async fn a_bots_effort_is_saved_read_back_and_checked() {
    let (app, state, _tmp) = setup().await;
    let (_, kwants) = call(&app, "GET", "/api/kwants", None).await;
    let kid = kwants[0]["id"].as_str().expect("a bot").to_string();
    let uri = format!("/api/settings/bot-effort/{kid}");

    let (s, v) = call(&app, "GET", &uri, None).await;
    assert_eq!((s, v["effort"].as_str()), (StatusCode::OK, Some("auto")), "auto until set");
    assert_eq!(bot_effort::fixed(&state, &kid).await, None);

    for level in ["low", "medium", "high", "xhigh", "max"] {
        let (s, v) = call(&app, "POST", &uri, Some(json!({"effort": level}))).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let (_, v) = call(&app, "GET", &uri, None).await;
        assert_eq!(v["effort"], level);
        assert_eq!(bot_effort::fixed(&state, &kid).await, Some(level));
    }

    let (s, _) = call(&app, "POST", &uri, Some(json!({"effort": "turbo"}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = call(&app, "POST", &uri, Some(json!({"effort": "high", "extra": 1}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unknown fields are refused");
    let (s, _) = call(&app, "POST", "/api/settings/bot-effort/no-such-bot", Some(json!({"effort": "high"}))).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (s, v) = call(&app, "POST", &uri, Some(json!({"effort": "Auto"}))).await;
    assert_eq!((s, v["effort"].as_str()), (StatusCode::OK, Some("auto")));
    assert_eq!(bot_effort::fixed(&state, &kid).await, None, "back to the router's pick");

    use axum::http::Method;
    assert!(kwnt::server::auth::person_only(&Method::POST, &uri), "only the person sets it");
}

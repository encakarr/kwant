use super::RouteDecision;

/// Phrases that reliably mean a question needs careful, multi-step reasoning. Matched as whole words
/// (see [`has_phrase`]), so "deep copy" or "security guards" don't count; bare "deep" is left out
/// because it is usually part of a name ("deep copy", "deep link", "deep learning").
const DEEP_SIGNALS: &[&str] = &[
    "architecture", "architectures", "architectural", "refactor", "refactoring", "refactored", "complex",
    "complexity", "deep dive", "in-depth", "in depth", "benchmark", "benchmarking", "security", "optimize",
    "optimise", "optimized", "optimised", "optimizing", "optimising", "optimization", "optimisation",
    "investigate", "investigating", "investigation", "root cause", "root-cause", "tradeoff", "trade-off",
    "trade off", "monolith", "monolithic", "microservice", "migrate", "migrated", "migrating", "migration",
    "postmortem", "post-mortem", "deep analysis", "think deeply", "think hard", "go deep", "dig deep",
];

/// Everyday phrases that contain a deep signal but ask for nothing deep.
const NOT_DEEP: &[&str] = &["security guard", "security deposit", "social security", "security camera"];

/// Words that, just before a signal, say the person doesn't want it ("don't refactor anything").
const NEGATIONS: &[&str] = &["don't", "dont", "do not", "not", "no", "never", "without"];

/// After a negation, these turn it back into a request: "don't ignore security warnings" wants them looked at.
const UNDO_NEGATION: &[&str] = &["ignore", "skip", "forget", "overlook", "neglect", "miss", "underestimate"];

/// How far back a negation reaches: "don't worry about the refactor" is four words.
const NEGATION_WINDOW: usize = 4;

/// After a negation, these say the person is confused, not declining: "I don't understand the architecture".
const NOT_A_REFUSAL: &[&str] = &["know", "understand", "get", "see", "sure"];

/// Chinese deep signals. Chinese has no spaces, so these are found inside a clause (see
/// [`has_cjk_deep_signal`]). Bare 优化 and 安全 are left out: "优化一下文案", "安全吗" ask for nothing deep.
const CJK_DEEP_SIGNALS: &[&str] = &[
    "重构", "架构", "根本原因", "根因", "性能优化", "优化性能", "性能瓶颈", "安全漏洞", "安全审计", "安全风险", "安全隐患",
    "迁移", "深入分析", "深度分析", "深入研究", "深入思考", "仔细想想", "仔细思考", "认真思考", "好好想想", "复杂",
    "权衡", "利弊", "基准测试", "压测", "微服务", "单体", "复盘", "排查原因", "疑难",
];

/// Chinese words that, shortly before a signal in the same clause, say the person doesn't want it
/// ("不要重构"). Bare 不 is left out: "我不懂这个架构" is a question, not a refusal.
const CJK_NEGATIONS: &[&str] = &["不要", "不用", "不需要", "无需", "不必", "没必要", "别", "先不", "暂时不", "不想"];

/// Words ending in 别 that are not "don't" ("特别复杂", "区别").
const CJK_NOT_NEGATION: &[&str] = &["特别", "区别", "分别", "级别", "类别", "差别", "告别", "个别", "识别", "辨别", "性别", "派别", "鉴别", "离别", "道别"];

/// Phrases that contain a Chinese signal but say the work is not deep ("这个不复杂").
const CJK_NOT_DEEP: &[&str] = &["不复杂", "不太复杂", "不算复杂", "没那么复杂", "并不复杂"];

/// After a Chinese negation, these turn it back into a request ("不要忽略安全漏洞").
const CJK_UNDO_NEGATION: &[&str] = &["忽略", "忽视", "忘记", "忘了", "漏掉", "低估"];

/// How many characters before a Chinese signal a negation reaches ("不要再继续重构").
const CJK_NEGATION_WINDOW: usize = 6;

/// Chinese asks for a short answer ("一句话解释…").
const CJK_BRIEF: &[&str] = &["一句话", "一个词", "简单说", "简单讲", "简短回答", "简单回答", "只要结论", "直接告诉我", "快速问一下", "简单问一下"];

/// Chinese greetings, thanks and small talk that never need deep reasoning.
const CJK_SMALL_TALK_START: &[&str] = &["你好", "您好", "嗨", "哈喽", "早上好", "晚上好", "谢谢", "多谢", "感谢", "辛苦了"];
const CJK_SMALL_TALK: &[&str] = &["笑话", "你是谁", "你叫什么"];

/// The clauses of `text` as written, split at ASCII and Chinese punctuation.
fn raw_clauses(text: &str) -> impl Iterator<Item = &str> {
    text.split([',', '.', ';', ':', '!', '?', '\n', '，', '。', '；', '：', '！', '？', '、'])
        .map(str::trim)
        .filter(|c| !c.is_empty())
}

/// A Chinese deep signal not negated shortly before it in its clause.
fn has_cjk_deep_signal(text: &str) -> bool {
    raw_clauses(text).any(|clause| {
        let clause = CJK_NOT_DEEP.iter().fold(clause.to_string(), |c, idiom| c.replace(idiom, " "));
        CJK_DEEP_SIGNALS.iter().any(|s| {
            clause.match_indices(s).any(|(at, _)| {
                let chars: Vec<char> = clause[..at].chars().collect();
                let before: String = chars[chars.len().saturating_sub(CJK_NEGATION_WINDOW)..].iter().collect();
                let plain = CJK_NOT_NEGATION.iter().fold(before.clone(), |b, w| b.replace(w, " "));
                let negated = CJK_NEGATIONS.iter().any(|n| plain.contains(n));
                !negated || CJK_UNDO_NEGATION.iter().any(|u| before.contains(u))
            })
        })
    })
}

/// Lower-case words of `text`. Apostrophes stay inside a word ("don't") but a possessive "'s" is
/// dropped ("Rust's" is "rust"). Hyphens split a word ("code-review" is "code review"), and keyword
/// phrases are split the same way, so "trade-off" still matches "trade-off" and "trade off".
pub(crate) fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .replace('\u{2019}', "'")
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|w| w.trim_matches('\''))
        .map(|w| w.strip_suffix("'s").unwrap_or(w))
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Where `phrase` (one or more words) starts in `words`. A word also matches its plural ("tradeoffs")
/// and a version number after it ("python3").
fn phrase_at(words: &[String], phrase: &str) -> Vec<usize> {
    let parts: Vec<&str> = phrase.split([' ', '-']).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() || words.len() < parts.len() {
        return Vec::new();
    }
    let unversioned = |w: &str| {
        let stem = w.trim_end_matches(|c: char| c.is_ascii_digit());
        if stem.len() >= 4 && stem.chars().all(char::is_alphabetic) { stem.to_string() } else { w.to_string() }
    };
    let same = |w: &str, p: &str| {
        let w = unversioned(w);
        w == p || w.strip_suffix('s').is_some_and(|x| x == p) || w.strip_suffix("es").is_some_and(|x| x == p)
    };
    (0..=words.len() - parts.len())
        .filter(|&i| parts.iter().enumerate().all(|(j, p)| same(&words[i + j], p)))
        .collect()
}

/// True when `phrase` appears in `words` as whole words.
pub(crate) fn has_phrase(words: &[String], phrase: &str) -> bool {
    !phrase_at(words, phrase).is_empty()
}

fn has_any(words: &[String], phrases: &[&str]) -> bool {
    phrases.iter().any(|p| has_phrase(words, p))
}

/// The clauses of `text`, as [`words`]. A clause ends at punctuation or at "but"/"just", so a
/// negation in one ("don't refactor it, just…") doesn't reach into the next.
fn clauses(text: &str) -> Vec<Vec<String>> {
    text.split([',', '.', ';', ':', '!', '?', '\n'])
        .flat_map(|c| words(c).split(|w| w == "but" || w == "just").map(<[String]>::to_vec).collect::<Vec<_>>())
        .filter(|c| !c.is_empty())
        .collect()
}

/// A deep signal that isn't part of an everyday phrase and isn't negated earlier in its clause.
fn has_deep_signal(text: &str) -> bool {
    has_cjk_deep_signal(text) || clauses(text).into_iter().any(|mut ws| {
        for idiom in NOT_DEEP {
            let len = idiom.split([' ', '-']).count();
            for i in phrase_at(&ws, idiom) {
                for w in &mut ws[i..i + len] {
                    w.clear();
                }
            }
        }
        let negated = |i: usize| {
            let before = &ws[i.saturating_sub(NEGATION_WINDOW)..i];
            let refusal = NEGATIONS.iter().any(|n| {
                phrase_at(before, n).into_iter().any(|j| {
                    let next = before.get(j + n.split(' ').count()).map(String::as_str).unwrap_or("");
                    !NOT_A_REFUSAL.contains(&next)
                })
            });
            refusal && !has_any(before, UNDO_NEGATION)
        };
        DEEP_SIGNALS.iter().any(|s| phrase_at(&ws, s).into_iter().any(|i| !negated(i)))
    })
}

/// Chinese, Japanese and Korean text has no spaces between words.
fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

/// Roughly how many words `prompt` has: words between spaces, and about one per two CJK characters,
/// so a Chinese paragraph isn't counted as one word.
fn word_count(prompt: &str) -> usize {
    prompt
        .split_whitespace()
        .map(|w| {
            let cjk = w.chars().filter(|&c| is_cjk(c)).count();
            if cjk == 0 { 1 } else { cjk.div_ceil(2) + usize::from(w.chars().any(|c| c.is_alphanumeric() && !is_cjk(c))) }
        })
        .sum()
}

/// Words of the person's own message below which an attachment alone doesn't earn the deep tier.
const SHORT_WITH_ATTACHMENT: usize = 30;

/// A short message whose weight is an attached file ("what's on this?" plus a PDF) gets at most
/// "medium" effort: reading the file is work for the tools, not a reason for the deepest model.
/// Asking for depth in so many words ("analyze this thoroughly") still keeps "high".
pub fn cap_effort_for_attachment(prompt: &str, effort: &str) -> Option<&'static str> {
    let (own, _files) = prompt.split_once("\n\n[Attached files]")?;
    (effort.eq_ignore_ascii_case("high") && word_count(own) <= SHORT_WITH_ATTACHMENT && !has_deep_signal(own)).then_some("medium")
}

/// Asks for a one-line answer ("in one line", "just tell me…").
const BRIEF: &[&str] = &["in one line", "one-liner", "in one word", "just tell me", "quick question"];

/// Greetings, jokes and tiny one-liners never need deep reasoning.
fn is_trivial(prompt: &str, max_words: usize) -> bool {
    let lower = prompt.to_lowercase();
    let ws = words(prompt);
    let first = ws.first().map(String::as_str).unwrap_or("");
    word_count(prompt) <= max_words
        || matches!(first, "hi" | "hello" | "hey" | "ping" | "thanks" | "thank" | "yo")
        || lower.starts_with("say ")
        || lower.contains("joke")
        || lower.contains("who are you")
        || has_any(&ws, BRIEF)
        || CJK_SMALL_TALK_START.iter().any(|g| prompt.trim_start().starts_with(g))
        || CJK_SMALL_TALK.iter().any(|g| prompt.contains(g))
        || CJK_BRIEF.iter().any(|b| prompt.contains(b))
}

/// Keyword-only effort estimate, used when Laya is offline.
pub fn heuristic_effort(prompt: &str, context: &str) -> &'static str {
    if has_deep_signal(prompt) || has_deep_signal(context) || word_count(prompt) >= 30 {
        "high"
    } else if is_trivial(prompt, 6) {
        "low"
    } else {
        "medium"
    }
}

/// Laya's effort answer is a weak signal: it rated a multi-file refactor, a root-cause hunt and an
/// architecture design "medium", so a clear keyword raises those to "high". But when Laya says "low"
/// it is usually right about a keyword that is only mentioned ("don't refactor anything", "what is a
/// deep copy, in one line"), so keywords never raise a "low". Greetings are always "low".
pub fn blend_effort(prompt: &str, laya_effort: &str) -> String {
    if laya_effort != "low" && has_deep_signal(prompt) {
        "high".into()
    } else if is_trivial(prompt, 3) {
        "low".into()
    } else {
        laya_effort.into()
    }
}

/// Asks to keep the work on this machine. Bare "local" and "private" are not among them: "localhost",
/// "my local coffee shop", "Safari private mode" and "a private method" aren't about where it runs.
const PRIVATE: &[&str] = &[
    "confidential", "sensitive", "offline", "ollama", "local model", "local llm", "locally", "on-device",
    "on my machine", "private data", "private files", "private documents", "private info",
    "private information", "keep it private", "keep this private",
    // "my private" only before the person's own records: "my private repo" and "my private method" are code
    "my private file", "my private document", "my private note", "my private diary", "my private record",
    "my private health", "my private medical",
];

/// Needs long reasoning or writing.
const REASONING: &[&str] = &[
    "architecture", "architectural", "design doc", "tradeoff", "trade-off", "refactor", "refactoring",
    "analysis", "philosophy", "essay",
];

/// Asks for code.
const CODING: &[&str] = &[
    "python", "rust", "javascript", "typescript", "code", "codebase", "coding", "script", "scripting",
    "regex", "algorithm", "function",
];

/// Evaluates a prompt using local keyword scoring heuristics when Laya is offline.
pub fn heuristic_fallback(prompt: &str, context: &str) -> RouteDecision {
    heuristic_fallback_with_models(prompt, context, &[])
}

/// Evaluates prompt and selects best model from available candidates along with required effort level.
pub fn heuristic_fallback_with_models(
    prompt: &str,
    context: &str,
    available_models: &[String],
) -> RouteDecision {
    let combined = words(&format!("{prompt} {context}"));

    let effort_level = heuristic_effort(prompt, context).to_string();

    let is_available = |model: &str| -> bool {
        available_models.is_empty() || available_models.iter().any(|m| m == model)
    };

    // 1. Private / local check
    if has_any(&combined, PRIVATE)
        && is_available("local_ollama") {
            return RouteDecision {
                selected_model: "local_ollama".into(),
                effort_level: effort_level.clone(),
                confidence: 0.85,
                provider_endpoint: Some("http://localhost:11434/v1".into()),
                is_fallback: true,
                tier: None,
                model: None,
                reasoning: format!("Local privacy keywords detected; effort={}", effort_level),
            };
        }

    // 2. Complex architecture / multi-file / deep analysis check
    if has_any(&combined, REASONING)
        && is_available("claude") {
            return RouteDecision {
                selected_model: "claude".into(),
                effort_level: effort_level.clone(),
                confidence: 0.88,
                provider_endpoint: None,
                is_fallback: true,
                tier: None,
                model: None,
                reasoning: format!("Architectural reasoning keywords detected; effort={}", effort_level),
            };
        }

    // 3. Direct coding / script / regex check
    if has_any(&combined, CODING)
        && is_available("codex") {
            return RouteDecision {
                selected_model: "codex".into(),
                effort_level: effort_level.clone(),
                confidence: 0.82,
                provider_endpoint: None,
                is_fallback: true,
                tier: None,
                model: None,
                reasoning: format!("Programming keywords detected; effort={}", effort_level),
            };
        }

    // 4. Default fast & general — ordered by measured CLI latency (claude ~3s, codex ~7s, grok 10s+)
    let selected = if is_available("claude") {
        "claude"
    } else if is_available("grok") {
        "grok"
    } else if is_available("codex") {
        "codex"
    } else if !available_models.is_empty() {
        &available_models[0]
    } else {
        "grok"
    };

    RouteDecision {
        selected_model: selected.into(),
        effort_level: effort_level.clone(),
        confidence: 0.75,
        provider_endpoint: None,
        is_fallback: true,
        tier: None,
        model: None,
        reasoning: format!("Optimal available model '{}' selected with effort={}", selected, effort_level),
    }
}

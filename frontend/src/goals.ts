// Goals (GSP, 0.6.5): the person tells kwant what should stay true. kwant re-runs the goal's typed checks
// on a schedule and, when one keeps failing, opens a remediation mission (investigate, then fix) on the
// board. Plan: /home/maus/shared/ship-software-safely/smart-results-goals/plan.md §B (v2). There is no
// setting: Goals show whenever the Mission board shows, and nothing runs until the person creates or
// approves a goal. Unknown is never shown as met: no green, no tick, no "Met" for it.
// Wire shapes: /home/maus/shared/ship-software-safely/smart-results-goals/goals-ui-contract.md

import { PersonCancelledError, personFetch } from './auth';
import { t } from './i18n';
import { MissionError, Tone, ago, checkKindLabel, checkTarget, formatTokens, humanize, missionStatusLabel, missionsApi, stateLabel, untilText } from './missions';

export type GoalStatus = 'draft' | 'checking' | 'met' | 'not_met' | 'fixing' | 'unknown' | 'needs_you' | 'paused' | 'waiting';
export type GoalMode = 'watch' | 'suggest' | 'fix';
export type GoalCheckKind = 'command' | 'http' | 'file_exists' | 'file_contains' | 'file_sha256';
export type ObservationStatus = 'passed' | 'failed' | 'error';
export type Verdict = 'met' | 'not_met' | 'unknown';
export type GoalEventKind =
  | 'created'
  | 'approved'
  | 'checked'
  | 'not_met'
  | 'met'
  | 'fix_opened'
  | 'fix_verified'
  | 'fix_failed'
  | 'needs_you'
  | 'paused'
  | 'resumed'
  | 'edited'
  | 'mission_opened'
  | 'investigated'
  | 'fix_approved'
  | 'replanned'
  | 'conflict'
  | 'waiting';
export type GoalOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains';
export type GoalSeverity = 'required' | 'advisory';

export interface GoalObservation {
  id?: string;
  status: ObservationStatus;
  verdict: Verdict;
  /** Observed output: untrusted text, shown as text only. */
  excerpt: string | null;
  /** The metric's value as seen ("503", "412", "found"); none for the file kinds. Untrusted text. */
  observed_value: string | null;
  observed_at: string;
  /** When the server stops trusting this result; past it, the check reads Out of date. */
  expires_at?: string | null;
}

export interface GoalCheck {
  id: string;
  label: string;
  kind: GoalCheckKind | string;
  spec: Record<string, unknown>;
  /** The typed predicate (plan v2 B.1): the run's `metric`, compared by `operator` to `target`. None for the file kinds. */
  metric: string | null;
  operator: string | null;
  target: string | null;
  /** From `severity`: advisory checks show but never decide the goal. */
  required: boolean;
  freshness_minutes: number | null;
  latest: GoalObservation | null;
}

/** A remediation mission opened for the goal ("Restore: <goal>"), from `goal_mission_links`. */
export interface GoalMission {
  id: string;
  title: string;
  /** The mission's status (draft, active, done, cancelled), when the server sends it. */
  status: string | null;
  reason: string | null;
  attempt: number;
  opened_at: string | null;
  closed_at: string | null;
  outcome: string | null;
  /** On a held remediation (suggest mode), the task the person's Run releases. */
  run_task_id: string | null;
  /** The Investigate task's report, when the server puts it on the mission (else the drawer reads the `investigated` event). */
  summary: string | null;
  cause: string | null;
  proposed_fix: string | null;
}

export interface GoalFixTask {
  id: string;
  title: string;
  state: string;
  /** Held fix tasks (mode `suggest`) wait for the person's Run. */
  held: boolean;
  created_at: string | null;
}

export interface GoalEvent {
  id: string;
  kind: GoalEventKind | string;
  actor: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface Goal {
  id: string;
  space_id: string | null;
  title: string;
  description: string;
  /** The bot that fixes it. */
  kwant_id: string | null;
  folder: string | null;
  status: GoalStatus | string;
  /** Why it's in its status (a Needs you reason, mostly): a known code or plain text. */
  status_reason: string | null;
  /** Status waiting: the goal whose fix runs first in the same folder. */
  waiting_for: string | null;
  waiting_title: string | null;
  /** The Investigate report, when the server puts it on the goal itself (it comes before the mission's and the timeline's). */
  diagnosis: GoalReport | null;
  /** True when the row carries an `open_mission` key at all (null counts), so the strip needn't read the detail to know. */
  has_mission_info: boolean;
  /** Set by the strip when it swaps `status` for what it draws: the server's own word. */
  raw_status?: string;
  /** 1 high, 2 normal (default), 3 low. */
  priority: number;
  mode: GoalMode;
  interval_minutes: number;
  confirm_failures: number;
  budget_tokens: number;
  max_fixes_per_day: number;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paused_at: string | null;
  next_check_at: string | null;
  last_checked_at: string | null;
  checking_since: string | null;
  fail_streak: number;
  version: number;
  created_at: string;
  updated_at: string;
  /** Present when the list or the detail includes them. */
  checks: GoalCheck[];
  open_fix_task: GoalFixTask | null;
  /** The open remediation mission, when the list or the detail includes it. */
  open_mission: GoalMission | null;
  spent_tokens: number | null;
}

/** The Investigate result: what the bot found and what it proposes. Untrusted text. */
export interface GoalReport {
  summary: string | null;
  cause: string | null;
  proposed_fix: string | null;
}

export interface GoalDetail {
  goal: Goal;
  checks: GoalCheck[];
  events: GoalEvent[];
  fix_tasks: GoalFixTask[];
  missions: GoalMission[];
  spent_tokens: number;
}

/** What the person (or a draft's edit) sends. */
export interface GoalCheckDraft {
  label: string;
  kind: GoalCheckKind;
  spec: Record<string, unknown>;
  metric: string | null;
  operator: GoalOperator | null;
  target: string | null;
  severity: GoalSeverity;
}

export interface GoalDraft {
  title: string;
  description: string;
  kwant_id: string | null;
  interval_minutes: number;
  mode: GoalMode;
  priority: number;
  confirm_failures: number;
  /** 0 is no limit. */
  budget_tokens: number;
  checks: GoalCheckDraft[];
}

// ---------------------------------------------------------------------------
// Reading the server's answer. Defensive: an older or newer server may leave fields out.

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
/** A time as ISO text. Storage keeps epoch numbers (seconds or ms); the routes may pass them through as is. */
const time = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return s(v);
};
/** `required: false`, or storage's `severity` of optional/advisory, makes a check informational. */
const isRequired = (c: Record<string, unknown>): boolean => {
  if (typeof c.required === 'boolean') return c.required;
  const sev = s(c.severity)?.toLowerCase();
  return sev !== 'optional' && sev !== 'advisory' && sev !== 'info';
};
/** A value as text: numbers too (a target stored as 200 or "200"). */
const txt = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v : null);
const byTime = (a: string, b: string): number => (Date.parse(a) || 0) - (Date.parse(b) || 0) || a.localeCompare(b);
const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const MODES: GoalMode[] = ['watch', 'suggest', 'fix'];

function observation(v: unknown): GoalObservation | null {
  const o = rec(v);
  const status = s(o.status);
  if (status !== 'passed' && status !== 'failed' && status !== 'error') return null;
  const verdict = s(o.verdict);
  return {
    id: s(o.id) ?? undefined,
    status,
    verdict: verdict === 'met' || verdict === 'not_met' || verdict === 'unknown' ? verdict : status === 'passed' ? 'met' : status === 'failed' ? 'not_met' : 'unknown',
    excerpt: s(o.excerpt) ?? s(o.output_excerpt),
    observed_value: txt(o.observed_value),
    observed_at: time(o.observed_at) ?? time(o.created_at) ?? '',
    expires_at: time(o.expires_at),
  };
}

export function parseCheck(v: unknown): GoalCheck | null {
  const c = rec(v);
  const id = s(c.id);
  const kind = s(c.kind);
  if (!id || !kind) return null;
  const spec = typeof c.spec === 'string' ? rec(safeJson(c.spec)) : rec(c.spec);
  return {
    id,
    label: s(c.label) ?? '',
    kind,
    spec,
    metric: s(c.metric),
    operator: s(c.operator),
    target: txt(c.target),
    required: isRequired(c),
    freshness_minutes: typeof c.freshness_minutes === 'number' ? c.freshness_minutes : null,
    latest: observation(c.latest ?? c.latest_observation ?? c.observation ?? null),
  };
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function parseFixTask(v: unknown): GoalFixTask | null {
  const r = rec(v);
  const id = s(r.id) ?? s(r.task_id);
  if (!id) return null;
  return {
    id,
    title: s(r.title) ?? t('Fix task'),
    state: s(r.state) ?? 'ready',
    held: !!(r.held || r.held_at),
    created_at: time(r.created_at),
  };
}

function diagnosisFrom(v: unknown): Pick<GoalMission, 'summary' | 'cause' | 'proposed_fix'> {
  // A bare string is the whole report (Juno: `diagnosis` is a string, or {summary, cause, proposed_fix}).
  if (typeof v === 'string') return { summary: s(v), cause: null, proposed_fix: null };
  const d = rec(v);
  return {
    summary: s(d.summary) ?? s(d.investigate_summary) ?? s(d.report),
    cause: s(d.cause) ?? s(d.likely_cause),
    proposed_fix: s(d.proposed_fix) ?? s(d.fix),
  };
}

export function parseGoalMission(v: unknown): GoalMission | null {
  const m = rec(v);
  const id = s(m.mission_id) ?? s(m.id);
  if (!id) return null;
  return {
    id,
    title: s(m.title) ?? s(m.mission_title) ?? t('Restore mission'),
    status: s(m.status) ?? s(m.mission_status),
    reason: s(m.reason),
    attempt: n(m.attempt, 1),
    opened_at: time(m.opened_at) ?? time(m.created_at),
    closed_at: time(m.closed_at),
    outcome: s(m.outcome),
    run_task_id: s(m.run_task_id) ?? s(m.held_task_id),
    ...diagnosisFrom(m.diagnosis ?? m),
  };
}
/** Open: not closed, and not a finished mission. */
/** A goal's own `diagnosis`, or null when there is none. */
function parseReport(v: unknown): GoalReport | null {
  const r = diagnosisFrom(v);
  return r.summary || r.cause || r.proposed_fix ? r : null;
}

export const isOpenMission = (m: Pick<GoalMission, 'closed_at' | 'status'>) => !m.closed_at && m.status !== 'done' && m.status !== 'cancelled';

const OPEN_TASK_STATES = new Set(['backlog', 'ready', 'working', 'needs_you', 'review', 'blocked']);
export const isOpenTask = (t: Pick<GoalFixTask, 'state'>) => OPEN_TASK_STATES.has(t.state);

const list = <T>(v: unknown, parse: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : []);

export function parseGoal(v: unknown): Goal | null {
  const g = rec(v);
  const id = s(g.id);
  if (!id) return null;
  const mode = s(g.mode) as GoalMode | null;
  const fixTasks = list(g.fix_tasks, parseFixTask);
  const open = parseFixTask(g.open_fix_task) ?? fixTasks.find(isOpenTask) ?? null;
  const spent = g.spent_tokens ?? g.tokens_spent ?? g.fix_spent_tokens;
  const missions = list(g.missions, parseGoalMission);
  const mission = parseGoalMission(g.open_mission) ?? missions.find(isOpenMission) ?? null;
  const prio = n(g.priority, 2);
  return {
    id,
    space_id: s(g.space_id),
    title: s(g.title) ?? t('Untitled goal'),
    description: s(g.description) ?? '',
    kwant_id: s(g.kwant_id),
    folder: s(g.folder),
    status: s(g.status) ?? 'unknown',
    status_reason: s(g.status_reason),
    // The list sends `waiting_for` only on the detail read; on a list row `status_reason` is that goal's id (Juno, 21:33).
    waiting_for: s(g.waiting_for) ?? (s(g.status) === 'waiting' ? s(g.status_reason) : null),
    waiting_title: s(g.waiting_title),
    diagnosis: parseReport(g.diagnosis),
    has_mission_info: 'open_mission' in g,
    priority: prio >= 1 && prio <= 3 ? Math.round(prio) : 2,
    mode: mode && MODES.includes(mode) ? mode : 'suggest',
    interval_minutes: n(g.interval_minutes, 60),
    confirm_failures: n(g.confirm_failures, 2),
    budget_tokens: n(g.budget_tokens, 0),
    max_fixes_per_day: n(g.max_fixes_per_day, 3),
    created_by: s(g.created_by),
    approved_by: s(g.approved_by),
    approved_at: time(g.approved_at),
    paused_at: time(g.paused_at),
    next_check_at: time(g.next_check_at),
    last_checked_at: time(g.last_checked_at),
    checking_since: time(g.checking_since),
    fail_streak: n(g.fail_streak, 0),
    version: n(g.version, 0),
    created_at: time(g.created_at) ?? '',
    updated_at: time(g.updated_at) ?? time(g.created_at) ?? '',
    checks: list(g.checks, parseCheck),
    open_fix_task: open && isOpenTask(open) ? open : null,
    open_mission: mission && isOpenMission(mission) ? mission : null,
    spent_tokens: typeof spent === 'number' ? spent : null,
  };
}

function parseEvent(v: unknown): GoalEvent | null {
  const e = rec(v);
  // The server's goal event ids are integers ("id": 6); older shapes send strings.
  const id = typeof e.id === 'number' && Number.isFinite(e.id) ? String(e.id) : s(e.id);
  const kind = s(e.kind);
  if (!id || !kind) return null;
  const detail = typeof e.detail === 'string' ? rec(safeJson(e.detail)) : rec(e.detail);
  return { id, kind, actor: s(e.actor) ?? 'kwant', detail, created_at: time(e.created_at) ?? '' };
}

/** GET /api/goals/:id: the goal (flat or under `goal`), its checks with their latest observation, events, fix tasks, tokens spent. */
export function parseGoalDetail(v: unknown): GoalDetail | null {
  const r = rec(v);
  const goal = parseGoal(r.goal ?? r);
  if (!goal) return null;
  const checks = list(r.checks, parseCheck);
  const fix = list(r.fix_tasks ?? r.tasks, parseFixTask);
  const missions = list(r.missions, parseGoalMission).sort((a, b) => b.attempt - a.attempt || byTime(b.opened_at ?? '', a.opened_at ?? ''));
  const spent = r.spent_tokens ?? r.tokens_spent ?? goal.spent_tokens ?? 0;
  const events = list(r.events, parseEvent).sort((a, b) => byTime(a.created_at, b.created_at));
  const allChecks = checks.length ? checks : goal.checks;
  return {
    goal: {
      ...goal,
      checks: allChecks,
      open_fix_task: goal.open_fix_task ?? fix.find(isOpenTask) ?? null,
      open_mission: missions.find(isOpenMission) ?? goal.open_mission,
      spent_tokens: typeof spent === 'number' ? spent : null,
      has_mission_info: true,
    },
    checks: allChecks,
    events,
    fix_tasks: fix,
    missions,
    spent_tokens: typeof spent === 'number' ? spent : 0,
  };
}

export function parseGoalList(v: unknown): Goal[] {
  const r = Array.isArray(v) ? v : rec(v).goals;
  return list(r, parseGoal);
}

// ---------------------------------------------------------------------------
// Words

export interface StatusLook {
  label: string;
  tone: Tone;
  /** Which icon the pill draws; Unknown has its own, never the Met tick. */
  icon: 'met' | 'not_met' | 'fixing' | 'unknown' | 'needs_you' | 'paused' | 'draft' | 'checking' | 'waiting';
  hint: string;
}

export const GOAL_STATUS: Record<GoalStatus, StatusLook> = {
  met: { label: t('OK'), tone: 'emerald', icon: 'met', hint: t('Every required check passed.') },
  not_met: { label: t('Failing'), tone: 'rose', icon: 'not_met', hint: t('A required check kept failing.') },
  fixing: { label: t('Fixing'), tone: 'violet', icon: 'fixing', hint: t('A fix is open for it.') },
  unknown: { label: t('Can’t check'), tone: 'zinc', icon: 'unknown', hint: t('Can’t tell yet: a check couldn’t run, is out of date, or hasn’t run.') },
  needs_you: { label: t('Needs you'), tone: 'amber', icon: 'needs_you', hint: t('The bot stopped fixing it and waits for you.') },
  paused: { label: t('Paused'), tone: 'zinc', icon: 'paused', hint: t('Not checked until you resume it.') },
  draft: { label: t('Draft'), tone: 'sky', icon: 'draft', hint: t('A bot proposed it. Nothing runs until you approve it.') },
  checking: { label: t('Checking'), tone: 'sky', icon: 'checking', hint: t('Its checks are running now.') },
  waiting: { label: t('Waiting'), tone: 'zinc', icon: 'waiting', hint: t('Another goal’s fix in the same folder goes first.') },
};

/** Anything the server sends that this build doesn't know reads as Unknown, never as Met. */
export const goalStatusLook = (status: string): StatusLook => GOAL_STATUS[status as GoalStatus] ?? GOAL_STATUS.unknown;

export const MODE_OPTIONS: { value: GoalMode; label: string; hint: string }[] = [
  { value: 'watch', label: t('Just tell me'), hint: t('You hear about it. Nothing else runs.') },
  { value: 'suggest', label: t('Suggest a fix'), hint: t('A fix is planned and waits for your Run.') },
  { value: 'fix', label: t('Fix it'), hint: t('The bot looks into it and fixes it. The checks confirm the fix.') },
];
export const modeLabel = (m: string) => MODE_OPTIONS.find((o) => o.value === m)?.label ?? humanize(m);

export const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: t('High') },
  { value: 2, label: t('Normal') },
  { value: 3, label: t('Low') },
];
export const priorityLabel = (p: number) => PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? t('Normal');

export const INTERVAL_MIN = 15;
export const INTERVAL_MAX = 1440;
export const INTERVALS = [15, 30, 60, 120, 240, 360, 720, 1440];

export function intervalLabel(m: number): string {
  if (m >= 1440 && m % 1440 === 0) return m === 1440 ? t('1 day') : t('{n} days', { n: m / 1440 });
  if (m >= 60 && m % 60 === 0) return m === 60 ? t('1 hour') : t('{n} hours', { n: m / 60 });
  return t('{n} min', { n: m });
}

/** The options for "Check every", keeping a draft's own value even when it isn't a preset. */
export function intervalOptions(current?: number): number[] {
  const out = [...INTERVALS];
  if (current && !out.includes(current) && current >= INTERVAL_MIN && current <= INTERVAL_MAX) out.push(current);
  return out.sort((a, b) => a - b);
}

export const GOAL_CHECK_KINDS: GoalCheckKind[] = ['command', 'http', 'file_exists', 'file_contains', 'file_sha256'];

/** One check, in one line: what it looks at. */
export const goalCheckTarget = (c: Pick<GoalCheck, 'kind' | 'spec'>) => checkTarget({ kind: c.kind as GoalCheckKind, spec: c.spec });
export const goalCheckName = (c: Pick<GoalCheck, 'label' | 'kind' | 'spec'>) => c.label.trim() || goalCheckTarget(c) || checkKindLabel(c.kind);

// The typed predicates (plan v2 B.1): which metrics each kind has, and the operators each metric takes.
export const METRICS: Record<'http' | 'command', { value: string; label: string; operators: GoalOperator[]; unit?: string; textTarget?: boolean }[]> = {
  http: [
    { value: 'status', label: t('HTTP status'), operators: ['eq', 'ne'] },
    { value: 'latency_ms', label: t('Response time'), operators: ['lt', 'lte'], unit: 'ms' },
    { value: 'body_contains', label: t('Page shows'), operators: [], textTarget: true },
    { value: 'json_value', label: t('JSON value'), operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains'] },
  ],
  command: [
    { value: 'exit_code', label: t('Exit code'), operators: ['eq'] },
    { value: 'stdout_contains', label: t('Output shows'), operators: [], textTarget: true },
    { value: 'stdout_number', label: t('Number in output'), operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'] },
  ],
};
export const metricInfo = (kind: string, metric: string | null) => (kind === 'http' || kind === 'command' ? METRICS[kind].find((m) => m.value === metric) ?? null : null);

export const OPERATOR_SIGN: Record<GoalOperator, string> = { eq: '=', ne: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥', contains: t('contains') };
export const OPERATOR_WORDS: Record<GoalOperator, string> = {
  eq: t('is'),
  ne: t('is not'),
  lt: t('is under'),
  lte: t('is at most'),
  gt: t('is over'),
  gte: t('is at least'),
  contains: t('contains'),
};

/**
 * What the check wants, in one line: "HTTP status = 200", "Response time < 500 ms", "Page shows “ok”",
 * "Exit code = 0". A check without a typed predicate reads as its kind's default.
 */
export function checkDesired(c: Pick<GoalCheck, 'kind' | 'spec' | 'metric' | 'operator' | 'target'>): string {
  const sp = c.spec ?? {};
  const str = (k: string) => (typeof sp[k] === 'string' && (sp[k] as string).trim() ? (sp[k] as string) : null);
  const sign = (op: string | null, fallback: GoalOperator) => OPERATOR_SIGN[(op as GoalOperator) ?? fallback] ?? op ?? OPERATOR_SIGN[fallback];
  const target = c.target ?? '';
  switch (c.kind) {
    case 'http': {
      const m = c.metric ?? 'status';
      if (m === 'status') return t('HTTP status {op} {value}', { op: sign(c.operator, 'eq'), value: c.target ?? (typeof sp.expect_status === 'number' ? (sp.expect_status as number) : 200) });
      if (m === 'latency_ms') return t('Response time {op} {value} ms', { op: sign(c.operator, 'lt'), value: target });
      if (m === 'body_contains') return t('Page shows “{text}”', { text: c.target ?? str('contains') ?? '' });
      if (m === 'json_value') return t('JSON {pointer} {op} {value}', { pointer: str('pointer') ?? str('json_pointer') ?? t('value'), op: sign(c.operator, 'eq'), value: target });
      return `${humanize(m)} ${sign(c.operator, 'eq')} ${target}`.trim();
    }
    case 'command': {
      const m = c.metric ?? 'exit_code';
      if (m === 'exit_code') return t('Exit code {op} {value}', { op: sign(c.operator, 'eq'), value: c.target ?? 0 });
      if (m === 'stdout_contains') return t('Output shows “{text}”', { text: target });
      if (m === 'stdout_number') return t('Number in output {op} {value}', { op: sign(c.operator, 'eq'), value: target });
      return `${humanize(m)} ${sign(c.operator, 'eq')} ${target}`.trim();
    }
    case 'file_exists':
      return t('File exists');
    case 'file_contains':
      return t('File has “{text}”', { text: str('text') ?? '' });
    case 'file_sha256':
      return t('File matches its fingerprint');
    default:
      return checkKindLabel(c.kind);
  }
}

/** What the last run saw, as text: "503", "1240 ms", "not found". Null when the run reported no value. */
export function checkObserved(c: Pick<GoalCheck, 'kind' | 'metric' | 'latest'>): string | null {
  const v = c.latest?.observed_value;
  if (!v) return null;
  const unit = metricInfo(c.kind, c.metric)?.unit;
  return unit && /^-?\d+(\.\d+)?$/.test(v) ? `${v} ${unit}` : v;
}

export interface CheckLook {
  label: string;
  tone: Tone;
  verdict: Verdict;
}

/**
 * A check's last result. A newest observation older than its freshness window is Unknown ("Out of date"),
 * and so is one that never ran or couldn't run.
 */
export function checkLook(c: Pick<GoalCheck, 'latest' | 'freshness_minutes'>, intervalMinutes: number, now: number = Date.now()): CheckLook {
  const o = c.latest;
  if (!o) return { label: t('Not checked yet'), tone: 'zinc', verdict: 'unknown' };
  const fresh = (c.freshness_minutes ?? intervalMinutes * 2) * 60_000;
  const at = Date.parse(o.observed_at);
  const expires = o.expires_at ? Date.parse(o.expires_at) : NaN;
  if ((!Number.isNaN(at) && now - at > fresh) || (!Number.isNaN(expires) && now > expires)) return { label: t('Out of date'), tone: 'zinc', verdict: 'unknown' };
  if (o.status === 'passed') return { label: t('Passed'), tone: 'emerald', verdict: 'met' };
  if (o.status === 'failed') return { label: t('Failed'), tone: 'rose', verdict: 'not_met' };
  return { label: t('Couldn’t run'), tone: 'amber', verdict: 'unknown' };
}

/**
 * The status the strip draws. A Met whose required checks aren't all fresh passes reads Unknown, so Met is
 * never shown on out-of-date or missing results, whatever the last stored status says.
 */
export function shownStatus(g: Pick<Goal, 'status' | 'checks' | 'interval_minutes'>, now: number = Date.now()): string {
  if (g.status !== 'met') return g.status;
  const required = g.checks.filter((c) => c.required);
  return required.some((c) => checkLook(c, g.interval_minutes, now).verdict !== 'met') ? 'unknown' : 'met';
}

/** "Checked 12 min ago · next in 48 min", or why there's no next check. */
export function scheduleText(g: Pick<Goal, 'status' | 'last_checked_at' | 'next_check_at' | 'checking_since'>, now: number = Date.now()): string {
  const parts: string[] = [];
  if (g.status === 'checking' || g.checking_since) parts.push(t('Checking now'));
  else if (g.last_checked_at) parts.push(t('Checked {when}', { when: ago(g.last_checked_at, now) }));
  else if (g.status !== 'draft') parts.push(t('Not checked yet'));
  if (g.status === 'draft') parts.push(t('Runs only after you approve it'));
  else if (g.status === 'paused') parts.push(t('Paused, no checks until you resume'));
  else if (g.next_check_at && !(g.status === 'checking' || g.checking_since)) {
    // Due now is what untilText reads as "now"; worked out here so it doesn't hang on that word.
    const at = Date.parse(g.next_check_at);
    const due = !Number.isNaN(at) && Math.round((at - now) / 60000) <= 0;
    parts.push(due ? t('next check due now') : t('next {when}', { when: untilText(g.next_check_at, now) }));
  }
  return parts.join(' · ');
}

export const spentText = (tokens: number | null | undefined): string | null =>
  typeof tokens === 'number' && tokens > 0 ? t('{tokens} tokens spent on fixes', { tokens: formatTokens(tokens) }) : null;

const NEEDS_YOU_REASONS: Record<string, string> = {
  budget: t('its token budget is spent'),
  budget_spent: t('its token budget is spent'),
  max_fixes: t('it hit its fixes for today'),
  max_fixes_per_day: t('it hit its fixes for today'),
  fix_failed: t('the fix didn’t work'),
  max_attempts: t('the fixes so far didn’t bring it back'),
  conflict: t('fixing another goal broke it, so nothing runs on its own'),
  declined: t('you chose Not now'),
  fix_ready: t('a fix is ready for your OK'),
  unknown_24h: t('it couldn’t be checked for a day'),
};

/** "Needs you: <why>" from a reason code, or the server's own words when it sends text. */
export function needsYouText(reason: string | null | undefined): string {
  const r = (reason ?? '').trim();
  if (!r) return t('Needs you');
  const known = NEEDS_YOU_REASONS[r.toLowerCase()];
  if (known) return t('Needs you: {why}', { why: known });
  return t('Needs you: {why}', { why: /^[a-z0-9_]+$/.test(r) ? humanize(r).toLowerCase() : r });
}

const who = (actor: string, names: Record<string, string>): string => {
  if (actor === 'person') return t('You');
  if (actor === 'kwant' || actor === 'system' || actor === 'scheduler') return t('The app');
  return names[actor] ?? t('A bot');
};

/** One line of the goal's timeline, in plain words. Quoted bot reports come back separately from goalEventQuote. */
export function goalEventText(e: Pick<GoalEvent, 'kind' | 'actor' | 'detail'>, names: Record<string, string> = {}): string {
  const d = e.detail ?? {};
  const label = s(d.check_label) ?? s(d.label);
  const title = s(d.task_title) ?? s(d.title);
  switch (e.kind) {
    case 'created':
      return e.actor === 'person' ? t('You created this goal') : t('{who} proposed this goal', { who: who(e.actor, names) });
    case 'approved':
      return t('{who} approved it', { who: who(e.actor, names) });
    case 'checked': {
      const v = s(d.verdict);
      const passed = typeof d.passed === 'number' ? d.passed : null;
      const total = typeof d.total === 'number' ? d.total : null;
      const count = passed !== null && total !== null ? t(', {passed} of {total} passed', { passed, total }) : '';
      return v === 'met'
        ? t('Checked: OK{count}', { count })
        : v === 'not_met'
          ? t('Checked: failing{count}', { count })
          : v
            ? t('Checked: couldn’t tell{count}', { count })
            : t('Checked{count}', { count });
    }
    case 'not_met': {
      const times = typeof d.fail_streak === 'number' && d.fail_streak > 1 ? t(' {n} times in a row', { n: d.fail_streak }) : '';
      const seen = txt(d.observed_value);
      return label ? t('Broke: “{label}” failed{times}{seen}', { label, times, seen: seen ? t(' (observed {value})', { value: seen }) : '' }) : t('Broke');
    }
    case 'met':
      return t('OK again');
    case 'mission_opened':
      return title ? t('Fix work opened: {title}', { title }) : t('Fix work opened');
    case 'investigated':
      return t('{who} looked into it', { who: actorOr(e.actor, names, t('The bot')) });
    case 'fix_approved':
      return t('{who} said fix it', { who: who(e.actor, names) });
    case 'fix_opened':
      return title ? t('Fix task opened: {title}', { title }) : t('Fix task opened');
    case 'fix_verified':
      return t('Fix verified: the checks pass again');
    case 'fix_failed':
      return t('The fix didn’t work');
    case 'replanned': {
      const n = typeof d.attempt === 'number' ? d.attempt : Number(txt(d.attempt));
      return Number.isFinite(n) && n > 1 ? t('Trying another fix (attempt {n})', { n }) : t('Trying another fix');
    }
    case 'conflict': {
      const other = s(d.goal_title) ?? s(d.other_title);
      return other ? t('Fixing “{other}” broke this goal', { other }) : t('Fixing another goal broke this one');
    }
    case 'waiting': {
      const other = s(d.waiting_title) ?? s(d.goal_title);
      return other ? t('Waiting for “{other}” to finish its fix', { other }) : t('Waiting for another fix in the same folder');
    }
    case 'withdrawn':
    case 'not_needed':
      return t('OK again before the fix ran, so the fix was withdrawn');
    case 'needs_you':
      return needsYouText(s(d.reason));
    case 'paused':
      return t('{who} paused it', { who: who(e.actor, names) });
    case 'resumed':
      return t('{who} resumed it', { who: who(e.actor, names) });
    case 'edited':
      return t('{who} edited it', { who: who(e.actor, names) });
    default:
      return humanize(e.kind);
  }
}

const actorOr = (actor: string, names: Record<string, string>, fallback: string) => (names[actor] ? names[actor] : fallback);

/** A bot's report quoted under its timeline line (investigate summary, failure excerpt). Untrusted text: show it as text only. */
export function goalEventQuote(e: Pick<GoalEvent, 'kind' | 'detail'>): string | null {
  const d = e.detail ?? {};
  if (e.kind === 'investigated') return s(d.summary) ?? s(d.report) ?? null;
  if (e.kind === 'replanned' || e.kind === 'fix_failed') return s(d.excerpt) ?? s(d.reason) ?? null;
  return null;
}

export const eventTaskId = (e: Pick<GoalEvent, 'detail'>): string | null => s(e.detail?.task_id);

export type EventTone = 'good' | 'bad' | 'warn' | 'plain';
export function goalEventTone(kind: string): EventTone {
  if (kind === 'met' || kind === 'fix_verified' || kind === 'withdrawn' || kind === 'not_needed') return 'good';
  if (kind === 'not_met' || kind === 'fix_failed' || kind === 'conflict') return 'bad';
  if (kind === 'needs_you' || kind === 'replanned') return 'warn';
  return 'plain';
}

// ---------------------------------------------------------------------------
// The New goal form

export interface CheckFormRow {
  key: string;
  label: string;
  kind: GoalCheckKind;
  command: string;
  url: string;
  path: string;
  text: string;
  sha256: string;
  /** http and command only: the typed predicate. */
  metric: string;
  operator: GoalOperator | '';
  target: string;
  /** json_value: where the value sits, as a JSON pointer like /status. */
  pointer: string;
  required: boolean;
}

/** The metric a kind starts on, with its default (plan v2 B.1: http status = 200, exit code = 0). */
export function defaultPredicate(kind: GoalCheckKind, metric?: string): Pick<CheckFormRow, 'metric' | 'operator' | 'target'> {
  if (kind !== 'http' && kind !== 'command') return { metric: '', operator: '', target: '' };
  const m = metricInfo(kind, metric ?? null) ?? METRICS[kind][0];
  if (m.value === 'status') return { metric: 'status', operator: 'eq', target: '200' };
  if (m.value === 'exit_code') return { metric: 'exit_code', operator: 'eq', target: '0' };
  return { metric: m.value, operator: m.operators[0] ?? '', target: '' };
}

let rowSeq = 0;
export function emptyCheckRow(kind: GoalCheckKind = 'http'): CheckFormRow {
  rowSeq += 1;
  return { key: `c${rowSeq}`, label: '', kind, command: '', url: '', path: '', text: '', sha256: '', pointer: '', required: true, ...defaultPredicate(kind) };
}

/** Switch a row to another kind or metric, keeping what was typed where it still applies. */
export function withKind(r: CheckFormRow, kind: GoalCheckKind): CheckFormRow {
  return kind === r.kind ? r : { ...r, kind, ...defaultPredicate(kind) };
}
export function withMetric(r: CheckFormRow, metric: string): CheckFormRow {
  return metric === r.metric ? r : { ...r, ...defaultPredicate(r.kind, metric) };
}

export function checkRowFrom(c: Pick<GoalCheck, 'label' | 'kind' | 'spec' | 'required' | 'metric' | 'operator' | 'target'>): CheckFormRow {
  const sp = c.spec ?? {};
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const kind = (GOAL_CHECK_KINDS as string[]).includes(c.kind) ? (c.kind as GoalCheckKind) : 'command';
  const row: CheckFormRow = {
    ...emptyCheckRow(kind),
    label: c.label,
    command: str('command'),
    url: str('url'),
    path: str('path'),
    text: str('text'),
    sha256: str('sha256'),
    pointer: str('pointer') || str('json_pointer'),
    required: c.required,
  };
  if (kind !== 'http' && kind !== 'command') return row;
  const info = metricInfo(kind, c.metric);
  if (info) {
    const op = (c.operator && (info.operators as string[]).includes(c.operator) ? c.operator : info.operators[0] ?? '') as GoalOperator | '';
    return { ...row, metric: info.value, operator: op, target: c.target ?? defaultPredicate(kind, info.value).target };
  }
  // A check from before typed predicates: read its old spec fields.
  if (kind === 'http' && str('contains') && sp.expect_status === undefined) return { ...row, metric: 'body_contains', operator: '', target: str('contains') };
  if (kind === 'http' && typeof sp.expect_status === 'number') return { ...row, metric: 'status', operator: 'eq', target: String(sp.expect_status) };
  return row;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Plain-word problem with one check row, or null when it's fine. */
export function checkRowError(r: CheckFormRow): string | null {
  const target = r.target.trim();
  switch (r.kind) {
    case 'command': {
      if (!r.command.trim()) return t('Type the command to run.');
      if (r.metric === 'exit_code' && !/^-?\d+$/.test(target)) return t('The exit code is a whole number, like 0.');
      if (r.metric === 'stdout_contains' && !target) return t('Type the text the output should show.');
      if (r.metric === 'stdout_number' && !NUMBER.test(target)) return t('Type the number to compare with, like 10.');
      return null;
    }
    case 'http': {
      const u = r.url.trim();
      if (!u) return t('Type the web address to open.');
      if (!/^https?:\/\/\S+$/i.test(u)) return t('The address should start with http:// or https://.');
      if (r.metric === 'status' && !(/^\d{3}$/.test(target) && Number(target) >= 100 && Number(target) <= 599)) return t('The HTTP status is a number from 100 to 599, like 200.');
      if (r.metric === 'latency_ms' && !(/^\d+$/.test(target) && Number(target) > 0)) return t('Type the time limit in milliseconds, like 500.');
      if (r.metric === 'body_contains' && !target) return t('Type the text the page should show.');
      if (r.metric === 'json_value') {
        if (!/^\/\S*$/.test(r.pointer.trim())) return t('Say where the value is, starting with /, like /status.');
        if (!target) return t('Type the value to compare with.');
        if (['lt', 'lte', 'gt', 'gte'].includes(r.operator) && !NUMBER.test(target)) return t('Compare a number with a number, like 3.');
      }
      return null;
    }
    case 'file_exists':
      return r.path.trim() ? null : t('Type the file’s path in the bot’s folder.');
    case 'file_contains':
      if (!r.path.trim()) return t('Type the file’s path in the bot’s folder.');
      return r.text.trim() ? null : t('Type the text the file should contain.');
    case 'file_sha256':
      if (!r.path.trim()) return t('Type the file’s path in the bot’s folder.');
      return /^[0-9a-f]{64}$/i.test(r.sha256.trim()) ? null : t('A fingerprint is 64 letters and digits (0–9 and a–f).');
    default:
      return t('Pick what kind of check this is.');
  }
}

export function checkRowToDraft(r: CheckFormRow): GoalCheckDraft {
  const spec: Record<string, unknown> = {};
  let typed = false;
  switch (r.kind) {
    case 'command':
      spec.command = r.command.trim();
      typed = true;
      break;
    case 'http':
      spec.url = r.url.trim();
      if (r.metric === 'json_value') spec.pointer = r.pointer.trim();
      typed = true;
      break;
    case 'file_exists':
      spec.path = r.path.trim();
      break;
    case 'file_contains':
      spec.path = r.path.trim();
      spec.text = r.text;
      break;
    case 'file_sha256':
      spec.path = r.path.trim();
      spec.sha256 = r.sha256.trim().toLowerCase();
      break;
  }
  const info = typed ? metricInfo(r.kind, r.metric) : null;
  const draft: GoalCheckDraft = {
    label: r.label.trim(),
    kind: r.kind,
    spec,
    metric: info ? info.value : null,
    operator: info && info.operators.length ? ((r.operator || info.operators[0]) as GoalOperator) : null,
    target: info ? (info.textTarget ? r.target : r.target.trim()) : null,
    severity: r.required ? 'required' : 'advisory',
  };
  return { ...draft, label: draft.label || (info ? checkDesired(draft) : goalCheckTarget(draft)).slice(0, 80) };
}

export const MAX_CHECKS = 10;
export const MAX_TITLE = 120;

export interface GoalFormState {
  title: string;
  description: string;
  kwantId: string;
  interval: number;
  mode: GoalMode;
  priority: number;
  /** Failed runs in a row before it counts as broken. */
  confirmFailures: number;
  /** Tokens its fixes may spend; blank is no limit. */
  budget: string;
  checks: CheckFormRow[];
}

/** The server's defaults (goals-api): what "More options" starts on. */
export const GOAL_DEFAULTS = { interval: 60, mode: 'suggest' as GoalMode, priority: 2, confirmFailures: 2, budget: '' };

export type GoalFormErrors = Partial<Record<'title' | 'kwantId' | 'checks' | 'budget', string>> & { rows?: Record<string, string> };

/** Every problem in the form, in plain words; empty when it can be saved. */
export function goalFormErrors(f: GoalFormState): GoalFormErrors {
  const e: GoalFormErrors = {};
  const title = f.title.trim();
  if (!title) e.title = t('Give the goal a short name.');
  else if (title.length > MAX_TITLE) e.title = t('Keep the name under {n} characters.', { n: MAX_TITLE });
  if (f.mode !== 'watch' && !f.kwantId) e.kwantId = t('Pick the bot that fixes it, or choose Just tell me.');
  if (f.checks.length === 0) e.checks = t('Add at least one check, so there’s something to look at.');
  else if (f.checks.length > MAX_CHECKS) e.checks = t('A goal can have up to {n} checks.', { n: MAX_CHECKS });
  else if (!f.checks.some((c) => c.required)) e.checks = t('Keep at least one check required: OK needs one.');
  if (f.budget.trim() && !/^\d+$/.test(f.budget.trim())) e.budget = t('Type a whole number of tokens, or leave it blank for no limit.');
  const rows: Record<string, string> = {};
  for (const r of f.checks) {
    const err = checkRowError(r);
    if (err) rows[r.key] = err;
  }
  if (Object.keys(rows).length) e.rows = rows;
  return e;
}

export const hasFormErrors = (e: GoalFormErrors) => !!(e.title || e.kwantId || e.checks || e.budget || (e.rows && Object.keys(e.rows).length));

export function formFromGoal(g: Goal | null): GoalFormState {
  if (!g) return { title: '', description: '', kwantId: '', ...GOAL_DEFAULTS, checks: [emptyCheckRow()] };
  return {
    title: g.title,
    description: g.description,
    kwantId: g.kwant_id ?? '',
    interval: Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, g.interval_minutes || 60)),
    mode: g.mode,
    priority: g.priority,
    confirmFailures: Math.min(5, Math.max(1, g.confirm_failures || GOAL_DEFAULTS.confirmFailures)),
    budget: g.budget_tokens > 0 ? String(g.budget_tokens) : '',
    checks: g.checks.length ? g.checks.map(checkRowFrom) : [emptyCheckRow()],
  };
}

export function draftFromForm(f: GoalFormState): GoalDraft {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    kwant_id: f.kwantId || null,
    interval_minutes: f.interval,
    mode: f.mode,
    priority: f.priority,
    confirm_failures: f.confirmFailures,
    budget_tokens: f.budget.trim() ? Number(f.budget.trim()) : 0,
    checks: f.checks.map(checkRowToDraft),
  };
}

// ---------------------------------------------------------------------------
// Links from the rest of the board

/** Open a goal's drawer from anywhere on the board (the "Goal: <title>" chip on a mission). */
export const OPEN_GOAL_EVENT = 'kwnt:open-goal';
export const openGoal = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_GOAL_EVENT, { detail: { id } }));

/**
 * A mission's goal: `goal_link {id, title}`, or `goal` when the server sends it as an object. `goal` as text
 * is the mission's own goal line (0.6.x), not a link.
 */
export function missionGoalLink(m: { goal_link?: unknown; goal?: unknown }): { id: string; title: string } | null {
  for (const v of [m.goal_link, m.goal]) {
    if (v && typeof v === 'object') {
      const r = rec(v);
      const id = s(r.id) ?? s(r.goal_id);
      if (id) return { id, title: s(r.title) ?? t('Goal') };
    }
  }
  return null;
}

/** "21:40" today, "Nov 1, 21:40" before that. */
export function clockText(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return now - d.getTime() > 20 * 3600_000 ? t('{date}, {time}', { date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), time }) : time;
}

// ---------------------------------------------------------------------------
// The one decision per incident (plan v2 B.0 rule 2)

export interface Diagnosis {
  /** "HTTP status = 200, observed 503". */
  observed: string | null;
  /** When the broken check was seen, as ISO time. */
  since: string | null;
  cause: string | null;
  proposed_fix: string | null;
  /** The bot's report when it has no cause/fix split. Untrusted: text only. */
  summary: string | null;
}

/** How far the bot's look into an incident has got: no report yet, a report, or it couldn't finish. */
export type DiagnosisPhase = 'looking' | 'ready' | 'failed';

export type GoalDecision =
  | { kind: 'approve' }
  /** One decision per incident. `taskId` is the held Fix; without a report (`looking`) there are no buttons yet. */
  | { kind: 'run'; taskId: string | null; phase: DiagnosisPhase; diagnosis: Diagnosis }
  /** The person chose Not now: not a request, so nothing asks for them (B.0 rule 1). */
  | { kind: 'declined'; taskId: string | null; at: string | null }
  | { kind: 'needs_you'; text: string }
  | null;

/** Past this long without a report or a failure, the bot is taken to have stopped looking (D5). */
export const LOOK_TIMEOUT_MS = 30 * 60_000;

/** The check that broke the goal: a failed required check, else any required check not OK. */
export function brokenCheck(g: Pick<Goal, 'checks' | 'interval_minutes'>, now: number = Date.now()): GoalCheck | null {
  const req = g.checks.filter((c) => c.required);
  return req.find((c) => checkLook(c, g.interval_minutes, now).verdict === 'not_met') ?? null;
}

/** Desired vs observed in one line: "HTTP status = 200 · observed 503". */
export function desiredVsObserved(c: GoalCheck): string {
  const seen = checkObserved(c);
  return seen ? t('{desired} · observed {seen}', { desired: checkDesired(c), seen }) : checkDesired(c);
}

export function goalDiagnosis(g: Goal, events: GoalEvent[] = [], now: number = Date.now()): Diagnosis {
  const c = brokenCheck(g, now);
  const m = g.open_mission;
  const own = g.diagnosis;
  const inv = [...events].reverse().find((e) => e.kind === 'investigated');
  const d = inv?.detail ?? {};
  const broke = [...events].reverse().find((e) => e.kind === 'not_met');
  // goal.diagnosis, then open_mission.diagnosis, then the `investigated` event (D4).
  const pick = (k: 'summary' | 'cause' | 'proposed_fix', ...alt: string[]) => own?.[k] ?? m?.[k] ?? alt.map((a) => s(d[a])).find(Boolean) ?? null;
  return {
    observed: c ? t('{name}: {detail}', { name: goalCheckName(c), detail: desiredVsObserved(c) }) : null,
    // When it broke, not when it was last seen: no time at all beats a wrong "since 4 min ago".
    since: broke?.created_at ?? m?.opened_at ?? g.open_fix_task?.created_at ?? null,
    cause: pick('cause', 'cause', 'likely_cause'),
    proposed_fix: pick('proposed_fix', 'proposed_fix', 'fix'),
    summary: pick('summary', 'summary', 'report'),
  };
}

/**
 * Where the bot's look into the open incident stands (D5): a report (or an `investigated` event) means ready;
 * an event that says it failed, or 30 minutes since the mission opened with neither, means it couldn't finish.
 */
export function diagnosisPhase(g: Goal, events: GoalEvent[] = [], now: number = Date.now()): DiagnosisPhase {
  const inv = [...events].reverse().find((e) => e.kind === 'investigated');
  const failed = !!inv && (inv.detail.failed === true || inv.detail.failed === 'true' || inv.detail.status === 'failed');
  if (failed) return 'failed';
  const d = goalDiagnosis(g, events, now);
  if (d.cause || d.proposed_fix || d.summary || inv) return 'ready';
  const opened = Date.parse(g.open_mission?.opened_at ?? '');
  return !Number.isNaN(opened) && now - opened > LOOK_TIMEOUT_MS ? 'failed' : 'looking';
}

/** The task a "Fix it" releases: the held remediation's run task, else a held v1 fix task. */
export function heldFixTask(g: Pick<Goal, 'open_mission' | 'open_fix_task'>): string | null {
  if (g.open_mission && isOpenMission(g.open_mission) && g.open_mission.run_task_id) return g.open_mission.run_task_id;
  if (g.open_fix_task?.held) return g.open_fix_task.id;
  return null;
}

/** The server's own word for the goal's status (the strip may have swapped `status` for what it draws). */
export const serverStatus = (g: Pick<Goal, 'status' | 'raw_status'>): string => g.raw_status ?? g.status;

/**
 * Does a live task or mission change belong to the fix of one of these goals? The server announces a fix being
 * claimed or finished as `task_updated` / `mission_updated` only, never `goal_updated`, so the strip reloads on these.
 * `released`: tasks this person just pressed Fix it on (the goal no longer lists them as held).
 */
export function liveTouchesGoalFix(
  goals: Pick<Goal, 'id' | 'open_mission' | 'open_fix_task'>[],
  ev: { taskId?: string | null; missionId?: string | null; goalId?: string | null },
  released: ReadonlySet<string> = new Set(),
): boolean {
  if (ev.taskId && released.has(ev.taskId)) return true;
  return goals.some((g) => {
    if (ev.goalId && g.id === ev.goalId) return true;
    const m = g.open_mission;
    if (m && (ev.taskId && m.run_task_id === ev.taskId || ev.missionId && m.id === ev.missionId)) return true;
    return !!ev.taskId && g.open_fix_task?.id === ev.taskId;
  });
}

/** needs_you / fix_ready, a remediation mission is open, and its run task is no longer held: Fix it was pressed. */
const fixReleased = (g: Goal): boolean =>
  serverStatus(g) === 'needs_you' && (g.status_reason ?? '').trim().toLowerCase() === 'fix_ready' && !!g.open_mission && isOpenMission(g.open_mission) && !heldFixTask(g);

/**
 * What the person is asked, if anything. One per goal: approve a draft, decide on the incident, or the Needs
 * you reason. A decision the person already made (Not now) is `declined`: shown, but not a request.
 * `notNowTask`: the held task this person already said Not now to on this device.
 */
export function goalDecision(g: Goal, events: GoalEvent[] = [], now: number = Date.now(), notNowTask: string | null = null): GoalDecision {
  const status = serverStatus(g);
  if (status === 'draft') return { kind: 'approve' };
  const task = heldFixTask(g);
  if (status === 'needs_you' && (g.status_reason ?? '').trim().toLowerCase() === 'declined') return { kind: 'declined', taskId: task, at: g.updated_at || null };
  // The server reports a held fix as needs_you / fix_ready (suggest mode, the look is done): that is the
  // same decision as a failing goal with a held fix, so it gets Fix it / Not now / Always fix.
  if (status === 'needs_you' && (g.status_reason ?? '').trim().toLowerCase() === 'fix_ready' && task) {
    if (notNowTask === task) return { kind: 'declined', taskId: task, at: null };
    // The server says the look is over, so the 30-minute timeout doesn't apply; only an event that says it failed does.
    const inv = [...events].reverse().find((e) => e.kind === 'investigated');
    const failed = !!inv && (inv.detail.failed === true || inv.detail.failed === 'true' || inv.detail.status === 'failed');
    return { kind: 'run', taskId: task, phase: failed ? 'failed' : 'ready', diagnosis: goalDiagnosis(g, events, now) };
  }
  // fix_ready with the task no longer held: it was released (Fix it) and waits to be claimed. Nothing to ask.
  if (fixReleased(g)) return null;
  if (status === 'needs_you') return { kind: 'needs_you', text: needsYouText(g.status_reason) };
  if (status !== 'not_met' && status !== 'fixing') return null;
  // A fix that actually runs has no decision: fix mode (kwant fixes on its own) or a task already released.
  if (g.mode === 'fix' || (!task && !g.open_mission)) return null;
  if (task && notNowTask === task) return { kind: 'declined', taskId: task, at: null };
  const phase = diagnosisPhase(g, events, now);
  // No held fix and a report already in (or given up on): the fix was released and is running.
  if (!task && phase !== 'looking') return null;
  return { kind: 'run', taskId: task, phase, diagnosis: goalDiagnosis(g, events, now) };
}

/**
 * The status the strip draws (D3, D6): everything `shownStatus` does, plus
 * - `needs_you` for `declined` reads Failing: the person chose it, so it isn't a request;
 * - in suggest mode with the Fix held, Failing while the bot looks and Needs you once the decision is ready;
 *   Fixing only while a fix actually runs (fix mode, or after Fix it).
 */
export function displayStatus(g: Goal, events: GoalEvent[] = [], now: number = Date.now(), notNowTask: string | null = null): string {
  const shown = shownStatus({ ...g, status: serverStatus(g) }, now);
  if (shown !== 'needs_you' && shown !== 'not_met' && shown !== 'fixing') return shown;
  const d = goalDecision({ ...g, status: shown, raw_status: undefined }, events, now, notNowTask);
  if (d?.kind === 'declined') return 'not_met';
  if (fixReleased({ ...g, raw_status: undefined, status: shown })) return 'fixing';
  if (d?.kind === 'run' && g.mode === 'suggest') return d.taskId && d.phase !== 'looking' ? 'needs_you' : 'not_met';
  return shown;
}

/** "Restore: kwant.si is up · Active" for the goal's current work, or null. */
export function currentWorkText(g: Pick<Goal, 'open_mission' | 'open_fix_task' | 'status' | 'waiting_title' | 'waiting_for'>, titles: Record<string, string> = {}): string | null {
  if (g.status === 'waiting') {
    const other = g.waiting_title ?? (g.waiting_for ? titles[g.waiting_for] : null);
    return other ? t('Waiting for “{other}” to finish its fix', { other }) : t('Waiting for another fix in the same folder');
  }
  const m = g.open_mission && isOpenMission(g.open_mission) ? g.open_mission : null;
  if (m) {
    if (m.run_task_id) return t('{title} · fix ready, waiting for your OK', { title: m.title });
    const try_ = m.attempt > 1 ? t(' · attempt {n}', { n: m.attempt }) : '';
    return `${m.title}${m.status ? ` · ${missionStatusLabel(m.status).label}` : ''}${try_}`;
  }
  const task = g.open_fix_task;
  if (task) return task.held ? t('{title} · fix ready, waiting for your OK', { title: task.title }) : `${task.title} · ${stateLabel(task.state).label}`;
  return null;
}

/** The strip's one line (plan v2 B.0 rule 5): "3 goals OK · checked 4 min ago", or what wants a look first. */
export function stripSummary(goals: Goal[], now: number = Date.now()): string {
  if (!goals.length) return '';
  const count: Record<string, number> = {};
  let last = 0;
  for (const g of goals) {
    const st = shownStatus(g, now);
    count[st] = (count[st] ?? 0) + 1;
    const at = g.last_checked_at ? Date.parse(g.last_checked_at) : NaN;
    if (!Number.isNaN(at) && at > last) last = at;
  }
  const n = (k: string) => count[k] ?? 0;
  const parts: string[] = [];
  const add = (k: string, text: (n: number) => string) => n(k) && parts.push(text(n(k)));
  add('needs_you', (n) => t(n === 1 ? '{n} needs you' : '{n} need you', { n }));
  add('not_met', (n) => t('{n} failing', { n }));
  add('fixing', (n) => t('{n} fixing', { n }));
  add('waiting', (n) => t('{n} waiting', { n }));
  add('draft', (n) => t(n === 1 ? '{n} draft to approve' : '{n} drafts to approve', { n }));
  add('unknown', (n) => t('{n} can’t check', { n }));
  const ok = n('met');
  if (ok) parts.push(parts.length ? t('{n} OK', { n: ok }) : t(ok === 1 ? '{n} goal OK' : '{n} goals OK', { n: ok }));
  add('checking', (n) => t('{n} checking', { n }));
  add('paused', (n) => t('{n} paused', { n }));
  // The last check time only when nothing wants the person (needs you, failing, fixing, a draft).
  const wants = n('needs_you') + n('not_met') + n('fixing') + n('draft') > 0;
  if (last && !wants) parts.push(t('checked {when}', { when: ago(new Date(last).toISOString(), now) }));
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Ordering: what needs the person first, drafts next, then the rest by name.

const ORDER: Record<string, number> = { needs_you: 0, not_met: 1, fixing: 2, waiting: 3, draft: 4, unknown: 5, checking: 6, met: 7, paused: 8 };
export function sortGoals(goals: Goal[]): Goal[] {
  return [...goals].sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || a.priority - b.priority || a.title.localeCompare(b.title));
}

/** Plan v2 B.0 rule 5: cards show only for goals that want a look; the rest fold into the one-line summary. */
export const wantsLook = (status: string) => status !== 'met' && status !== 'paused' && status !== 'checking';

export function goalCounts(goals: Goal[]): { met: number; attention: number; drafts: number; total: number } {
  let met = 0;
  let attention = 0;
  let drafts = 0;
  for (const g of goals) {
    if (g.status === 'met') met += 1;
    else if (g.status === 'draft') drafts += 1;
    else if (g.status === 'not_met' || g.status === 'needs_you') attention += 1;
  }
  return { met, attention, drafts, total: goals.length };
}

/** Check now is allowed on every approved goal (paused included, Rigel Q10), not on a draft or while it runs. */
export const canCheckNow = (g: Pick<Goal, 'status' | 'checking_since'>) => g.status !== 'draft' && g.status !== 'checking' && !g.checking_since;

// ---------------------------------------------------------------------------
// API (person only; every write takes an Idempotency-Key on POST)

export class GoalError extends MissionError {}

function goalError(status: number, answer: unknown): GoalError {
  const a = rec(answer);
  const err = s(a.error);
  const code = s(a.code);
  if (status === 403) return new GoalError(err && !/person/i.test(err) ? err : t('Only you can change goals.'), 403, code);
  if (status === 404 && !err) return new GoalError(t('This server doesn’t have Goals yet. Update the app and try again.'), 404, code);
  if (status === 409 && !err) return new GoalError(t('Someone changed this goal just now. It has been reloaded; try again.'), 409, code ?? 'conflict');
  return new GoalError(err ? err.replace(/^\w/, (c) => c.toUpperCase()) : t('Something went wrong (HTTP {status}).', { status }), status, code);
}

async function call(url: string, method = 'GET', body?: unknown, key?: string): Promise<unknown> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  try {
    res = await personFetch(url, {
      method,
      cache: 'no-store',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof PersonCancelledError) throw new GoalError(e.message, 401);
    throw new GoalError(t('Couldn’t reach the server. Check your connection and try again.'), 0);
  }
  const answer = await res.json().catch(() => null);
  if (res.ok) return answer;
  throw goalError(res.status, answer);
}

const enc = encodeURIComponent;
const needGoal = (v: unknown): Goal => {
  const g = parseGoal(rec(v).goal ?? v);
  if (!g) throw new GoalError(t('The server sent a goal this app can’t read. Reload and try again.'), 500);
  return g;
};
const needDetail = (v: unknown): GoalDetail => {
  const d = parseGoalDetail(v);
  if (!d) throw new GoalError(t('The server sent a goal this app can’t read. Reload and try again.'), 500);
  return d;
};

export const goalsApi = {
  /** The space comes from the app's space wrapper (`?space=`), like the board's other reads. */
  list: () => call('/api/goals').then(parseGoalList),
  get: (id: string) => call(`/api/goals/${enc(id)}`).then(needDetail),
  create: (d: GoalDraft, key: string) => call('/api/goals', 'POST', d, key).then(needGoal),
  update: (id: string, patch: Partial<GoalDraft> & { paused?: boolean; version?: number }) => call(`/api/goals/${enc(id)}`, 'PATCH', patch).then(needGoal),
  approve: (id: string, key: string) => call(`/api/goals/${enc(id)}/approve`, 'POST', {}, key).then(needGoal),
  check: (id: string, key: string) => call(`/api/goals/${enc(id)}/check`, 'POST', {}, key).then((v) => parseGoal(rec(v).goal ?? v)),
  remove: (id: string) => call(`/api/goals/${enc(id)}`, 'DELETE').then(() => true),
  /** Plain-language drafting: the bot looks at the project and proposes checks. The draft arrives later, through goal_updated. */
  draft: (body: { space_id: string | null; kwant_id: string; text: string }, key: string) =>
    call('/api/goals/draft', 'POST', body, key).then((v) => parseGoal(rec(v).goal ?? v)),
  /** "Keep this true" on a verified task: the server copies its title and outcome checks into a goal. */
  fromTask: (taskId: string, key: string) => call('/api/goals', 'POST', { from_task: taskId }, key).then(needGoal),
  /** "Not now": holds on every device and stops the asking for this incident. Silent; returns the goal. */
  notNow: (id: string, key: string) => call(`/api/goals/${enc(id)}/remediation/not-now`, 'POST', {}, key).then(needGoal),
  /** "Always fix this goal": the goal switches to fix mode; the held fix may or may not be released by the server. */
  alwaysFix: (id: string, key: string) => call(`/api/goals/${enc(id)}/remediation/always-fix`, 'POST', {}, key).then(needGoal),
  /** Release the held fix ("Fix it"). The same key never starts it twice. */
  runFix: (taskId: string, key: string) => missionsApi.runHeld(taskId, key).then(() => true),
};
export type GoalsApi = typeof goalsApi;

const SPEC_NAMES: Record<string, string> = {
  pointer: t('Value at'),
  json_pointer: t('Value at'),
  command: t('Command'),
  url: t('Address'),
  expect_status: t('Answer code'),
  contains: t('Page shows'),
  path: t('File'),
  text: t('Contains'),
  sha256: t('Fingerprint'),
  timeout_secs: t('Time limit (seconds)'),
};

/** Every field of a check's spec, verbatim, for a draft the person approves: nothing summarised away. */
export function specLines(spec: Record<string, unknown>): { name: string; value: string }[] {
  return Object.entries(spec ?? {}).map(([k, v]) => ({ name: SPEC_NAMES[k] ?? humanize(k), value: typeof v === 'string' ? v : JSON.stringify(v) }));
}

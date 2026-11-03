// "While you were away" (batch 3): what agents need from you, finished and failed since you last
// looked. Pure helpers, so the page and the node tests share them; the API calls are at the bottom.

import { t } from './i18n';

export type AwayKind = 'question' | 'approval' | 'delegation' | 'routine_run';
export type AwaySection = 'waiting' | 'finished' | 'failed';
export type ApprovalDecision = 'allow_once' | 'always_allow' | 'deny';

export interface AwayLink {
  thread_id: string | null;
  channel_id: string | null;
  direct_kwant_id: string | null;
}

export interface AwayItem {
  kind: AwayKind;
  id: string;
  kwant_id: string;
  kwant_name: string;
  title: string;
  summary: string;
  status: string;
  timestamp: string;
  link: AwayLink;
  /** Questions only. */
  choices?: string[];
  /** Approvals only, from servers that send them: the tool and the card's details. */
  tool_name?: string;
  details?: Record<string, unknown>;
  /** Approvals only: set when the payment floor asked, also on servers that send no details. */
  payment_reason?: string;
}

export interface AwayCounts {
  waiting: number;
  finished: number;
  failed: number;
  total: number;
}

export interface AwayResponse {
  since: string;
  last_seen: string | null;
  now: string;
  stuck_after_minutes: number;
  waiting: AwayItem[];
  finished: AwayItem[];
  failed: AwayItem[];
  unseen: AwayCounts;
}

export const AWAY_SECTIONS: { key: AwaySection; label: string; empty: string }[] = [
  { key: 'waiting', label: t('Waiting on you'), empty: t('No questions or approvals waiting.') },
  { key: 'finished', label: t('Finished'), empty: t('Nothing finished since you last looked.') },
  { key: 'failed', label: t('Failed or stuck'), empty: t('Nothing failed or stuck.') },
];

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function relativeTime(ts: string, now: number = Date.now()): string {
  const at = Date.parse(ts);
  if (Number.isNaN(at)) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return t('just now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('{n} min ago', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t('yesterday');
  if (d < 7) return t('{n} days ago', { n: d });
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Page subtitle: the 7-day default window, or since the last visit. */
export function windowLabel(since: string, now: number = Date.now()): string {
  const at = Date.parse(since);
  if (Number.isNaN(at)) return '';
  if (now - at >= 7 * 86400_000 - 60_000) return t('From the last 7 days');
  return t('Since you last looked, {when}', { when: relativeTime(since, now) });
}

export type Tone = 'amber' | 'emerald' | 'rose' | 'sky' | 'zinc';

/** Short label and colour for an item's kind and status. */
export function itemLabel(item: Pick<AwayItem, 'kind' | 'status'>): { label: string; tone: Tone } {
  switch (item.kind) {
    case 'question':
      return { label: t('Question'), tone: 'amber' };
    case 'approval':
      // Its turn stopped waiting, but the card is open and a late Allow resumes the work.
      return item.status === 'waiting' ? { label: t('Still open'), tone: 'sky' } : { label: t('Needs approval'), tone: 'amber' };
    case 'routine_run':
      return item.status === 'ok' ? { label: t('Routine ran'), tone: 'emerald' } : { label: t('Routine failed'), tone: 'rose' };
    case 'delegation':
      switch (item.status) {
        case 'completed':
          return { label: t('Handoff done'), tone: 'emerald' };
        case 'stuck':
          return { label: t('Stuck'), tone: 'amber' };
        case 'interrupted':
          return { label: t('Interrupted'), tone: 'rose' };
        default:
          return { label: t('Handoff failed'), tone: 'rose' };
      }
  }
  return { label: item.status, tone: 'zinc' };
}

/** A provider's own limit message ("You've hit your session limit · resets 3am"): never a result. The server
 * keeps these out of replies and summaries; this is the second guard on the card. */
const LIMIT_LINE = /\b(?:hit|reached|exceeded)\s+your\b[^.\n]{0,24}\blimit\b|\b(?:session|weekly|usage|opus)\s+limit\b|\blimit\b[^.\n]{0,12}\bresets?\b/i;
export const isLimitLine = (text: string | null | undefined): boolean => !!text && LIMIT_LINE.test(text);

/** The summary line a card shows: empty for a limit message, so the card shows its title alone. */
export const awaySummary = (item: Pick<AwayItem, 'summary' | 'title'>): string => (isLimitLine(item.summary) ? '' : item.summary);

/** Sidebar badge text: nothing at 0, "99+" past 99. */
export const badgeText = (n: number): string => (n <= 0 ? '' : n > 99 ? '99+' : String(n));

export const isAwayEmpty = (r: Pick<AwayResponse, AwaySection> | null): boolean =>
  !!r && r.waiting.length === 0 && r.finished.length === 0 && r.failed.length === 0;

/** Where clicking an item goes: exactly one of thread, channel or direct chat. */
export type AwayTarget = { thread: string; kwant: string } | { channel: string } | { direct: string };

export function awayTarget(item: Pick<AwayItem, 'kwant_id' | 'link'>): AwayTarget {
  const l = item.link;
  if (l.thread_id) return { thread: l.thread_id, kwant: item.kwant_id };
  if (l.channel_id) return { channel: l.channel_id };
  return { direct: l.direct_kwant_id || item.kwant_id };
}

/** Drops an acted-on item right away, before the refresh confirms it. */
export function withoutItem(r: AwayResponse, section: AwaySection, id: string): AwayResponse {
  const list = r[section].filter((i) => i.id !== id);
  if (list.length === r[section].length) return r;
  const dropped = section === 'waiting' ? 1 : 0;
  return {
    ...r,
    [section]: list,
    unseen: { ...r.unseen, waiting: Math.max(0, r.unseen.waiting - dropped), total: Math.max(0, r.unseen.total - dropped) },
  };
}

/** The message for a failed one-tap action; a 409 means the request lapsed meanwhile. */
export const actionErrorText = (status: number, fallback: string): string =>
  status === 409 || status === 404 ? t('This request expired') : fallback;

/** Outcome of a one-tap action; `info` is neither a success nor a failure (a card that expired). */
export interface AwayNotice {
  text: string;
  error: boolean;
  info?: boolean;
}

/**
 * The notice for a failed one-tap action. A card that expired before it was answered is not an error:
 * the server's own sentence ("This card expired: … Ask the bot again.") is shown as a plain notice.
 */
export function actionFailureNotice(status: number, serverMessage: string, title: string): AwayNotice {
  if (status === 409 && /^This card expired\b/.test(serverMessage)) return { text: t('{message} (“{title}”)', { message: serverMessage, title }), error: false, info: true };
  return { text: t('{error}: “{title}”', { error: actionErrorText(status, t("Couldn't send it: {error}", { error: serverMessage })), title }), error: true };
}

export class AwayError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = t('Request failed (HTTP {status}).', { status: res.status });
    try {
      const data = await res.json();
      if (data && typeof data.error === 'string' && data.error) message = data.error;
    } catch {
      // no JSON body
    }
    throw new AwayError(res.status, message);
  }
  return res.json();
}

const enc = encodeURIComponent;

export const awayApi = {
  get: (since?: string) => call<AwayResponse>('GET', `/api/away${since ? `?since=${enc(since)}` : ''}`),
  seen: () => call<{ last_seen: string }>('POST', '/api/away/seen'),
  answer: (id: string, choice: number) => call<unknown>('POST', `/api/questions/${enc(id)}/answer`, { choice }),
  resolve: (id: string, decision: ApprovalDecision) => call<unknown>('POST', `/api/approvals/${enc(id)}/resolve`, { decision }),
};

/** SSE events that can change what the page shows, so the badge re-counts. */
const AWAY_EVENTS = new Set([
  'question_updated', 'QuestionUpdated',
  'delegation_updated', 'DelegationUpdated',
  'routine_run', 'RoutineRun',
  'ApprovalRequired', 'ApprovalWithdrawn',
]);
export const affectsAway = (type: unknown): boolean => typeof type === 'string' && AWAY_EVENTS.has(type);

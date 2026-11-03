// Loose ends (Zombie Mission Hunter): things the person started and never finished, found
// read-only in their own conversations. Every route is person-only. Nothing here sends anything:
// a case carries a draft the person copies and sends themselves.
//
// The card is not tied to mail: `source`, `conv_kind` and `kind` are shown with a readable
// fallback, so later sources (a photographed letter, a bank statement) need no new card.

import { PersonCancelledError, personFetch } from './auth';
import { needsBitwardenFrom } from './passwordStore';
import { t, tc } from './i18n';

export interface Evidence {
  quote: string;
  from: string;
  at: string;
  outbound: boolean;
}

export interface CaseDraft {
  /** `email`, `github`, `kwant` or `letter` (a paper reply: copy only). Where the person sends it themselves. */
  channel: string;
  to: string | null;
  subject: string | null;
  body: string;
  mailto: string | null;
  open_url: string | null;
  kwant_thread_id: string | null;
  /** `template` or `model`. */
  generated_by: string;
  created_at: string;
}

export type CaseStatus = 'open' | 'snoozed' | 'dismissed' | 'waiting_reply' | 'closed';

export interface LooseCase {
  id: string;
  status: CaseStatus;
  kind: string;
  conv_kind: string;
  source: string;
  source_id: string;
  title: string;
  counterpart: string | null;
  counterpart_name: string | null;
  reference: string | null;
  link: string | null;
  why: string;
  evidence: Evidence[];
  draft: CaseDraft | null;
  age_days: number;
  last_activity_at: string;
  snoozed_until: string | null;
  waiting_since: string | null;
  follow_ups: number;
  /** `YYYY-MM-DD`. */
  deadline: string | null;
  resolution: string | null;
  dismiss_reason: string | null;
  /** The bot whose chat a `kwant_*` case is in; `null` for other sources and older cases. */
  kwant_id?: string | null;
}

export interface LooseSource {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  builtin: boolean;
  last_scan_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export type Tone = 'amber' | 'emerald' | 'rose' | 'sky' | 'zinc';

const KINDS: Record<string, { label: string; tone: Tone }> = {
  awaiting_reply: { label: t('No reply yet'), tone: 'amber' },
  promise_lapsed: { label: t('Promise passed'), tone: 'rose' },
  you_promised: { label: t('You promised'), tone: 'sky' },
  you_owe_reply: { label: t('You owe a reply'), tone: 'sky' },
  stale_issue: { label: t('Gone quiet'), tone: 'zinc' },
  failed_task: { label: t('Task failed'), tone: 'rose' },
  unanswered_question: { label: t('Question open'), tone: 'amber' },
  document_request: { label: t('Letter to deal with'), tone: 'sky' },
};

const SOURCES: Record<string, string> = { imap: t('Email'), github: 'GitHub', kwant: t('Bot chats'), document: t('Letter') };

/** `bank_statement` → `Bank statement`: how an unknown kind or source still reads. */
export function humanize(s: string): string {
  const words = s.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : t('Other');
}

export const kindLabel = (kind: string): { label: string; tone: Tone } => KINDS[kind] ?? { label: humanize(kind), tone: 'zinc' };
export const sourceLabel = (source: string): string => SOURCES[source] ?? humanize(source);

/** Which list a status belongs in. */
export type CaseTab = 'open' | 'snoozed' | 'waiting' | 'done';
export const CASE_TABS: Array<{ key: CaseTab; label: string; empty: string }> = [
  { key: 'open', label: tc('status', 'Open'), empty: t('Nothing is stalled. Loose ends show up here when something goes quiet.') },
  { key: 'waiting', label: t('Waiting'), empty: t('Nothing you followed up on is waiting for an answer.') },
  { key: 'snoozed', label: t('Snoozed'), empty: t('Nothing is snoozed.') },
  { key: 'done', label: t('Done'), empty: t('Nothing marked done or dismissed yet.') },
];
export function tabOf(status: string): CaseTab {
  if (status === 'snoozed') return 'snoozed';
  if (status === 'waiting_reply') return 'waiting';
  if (status === 'closed' || status === 'dismissed') return 'done';
  return 'open';
}

export type CaseAction = 'draft' | 'snooze' | 'dismiss' | 'done' | 'followed-up' | 'reopen';

/** The buttons a case offers in its status. */
export function actionsFor(c: Pick<LooseCase, 'status' | 'draft'>): CaseAction[] {
  switch (c.status) {
    case 'open':
      return [...(c.draft ? (['draft'] as CaseAction[]) : []), 'followed-up', 'snooze', 'dismiss', 'done'];
    case 'snoozed':
    case 'waiting_reply':
      return ['reopen', 'done', 'dismiss'];
    default:
      return ['reopen'];
  }
}

export const ACTION_LABELS: Record<CaseAction, string> = {
  draft: t('Draft again'),
  snooze: t('Snooze'),
  dismiss: t('Dismiss'),
  done: t('Mark done'),
  'followed-up': t('I followed up'),
  reopen: t('Reopen'),
};

/** What changed, for the status line after an action. */
export function actionDoneText(a: CaseAction, c: LooseCase): string {
  const title = c.title;
  switch (a) {
    case 'draft':
      return t('New draft for “{title}”.', { title });
    case 'snooze':
      return c.snoozed_until ? t('Snoozed “{title}” until {date}.', { title, date: shortDate(c.snoozed_until) }) : t('Snoozed “{title}”.', { title });
    case 'dismiss':
      return t('Dismissed “{title}”. It won’t come back.', { title });
    case 'done':
      return t('Marked “{title}” done.', { title });
    case 'followed-up':
      return t('“{title}” is waiting for an answer. It comes back if nobody replies.', { title });
    case 'reopen':
      return t('Reopened “{title}”.', { title });
  }
}

export const shortDate = (iso: string): string => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const ageText = (days: number): string => (days <= 0 ? t('today') : t(days === 1 ? '{n} day quiet' : '{n} days quiet', { n: days }));

/** A promised date: "was due 3 Oct 2026" once passed, else "due …". */
export function deadlineText(deadline: string, now = Date.now()): { text: string; passed: boolean } {
  const end = new Date(`${deadline}T23:59:59`).getTime();
  const passed = !Number.isNaN(end) && end < now;
  return { text: passed ? t('Was due {date}', { date: shortDate(deadline) }) : t('Due {date}', { date: shortDate(deadline) }), passed };
}

/** Only web links open from a card; anything else (kwant://, javascript:) is shown, not linked. */
export const safeHref = (url: string | null | undefined, scheme: 'https' | 'mailto' = 'https'): string | null =>
  url && url.toLowerCase().startsWith(`${scheme}:`) ? url : null;

/** The bot chat a case came from, to open in the app. Needs both the bot (`kwant_id`, missing on
 * cases found before it was added) and the thread (`kwant://thread/<id>` in `link`). */
export function caseChat(c: Pick<LooseCase, 'kwant_id' | 'link' | 'draft'>): { kwantId: string; threadId: string } | null {
  const fromLink = c.link?.startsWith('kwant://thread/') ? c.link.slice('kwant://thread/'.length) : null;
  const threadId = fromLink || c.draft?.kwant_thread_id || null;
  return c.kwant_id && threadId ? { kwantId: c.kwant_id, threadId } : null;
}

/** The text "Copy draft" puts on the clipboard. */
export const draftCopyText = (d: CaseDraft): string => (d.subject ? `Subject: ${d.subject}\n\n${d.body}` : d.body);

/** Where the person sends a draft themselves. */
export function draftOpen(d: CaseDraft): { href: string; label: string } | null {
  const mail = safeHref(d.mailto, 'mailto');
  if (mail) return { href: mail, label: t('Open in my mail app') };
  const web = safeHref(d.open_url);
  if (web) return { href: web, label: d.channel === 'github' ? t('Open on GitHub') : t('Open') };
  return null;
}

/** Why a call failed, as the panel shows it. */
export class LooseEndsError extends Error {
  constructor(
    message: string,
    public status: number,
    /** 409: a space or bot isn't on "Ask before running commands" and the login would sit on this server; Bitwarden first. */
    public needsBitwarden = false,
    /** 423: Bitwarden holds the logins and is locked. */
    public locked = false,
    /** The server's `code`, e.g. `busy` on a 409. */
    public code: string | null = null,
  ) {
    super(message);
  }
}

const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return t;
  const c = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};

export async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await personFetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof PersonCancelledError) throw new LooseEndsError(e.message, 401);
    throw new LooseEndsError(t('Couldn’t reach the server. Check your connection and try again.'), 0);
  }
  const answer = await res.json().catch(() => null);
  if (res.ok) return answer as T;
  const needs = needsBitwardenFrom(res.status, answer);
  if (needs) throw new LooseEndsError(needs.message, 409, true);
  const err = answer && typeof answer === 'object' ? (answer as Record<string, unknown>).error : null;
  const code = answer && typeof answer === 'object' && typeof (answer as Record<string, unknown>).code === 'string' ? ((answer as Record<string, unknown>).code as string) : null;
  const msg = typeof err === 'string' && err.trim() ? sentence(err) : t('Something went wrong (HTTP {status}).', { status: res.status });
  if (res.status === 423) throw new LooseEndsError(msg, 423, false, true);
  if (res.status === 403) throw new LooseEndsError(t('Only you can see and change loose ends.'), 403);
  if (res.status === 404 && !err) throw new LooseEndsError(t('This server doesn’t have loose ends yet. Update the app and try again.'), 404);
  throw new LooseEndsError(msg, res.status, false, false, code);
}

const enc = encodeURIComponent;

export interface NewSource {
  kind: 'imap' | 'github';
  label: string;
  config: Record<string, unknown>;
  secret: string;
}

/**
 * Who gets a turn when a review picks cases or a letter deadline comes up (`/api/zombie/owner`,
 * per space). The bot only prepares drafts and next steps; nothing is sent without the person.
 */
export interface LooseOwner {
  enabled: boolean;
  /** The picked bot, or null for the space's lead. */
  kwant_id: string | null;
  daily_cap: number;
  /** The bot that would get the turn now (the pick or the lead), or null when there is none. */
  owner: { id: string; name: string } | null;
  used_today: number;
}
export type LooseOwnerChange = Pick<LooseOwner, 'enabled' | 'kwant_id' | 'daily_cap'>;

/** The PUT body for one change, keeping the rest as it is. */
export const ownerChange = (o: LooseOwner, change: Partial<LooseOwnerChange>): LooseOwnerChange => ({
  enabled: o.enabled,
  kwant_id: o.kwant_id,
  daily_cap: o.daily_cap,
  ...change,
});

/** The line under the setting: who, how often, and how much of today's cap is used. */
export function ownerSummary(o: LooseOwner): string {
  if (!o.enabled) return t('Off. Reviews and deadlines still notify you, but no bot starts on them.');
  if (!o.owner) return t('No bot to start: this space has no lead yet. Pick a bot below.');
  if (o.daily_cap === 0) return t('{name} is picked, but the daily limit is 0, so no turn starts.', { name: o.owner.name });
  const used = Math.min(o.used_today, o.daily_cap);
  return t(
    o.daily_cap === 1
      ? '{name} prepares drafts and next steps, up to {n} time a day ({used} used today, UTC). Nothing is sent without you.'
      : '{name} prepares drafts and next steps, up to {n} times a day ({used} used today, UTC). Nothing is sent without you.',
    { name: o.owner.name, n: o.daily_cap, used },
  );
}

export const looseApi = {
  cases: () => call<{ cases: LooseCase[]; running: boolean }>('/api/zombie/cases'),
  act: (id: string, action: CaseAction, body?: unknown) => call<LooseCase>(`/api/zombie/cases/${enc(id)}/${action}`, 'POST', body ?? {}),
  sources: () => call<{ sources: LooseSource[]; vault_locked: boolean }>('/api/zombie/sources'),
  addSource: (s: NewSource) => call<{ source: LooseSource; test: unknown }>('/api/zombie/sources', 'POST', s),
  setEnabled: (id: string, enabled: boolean) => call<{ source: LooseSource }>(`/api/zombie/sources/${enc(id)}`, 'PATCH', { enabled }),
  removeSource: (id: string) => call<{ deleted: boolean; cases_removed: number }>(`/api/zombie/sources/${enc(id)}`, 'DELETE'),
  testSource: (id: string) => call<{ ok: boolean; test: unknown }>(`/api/zombie/sources/${enc(id)}/test`, 'POST'),
  run: () => call<{ started: boolean }>('/api/zombie/run', 'POST', {}),
  status: () => call<{ running: boolean; next_review_at: string | null }>('/api/zombie/status'),
  owner: () => call<LooseOwner>('/api/zombie/owner'),
  setOwner: (o: LooseOwnerChange) => call<LooseOwner>('/api/zombie/owner', 'PUT', o),
  bots: () => call<Array<{ id: string; name: string }>>('/api/kwants'),
};

/** IMAP over plain text or with a self-signed certificate is only for a server on this computer. */
export const isLoopbackHost = (host: string): boolean => {
  const h = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
};

export interface ImapFields {
  label: string;
  host: string;
  port: string;
  security: 'tls' | 'starttls' | 'plain';
  username: string;
  folders: string;
  accept_invalid_certs: boolean;
}

/** The IMAP form as the API wants it, or why it can't be sent yet. */
export function imapSource(f: ImapFields, secret: string): NewSource | { error: string } {
  const host = f.host.trim();
  if (!host) return { error: t('Enter the mail server, like imap.gmail.com.') };
  if (!f.username.trim()) return { error: t('Enter the mailbox login, usually your email address.') };
  if (!secret) return { error: t('Enter the password. For Gmail, use an app password.') };
  const port = Number(f.port || (f.security === 'tls' ? 993 : 143));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: t('The port must be a number like 993.') };
  const local = isLoopbackHost(host);
  if (f.security === 'plain' && !local) return { error: t('An unencrypted connection is only allowed to a server on this computer.') };
  return {
    kind: 'imap',
    label: f.label.trim() || f.username.trim(),
    config: {
      host,
      port,
      security: f.security,
      username: f.username.trim(),
      folders: f.folders
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      accept_invalid_certs: local && f.accept_invalid_certs,
    },
    secret,
  };
}

export function githubSource(label: string, apiBase: string, token: string): NewSource | { error: string } {
  if (!token) return { error: t('Enter a GitHub token. It only needs to read issues and pull requests.') };
  const base = apiBase.trim() || 'https://api.github.com';
  return { kind: 'github', label: label.trim() || 'GitHub', config: { api_base: base }, secret: token };
}

/** One line for a source's last scan. */
export function sourceStatusText(s: LooseSource): { text: string; error: boolean } {
  if (!s.enabled) return { text: t('Off'), error: false };
  if (s.last_status === 'error' || s.last_error) return { text: s.last_error ? sentence(s.last_error) : t('The last scan failed.'), error: true };
  if (s.last_scan_at) return { text: t('Last read {date}', { date: shortDate(s.last_scan_at) }), error: false };
  return { text: t('Not read yet'), error: false };
}

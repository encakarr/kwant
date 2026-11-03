// Camera-to-Completed: a photographed or uploaded letter becomes a Loose ends case (`source:
// "document"`). kwant reads it once and marks what it isn't sure of. A field it is sure of is
// confirmed on its own (`auto`) and can still be edited or cleared; an uncertain one waits for the
// person. Only a confirmed, certain deadline starts reminders. Nothing is ever
// sent: the reply is a draft the person copies (or opens in their own mail app).

import { LooseCase, LooseEndsError, call, shortDate } from './looseEnds';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import { t } from './i18n';

export interface LetterField {
  value: string;
  /** Where in the letter the value came from; empty when kwant found no quote. */
  quote: string;
  uncertain: boolean;
  confirmed: boolean;
  /** Confirmed on its own because kwant was sure; the person hasn't touched it. Absent means false. */
  auto?: boolean;
  /** Checklist items only. */
  done?: boolean | null;
}

export type SingleKey = 'sender' | 'request' | 'reply_to' | 'deadline';
export type ListKey = 'references' | 'amounts' | 'checklist';

export interface LetterFields {
  sender?: LetterField | null;
  request?: LetterField | null;
  reply_to?: LetterField | null;
  deadline?: LetterField | null;
  references?: LetterField[];
  amounts?: LetterField[];
  checklist?: LetterField[];
}

export type ReadStatus = 'running' | 'read' | 'text_only' | 'unreadable';

export interface LetterPage {
  id: string;
  name: string;
  mime: string;
  url: string;
}

export interface Extraction {
  status: ReadStatus | string;
  method: string | null;
  note: string | null;
  fields: LetterFields;
  text: string;
  read_by: string | null;
  pages: LetterPage[];
  updated_at: string;
}

export interface Reminder {
  offset_days: number;
  due_at: string;
  fired_at: string | null;
}

export interface LetterView {
  case: LooseCase;
  extraction: Extraction | null;
  reminders: Reminder[];
}

export const MAX_LETTER_PAGES = 5;
export const LETTER_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const LETTER_EXTS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
/** For the file picker. */
export const LETTER_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf';

/** A page's type from the browser's MIME, or its extension when the browser gives none. */
export function letterMime(f: { name: string; type: string }): string | null {
  const type = f.type.toLowerCase();
  if (LETTER_MIMES.includes(type)) return type;
  if (type && type !== 'application/octet-stream') return null;
  const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase();
  return (ext && LETTER_EXTS[ext]) || null;
}

/** Why these pages can't be read as one letter, or null. Checked before anything is uploaded. */
export function checkLetterFiles(files: Array<{ name: string; type: string; size: number }>): string | null {
  if (files.length === 0) return t('Add a photo or a PDF of the letter.');
  if (files.length > MAX_LETTER_PAGES) return t('A letter can have at most {max} pages. You picked {n}: remove {extra}.', { max: MAX_LETTER_PAGES, n: files.length, extra: files.length - MAX_LETTER_PAGES });
  for (const f of files) {
    const name = f.name || t('That file');
    if (!letterMime(f)) return t('{name} isn’t a photo or a PDF. Use PNG, JPEG, WebP or PDF.', { name });
    if (f.size === 0) return t('{name} is empty.', { name });
    if (f.size > MAX_ATTACHMENT_BYTES) return t('{name} is too big ({size} MB). Max 20 MB per page.', { name, size: (f.size / (1024 * 1024)).toFixed(1) });
  }
  return null;
}

/** A real calendar date written `YYYY-MM-DD`, the only form a deadline is saved in. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** An amount kwant can save: a number and a currency (`GBP 142.60`, `£142.60`, `142,60 EUR`). */
export const looksLikeAmount = (s: string): boolean => /\d/.test(s) && (/(^|[^A-Za-z])[A-Z]{3}([^A-Za-z]|$)/.test(s) || /[€$£₴]/.test(s));

export const MAX_FIELD_CHARS = 500;

/** Why a value can't be saved in this field, or null. The server checks again. */
export function fieldValueError(key: SingleKey | ListKey, value: string): string | null {
  const v = value.trim();
  if (!v) return t('Type something, or use Clear to remove it.');
  if (v.length > MAX_FIELD_CHARS) return t('At most {n} characters.', { n: MAX_FIELD_CHARS });
  if (key === 'deadline' && !isIsoDate(v)) return t('Write the date as YYYY-MM-DD, for example 2026-11-14.');
  if (key === 'amounts' && !looksLikeAmount(v)) return t('Include the currency, for example GBP 142.60.');
  return null;
}

export type FieldState = 'empty' | 'confirmed' | 'uncertain' | 'unconfirmed';

/** Confirmed wins: the person checked it. Otherwise an uncertain mark is never hidden. */
export function fieldState(f: LetterField | null | undefined): FieldState {
  if (!f || !f.value) return 'empty';
  if (f.confirmed && !f.uncertain) return 'confirmed';
  if (f.uncertain) return 'uncertain';
  return 'unconfirmed';
}

export const FIELD_STATE_LABEL: Record<FieldState, string> = {
  empty: t('Empty'),
  confirmed: t('Confirmed'),
  uncertain: t('Uncertain'),
  unconfirmed: t('Not checked yet'),
};

export const SINGLE_FIELDS: Array<{ key: SingleKey; label: string; hint: string }> = [
  { key: 'sender', label: t('From'), hint: t('Who sent the letter') },
  { key: 'request', label: t('What they want'), hint: t('What the letter asks you to do') },
  { key: 'deadline', label: t('Deadline'), hint: 'YYYY-MM-DD' },
  { key: 'reply_to', label: t('Reply to'), hint: t('An email or postal address from the letter') },
];

export const LIST_FIELDS: Array<{ key: ListKey; label: string; hint: string; empty: string }> = [
  { key: 'references', label: t('References'), hint: t('Account or case number'), empty: t('No reference numbers found.') },
  { key: 'amounts', label: t('Amounts'), hint: 'GBP 142.60', empty: t('No amounts found.') },
  { key: 'checklist', label: t('Checklist'), hint: t('Something to do'), empty: t('Nothing to do was found.') },
];

/** The body for confirming a single field as it is, setting it, or clearing it. */
export const confirmBody = (key: SingleKey) => ({ [key]: {} });
export const setBody = (key: SingleKey, value: string) => ({ [key]: { value: value.trim() } });
export const clearBody = (key: SingleKey) => ({ [key]: null });

/** A list is always sent whole. Saving it confirms every item in it (the server's rule). */
/** A whole list for the server. `confirm` confirms every entry as it is; without it only new or changed entries are confirmed. */
export function listBody(key: ListKey, items: Array<{ value: string; done?: boolean | null }>, confirm = false) {
  return {
    [key]: items.map((i) => ({
      value: i.value.trim(),
      ...(key === 'checklist' ? { done: !!i.done } : {}),
      ...(confirm ? { confirmed: true } : {}),
    })),
  };
}

/** How far kwant got with the letter, said plainly. */
export function readingText(e: Extraction | null): { title: string; body: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' } {
  if (!e) return { title: t('Waiting to read'), body: t('This letter hasn’t been read yet.'), tone: 'sky' };
  const note = e.note ? ` ${sentence(e.note)}` : '';
  // The server's note may already ask the person to fill the fields in: don't say it twice
  const fillIn = (text: string) => (/fill in the fields/i.test(e.note ?? '') ? '' : ` ${text}`);
  switch (e.status) {
    case 'running':
      return { title: t('Reading the letter…'), body: t('This usually takes under a minute. You can leave this page; the case stays in Loose ends.'), tone: 'sky' };
    case 'read':
      return {
        title: t('Read'),
        body: t('{method} Fields marked Uncertain need you to check them against the letter; the rest are confirmed already.', { method: methodText(e.method) }),
        tone: 'emerald',
      };
    case 'text_only':
      return {
        title: t('Only the PDF text was read'),
        body: `${t('The text was kept, but the details couldn’t be picked out.')}${note}${fillIn(t('Fill in the fields from the letter.'))}`,
        tone: 'amber',
      };
    case 'unreadable':
      return {
        title: t('This letter couldn’t be read'),
        body: `${t('Nothing was picked out of it.')}${note}${fillIn(t('Fill in the fields yourself from the pages shown here.'))}`,
        tone: 'rose',
      };
    default:
      return { title: t('Unknown state'), body: `${t('The reader reports “{status}”.', { status: e.status })}${note}`, tone: 'amber' };
  }
}

export function methodText(method: string | null): string {
  switch (method) {
    case 'pdf_text':
      return t('Read from the PDF’s text.');
    case 'model_vision':
      return t('Read from the photos by your Claude model: compare each field with the page.');
    case 'pdf_text+model_vision':
      return t('Read from the PDF’s text and, for the photos, by your Claude model.');
    default:
      return '';
  }
}

/** Whether reminders run, and why not. Mirrors the server: confirmed and not uncertain. */
export function reminderGate(deadline: LetterField | null | undefined): { on: boolean; text: string } {
  const s = fieldState(deadline);
  if (s === 'empty') return { on: false, text: t('No deadline yet. Reminders start once you add and confirm one.') };
  if (s === 'uncertain') return { on: false, text: t('The deadline is marked uncertain, so there are no reminders. Check it against the letter and confirm it to start them.') };
  if (s === 'unconfirmed') return { on: false, text: t('Reminders start once you confirm the deadline.') };
  return { on: true, text: t('Reminders 7 days before, 1 day before and on {date}, at 09:00.', { date: shortDate(deadline!.value) }) };
}

/** Confirmed by kwant itself, not by the person. */
export const isAuto = (f: LetterField | null | undefined): boolean => fieldState(f) === 'confirmed' && !!f?.auto;

/** How many fields still need the person: the uncertain ones. */
export function needsLook(fields: LetterFields | null | undefined): number {
  if (!fields) return 0;
  const all = [fields.sender, fields.request, fields.reply_to, fields.deadline, ...(fields.references ?? []), ...(fields.amounts ?? []), ...(fields.checklist ?? [])];
  return all.filter((f) => fieldState(f) === 'uncertain').length;
}

export const reminderLabel = (offset: number): string => (offset === 0 ? t('On the day') : t(offset === 1 ? '{n} day before' : '{n} days before', { n: offset }));

export const reminderWhen = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Text for a refused upload of a letter: busy reads calmly, the rest says what to change. */
export function letterErrorText(e: unknown): { text: string; calm: boolean } {
  if (e instanceof LooseEndsError) {
    if (e.status === 409 && e.code === 'busy') return { text: t('Another letter is being read right now. Your pages are saved here: try again in a minute.'), calm: true };
    if (e.status === 409) return { text: `${e.message} ${t('Pick the pages again.')}`, calm: false };
    return { text: e.message, calm: false };
  }
  return { text: e instanceof Error ? e.message : t('Something went wrong.'), calm: false };
}

/** Text for a refused delete. The letter is never half-deleted. */
export function deleteErrorText(e: unknown): { text: string; calm: boolean } {
  if (e instanceof LooseEndsError && e.status === 409) return { text: t('This letter is still being read. It can be deleted once reading finishes.'), calm: true };
  return { text: `${e instanceof Error ? e.message : t('Something went wrong.')} ${t('Nothing was deleted.')}`, calm: false };
}

/** Where a letter's reply goes. Nothing is ever sent from kwant. */
export function draftChannelText(channel: string): string {
  if (channel === 'email') return t('Nothing is sent from kwant bots. Copy the reply, or open it in your own mail app and send it from there.');
  if (channel === 'letter') return t('Nothing is sent from kwant bots. This is a paper reply: copy it, then print or write it out and post it yourself.');
  return t('Nothing is sent from kwant bots. Copy it and send it yourself.');
}

export const isLetter = (c: Pick<LooseCase, 'source'>) => c.source === 'document';

/** Poll while kwant reads. */
export const stillReading = (v: LetterView | null) => !!v && (!v.extraction || v.extraction.status === 'running');

const sentence = (s: string) => {
  const x = s.trim();
  if (!x) return x;
  // The brand stays lowercase ("kwant restarted while reading it").
  const c = /^kwant\b/.test(x) ? x : x[0].toUpperCase() + x.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};

const enc = encodeURIComponent;

export const letterApi = {
  create: (attachment_ids: string[]) => call<{ case_id: string }>('/api/documents', 'POST', { attachment_ids }),
  get: (id: string) => call<LetterView>(`/api/documents/${enc(id)}`),
  remove: (id: string) => call<{ deleted: boolean }>(`/api/documents/${enc(id)}`, 'DELETE'),
  patch: (id: string, body: Record<string, unknown>) => call<LetterView>(`/api/zombie/cases/${enc(id)}/fields`, 'PATCH', body),
};

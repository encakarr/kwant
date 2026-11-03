// The line under "Sending your question to X" on Laya's routing card: why that bot, in words that
// match how it was actually picked.
import { t } from './i18n';

export type RouteBasis =
  | 'skills'
  | 'lead'
  | 'keywords'
  | 'only'
  | 'several'
  | 'discuss'
  | 'team'
  | 'asked'
  | 'last'
  | 'concierge'
  | 'ask'
  | 'handback'
  | 'learned'
  | 'jev';

export interface RouteReasonInput {
  kwantName?: string;
  reason?: string;
  basis?: string;
  fallback?: boolean;
  matchedTerms?: string[];
  /** Basis "handback": the name of the bot that said it wasn't their area. */
  handedBackBy?: string;
}

/** "Lin handed this back (…), so Ada takes it": the server's handback sentence starts with the name. */
const handbackName = (reason?: string) => reason?.match(/^(\S+) handed this back\b/)?.[1];

/** The fixed line for the router's newer picks (Concierge, ask card, hand-back, learned), or null for
 *  any other basis. These always use the app's own wording, never the server's longer sentence. */
export function pickedLine(r: RouteReasonInput): string | null {
  const name = r.kwantName || t('another bot');
  switch (r.basis) {
    case 'concierge':
      return t('No specialist fits, answering generally.');
    case 'ask':
      return t('You picked {name}.', { name });
    case 'handback':
      return t('{by} said it’s not their area, so {name} took it.', { by: r.handedBackBy || handbackName(r.reason) || t('The first bot'), name });
    case 'learned':
      return t('You sent a message like this to {name} before.', { name });
    default:
      return null;
  }
}

/** True when the server wrote its own sentence for this pick. Older servers say "Laya picked …" for
 *  every pick, even the lead fallback, so that wording is never trusted when a basis says otherwise. */
export function serverReason(r: { reason?: string; basis?: string }): string | null {
  const reason = r.reason?.trim();
  if (!reason || !r.basis || /^laya picked\b/i.test(reason)) return null;
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
}

export function routeReasonText(r: RouteReasonInput): string | null {
  const picked = pickedLine(r);
  if (picked) return picked;
  const own = serverReason(r);
  if (own) return own;
  const name = r.kwantName || t('the team lead');
  const terms = (r.matchedTerms ?? []).filter(Boolean).slice(0, 4);
  switch (r.basis) {
    case 'lead':
      return t('No one’s role matched this, so it went to the team lead, {name}.', { name });
    case 'only':
      return t('{name} is the only bot here that can answer.', { name });
    case 'team':
      return t('This asks to put a team of bots together, so it went to the lead, {name}, to propose them for you to approve.', { name });
    case 'keywords':
      return terms.length ? t('Picked by matching words: {terms}.', { terms: terms.join(t(', ')) }) : t('Picked by matching words in your message.');
    default:
      // Older servers phrase every pick, even the lead fallback, as "Laya picked …".
      return r.reason || null;
  }
}

// A bot's thinking effort (its settings, under the engine and model): auto lets the router pick low,
// medium or high for each message; the others fix it for every message. xhigh and max are only
// ever chosen here: Claude Code and Codex run them as is (Codex steps down to what the model lists),
// Grok tops out at xhigh, model APIs use the deep tier. See src/server/bot_effort.rs.
import { t } from './i18n';

export type EffortChoice = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_CHOICES: readonly { value: EffortChoice; label: string }[] = [
  { value: 'auto', label: t('Auto (picked per message)') },
  { value: 'low', label: t('Low · fast model') },
  { value: 'medium', label: t('Medium · balanced model') },
  { value: 'high', label: t('High · deep model') },
  { value: 'xhigh', label: t('Extra high (xhigh)') },
  { value: 'max', label: t('Max') },
];

export const isEffortChoice = (v: unknown): v is EffortChoice => EFFORT_CHOICES.some((c) => c.value === v);

/** The line under the picker, for the chosen effort. */
export function effortHint(effort: EffortChoice): string {
  switch (effort) {
    case 'auto':
      return t('Each message gets low, medium or high, from what it asks.');
    case 'xhigh':
    case 'max':
      return t('Slower and uses much more of your limits. Claude Code and Codex run it as is (Codex steps down when the model tops out lower); Grok runs xhigh at most; model APIs run their deepest model.');
    default:
      return t('Every message runs at this effort. Unless a model is pinned, it also picks the model tier.');
  }
}

const url = (kwantId: string) => `/api/settings/bot-effort/${encodeURIComponent(kwantId)}`;

/** The bot's effort; "auto" when unset or the server is older. */
export async function loadBotEffort(kwantId: string): Promise<EffortChoice> {
  try {
    const res = await fetch(url(kwantId));
    const data = res.ok ? await res.json() : null;
    return isEffortChoice(data?.effort) ? data.effort : 'auto';
  } catch {
    return 'auto';
  }
}

/** Saves the bot's effort; the error text when it fails. */
export async function saveBotEffort(kwantId: string, effort: EffortChoice): Promise<string | null> {
  try {
    const res = await fetch(url(kwantId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort }) });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error || t('Couldn’t save the thinking effort (HTTP {status}).', { status: res.status });
  } catch {
    return t('Couldn’t save the thinking effort.');
  }
}

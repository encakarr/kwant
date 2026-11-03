// The interface language. The English text is the key: t('Save') reads "Save" in English and its
// translation in another language, so the English stays in the code (and in upstream diffs) and a
// missing translation falls back to it. The language is picked once at load (a change reloads the
// page), so module-level t() calls are safe.
//
// - t('Delete {name}?', { name }) fills {placeholders}.
// - tj('Press {key} to send', { key: <kbd>Enter</kbd> }) does the same with React nodes.
// - Plurals: t(n === 1 ? '{n} bot' : '{n} bots', { n }).
// - One English word, two meanings: tc('task status', 'Review') looks up 'Review|task status' first
//   (待审核, where plain 'Review' is 查看), and reads "Review" in English.
// - The first argument is a string literal (tests/i18n.test.mjs checks each one has a translation);
//   tDynamic() is for text that only exists at run time.
import React from 'react';
import zhCN from './zh-CN';

export type Locale = 'en' | 'zh-CN';
export type LocaleChoice = 'auto' | Locale;
export const LOCALES: readonly Locale[] = ['en', 'zh-CN'];
export const LOCALE_KEY = 'kwnt:locale';

type Vars = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Record<string, string> | null> = { en: null, 'zh-CN': zhCN };

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** What the person chose in App settings; "auto" follows the browser. */
export function localeChoice(): LocaleChoice {
  const saved = storage()?.getItem(LOCALE_KEY);
  return saved === 'en' || saved === 'zh-CN' ? saved : 'auto';
}

/** The language to show for a choice and the browser's preferred languages. */
export function detectLocale(choice: LocaleChoice, languages: readonly string[]): Locale {
  if (choice !== 'auto') return choice;
  for (const lang of languages) {
    const l = lang.toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

const browserLanguages = (): readonly string[] => {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
};

export const locale: Locale = detectLocale(localeChoice(), browserLanguages());

/** Saves the choice and reloads, so every text is shown in the new language. */
export function setLocaleChoice(choice: LocaleChoice): void {
  const s = storage();
  if (!s) return;
  if (choice === 'auto') s.setItem(LOCALE_KEY, '');
  else s.setItem(LOCALE_KEY, choice);
  if (typeof location !== 'undefined') location.reload();
}

const dictionary = DICTIONARIES[locale];

/** `text` in the interface language, with {placeholders} filled from `vars`. */
export function translate(dict: Record<string, string> | null, text: string, vars?: Vars): string {
  const s = dict?.[text] || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function t(text: string, vars?: Vars): string {
  return translate(dictionary, text, vars);
}

/** t() for a word whose translation depends on where it is shown: the key is `text|context`. */
export function tc(context: string, text: string, vars?: Vars): string {
  const key = `${text}|${context}`;
  return translate(dictionary, dictionary?.[key] ? key : text, vars);
}

/** t() for text only known at run time (not checked for a translation). */
export function tDynamic(text: string, vars?: Vars): string {
  return translate(dictionary, text, vars);
}

/** t() with React nodes for placeholders: `tj('Press {key} to send', { key: <kbd>Enter</kbd> })`. */
export function tj(text: string, vars: Record<string, React.ReactNode>): React.ReactNode {
  const s = dictionary?.[text] || text;
  const parts = s.split(/(\{\w+\})/);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    const node = m && m[1] in vars ? vars[m[1]] : part;
    return React.createElement(React.Fragment, { key: i }, node);
  });
}

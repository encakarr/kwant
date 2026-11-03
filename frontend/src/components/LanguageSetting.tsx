// The interface language, in App settings. The label is in both languages so it can be found
// whichever one is showing.
import React from 'react';
import { Languages } from 'lucide-react';
import { localeChoice, setLocaleChoice, t, type LocaleChoice } from '../i18n';

export const LanguageRow: React.FC = () => {
  const [choice, setChoice] = React.useState<LocaleChoice>(localeChoice());
  return (
    <div className="flex items-center gap-3 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
      <Languages size={15} className="text-sky-400 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <label htmlFor="language-choice" className="text-xs font-medium text-zinc-200">
          Language · 语言
        </label>
        <p className="mt-0.5 text-[11px] text-zinc-500">{t('The page reloads to switch the language.')}</p>
      </div>
      <select
        id="language-choice"
        value={choice}
        onChange={(e) => {
          const next = e.target.value as LocaleChoice;
          setChoice(next);
          setLocaleChoice(next);
        }}
        className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
      >
        <option value="auto">{t('Follow the browser')}</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </div>
  );
};

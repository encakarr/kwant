// Jev, a hosted decision model that picks who answers in a channel, set up in App settings.
// Off until a key is saved; without it (or when it fails) channels route as before.
import React from 'react';
import { Sparkles } from 'lucide-react';
import { t } from '../i18n';
import { loadJevActive } from '../jevStatus';

export interface JevView {
  enabled: boolean;
  url: string;
  api_key: string;
  model: string;
  active: boolean;
  default_url: string;
  default_model: string;
}

export const JEV_PRESETS = [
  { label: t('OpenCode Zen (free)'), url: 'https://opencode.ai/inference/systemone/v1/systemone', model: 'jev-1.13-free' },
  { label: 'TypeSafe', url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
] as const;

/** The status line under the title. */
export function jevStatus(view: JevView | null): string {
  if (!view) return t('Loading…');
  if (view.active) return t('On · {model} picks the model for each message and who answers in channels', { model: view.model });
  if (!view.api_key) return t('Off · add an API key to turn it on');
  return t('Off · channels pick by keywords and Laya');
}

const input =
  'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-sky-500 focus:outline-none';
const button =
  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400';

export const JevRoutingRow: React.FC = () => {
  const [view, setView] = React.useState<JevView | null>(null);
  const [url, setUrl] = React.useState('');
  const [model, setModel] = React.useState('');
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState<'save' | 'test' | null>(null);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  const show = (v: JevView) => {
    setView(v);
    setUrl(v.url);
    setModel(v.model);
    setKey(v.api_key);
  };

  React.useEffect(() => {
    fetch('/api/settings/jev')
      .then((r) => (r.ok ? r.json() : null))
      .then((v: JevView | null) => v && show(v))
      .catch(() => {});
  }, []);

  const send = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };
  const fields = () => ({ url: url.trim(), model: model.trim(), api_key: key });

  const save = async (enabled?: boolean) => {
    setBusy('save');
    setNote(null);
    try {
      const { ok, data } = await send('/api/settings/jev', { ...fields(), ...(enabled === undefined ? {} : { enabled }) });
      if (ok) {
        show(data as JevView);
        loadJevActive();
        setNote({ ok: true, text: t('Saved.') });
      } else setNote({ ok: false, text: data.error || t('Couldn’t save.') });
    } catch {
      setNote({ ok: false, text: t('Couldn’t reach the server.') });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setNote(null);
    try {
      const { ok, data } = await send('/api/settings/jev/test', fields());
      setNote(
        ok
          ? { ok: true, text: t('Works: picked {choice} for a sample message in {ms} ms.', { choice: data.choice, ms: data.elapsed_ms }) }
          : { ok: false, text: data.error || t('The test failed.') },
      );
    } catch {
      setNote({ ok: false, text: t('Couldn’t reach the server.') });
    } finally {
      setBusy(null);
    }
  };

  const on = !!view?.enabled;
  return (
    <div className="flex items-start gap-3 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
      <Sparkles size={15} className="mt-0.5 text-sky-400 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p id="jev-label" className="text-xs font-medium text-zinc-200">{t('Jev, smarter routing')}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400" role="status">{jevStatus(view)}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="jev-label"
            disabled={!view || busy !== null}
            onClick={() => save(!on)}
            className={`relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${on ? 'bg-sky-600' : 'bg-zinc-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform motion-reduce:transition-none ${on ? 'translate-x-4' : ''}`} />
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 leading-snug">
          {t(
            'Picks each message’s engine and model, and who answers in a channel, in Laya’s place. It reads the meaning of a message, so Chinese and other languages written without spaces route well too. Messages, the channel name and your bots’ names, titles and Good for / Not for lists are sent to the URL below.',
          )}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {JEV_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setUrl(p.url);
                setModel(p.model);
              }}
              className={`${button} bg-zinc-800 text-zinc-300 hover:bg-zinc-700`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="block text-[11px] text-zinc-400">
          {t('URL')}
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={view?.default_url} spellCheck={false} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block text-[11px] text-zinc-400">
            {t('Model')}
            <input className={input} value={model} onChange={(e) => setModel(e.target.value)} placeholder={view?.default_model} spellCheck={false} />
          </label>
          <label className="block text-[11px] text-zinc-400">
            {t('API key')}
            <input
              className={input}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onFocus={() => key.startsWith('•') && setKey('')}
              onBlur={() => !key && view?.api_key && setKey(view.api_key)}
              placeholder={t('Paste the key')}
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy !== null || !key} onClick={test} className={`${button} bg-zinc-800 text-zinc-200 hover:bg-zinc-700`}>
            {busy === 'test' ? t('Testing…') : t('Test')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => save()} className={`${button} bg-sky-600 text-white hover:bg-sky-500`}>
            {busy === 'save' ? t('Saving…') : t('Save')}
          </button>
          {note && (
            <span className={`text-[11px] ${note.ok ? 'text-emerald-400' : 'text-rose-400'}`} role={note.ok ? 'status' : 'alert'}>
              {note.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

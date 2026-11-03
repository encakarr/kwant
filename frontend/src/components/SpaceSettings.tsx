import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bot,
  CalendarClock,
  Check,
  Download,
  FileUp,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Settings2,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { playSfx } from '../audio/chiptune';
import { SPACE_COLORS, SPACE_ICONS, Space, spaceColor, spaceNameError, spacesApi } from '../spaces';
import { useEngines } from '../useEngines';
import { useProfiles } from '../useProfiles';
import type { Profile } from '../profiles';
import { AccountPriority } from './AccountPriority';
import { EnginesPanel } from './EnginesPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { RoutinesPanel, type RoutineFocus } from './RoutinesPanel';
import { HirePolicyPanel } from './HirePolicyPanel';
import { ModernAvatar } from './ModernAvatar';
import { SpaceTile } from './Spaces';
import { ImportDialog, RecentImports } from './ImportDialog';
import { ImportError, ImportRecord, downloadExport, importApi, importErrorText } from '../imports';
import { memberIdsOf, type Channel, type Kwant, type Team } from './Sidebar';
import { SpaceApprovalsSetting } from './ApprovalsSetting';

import type { SettingsScope, SpaceSettingsTab } from '../nav';
import { InstallAppButton } from './InstallAppButton';
import { editorProps, useEscapeLayer } from '../escape';
import { t } from '../i18n';

export type { SettingsScope, SpaceSettingsTab };

const TABS: Array<{ id: SpaceSettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: t('General'), icon: <Settings2 size={15} /> },
  { id: 'accounts', label: t('Accounts'), icon: <KeyRound size={15} /> },
  { id: 'bots', label: t('Kwant bots'), icon: <Bot size={15} /> },
  { id: 'teams', label: t('Teams'), icon: <Users size={15} /> },
  { id: 'connections', label: t('Connections'), icon: <Link2 size={15} /> },
  { id: 'tools', label: t('Tools'), icon: <Plug size={15} /> },
  { id: 'skills', label: t('Skills'), icon: <Sparkles size={15} /> },
  { id: 'routines', label: t('Routines'), icon: <CalendarClock size={15} /> },
  { id: 'import', label: t('Import & export'), icon: <FileUp size={15} /> },
];

interface Props {
  space: Space;
  /** Every space, for taken names. */
  spaces: Space[];
  /** This space, or All spaces (app-wide settings). */
  scope: SettingsScope;
  onScope: (scope: SettingsScope) => void;
  tab: SpaceSettingsTab;
  onTab: (tab: SpaceSettingsTab) => void;
  onClose: () => void;
  /** This space › Connections: the space's connected apps and tools. */
  connections: React.ReactNode;
  /** All spaces: the app-wide settings. */
  appSettings: React.ReactNode;
  onOpenArchived: () => void;
  kwants: Kwant[];
  channels: Channel[];
  teams: Team[];
  /** Changes to focus "Sign in with Claude" in Accounts. */
  focusClaudeSignIn?: number;
  onProfilesChanged?: (profiles: Profile[]) => void;
  pendingSkills?: Record<string, number>;
  onSpaceSaved: (space: Space) => void;
  onArchived: (space: Space) => void;
  onNewBot: () => void;
  onEditBot: (k: Kwant) => void;
  onOpenSkills: (k: Kwant) => void;
  onNewTeam: () => void;
  onManageTeam: (t: Team) => void;
  onOpenTools: () => void;
  /** Set by a routine card's Edit or Pause: opens that routine in Routines. */
  routineFocus?: RoutineFocus | null;
  /** Phones get a full-screen dialog; desktop keeps the space rail beside Settings. */
  isPhone?: boolean;
  /** After an import or its undo: load bots, teams and chats again. */
  onImported?: () => void;
  /** After the approvals switch changes: load bots and spaces again (no event fires). */
  onApprovalsChanged?: () => void;
}

/** What the tabs get on top of the props: opening the Import dialog. */
type TabProps = Props & { onOpenImport: () => void; importsSeq: number };

const card = 'rounded-xl border border-zinc-800 bg-zinc-950/60';
const rowBtn =
  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 border border-zinc-700/60 bg-zinc-800/60 hover:bg-zinc-700/70 hover:text-zinc-100 transition-colors';
const primaryBtn =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 transition-colors disabled:opacity-50';

/** Settings, in one place: "This space" (only the open space) and "All spaces" (the app). */
export const SpaceSettings: React.FC<Props> = (p) => {
  const { space, tab, onTab, onClose, scope, onScope } = p;
  const toApp = () => {
    playSfx('click');
    onScope('app');
  };
  const [importOpen, setImportOpen] = useState(false);
  // Bumped after the dialog imports or undoes, so the Import tab's list loads again.
  const [importsSeq, setImportsSeq] = useState(0);
  const tp: TabProps = { ...p, onOpenImport: () => setImportOpen(true), importsSeq };
  const rootRef = useRef<HTMLDivElement>(null);
  // Escape closes Settings, but not while a dialog opened from here is open (the bot editor, Tools),
  // and not while an editor in it holds typed text.
  useEscapeLayer(rootRef, true, onClose, { covered: () => !!document.querySelector('[role="dialog"]:not([data-space-settings])') });
  // Focus starts on the title (from the gear, Ctrl/⌘ 1–9 or a link), unless a tab already focused
  // something inside, or a space was picked on the rail, which keeps focus there.
  useEffect(() => {
    const a = document.activeElement;
    if (rootRef.current?.contains(a) || a?.closest('[data-rail-space]')) return;
    rootRef.current?.querySelector<HTMLElement>('#space-settings-title')?.focus();
  }, []);

  return (
    // A full-screen dialog on phones. On desktop it fills the space's area beside the space rail,
    // which stays clickable: picking another space keeps Settings open there.
    <div
      ref={rootRef}
      role={p.isPhone ? 'dialog' : 'region'}
      aria-modal={p.isPhone ? true : undefined}
      aria-labelledby="space-settings-title"
      data-space-settings
      className={`${p.isPhone ? 'fixed' : 'absolute'} inset-0 z-40 bg-zinc-950 text-zinc-100 flex flex-col md:flex-row overflow-hidden`}
    >
      {/* Tab list: a column on desktop, scrolling chips on phones */}
      <div className="md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-900/40 flex flex-col">
        <div className="flex items-center gap-2.5 p-3 md:p-4 pb-2 md:pb-3">
          <button type="button" onClick={onClose} aria-label={t('Back to chats')} className="p-1.5 -ml-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
            <ArrowLeft size={17} />
          </button>
          <h2 id="space-settings-title" tabIndex={-1} className="text-sm font-semibold truncate focus:outline-none">{t('Settings')}</h2>
        </div>
        {/* Which settings: this space's, or the ones every space shares */}
        <div role="tablist" aria-label={t('Settings scope')} className="mx-3 md:mx-2 mb-3 grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 border border-zinc-800 p-0.5">
          {(
            [
              { id: 'space', label: t('This space'), icon: <SpaceTile space={space} size={16} /> },
              { id: 'app', label: t('All spaces'), icon: <Globe size={13} aria-hidden="true" /> },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              data-settings-scope={s.id}
              onClick={() => {
                if (scope === s.id) return;
                playSfx('click');
                onScope(s.id);
              }}
              className={`flex items-center justify-center gap-1.5 min-w-0 px-2 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                scope === s.id ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="shrink-0 flex">{s.icon}</span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
        {scope === 'space' && (
          <nav aria-label={t('{space} settings', { space: space.name })} className="flex md:flex-col gap-1 px-3 pb-3 md:px-2 overflow-x-auto md:overflow-visible">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => {
                  playSfx('click');
                  onTab(item.id);
                }}
                className={`shrink-0 flex items-center gap-2 px-3 py-1.5 md:py-2 rounded-full md:rounded-lg text-xs font-medium transition-colors ${
                  tab === item.id ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/60' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border border-transparent'
                }`}
              >
                <span className={tab === item.id ? 'text-sky-400' : 'text-zinc-500'} aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{scope === 'app' ? t('All spaces') : TABS.find((item) => item.id === tab)?.label}</h3>
              <p className="text-[11px] text-zinc-500">
                {scope === 'app' ? t('Applies to every space and to this app') : t('Only affects this space ({space})', { space: space.name })}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('Close settings')} className="hidden md:block p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
              <X size={18} />
            </button>
          </div>
          {scope === 'app' ? (
            <>
              <div className={`${card} p-4 space-y-3`} data-all-spaces-spaces>
                <p className="text-xs font-medium text-zinc-200">{t('Spaces')}</p>
                <p className="text-[11px] text-zinc-500">{t('Switch spaces on the left rail (Ctrl or ⌘ with 1–9). Archived spaces keep their bots and chats until you restore them.')}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={p.onOpenArchived} className={rowBtn}>
                    <Archive size={13} /> {t('Archived spaces')}
                  </button>
                  <InstallAppButton className={rowBtn} />
                </div>
              </div>
              {p.appSettings}
            </>
          ) : (
            <>
              {tab === 'general' && <GeneralTab {...p} />}
              {tab === 'accounts' && <AccountsTab {...p} />}
              {tab === 'bots' && <BotsTab {...tp} />}
              {tab === 'teams' && <TeamsTab {...p} />}
              {tab === 'connections' && <div data-settings-connections>{p.connections}</div>}
              {tab === 'tools' && (
                <div className={`${card} p-4 space-y-3`}>
                  <p className="text-xs text-zinc-300">{t('Tool servers (MCP) give the bots in {space} abilities like files, web pages or GitHub.', { space: space.name })}</p>
                  <button type="button" onClick={p.onOpenTools} className={primaryBtn}>
                    <Plug size={13} /> {t('Manage tools')}
                  </button>
                </div>
              )}
              {tab === 'skills' && <SkillsTab {...p} />}
              {tab === 'routines' && <RoutinesPanel kwants={p.kwants} channels={p.channels} focus={p.routineFocus} onOpenSettings={toApp} />}
              {tab === 'import' && <ImportTab {...tp} />}
            </>
          )}
        </div>
      </div>
      {importOpen && (
        <ImportDialog
          spaceName={space.name}
          onClose={() => setImportOpen(false)}
          onChanged={() => {
            setImportsSeq((n) => n + 1);
            p.onImported?.();
          }}
        />
      )}
    </div>
  );
};

/** Export one bot or the whole space; shows a short error under the button if it fails. */
function useExport() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const run = async (key: string, kwantId?: string) => {
    setBusy(key);
    setError(null);
    try {
      await downloadExport(kwantId);
    } catch (err) {
      setError({ key, text: importErrorText(err).detail || t('The export didn’t work.') });
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

const ImportTab: React.FC<TabProps> = ({ space, kwants, onOpenImport, onImported, importsSeq }) => {
  const exp = useExport();
  const [records, setRecords] = useState<ImportRecord[] | null>(null);
  const [listError, setListError] = useState<unknown>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ record: ImportRecord; names: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => importApi.list().then((r) => { setRecords(r); setListError(null); }, setListError);
  useEffect(() => {
    load();
  }, [space.id, importsSeq]);

  const undo = async (r: ImportRecord, force = false) => {
    setUndoing(r.id);
    setConfirm(null);
    setNotice(null);
    try {
      await importApi.undo(r.id, force);
      setNotice(t('Import undone.'));
      onImported?.();
    } catch (err) {
      if (err instanceof ImportError && err.code === 'edited') setConfirm({ record: r, names: err.names });
      else if (err instanceof ImportError && err.code === 'in_use')
        setNotice(
          t('{names} has already been used, so this import can’t be undone in one step. Delete those bots yourself in Kwant bots.', {
            names: err.names.join(', ') || t('Something it made'),
          }),
        );
      else setNotice(importErrorText(err).detail || importErrorText(err).title);
    } finally {
      setUndoing(null);
      load();
    }
  };

  return (
    <>
      <div className={`${card} p-4 space-y-3`}>
        <p className="text-xs font-medium text-zinc-200">{t('Bring bots from another app')}</p>
        <p className="text-[11px] text-zinc-500">{t('From Grok, ChatGPT, Claude or any other bot, or from a file. You check a preview first, and you can undo it.')}</p>
        <button type="button" onClick={onOpenImport} className={primaryBtn}>
          <FileUp size={13} /> {t('Import bots')}
        </button>
      </div>
      <div className={`${card} p-4 space-y-3`}>
        <p className="text-xs font-medium text-zinc-200">{t('Export {space}', { space: space.name })}</p>
        <p className="text-[11px] text-zinc-500">
          {t(
            kwants.length === 1
              ? 'Downloads its bot, teams and shared skills as one file you can import again. Chat history, files, tools and keys are never included.'
              : 'Downloads its {n} bots, teams and shared skills as one file you can import again. Chat history, files, tools and keys are never included.',
            { n: kwants.length },
          )}
        </p>
        <button type="button" onClick={() => exp.run('space')} disabled={exp.busy === 'space' || kwants.length === 0} className={rowBtn}>
          {exp.busy === 'space' ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> : <Download size={13} />} {t('Export space')}
        </button>
        {exp.error && <p role="alert" className="text-[11px] text-rose-300">{exp.error.text}</p>}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-zinc-300">{t('Recent imports')}</p>
        {confirm && (
          <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
            <p className="text-xs text-amber-100">
              {t(
                confirm.names.length === 1
                  ? '{names} changed since the import. Undo anyway removes it with your changes.'
                  : '{names} changed since the import. Undo anyway removes them with your changes.',
                { names: confirm.names.join(', ') },
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirm(null)} className={rowBtn}>{t('Keep them')}</button>
              <button type="button" onClick={() => undo(confirm.record, true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-rose-600 hover:bg-rose-500">
                {t('Undo anyway')}
              </button>
            </div>
          </div>
        )}
        {notice && <p role="status" className="text-[11px] text-zinc-300">{notice}</p>}
        {listError ? (
          <p role="alert" className="text-[11px] text-rose-300">{importErrorText(listError).detail || t('Couldn’t load the imports.')}</p>
        ) : records ? (
          <RecentImports records={records} busyId={undoing} onUndo={(r) => undo(r)} />
        ) : (
          <p className="text-[11px] text-zinc-500">{t('Loading…')}</p>
        )}
      </div>
    </>
  );
};

const GeneralTab: React.FC<Props> = ({ space, spaces, kwants, onSpaceSaved, onArchived, onApprovalsChanged }) => {
  const [name, setName] = useState(space.name);
  const [icon, setIcon] = useState(space.icon);
  // "amber" from the server shows as its swatch.
  const initialColor = space.color ? spaceColor(space) : '';
  const [color, setColor] = useState(initialColor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const nameErr = spaceNameError(name, spaces.filter((s) => s.id !== space.id).map((s) => s.name));
  const dirty = name.trim() !== space.name || icon !== space.icon || color !== initialColor;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameErr || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const next = await spacesApi.patch(space.id, { name: name.trim(), icon, color: color || null });
      onSpaceSaved(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Couldn’t save the space.'));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setArchiving(true);
    setError(null);
    try {
      const next = await spacesApi.patch(space.id, { archived: true });
      onArchived(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Couldn’t archive the space.'));
      setArchiving(false);
      setConfirmArchive(false);
    }
  };

  return (
    <>
      <form onSubmit={save} {...editorProps(dirty)} className={`${card} p-4 space-y-4`}>
        <div className="flex items-center gap-3">
          <SpaceTile space={{ id: space.id, icon, color: color || null }} size={44} />
          <div className="flex-1 min-w-0">
            <label htmlFor="space-rename" className="block text-xs font-medium text-zinc-300 mb-1">
              {t('Name')} {space.is_default && <span className="ml-1 px-1.5 py-px rounded bg-zinc-800 text-[10px] text-zinc-400">{t('Default')}</span>}
            </label>
            <input
              id="space-rename"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!nameErr}
              aria-describedby="space-rename-error"
              className={`w-full bg-zinc-950 border rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none ${nameErr ? 'border-rose-500/70' : 'border-zinc-800 focus:border-sky-500'}`}
            />
            <p id="space-rename-error" className="mt-1 text-[11px] text-rose-300 min-h-[1em]">{nameErr}</p>
          </div>
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-zinc-300 mb-1.5">{t('Icon')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {SPACE_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={icon === i}
                aria-label={t('Icon {icon}', { icon: i })}
                onClick={() => setIcon(i)}
                className={`w-9 h-9 max-md:w-11 max-md:h-11 rounded-lg text-lg flex items-center justify-center border ${icon === i ? 'border-sky-400 bg-sky-500/10' : 'border-zinc-800 hover:border-zinc-600'}`}
              >
                {i}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-medium text-zinc-300 mb-1.5">{t('Colour')}</legend>
          <div className="flex flex-wrap gap-2">
            {SPACE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={color === c}
                aria-label={t('Colour {color}', { color: c })}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-xs text-rose-300">
            <AlertTriangle size={13} /> {error}
          </p>
        )}
        <div className="flex justify-end items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-400" role="status">
              <Check size={13} /> {t('Saved')}
            </span>
          )}
          <button type="submit" disabled={!dirty || !!nameErr || saving} className={primaryBtn}>
            {saving ? t('Saving…') : t('Save')}
          </button>
        </div>
      </form>

      <SpaceApprovalsSetting
        key={space.id}
        spaceId={space.id}
        spaceName={space.name}
        value={space.approvals ?? 'ask'}
        overrides={{
          ask: kwants.filter((k) => k.approvals === 'ask').map((k) => k.name),
          off: kwants.filter((k) => k.approvals === 'off').map((k) => k.name),
        }}
        onChanged={() => onApprovalsChanged?.()}
      />

      <div className={`${card} p-4 space-y-3`}>
        <p className="flex items-center gap-2 text-xs font-medium text-zinc-200">
          <Archive size={14} className="text-zinc-400" /> {t('Archive space')}
        </p>
        {space.is_default ? (
          <p className="text-[11px] text-zinc-500">{t('The Default space can be renamed but can’t be archived.')}</p>
        ) : confirmArchive ? (
          <div className="space-y-2.5" role="alert">
            <p className="text-xs text-zinc-300">
              {t('Archive {space}? Its routines pause and nothing new can run in it. Its bots, chats and accounts stay, and you can restore it from Archived spaces.', { space: space.name })}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmArchive(false)} className={rowBtn}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                onClick={archive}
                disabled={archiving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
              >
                {archiving && <Loader2 size={12} className="animate-spin motion-reduce:animate-none" />}
                {t('Archive {space}', { space: space.name })}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">{t('Pauses its routines and stops anything new from running. You can restore it any time.')}</p>
            <button type="button" onClick={() => setConfirmArchive(true)} className={rowBtn}>
              <Archive size={13} /> {t('Archive space…')}
            </button>
          </>
        )}
      </div>
    </>
  );
};

const AccountsTab: React.FC<Props> = ({ space, focusClaudeSignIn, onProfilesChanged }) => {
  const engines = useEngines(true);
  const accounts = useProfiles(true, onProfilesChanged);
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">{t('What runs your kwant bots in {space}: the accounts here, and This machine when it’s on.', { space: space.name })}</p>
      {accounts.profiles && accounts.profiles.length > 1 && (
        <AccountPriority profiles={accounts.profiles} engines={engines.engines} onChanged={accounts.reload} />
      )}
      <EnginesPanel api={engines} accounts={accounts} focusClaudeSignIn={focusClaudeSignIn} />
      <ApiKeysPanel
        onSaved={() => {
          // Saving a key or the Ollama address re-checks engines on the server; show the result.
          window.setTimeout(engines.reload, 1500);
          window.setTimeout(engines.reload, 6000);
        }}
      />
    </div>
  );
};

const BotsTab: React.FC<TabProps> = ({ space, kwants, onNewBot, onEditBot, onOpenImport }) => {
  const exp = useExport();
  return (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-zinc-400">
        {t(kwants.length === 1 ? '{n} bot in {space}. Laya only picks from these.' : '{n} bots in {space}. Laya only picks from these.', {
          n: kwants.length,
          space: space.name,
        })}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onOpenImport} className={rowBtn}>
          <FileUp size={13} /> {t('Import bots')}
        </button>
        <button type="button" onClick={onNewBot} className={primaryBtn}>
          <Plus size={13} /> {t('New bot')}
        </button>
      </div>
    </div>
    {exp.error && <p role="alert" className="text-[11px] text-rose-300">{exp.error.text}</p>}
    <ul className="space-y-1.5">
      {kwants.map((k) => (
        <li key={k.id} className={`${card} flex items-center gap-3 p-2.5`}>
          <ModernAvatar role={k.avatar_sprite} name={k.name} size={30} kwantId={k.id} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-200 truncate">{k.name}</p>
            <p className="text-[11px] text-zinc-500 truncate">{k.title}</p>
          </div>
          <button type="button" onClick={() => exp.run(k.id, k.id)} disabled={exp.busy === k.id} className={rowBtn} aria-label={t('Export {name}', { name: k.name })} title={t('Download as a file')}>
            {exp.busy === k.id ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : <Download size={12} />}
            <span className="hidden sm:inline">{t('Export')}</span>
          </button>
          <button type="button" onClick={() => onEditBot(k)} className={rowBtn} aria-label={t('Edit {name}', { name: k.name })}>
            <Pencil size={12} /> {t('Edit')}
          </button>
        </li>
      ))}
    </ul>
    {kwants.length === 0 && <p className="text-xs text-zinc-500">{t('No bots yet. New spaces start empty. Make one, or import bots from another app.')}</p>}
    <HirePolicyPanel key={space.id} spaceId={space.id} spaceName={space.name} />
  </div>
  );
};

const TeamsTab: React.FC<Props> = ({ space, teams, kwants, onNewTeam, onManageTeam }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-zinc-400">
        {t(teams.length === 1 ? '{n} team in {space}.' : '{n} teams in {space}.', { n: teams.length, space: space.name })}
      </p>
      <button type="button" onClick={onNewTeam} disabled={kwants.length === 0} className={primaryBtn} title={kwants.length === 0 ? t('Create a bot first') : undefined}>
        <Plus size={13} /> {t('New team')}
      </button>
    </div>
    <ul className="space-y-1.5">
      {teams.map((team) => {
        const ids = memberIdsOf(team);
        const lead = kwants.find((k) => k.id === team.lead_kwant_id);
        return (
          <li key={team.id} className={`${card} flex items-center gap-3 p-2.5`}>
            <Users size={16} className="text-zinc-500 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">@{team.name}</p>
              <p className="text-[11px] text-zinc-500 truncate">
                {lead
                  ? t(ids.length === 1 ? '{n} member · lead {lead}' : '{n} members · lead {lead}', { n: ids.length, lead: lead.name })
                  : t(ids.length === 1 ? '{n} member' : '{n} members', { n: ids.length })}
              </p>
            </div>
            <button type="button" onClick={() => onManageTeam(team)} className={rowBtn} aria-label={t('Manage @{name}', { name: team.name })}>
              <Settings2 size={12} /> {t('Manage')}
            </button>
          </li>
        );
      })}
    </ul>
    {teams.length === 0 && <p className="text-xs text-zinc-500">{t('No teams yet.')}</p>}
  </div>
);

const SkillsTab: React.FC<Props> = ({ space, kwants, pendingSkills = {}, onOpenSkills }) => (
  <div className="space-y-3">
    <p className="text-xs text-zinc-400">{t('Skills are shared by the bots in {space}. Open a bot to see, approve or write its skills.', { space: space.name })}</p>
    <ul className="space-y-1.5">
      {kwants.map((k) => (
        <li key={k.id} className={`${card} flex items-center gap-3 p-2.5`}>
          <ModernAvatar role={k.avatar_sprite} name={k.name} size={26} kwantId={k.id} />
          <p className="flex-1 min-w-0 text-xs font-medium text-zinc-200 truncate">{k.name}</p>
          {(pendingSkills[k.id] ?? 0) > 0 && (
            <span className="px-1.5 py-px rounded-full bg-amber-500 text-zinc-950 text-[10px] font-semibold">{t('{n} to review', { n: pendingSkills[k.id] })}</span>
          )}
          <button type="button" onClick={() => onOpenSkills(k)} className={rowBtn}>
            <Sparkles size={12} /> {t('Skills')}
          </button>
        </li>
      ))}
    </ul>
    {kwants.length === 0 && <p className="text-xs text-zinc-500">{t('Skills show up once this space has a bot.')}</p>}
  </div>
);

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { WindowID, Language, OpenWindowDetail, dispatchOpenWindow } from '../types';
import { getTranslation } from '../locales';
import { gwApi, skillsApi, gatewayApi } from '../services/api';

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

interface Command {
  id: string;
  label: string;
  icon: string;
  category: 'window' | 'action' | 'entity';
  keywords?: string;
  onExecute: () => void;
}

interface CommandPaletteProps {
  language: Language;
  openWindow: (id: WindowID) => void;
}

// ---------------------------------------------------------------------------
// Window metadata (icon + gradient aligned with Desktop.tsx)
// ---------------------------------------------------------------------------

const WINDOW_META: Record<WindowID, { icon: string; gradient: string }> = {
  dashboard:    { icon: 'dashboard',         gradient: 'from-[#2DA9FF] to-[#007AFF]' },
  agentroom:    { icon: 'groups_3',          gradient: 'from-[#00D4FF] to-[#8B5CF6]' },
  editor:       { icon: 'code_blocks',       gradient: 'from-[#14B8A6] to-[#0D9488]' },
  gateway:      { icon: 'router',            gradient: 'from-[#34C759] to-[#248A3D]' },
  sessions:     { icon: 'forum',             gradient: 'from-[#818CF8] to-[#4F46E5]' },
  activity:     { icon: 'query_stats',       gradient: 'from-[#AF52DE] to-[#8944AB]' },
  skills:       { icon: 'extension',         gradient: 'from-[#FF9500] to-[#E67E00]' },
  knowledge:    { icon: 'auto_awesome',      gradient: 'from-[#8B5CF6] to-[#6D28D9]' },
  observability: { icon: 'monitoring',        gradient: 'from-[#06B6D4] to-[#0891B2]' },
  usage:        { icon: 'analytics',         gradient: 'from-[#F472B6] to-[#DB2777]' },
  alerts:       { icon: 'approval',          gradient: 'from-[#FF453A] to-[#C33B32]' },
  agents:       { icon: 'robot_2',           gradient: 'from-[#5856D6] to-[#3634A3]' },
  scheduler:    { icon: 'event_repeat',      gradient: 'from-[#FF375F] to-[#BF2A47]' },
  maintenance:  { icon: 'health_and_safety', gradient: 'from-[#22C55E] to-[#15803D]' },
  terminal:     { icon: 'terminal',          gradient: 'from-[#0EA5E9] to-[#0369A1]' },
  setup_wizard: { icon: 'rocket_launch',     gradient: 'from-[#FF6B6B] to-[#FF3D3D]' },
  usage_wizard: { icon: 'auto_fix_high',     gradient: 'from-[#A855F7] to-[#7C3AED]' },
  settings:     { icon: 'settings',          gradient: 'from-[#8E8E93] to-[#636366]' },
  nodes:        { icon: 'hub',               gradient: 'from-[#10B981] to-[#059669]' },
};

const ALL_WINDOW_IDS: WindowID[] = [
  'dashboard', 'agentroom', 'editor', 'gateway', 'sessions', 'activity', 'skills',
  'knowledge', 'observability', 'usage', 'alerts', 'agents', 'scheduler',
  'maintenance', 'terminal', 'setup_wizard', 'usage_wizard', 'settings', 'nodes',
];

// ---------------------------------------------------------------------------
// Fuzzy match
// ---------------------------------------------------------------------------

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function matchScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;
  return 50;
}

// ---------------------------------------------------------------------------
// Entity data cache (avoids redundant API calls on every keystroke)
// ---------------------------------------------------------------------------

const ENTITY_CACHE_TTL = 15000; // 15 seconds

let entityCache: {
  sessions: any[] | null;
  agents: any[] | null;
  skills: any[] | null;
  fetchedAt: number;
} = { sessions: null, agents: null, skills: null, fetchedAt: 0 };

async function getEntityData(): Promise<{ sessions: any[]; agents: any[]; skills: any[] }> {
  if (Date.now() - entityCache.fetchedAt < ENTITY_CACHE_TTL && entityCache.sessions) {
    return { sessions: entityCache.sessions!, agents: entityCache.agents!, skills: entityCache.skills! };
  }

  const [sessionsRes, agentsRes, skillsRes] = await Promise.allSettled([
    gwApi.sessions(),
    gwApi.agents(),
    skillsApi.list(),
  ]);

  const sessions = sessionsRes.status === 'fulfilled' && Array.isArray(sessionsRes.value) ? sessionsRes.value : [];
  const agents = agentsRes.status === 'fulfilled' && Array.isArray(agentsRes.value) ? agentsRes.value : [];
  const skills = skillsRes.status === 'fulfilled' && Array.isArray(skillsRes.value) ? skillsRes.value : [];

  entityCache = { sessions, agents, skills, fetchedAt: Date.now() };
  return { sessions, agents, skills };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CommandPalette: React.FC<CommandPaletteProps> = ({ language, openWindow }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [asyncCommands, setAsyncCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const t = useMemo(() => getTranslation(language), [language]);
  const cp = (t as any).cp || {};

  const openPalette = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    setAsyncCommands([]);
    setOpen(true);
  }, []);

  // ── Global shortcut: Ctrl/Cmd + K ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => {
          if (!prev) {
            setQuery('');
            setSelectedIndex(0);
            setAsyncCommands([]);
          }
          return !prev;
        });
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // ── Allow external trigger (Desktop search bar) ──
  useEffect(() => {
    const handler = () => openPalette();
    window.addEventListener('clawdeck:open-palette', handler);
    return () => window.removeEventListener('clawdeck:open-palette', handler);
  }, [openPalette]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Static commands ──
  const staticCommands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // Window commands
    for (const id of ALL_WINDOW_IDS) {
      const meta = WINDOW_META[id];
      const raw = (t as any)?.[id];
      const title = typeof raw === 'string' ? raw : (raw?.title || id);
      cmds.push({
        id: `win:${id}`,
        label: `${cp.open || 'Open'} ${title}`,
        icon: meta.icon,
        category: 'window',
        keywords: `open ${id} ${title}`,
        onExecute: () => {
          openWindow(id);
          setOpen(false);
        },
      });
    }

    // Action commands
    const actions: { id: string; label: string; icon: string; keywords: string; exec: () => void }[] = [
      {
        id: 'act:restart-gw',
        label: cp.restartGateway || 'Restart Gateway',
        icon: 'restart_alt',
        keywords: 'restart gateway reboot',
        exec: () => { gwApi.gatewayRestartRequest({ reason: 'command-palette' }).catch(() => gatewayApi.restart().catch(() => {})); },
      },
      {
        id: 'act:refresh-dashboard',
        label: cp.refreshDashboard || 'Refresh Dashboard',
        icon: 'refresh',
        keywords: 'refresh dashboard reload',
        exec: () => {
          openWindow('dashboard');
          // Dashboard auto-refreshes on open
        },
      },
      {
        id: 'act:open-alerts',
        label: cp.openAlerts || 'Open Current Alerts',
        icon: 'notification_important',
        keywords: 'alerts notifications approval',
        exec: () => { openWindow('alerts'); },
      },
      {
        id: 'act:open-logs',
        label: cp.openLogs || 'Open Gateway Logs',
        icon: 'receipt_long',
        keywords: 'logs gateway log tail',
        exec: () => { dispatchOpenWindow({ id: 'gateway', tab: 'logs' }); },
      },
      {
        id: 'act:open-events',
        label: cp.openEvents || 'Open Gateway Events',
        icon: 'event_note',
        keywords: 'events gateway activity',
        exec: () => { dispatchOpenWindow({ id: 'gateway', tab: 'events' }); },
      },
      {
        id: 'act:open-errors',
        label: cp.openErrors || 'Open Error Events',
        icon: 'error',
        keywords: 'errors exceptions critical high risk',
        exec: () => { dispatchOpenWindow({ id: 'gateway', tab: 'events', eventRisk: 'high' }); },
      },
      {
        id: 'act:open-settings-update',
        label: cp.checkUpdate || 'Check for Updates',
        icon: 'system_update',
        keywords: 'update check version upgrade',
        exec: () => { dispatchOpenWindow({ id: 'settings', tab: 'update' }); },
      },
      {
        id: 'act:open-settings-prefs',
        label: cp.preferences || 'Preferences',
        icon: 'tune',
        keywords: 'preferences settings theme language wallpaper',
        exec: () => { dispatchOpenWindow({ id: 'settings', tab: 'preferences' }); },
      },
      {
        id: 'act:run-doctor',
        label: cp.runDoctor || 'Run Health Check',
        icon: 'health_and_safety',
        keywords: 'doctor health check diagnose',
        exec: () => { openWindow('maintenance'); },
      },
      {
        id: 'act:open-editor-models',
        label: cp.configModels || 'Configure Models',
        icon: 'model_training',
        keywords: 'models provider openai anthropic config',
        exec: () => { dispatchOpenWindow({ id: 'editor', section: 'models' }); },
      },
      {
        id: 'act:open-editor-tools',
        label: cp.configTools || 'Configure Tools',
        icon: 'build',
        keywords: 'tools exec security sandbox config',
        exec: () => { dispatchOpenWindow({ id: 'editor', section: 'tools' }); },
      },
      {
        id: 'act:open-editor-identity',
        label: cp.configIdentity || 'Configure Identity',
        icon: 'person',
        keywords: 'identity name personality user config',
        exec: () => { dispatchOpenWindow({ id: 'editor', section: 'identity' }); },
      },
    ];

    for (const a of actions) {
      cmds.push({
        id: a.id,
        label: a.label,
        icon: a.icon,
        category: 'action',
        keywords: a.keywords,
        onExecute: () => {
          a.exec();
          setOpen(false);
        },
      });
    }

    return cmds;
  }, [t, cp, openWindow]);

  // ── Async entity search ──
  useEffect(() => {
    if (!open || query.length < 2) {
      setAsyncCommands([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const results: Command[] = [];
      try {
        const { sessions, agents, skills } = await getEntityData();

        // Sessions
        for (const s of sessions) {
          const key = s.key || s.id;
          const label = s.label || key;
          if (!key || !fuzzyMatch(query, `${label} ${key}`)) continue;
          results.push({
            id: `ent:session:${key}`,
            label: `${cp.session || 'Session'}: ${label}`,
            icon: 'forum',
            category: 'entity',
            keywords: `session ${key} ${label}`,
            onExecute: () => {
              dispatchOpenWindow({ id: 'sessions', sessionKey: key });
              setOpen(false);
            },
          });
        }

        // Agents
        for (const a of agents) {
          const id = a.id || a.name;
          const label = a.label || a.name || id;
          if (!id || !fuzzyMatch(query, `${label} ${id}`)) continue;
          results.push({
            id: `ent:agent:${id}`,
            label: `${cp.agent || 'Agent'}: ${label}`,
            icon: 'robot_2',
            category: 'entity',
            keywords: `agent ${id} ${label}`,
            onExecute: () => {
              dispatchOpenWindow({ id: 'agents', agentId: id });
              setOpen(false);
            },
          });
        }

        // Skills
        for (const sk of skills) {
          const name = sk.name || sk.id;
          if (!name || !fuzzyMatch(query, name)) continue;
          results.push({
            id: `ent:skill:${name}`,
            label: `${cp.skill || 'Skill'}: ${name}`,
            icon: 'extension',
            category: 'entity',
            keywords: `skill ${name}`,
            onExecute: () => {
              openWindow('skills');
              setOpen(false);
            },
          });
        }
      } catch {
        // Silently ignore fetch errors
      }
      setAsyncCommands(results.slice(0, 15));
    }, 250);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, open, cp, openWindow]);

  // ── Filtered & sorted commands ──
  const filtered = useMemo(() => {
    const all = [...staticCommands, ...asyncCommands];
    if (!query.trim()) return all.filter(c => c.category !== 'entity');

    return all
      .filter(c => fuzzyMatch(query, `${c.label} ${c.keywords || ''}`))
      .sort((a, b) => {
        const sa = matchScore(query, `${a.label} ${a.keywords || ''}`);
        const sb = matchScore(query, `${b.label} ${b.keywords || ''}`);
        if (sb !== sa) return sb - sa;
        const catOrder = { window: 0, action: 1, entity: 2 };
        return (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
      });
  }, [staticCommands, asyncCommands, query]);

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      filtered[selectedIndex]?.onExecute();
    }
  }, [filtered, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ── Group by category for display ──
  const grouped = useMemo(() => {
    const groups: { category: string; label: string; items: typeof filtered }[] = [];
    const seen = new Set<string>();
    for (const cmd of filtered) {
      if (!seen.has(cmd.category)) {
        seen.add(cmd.category);
        const categoryLabel = cmd.category === 'window'
          ? (cp.catWindows || 'Windows')
          : cmd.category === 'action'
            ? (cp.catActions || 'Actions')
            : (cp.catEntities || 'Entities');
        groups.push({ category: cmd.category, label: categoryLabel, items: [] });
      }
      groups.find(g => g.category === cmd.category)?.items.push(cmd);
    }
    return groups;
  }, [filtered, cp]);

  if (!open) return null;

  // Compute flat index for keyboard navigation across groups
  let flatIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9999] bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-[fade-in_0.1s_ease-out]"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[560px] mx-4 rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/95 dark:bg-[#1a2332]/95 backdrop-blur-xl shadow-2xl dark:shadow-black/40 animate-[card-enter_0.15s_ease-out] overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/[0.06]">
            <span className="material-symbols-outlined text-[20px] text-slate-400 dark:text-white/40">search</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={cp.placeholder || 'Type a command or search...'}
              className="flex-1 bg-transparent text-[14px] text-slate-800 dark:text-white/90 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[10px] text-slate-400 dark:text-white/30 font-mono border border-slate-200 dark:border-white/[0.08]">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[400px] overflow-y-auto custom-scrollbar neon-scrollbar py-1">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-white/30">
                <span className="material-symbols-outlined text-[32px] mb-2">search_off</span>
                <p className="text-[12px]">{cp.noResults || 'No results found'}</p>
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.category}>
                  <div className="px-4 pt-2.5 pb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/30">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map(cmd => {
                    const idx = flatIndex++;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={cmd.id}
                        onClick={cmd.onExecute}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-start transition-colors ${
                          isSelected
                            ? 'bg-primary/10 dark:bg-primary/20'
                            : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          cmd.category === 'window'
                            ? `bg-gradient-to-br ${WINDOW_META[cmd.id.replace('win:', '') as WindowID]?.gradient || 'from-slate-400 to-slate-500'}`
                            : cmd.category === 'action'
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'bg-indigo-500/10 dark:bg-indigo-500/20'
                        }`}>
                          <span className={`material-symbols-outlined text-[15px] ${
                            cmd.category === 'window' ? 'text-white' : cmd.category === 'action' ? 'text-primary' : 'text-indigo-500'
                          }`}>
                            {cmd.icon}
                          </span>
                        </div>
                        <span className={`text-[13px] font-medium truncate ${
                          isSelected
                            ? 'text-primary dark:text-primary'
                            : 'text-slate-700 dark:text-white/70'
                        }`}>
                          {cmd.label}
                        </span>
                        {isSelected && (
                          <kbd className="ms-auto hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-primary/10 dark:bg-primary/20 text-[9px] text-primary font-mono shrink-0">
                            ↵
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 dark:border-white/[0.06] text-[10px] text-slate-400 dark:text-white/30">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] font-mono border border-slate-200 dark:border-white/[0.08]">↑↓</kbd>
                {cp.navigate || 'Navigate'}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] font-mono border border-slate-200 dark:border-white/[0.08]">↵</kbd>
                {cp.select || 'Select'}
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] font-mono border border-slate-200 dark:border-white/[0.08]">Ctrl</kbd>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-white/[0.06] font-mono border border-slate-200 dark:border-white/[0.08]">K</kbd>
              {cp.toggle || 'Toggle'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(CommandPalette);

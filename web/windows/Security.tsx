
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { securityApi, alertApi } from '../services/api';
import CustomSelect from '../components/CustomSelect';
import { useToast } from '../components/Toast';

type SecTab = 'overview' | 'rules' | 'logs';

interface SecurityProps {
  language: Language;
}

interface RuleItem {
  dbId: number;
  ruleId: string;
  category: string;
  risk: string;
  description: string;
  pattern: string;
  actions: string[];
  enabled: boolean;
  builtIn: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  Shell: 'terminal', Network: 'language', File: 'folder_open',
  Credential: 'key', Browser: 'web', System: 'settings',
};

const RISK_COLORS: Record<string, string> = {
  critical: 'bg-mac-red/15 text-mac-red',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
};

const Security: React.FC<SecurityProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const s = t.sec as any;
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SecTab>('overview');
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // ── Create / Edit rule form ──
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleItem | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const emptyForm = { ruleId: '', category: 'Shell', risk: 'medium', pattern: '', reason: '', actions: ['warn'], enabled: true };
  const [form, setForm] = useState(emptyForm);

  // ── Security logs ──
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertPage, setAlertPage] = useState(1);
  const [alertTotal, setAlertTotal] = useState(0);
  const [alertLoading, setAlertLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchRules = useCallback(() => {
    securityApi.listRules().then((data: any) => {
      const list = Array.isArray(data) ? data : (data?.list || []);
      setRules(list.map((r: any) => {
        let acts: string[] = [];
        try { acts = typeof r.actions === 'string' ? JSON.parse(r.actions) : (r.actions || []); } catch { /* ignore */ }
        return {
          dbId: r.ID || r.id || 0,
          ruleId: r.rule_id || r.RuleID || '',
          category: r.category || r.Category || 'System',
          risk: r.risk || r.Risk || 'medium',
          description: r.reason || r.Reason || r.description || '',
          pattern: r.pattern || r.Pattern || '',
          actions: acts,
          enabled: r.enabled !== false && r.Enabled !== false,
          builtIn: r.built_in === true || r.BuiltIn === true,
        };
      }));
    }).catch(() => { });
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleToggle = async (rule: RuleItem) => {
    try {
      await securityApi.updateRule(String(rule.dbId), { enabled: !rule.enabled });
      setRules(prev => prev.map(r => r.dbId === rule.dbId ? { ...r, enabled: !r.enabled } : r));
      toast('success', s.toggleOk);
    } catch { toast('error', s.toggleFailed); }
  };

  const handleDelete = async (rule: RuleItem) => {
    if (rule.builtIn) return;
    try {
      await securityApi.deleteRule(String(rule.dbId));
      fetchRules();
      toast('success', s.deleteOk);
    } catch { toast('error', s.deleteFailed); }
  };

  // ── Create / Edit handlers ──
  const openCreateForm = () => {
    setEditingRule(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };
  const openEditForm = (rule: RuleItem) => {
    setEditingRule(rule);
    setForm({ ruleId: rule.ruleId, category: rule.category, risk: rule.risk, pattern: rule.pattern, reason: rule.description, actions: rule.actions, enabled: rule.enabled });
    setShowForm(true);
  };
  const handleFormSubmit = async () => {
    setFormSaving(true);
    try {
      const payload = { rule_id: form.ruleId, category: form.category, risk: form.risk, pattern: form.pattern, reason: form.reason, actions: JSON.stringify(form.actions), enabled: form.enabled };
      if (editingRule) {
        await securityApi.updateRule(String(editingRule.dbId), payload);
        toast('success', s.editOk);
      } else {
        await securityApi.createRule(payload);
        toast('success', s.createOk);
      }
      setShowForm(false);
      fetchRules();
    } catch { toast('error', editingRule ? s.editFailed : s.createFailed); }
    setFormSaving(false);
  };
  const toggleFormAction = (act: string) => {
    setForm(prev => ({ ...prev, actions: prev.actions.includes(act) ? prev.actions.filter(a => a !== act) : [...prev.actions, act] }));
  };

  // ── Alerts / Logs ──
  const fetchAlerts = useCallback((page = 1) => {
    setAlertLoading(true);
    alertApi.list({ page, page_size: 20 }).then((data: any) => {
      const list = data?.list || [];
      if (page === 1) setAlerts(list); else setAlerts(prev => [...prev, ...list]);
      setAlertTotal(data?.total || 0);
      setAlertPage(page);
    }).catch(() => { }).finally(() => setAlertLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') fetchAlerts(1);
  }, [activeTab, fetchAlerts]);

  // WS real-time alerts
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/v1/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', channels: ['alert'] }));
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'alert' && msg.data) {
          setAlerts(prev => [{ ...msg.data, created_at: msg.data.timestamp || new Date().toISOString() }, ...prev]);
          setAlertTotal(prev => prev + 1);
        }
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, []);

  // ── 统计 ──
  const stats = useMemo(() => {
    const total = rules.length;
    const enabled = rules.filter(r => r.enabled).length;
    const builtInCount = rules.filter(r => r.builtIn).length;
    const customCount = total - builtInCount;
    const criticalEnabled = rules.filter(r => r.enabled && (r.risk === 'critical' || r.risk === 'high')).length;
    const criticalTotal = rules.filter(r => r.risk === 'critical' || r.risk === 'high').length;
    const score = total > 0 ? Math.round((enabled / total) * 80 + (criticalTotal > 0 ? (criticalEnabled / criticalTotal) * 20 : 20)) : 0;
    const byCat: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    const enabledByRisk: Record<string, number> = {};
    rules.forEach(r => {
      byCat[r.category] = (byCat[r.category] || 0) + 1;
      byRisk[r.risk] = (byRisk[r.risk] || 0) + 1;
      if (r.enabled) enabledByRisk[r.risk] = (enabledByRisk[r.risk] || 0) + 1;
    });
    return { total, enabled, builtInCount, customCount, score, byCat, byRisk, enabledByRisk };
  }, [rules]);

  const categories = useMemo(() => {
    const cats = new Set(rules.map(r => r.category));
    return ['all', ...Array.from(cats)];
  }, [rules]);

  const filtered = useMemo(() => {
    return rules.filter(r => {
      if (filter !== 'all' && r.category !== filter) return false;
      if (search && !r.ruleId.toLowerCase().includes(search.toLowerCase()) && !r.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rules, filter, search]);

  const catLabel = (cat: string) => {
    const map: Record<string, string> = { Shell: s.shell, Network: s.network, File: s.file, Credential: s.credential, Browser: s.browser, System: s.system };
    return map[cat] || cat;
  };
  const riskLabel = (risk: string) => {
    const map: Record<string, string> = { critical: s.critical, high: s.high, medium: s.medium, low: s.low };
    return map[risk] || risk;
  };
  const actionLabel = (act: string) => {
    const map: Record<string, string> = { abort: s.abort, warn: s.warn, notify: s.notify };
    return map[act] || act;
  };

  const navItems: { id: SecTab; icon: string; label: string; color: string }[] = [
    { id: 'overview', icon: 'shield', label: s.score, color: 'bg-blue-500' },
    { id: 'rules', icon: 'gavel', label: s.rules, color: 'bg-orange-500' },
    { id: 'logs', icon: 'notifications', label: s.logs, color: 'bg-red-500' },
  ];

  const rowCls = "bg-white dark:bg-white/[0.04] rounded-xl border border-slate-200/70 dark:border-white/[0.06] divide-y divide-slate-100 dark:divide-white/[0.04] overflow-hidden";
  const scoreColor = stats.score >= 80 ? 'text-mac-green' : stats.score >= 50 ? 'text-amber-500' : 'text-mac-red';
  const scoreBg = stats.score >= 80 ? 'bg-mac-green' : stats.score >= 50 ? 'bg-amber-500' : 'bg-mac-red';

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[#f5f5f7] dark:bg-[#1c1c1e]">

      {/* ── 移动端顶部导航 ── */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-slate-200/70 dark:border-white/[0.06] bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 backdrop-blur-xl shrink-0">
        <div className="relative w-8 h-8 shrink-0">
          <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" className="text-slate-200 dark:text-white/10" strokeWidth="2.5" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" className={scoreColor} strokeWidth="2.5"
              strokeDasharray={`${stats.score * 0.817} 81.7`} strokeLinecap="round" />
          </svg>
          <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${scoreColor}`}>{stats.score}</span>
        </div>
        <div className="flex gap-1 flex-1 overflow-x-auto no-scrollbar">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] whitespace-nowrap transition-all ${activeTab === item.id
                  ? 'bg-primary/15 dark:bg-primary/20 text-primary font-semibold'
                  : 'text-slate-500 dark:text-white/40 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                }`}>
              <span className="material-symbols-outlined text-[14px]">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── macOS 风格侧边栏（桌面端） ── */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-slate-200/70 dark:border-white/[0.06] bg-[#f5f5f7]/80 dark:bg-[#2c2c2e]/80 backdrop-blur-xl flex-col overflow-y-auto no-scrollbar">
        {/* 安全评分概览 */}
        <div className="flex flex-col items-center py-5 px-4 border-b border-slate-200/70 dark:border-white/[0.06]">
          <div className="relative w-16 h-16 mb-2">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-slate-200 dark:text-white/10" strokeWidth="4" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className={scoreColor} strokeWidth="4"
                strokeDasharray={`${stats.score * 1.76} 176`} strokeLinecap="round" />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[15px] font-bold ${scoreColor}`}>{stats.score}</span>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-white/35 text-center">{s.scoreDesc}</p>
        </div>

        {/* 导航 */}
        <nav className="flex flex-col gap-0.5 p-2 mt-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all ${activeTab === item.id
                  ? 'bg-primary/15 dark:bg-primary/20 text-primary font-semibold'
                  : 'text-slate-600 dark:text-white/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                }`}>
              <div className={`w-[22px] h-[22px] rounded-md ${item.color} flex items-center justify-center shadow-sm`}>
                <span className="material-symbols-outlined text-white text-[14px]">{item.icon}</span>
              </div>
              {item.label}
            </button>
          ))}
        </nav>

        {/* 侧边栏底部统计 */}
        <div className="mt-auto p-3">
          <div className="bg-white dark:bg-white/[0.04] rounded-xl border border-slate-200/70 dark:border-white/[0.06] p-3 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.rules}</span>
              <span className="font-semibold text-slate-700 dark:text-white/70">{stats.total}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.enabled}</span>
              <span className="font-semibold text-mac-green">{stats.enabled}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.builtIn}</span>
              <span className="font-semibold text-slate-700 dark:text-white/70">{stats.builtInCount}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.custom}</span>
              <span className="font-semibold text-slate-700 dark:text-white/70">{stats.customCount}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── 右侧内容 ── */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl mx-auto p-4 md:p-8">

          {/* ── 总览 ── */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.title}</h2>

              {/* 安全评分大卡片 */}
              <div className={rowCls}>
                <div className="p-5 flex items-center gap-5">
                  <div className="relative w-24 h-24 shrink-0">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                      <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" className="text-slate-100 dark:text-white/5" strokeWidth="6" />
                      <circle cx="48" cy="48" r="42" fill="none" stroke="currentColor" className={scoreColor} strokeWidth="6"
                        strokeDasharray={`${stats.score * 2.64} 264`} strokeLinecap="round" />
                    </svg>
                    <span className={`absolute inset-0 flex items-center justify-center text-[28px] font-bold ${scoreColor}`}>{stats.score}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">{s.score}</h3>
                    <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{s.scoreDesc}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(() => {
                        const disabledRisks = ['critical', 'high', 'medium', 'low'].filter(risk => {
                          const total = stats.byRisk[risk] || 0;
                          const enabled = stats.enabledByRisk[risk] || 0;
                          return total > 0 && enabled < total;
                        });
                        if (disabledRisks.length === 0) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-500/15 text-green-600 dark:text-green-400">
                              <span className="material-symbols-outlined text-[11px]">verified_user</span>
                              {s.protected}
                            </span>
                          );
                        }
                        return disabledRisks.map(risk => {
                          const total = stats.byRisk[risk] || 0;
                          const disabled = total - (stats.enabledByRisk[risk] || 0);
                          return (
                            <span key={risk} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${RISK_COLORS[risk]}`}>
                              <span className="material-symbols-outlined text-[11px]">gpp_maybe</span>
                              {riskLabel(risk)} {disabled}{s.unprotected}
                            </span>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* 分类分布 */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-widest mb-3">{s.category}</p>
                  <div className="space-y-0">
                    {Object.entries(stats.byCat).map(([cat, count]) => {
                      const pct = stats.total > 0 ? Math.round((count as number / stats.total) * 100) : 0;
                      return (
                        <div key={cat} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-white/[0.04] last:border-0">
                          <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/35">{CATEGORY_ICONS[cat] || 'shield'}</span>
                          <span className="text-[13px] text-slate-600 dark:text-white/50 w-24">{catLabel(cat)}</span>
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full ${scoreBg} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 dark:text-white/40 w-8 text-right">{count as number}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 快速操作 */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setActiveTab('rules')}
                  className={`${rowCls} p-4 text-left hover:border-primary/30 transition-colors cursor-pointer`}>
                  <span className="material-symbols-outlined text-[20px] text-orange-500 mb-2">gavel</span>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-white/70">{s.rules}</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{s.rulesDesc}</p>
                </button>
                <div className={`${rowCls} p-4`}>
                  <span className="material-symbols-outlined text-[20px] text-blue-500 mb-2">verified_user</span>
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-white/70">{s.enabled}</p>
                  <p className="text-[22px] font-bold text-mac-green mt-1">{stats.enabled}<span className="text-[12px] text-slate-400 dark:text-white/35 font-normal">/{stats.total}</span></p>
                </div>
              </div>

            </div>
          )}

          {/* ── 规则管理 ── */}
          {activeTab === 'rules' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.rules}</h2>
                <button onClick={openCreateForm}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-primary text-white hover:bg-primary/90 transition-all">
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  {s.newRule}
                </button>
              </div>

              {/* 搜索 + 筛选 */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">search</span>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-800 dark:text-white focus:ring-2 focus:ring-primary/30 outline-none transition-all"
                    placeholder={s.search} />
                </div>
                <div className="flex gap-1 overflow-x-auto no-scrollbar shrink-0">
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setFilter(cat)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all ${filter === cat
                          ? 'bg-primary text-white'
                          : 'bg-white dark:bg-white/5 text-slate-500 dark:text-white/40 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
                        }`}>
                      {cat === 'all' ? s.all : catLabel(cat)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 规则列表 */}
              <div className={rowCls}>
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-slate-300 dark:text-white/10">
                    <span className="material-symbols-outlined text-4xl mb-2">shield</span>
                    <span className="text-[12px] text-slate-400 dark:text-white/20">{s.search}</span>
                  </div>
                ) : (
                  filtered.map(rule => (
                    <div key={rule.dbId} className="px-4 py-3 flex items-start gap-3 group">
                      {/* 左侧图标 */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${rule.enabled ? 'bg-mac-green/10' : 'bg-slate-100 dark:bg-white/5'
                        }`}>
                        <span className={`material-symbols-outlined text-[16px] ${rule.enabled ? 'text-mac-green' : 'text-slate-300 dark:text-white/15'
                          }`}>{CATEGORY_ICONS[rule.category] || 'shield'}</span>
                      </div>

                      {/* 中间内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-slate-700 dark:text-white/70">{rule.description}</span>
                          {rule.builtIn && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-white/20 uppercase">{s.builtIn}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400 dark:text-white/20">{rule.ruleId}</span>
                          {rule.enabled
                            ? <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-green-500/10 text-green-600 dark:text-green-400">{s.enabled}</span>
                            : <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${RISK_COLORS[rule.risk]}`}>{riskLabel(rule.risk)}</span>
                          }
                          {rule.actions.map(a => (
                            <span key={a} className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{actionLabel(a)}</span>
                          ))}
                        </div>
                      </div>

                      {/* 右侧操作 */}
                      <div className="flex items-center gap-2 shrink-0">
                        {!rule.builtIn && (
                          <button onClick={() => openEditForm(rule)}
                            className="p-1 text-slate-300 dark:text-white/10 hover:text-primary rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                        )}
                        {!rule.builtIn && (
                          <button onClick={() => handleDelete(rule)}
                            className="p-1 text-slate-300 dark:text-white/10 hover:text-mac-red rounded-lg transition-colors opacity-0 group-hover:opacity-100">
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        )}
                        <button onClick={() => handleToggle(rule)}
                          className={`relative w-9 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/10'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 底部统计 */}
              <p className="text-[10px] text-slate-400 dark:text-white/20 text-center">
                {s.total.replace('{count}', String(stats.total)).replace('{builtIn}', String(stats.builtInCount)).replace('{custom}', String(stats.customCount))}
              </p>

              {/* ── Create / Edit modal ── */}
              {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setShowForm(false)}>
                  <div className="w-full max-w-md mx-4 bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl border border-slate-200/70 dark:border-white/[0.08] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                    onClick={e => e.stopPropagation()}>
                    <div className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">{editingRule ? s.editForm : s.createForm}</h3>
                        <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>
                      {/* Rule ID */}
                      <div>
                        <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.id}</label>
                        <input value={form.ruleId} onChange={e => setForm(prev => ({ ...prev, ruleId: e.target.value }))} disabled={!!editingRule}
                          className="w-full h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-800 dark:text-white focus:ring-2 focus:ring-primary/30 outline-none disabled:opacity-50"
                          placeholder={s.ruleIdHintShort} />
                      </div>
                      {/* Category + Risk */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.category}</label>
                          <CustomSelect value={form.category} onChange={v => setForm(prev => ({ ...prev, category: v }))}
                            options={['Shell', 'Network', 'File', 'Credential', 'Browser', 'System'].map(c => ({ value: c, label: catLabel(c) }))}
                            className="w-full h-8 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-800 dark:text-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.risk}</label>
                          <CustomSelect value={form.risk} onChange={v => setForm(prev => ({ ...prev, risk: v }))}
                            options={['critical', 'high', 'medium', 'low'].map(r => ({ value: r, label: riskLabel(r) }))}
                            className="w-full h-8 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-800 dark:text-white" />
                        </div>
                      </div>
                      {/* Pattern */}
                      <div>
                        <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.pattern}</label>
                        <input value={form.pattern} onChange={e => setForm(prev => ({ ...prev, pattern: e.target.value }))}
                          className="w-full h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-mono text-slate-800 dark:text-white focus:ring-2 focus:ring-primary/30 outline-none"
                          placeholder={s.patternHintShort} />
                      </div>
                      {/* Reason */}
                      <div>
                        <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.desc}</label>
                        <input value={form.reason} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))}
                          className="w-full h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-800 dark:text-white focus:ring-2 focus:ring-primary/30 outline-none"
                          placeholder={s.reasonHintShort} />
                      </div>
                      {/* Actions */}
                      <div>
                        <label className="text-[11px] font-medium text-slate-500 dark:text-white/40 mb-1 block">{s.actions}</label>
                        <div className="flex gap-2">
                          {['abort', 'warn', 'notify'].map(act => (
                            <button key={act} onClick={() => toggleFormAction(act)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${form.actions.includes(act)
                                  ? 'bg-primary text-white'
                                  : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 border border-slate-200 dark:border-white/10'
                                }`}>
                              {actionLabel(act)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Submit */}
                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setShowForm(false)}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                          {s.cancel}
                        </button>
                        <button onClick={handleFormSubmit} disabled={formSaving || !form.ruleId || !form.pattern || !form.reason}
                          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-50">
                          {formSaving ? (editingRule ? s.updating : s.creating) : (editingRule ? s.editForm : s.create)}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 安全日志 ── */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.logs}</h2>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    {s.realtime}
                  </span>
                  <button onClick={() => fetchAlerts(1)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                    <span className="material-symbols-outlined text-[14px]">refresh</span>
                  </button>
                </div>
              </div>

              <div className={rowCls}>
                {alerts.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-slate-300 dark:text-white/10">
                    <span className="material-symbols-outlined text-4xl mb-2">notifications_off</span>
                    <span className="text-[12px] text-slate-400 dark:text-white/20">{s.noLogs}</span>
                  </div>
                ) : (
                  alerts.map((alert: any, idx: number) => (
                    <div key={alert.id || alert.alert_id || idx} className="px-4 py-3 flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${RISK_COLORS[alert.risk] || 'bg-slate-100 dark:bg-white/5'}`}>
                        <span className="material-symbols-outlined text-[16px]">
                          {alert.risk === 'critical' ? 'error' : alert.risk === 'high' ? 'warning' : 'info'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-slate-700 dark:text-white/70 break-words">{alert.message || alert.Message}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${RISK_COLORS[alert.risk] || ''}`}>{riskLabel(alert.risk)}</span>
                          <span className="text-[10px] text-slate-400 dark:text-white/20">
                            {alert.created_at ? new Date(alert.created_at).toLocaleString() : alert.timestamp || '-'}
                          </span>
                        </div>
                        {alert.detail && (
                          <p className="text-[11px] text-slate-400 dark:text-white/35 mt-1 font-mono break-all">{alert.detail}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {alerts.length < alertTotal && (
                <div className="text-center">
                  <button onClick={() => fetchAlerts(alertPage + 1)} disabled={alertLoading}
                    className="px-4 py-1.5 rounded-lg text-[12px] font-medium text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                    {alertLoading ? '...' : s.loadMore}
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default Security;

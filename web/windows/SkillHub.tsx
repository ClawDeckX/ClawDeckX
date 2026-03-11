import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { skillHubApi, SkillHubSkill, SkillHubData } from '../services/api';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import CustomSelect from '../components/CustomSelect';

interface SkillHubProps { language: Language; }

const CACHE_KEY = 'skillhub_data_cache';
const CACHE_EXPIRY_HOURS = 24;
const BANNER_DISMISSED_KEY = 'skillhub_banner_dismissed';

interface CacheData {
  data: SkillHubData;
  timestamp: number;
  url: string;
}

// 技能详情弹窗组件
const SkillDetailModal: React.FC<{
  skill: SkillHubSkill | null;
  onClose: () => void;
  onCopyPrompt: (skill: SkillHubSkill) => void;
  onCopyCLI: (skill: SkillHubSkill) => void;
  language: Language;
  sk: any;
}> = ({ skill, onClose, onCopyPrompt, onCopyCLI, language, sk }) => {
  if (!skill) return null;

  const desc = language === 'zh' || language === 'zh-TW' ? (skill.description_zh || skill.description) : skill.description;
  const updatedDate = new Date(skill.updated_at).toLocaleDateString();

  const promptCode = `请先检查是否已安装 SkillHub 商店，若未安装，请根据 https://skillhub-1251783334.cos.ap-guangzhou.myqcloud.com/install/skillhub.md 安装 SkillHub 商店，然后安装 ${skill.slug} 技能。

若已安装，则直接安装 ${skill.slug} 技能。`;

  const cliCode = `skillhub install ${skill.slug}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-[#1a1c22] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-4 p-6 border-b border-slate-200 dark:border-white/10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-purple-500/15 flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-white/5">
            <span className="text-3xl">📦</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-1">{skill.name}</h2>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-white/50">
              <span className="font-mono">v{skill.version}</span>
              <span>•</span>
              <span>{sk.lastUpdated || 'Updated'}: {updatedDate}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors shrink-0">
            <span className="material-symbols-outlined text-slate-500">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {/* Description */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-2">{sk.description || 'Description'}</h3>
            <p className="text-sm text-slate-700 dark:text-white/70 leading-relaxed whitespace-pre-wrap">{desc}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2 text-amber-500 mb-1">
                <span className="material-symbols-outlined text-[16px]">star</span>
                <span className="text-xs font-bold">{sk.stars || 'Stars'}</span>
              </div>
              <div className="text-lg font-bold text-slate-800 dark:text-white">{skill.stars}</div>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2 text-blue-500 mb-1">
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span className="text-xs font-bold">{sk.downloads || 'Downloads'}</span>
              </div>
              <div className="text-lg font-bold text-slate-800 dark:text-white">
                {skill.downloads >= 1000 ? `${(skill.downloads / 1000).toFixed(1)}k` : skill.downloads}
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2 text-green-500 mb-1">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span className="text-xs font-bold">{sk.installs || 'Installs'}</span>
              </div>
              <div className="text-lg font-bold text-slate-800 dark:text-white">{skill.installs}</div>
            </div>
          </div>

          {/* Tags */}
          {skill.tags.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-2">{sk.tags || 'Tags'}</h3>
              <div className="flex flex-wrap gap-2">
                {skill.tags.map(tag => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 text-xs font-medium border border-slate-200 dark:border-white/10">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Installation Methods */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{sk.installMethods || 'Installation Methods'}</h3>
            
            {/* Method 1: Prompt */}
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-slate-700 dark:text-white/80">{sk.installViaPrompt || 'Install via AI Assistant'}</h4>
                <button onClick={() => onCopyPrompt(skill)} className="h-7 px-3 bg-primary/15 text-primary hover:bg-primary/25 text-xs font-bold rounded-lg transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">content_copy</span>
                  {sk.copyPrompt || 'Copy'}
                </button>
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-white/60 bg-white dark:bg-black/20 p-3 rounded-lg overflow-x-auto border border-slate-200 dark:border-white/10 font-mono whitespace-pre-wrap break-words">
                {promptCode}
              </pre>
            </div>

            {/* Method 2: CLI */}
            <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4 border border-slate-200 dark:border-white/10">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-slate-700 dark:text-white/80">{sk.installViaCLI || 'Install via CLI'}</h4>
                <button onClick={() => onCopyCLI(skill)} className="h-7 px-3 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20 text-xs font-bold rounded-lg transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">content_copy</span>
                  {sk.copyCLI || 'Copy'}
                </button>
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-white/60 bg-white dark:bg-black/20 p-3 rounded-lg overflow-x-auto border border-slate-200 dark:border-white/10 font-mono">
                {cliCode}
              </pre>
            </div>
          </div>

          {/* Homepage Link */}
          {skill.homepage && (
            <div className="mt-6">
              <a href={skill.homepage} target="_blank" rel="noopener noreferrer" 
                className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                {sk.viewHomepage || 'View Homepage'}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// CLI 安装 Banner 组件
const CLIBanner: React.FC<{
  status: 'checking' | 'not-installed' | 'installing' | 'installed' | 'error' | 'dismissed';
  onInstall: () => void;
  onDismiss: () => void;
  error?: string;
  sk: any;
}> = ({ status, onInstall, onDismiss, error, sk }) => {
  if (status === 'installed' || status === 'dismissed') return null;

  if (status === 'installing') {
    return (
      <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-blue-500 animate-spin">progress_activity</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-blue-700 dark:text-blue-400">{sk.installing || 'Installing SkillHub CLI...'}</p>
            <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">{sk.pleaseWait || 'Please wait, this may take a few minutes...'}</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mb-4 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-red-500 text-xl">error</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">{sk.installFailed || 'Installation Failed'}</p>
            <p className="text-xs text-red-600 dark:text-red-300 mt-1 break-words">{error}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={onInstall} className="h-7 px-3 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600">
                {sk.retry || 'Retry'}
              </button>
              <button onClick={onDismiss} className="h-7 px-3 bg-white dark:bg-white/10 text-red-700 dark:text-red-400 text-xs font-bold rounded-lg border border-red-300 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-white/20">
                {sk.close || 'Close'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // not-installed or checking
  return (
    <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
      <div className="flex items-start gap-3">
        <span className="text-2xl">💡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">{sk.skillHubBannerNotInstalled || 'SkillHub CLI Not Installed'}</p>
          <p className="text-xs text-amber-700 dark:text-amber-200 mt-1">{sk.skillHubBannerDesc || 'Install SkillHub CLI to use skill installation features'}</p>
          <div className="flex gap-2 mt-3">
            <button onClick={onInstall} disabled={status === 'checking'} className="h-7 px-4 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
              {status === 'checking' ? (
                <><span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>{sk.checking || 'Checking...'}</>
              ) : (
                <>{sk.oneClickInstall || 'One-Click Install'}</>
              )}
            </button>
            <a href="https://skillhub.ai/docs" target="_blank" rel="noopener noreferrer" className="h-7 px-3 bg-white dark:bg-white/10 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-500/30 hover:bg-amber-50 dark:hover:bg-white/20 flex items-center">
              {sk.viewDocs || 'View Docs'}
            </a>
            <button onClick={onDismiss} className="h-7 px-3 text-amber-600 dark:text-amber-400 text-xs font-bold hover:underline">
              {sk.close || 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SkillHub: React.FC<SkillHubProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const sk = (t as any).sk || {};
  const { toast } = useToast();

  const [cliStatus, setCLIStatus] = useState<'checking' | 'not-installed' | 'installing' | 'installed' | 'error' | 'dismissed'>('checking');
  const [cliError, setCLIError] = useState<string>('');
  
  // Load cache immediately to avoid showing loading indicator
  const initialCache = useMemo(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;
      const parsed: CacheData = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;
      const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
      if (age > maxAge) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const [data, setData] = useState<SkillHubData | null>(initialCache?.data || null);
  const [loading, setLoading] = useState(!initialCache); // Only show loading if no cache
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'downloads' | 'stars'>('newest');
  const [showFeatured, setShowFeatured] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(initialCache?.timestamp || null);
  const [detailSkill, setDetailSkill] = useState<SkillHubSkill | null>(null);
  const [displayLimit, setDisplayLimit] = useState(60); // Initial load: 60 skills
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [confirmSkill, setConfirmSkill] = useState<SkillHubSkill | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Clipboard helper with fallback for non-secure contexts
  const copyToClipboard = useCallback((text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback: use textarea + execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return Promise.resolve();
    } catch {
      return Promise.reject(new Error('Copy failed'));
    } finally {
      document.body.removeChild(textarea);
    }
  }, []);

  // Load cache
  const loadCache = useCallback((): CacheData | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;
      const parsed: CacheData = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;
      const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
      if (age > maxAge) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, []);

  // Save cache
  const saveCache = useCallback((data: SkillHubData, url: string) => {
    try {
      const cacheData: CacheData = { data, timestamp: Date.now(), url };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      setLastUpdated(Date.now());
    } catch { /* quota exceeded */ }
  }, []);

  // Fetch data
  const fetchData = useCallback(async (force = false) => {
    try {
      // Try cache first
      const cached = loadCache();
      if (!force && cached) {
        // Cache exists, use it immediately (already loaded in initialCache)
        // Don't show loading indicator, just return
        return;
      }

      // If no cache or force refresh, show loading only if we don't have data yet
      if (!data || force) {
        setLoading(true);
      }
      
      const result = await skillHubApi.getData();
      setData(result);
      saveCache(result, '');
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      const errorMsg = err?.message || 'Unknown error';
      toast('error', `${sk.loadFailed || 'Load failed'}: ${errorMsg}`);
    }
  }, [loadCache, saveCache, sk, toast, data]);

  // Check CLI status
  const checkCLI = useCallback(async () => {
    try {
      const status = await skillHubApi.cliStatus();
      setCLIStatus(status.installed ? 'installed' : 'not-installed');
    } catch {
      setCLIStatus('not-installed');
    }
  }, []);

  // Install CLI
  const handleInstallCLI = useCallback(async () => {
    setCLIStatus('installing');
    setCLIError('');
    try {
      const result = await skillHubApi.install();
      if (result.success) {
        toast('success', sk.installSuccess || 'SkillHub CLI installed successfully!');
        setCLIStatus('installed');
      } else {
        setCLIError(result.output || 'Unknown error');
        setCLIStatus('error');
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Installation failed';
      setCLIError(errorMsg);
      setCLIStatus('error');
      if (errorMsg.includes('PERMISSION_DENIED')) {
        toast('error', sk.permissionDenied || 'Permission denied. Please run with sudo.');
      } else if (errorMsg.includes('PLATFORM_NOT_SUPPORTED')) {
        toast('error', sk.platformNotSupported || 'Platform not supported. Please install manually.');
      } else {
        toast('error', `${sk.installFailed || 'Install failed'}: ${errorMsg}`);
      }
    }
  }, [sk, toast]);

  // Dismiss banner
  const handleDismissBanner = useCallback(() => {
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
    setCLIStatus('dismissed');
  }, []);

  // Initial load
  useEffect(() => {
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY);
    if (dismissed === 'true') {
      setCLIStatus('dismissed');
    } else {
      checkCLI();
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Filter and sort skills
  const filteredSkills = useMemo(() => {
    if (!data) return [];
    let list = data.skills;

    // Featured filter
    if (showFeatured) {
      const featuredSet = new Set(data.featured);
      list = list.filter(s => featuredSet.has(s.slug));
    }

    // Category filter
    if (category !== 'all') {
      const categoryTags = data.categories[category] || [];
      const tagSet = new Set(categoryTags.map(t => t.toLowerCase()));
      list = list.filter(s => s.tags.some(t => tagSet.has(t.toLowerCase())));
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.description_zh?.toLowerCase().includes(q)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortBy === 'downloads') return b.downloads - a.downloads;
      if (sortBy === 'stars') return b.stars - a.stars;
      return b.updated_at - a.updated_at; // newest
    });

    return list;
  }, [data, showFeatured, category, searchQuery, sortBy]);

  const renderedSkills = useMemo(() => filteredSkills.slice(0, displayLimit), [filteredSkills, displayLimit]);
  const hasMore = filteredSkills.length > displayLimit;

  // Reset display limit when filters change
  useEffect(() => {
    setDisplayLimit(60);
  }, [searchQuery, category, sortBy, showFeatured]);

  // Copy prompt
  const handleCopyPrompt = useCallback((skill: SkillHubSkill) => {
    const prompt = `请先检查是否已安装 SkillHub 商店，若未安装，请根据 https://skillhub-1251783334.cos.ap-guangzhou.myqcloud.com/install/skillhub.md 安装 SkillHub 商店，然后安装 ${skill.slug} 技能。\n\n若已安装，则直接安装 ${skill.slug} 技能。`;
    copyToClipboard(prompt).then(() => {
      toast('success', sk.copiedHint || 'Copied to clipboard');
    }).catch(() => {
      toast('error', sk.copyFailed || 'Copy failed');
    });
  }, [sk, toast, copyToClipboard]);

  // Copy CLI command
  const handleCopyCLI = useCallback((skill: SkillHubSkill) => {
    const command = `skillhub install ${skill.slug}`;
    copyToClipboard(command).then(() => {
      toast('success', sk.copiedHint || 'Copied to clipboard');
    }).catch(() => {
      toast('error', sk.copyFailed || 'Copy failed');
    });
  }, [sk, toast, copyToClipboard]);

  // Right button action: if CLI installed → show confirm dialog; else → copy CLI command
  const handleRightButton = useCallback((skill: SkillHubSkill) => {
    if (cliStatus === 'installed') {
      setConfirmSkill(skill);
    } else {
      handleCopyCLI(skill);
    }
  }, [cliStatus, handleCopyCLI]);

  // Install skill via API (called after confirmation)
  const handleInstallSkill = useCallback(async (skill: SkillHubSkill) => {
    if (installingSlug) return;
    setConfirmSkill(null);
    setInstallingSlug(skill.slug);
    try {
      const result = await skillHubApi.installSkill(skill.slug);
      if (result.success) {
        toast('success', `${skill.name} ${sk.installSuccess || 'installed successfully'}`);
      }
    } catch (err: any) {
      const msg = err?.message || 'Install failed';
      if (msg.includes('CLI_NOT_INSTALLED')) {
        toast('error', sk.skillHubBannerNotInstalled || 'SkillHub CLI not installed');
      } else {
        toast('error', `${sk.installFailed || 'Install failed'}: ${msg}`);
      }
    } finally {
      setInstallingSlug(null);
    }
  }, [installingSlug, sk, toast]);

  const categories = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.categories);
  }, [data]);

  const cacheAge = useMemo(() => {
    if (!lastUpdated) return '';
    const age = Date.now() - lastUpdated;
    const hours = Math.floor(age / (60 * 60 * 1000));
    const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}${sk.hoursAgo || 'h ago'}`;
    if (minutes > 0) return `${minutes}${sk.minutesAgo || 'm ago'}`;
    return sk.justNow || 'Just now';
  }, [lastUpdated, sk]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0f1115]">
      {/* Toolbar */}
      <div className="flex flex-col border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 shrink-0">
        <div className="p-3 flex flex-row items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">search</span>
            <input ref={searchRef} className="w-full h-9 ps-9 pe-4 bg-white dark:bg-[#1a1c22] border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-1 focus:ring-primary outline-none"
              placeholder={`${sk.search || 'Search'} (Ctrl+K)`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>

          {/* Category filter */}
          <CustomSelect
            value={category}
            onChange={(v) => setCategory(v)}
            options={[
              { value: 'all', label: sk.categoryAll || 'All Categories' },
              ...categories.map(cat => ({ value: cat, label: cat }))
            ]}
            className="shrink-0"
          />

          {/* Featured toggle */}
          <button onClick={() => setShowFeatured(!showFeatured)}
            className={`h-9 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all shrink-0 ${showFeatured
              ? 'bg-primary/10 dark:bg-primary/20 border-primary/30 text-primary'
              : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60'
            }`}>
            <span className="material-symbols-outlined text-[14px]">star</span>
            {sk.featuredSkills || 'Featured'}
          </button>

          {/* Sort */}
          <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-lg shadow-inner shrink-0">
            {([['newest', sk.sortNewest || 'Newest'], ['downloads', sk.sortDownloads || 'Downloads'], ['stars', sk.sortStars || 'Stars']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setSortBy(val as any)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all whitespace-nowrap ${sortBy === val ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button onClick={() => fetchData(true)} disabled={loading}
            className="h-9 w-9 flex items-center justify-center bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg shrink-0 disabled:opacity-50"
            title={sk.forceRefresh || 'Force Refresh'}>
            <span className={`material-symbols-outlined text-[16px] text-slate-500 ${loading ? 'animate-spin' : ''}`}>{loading ? 'progress_activity' : 'refresh'}</span>
          </button>

          {/* Cache status */}
          {lastUpdated && (
            <span className="h-9 px-2 flex items-center text-[10px] text-slate-500 dark:text-white/50 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg whitespace-nowrap shrink-0">
              {sk.lastUpdated || 'Updated'}: {cacheAge}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {/* CLI Banner */}
          <CLIBanner status={cliStatus} onInstall={handleInstallCLI} onDismiss={handleDismissBanner} error={cliError} sk={sk} />

          {/* Loading */}
          {loading && !data && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <span className="material-symbols-outlined text-4xl animate-spin mb-3">progress_activity</span>
              <span className="text-xs">{sk.loading || 'Loading...'}</span>
              <span className="text-[10px] mt-2 text-slate-400">{sk.loadingLargeFile || 'Loading large file, please wait...'}</span>
            </div>
          )}

          {/* Error - no data and not loading */}
          {!loading && !data && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <span className="material-symbols-outlined text-4xl mb-3 text-red-500">error</span>
              <span className="text-xs mb-3">{sk.loadFailed || 'Failed to load data'}</span>
              <button onClick={() => fetchData(true)} className="h-8 px-4 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90">
                {sk.retry || 'Retry'}
              </button>
            </div>
          )}

          {/* Empty */}
          {!loading && data && filteredSkills.length === 0 && (
            <EmptyState icon="search_off" title={sk.noResults || 'No skills found'} />
          )}

          {/* Skills grid */}
          {filteredSkills.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {renderedSkills.map(skill => {
                const desc = language === 'zh' || language === 'zh-TW' ? (skill.description_zh || skill.description) : skill.description;
                return (
                  <div key={skill.slug} className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-2xl p-4 hover:border-primary/30 transition-all group shadow-sm flex flex-col cursor-pointer" onClick={() => setDetailSkill(skill)}>
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-2">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-purple-500/15 flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-white/5">
                        <span className="text-lg">📦</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-[13px] text-slate-800 dark:text-white truncate">{skill.name}</h4>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-white/40">v{skill.version}</span>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-[11px] text-slate-500 dark:text-white/40 leading-relaxed mb-3 line-clamp-2">{desc}</p>

                    {/* Tags */}
                    {skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {skill.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-2 mt-auto text-[10px] text-slate-400 dark:text-white/35">
                      {skill.stars > 0 && (
                        <span className="flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">star</span>{skill.stars}
                        </span>
                      )}
                      {skill.downloads > 0 && (
                        <span className="flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">download</span>
                          {skill.downloads >= 1000 ? `${(skill.downloads / 1000).toFixed(1)}k` : skill.downloads}
                        </span>
                      )}
                      <a href={skill.homepage} target="_blank" rel="noopener noreferrer" className="ms-auto flex items-center text-primary/60 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                      </a>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100 dark:border-white/5">
                      <button onClick={(e) => { e.stopPropagation(); handleCopyPrompt(skill); }}
                        className="flex-1 h-7 bg-primary/15 text-primary hover:bg-primary/25 text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">content_copy</span>
                        <span className="truncate">{sk.copyPrompt || 'Copy Prompt'}</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleRightButton(skill); }}
                        disabled={installingSlug === skill.slug}
                        className={`h-7 px-2 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0 ${installingSlug === skill.slug ? 'bg-primary/20 text-primary cursor-wait' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10'}`}
                        title={cliStatus === 'installed' ? `${sk.installSkill || 'Install'} ${skill.slug}` : `${sk.copyCLI || 'Copy'}: skillhub install ${skill.slug}`}>
                        <span className={`material-symbols-outlined text-[12px] ${installingSlug === skill.slug ? 'animate-spin' : ''}`}>
                          {installingSlug === skill.slug ? 'progress_activity' : (cliStatus === 'installed' ? 'download' : 'terminal')}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More Button */}
          {hasMore && (
            <div className="flex justify-center mt-6">
              <button 
                onClick={() => setDisplayLimit(prev => prev + 60)} 
                className="h-10 px-6 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-bold text-slate-700 dark:text-white/70 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">expand_more</span>
                {sk.loadMore || 'Load More'} ({filteredSkills.length - displayLimit} {sk.remaining || 'remaining'})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Install Confirmation Dialog */}
      {confirmSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmSkill(null)}>
          <div className="bg-white dark:bg-[#1a1c22] rounded-2xl shadow-2xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary">download</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{sk.confirmInstallTitle || 'Install Skill'}</h3>
                <p className="text-xs text-slate-500 dark:text-white/50">{confirmSkill.name}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 dark:text-white/60 mb-1">
              {sk.confirmInstallDesc || 'This will execute the following command:'}
            </p>
            <pre className="text-[11px] text-slate-700 dark:text-white/70 bg-slate-50 dark:bg-black/20 p-2 rounded-lg mb-4 font-mono border border-slate-200 dark:border-white/10">
              skillhub install {confirmSkill.slug}
            </pre>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmSkill(null)}
                className="h-8 px-4 text-xs font-bold rounded-lg bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/20 transition-colors">
                {sk.cancel || 'Cancel'}
              </button>
              <button onClick={() => handleInstallSkill(confirmSkill)}
                className="h-8 px-4 text-xs font-bold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">download</span>
                {sk.confirmInstallBtn || 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <SkillDetailModal 
        skill={detailSkill} 
        onClose={() => setDetailSkill(null)} 
        onCopyPrompt={handleCopyPrompt} 
        onCopyCLI={handleCopyCLI} 
        language={language} 
        sk={sk} 
      />
    </div>
  );
};

export default SkillHub;

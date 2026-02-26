
import React, { useState, useEffect, useMemo } from 'react';
import { authApi } from '../services/api';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { useConfirm } from './ConfirmDialog';
import LanguageSwitcher from './LanguageSwitcher';

interface LockScreenProps {
  onUnlock: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

const LockScreen: React.FC<LockScreenProps> = ({
  onUnlock,
  theme,
  onToggleTheme,
  language,
  onChangeLanguage
}) => {
  const t = useMemo(() => getTranslation(language), [language]) as any;
  const dateLocale = useMemo(() => ({ zh: 'zh-CN', en: 'en-US' } as Record<string, string>)[language] || 'en-US', [language]);
  const [username, setUsername] = useState('');
  const [editingUsername, setEditingUsername] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(false);

  // Setup form states
  const [setupData, setSetupData] = useState({
    adminUser: 'admin',
    adminPass: '',
    confirmPass: '',
  });

  useEffect(() => {
    authApi.needsSetup()
      .then(res => {
        setNeedsSetup(res.needs_setup);
        if (!res.needs_setup && res.login_hint) {
          setUsername(res.login_hint);
        }
      })
      .catch(() => { });
  }, []);

  const handleUnlock = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await authApi.login(username, password);
      onUnlock();
    } catch (err: any) {
      setError(true);
      setErrorMsg(err.message || t.loginFailed);
      setTimeout(() => setError(false), 500);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    // 验证两次密码是否一致
    if (setupData.adminPass !== setupData.confirmPass) {
      setErrorMsg(t.passwordMismatch);
      return;
    }

    if (setupData.adminPass.length < 6) {
      setErrorMsg(t.passwordMin6);
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      await authApi.setup(setupData.adminUser, setupData.adminPass);
      // 初始化成功后，自动登录
      await authApi.login(setupData.adminUser, setupData.adminPass);
      onUnlock();
    } catch (err: any) {
      setErrorMsg(err.message || t.initFailed);
    } finally {
      setLoading(false);
    }
  };

  const { confirm } = useConfirm();
  const handleSystemReset = async () => {
    const confirmMsg = m.resetConfirm;
    if (await confirm({
      title: t.resetLabel,
      message: confirmMsg,
      confirmText: t.resetLabel,
      cancelText: t.cancel,
      danger: true,
    })) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const m = t.menu || {};

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col items-center justify-between py-12 px-6">
      {/* Background with Sequoia Blur */}
      <div className="fixed inset-0 z-0">
        <div
          className="absolute inset-0 scale-110 blur-[40px] opacity-90 transition-transform duration-[20s] animate-pulse"
          style={{
            backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuC-3GurQYWxoUvwmaGhtDNBjz-z4QA_n4niOobP-Bi1nB6wYtkRQLUQ8PrSOuldFjj-wrbdzTMlzXUVX1was_9naxkPMnzMUCSjS2CKSVjncHnpOk34kVYS1VU4Rq0uMOLJ6SrsqaMdc44XK9gr5GV13WpAdhyp6huIOL8NjcY4EJOdiWJxSpV_7pivLl70j9POzjvXNhBltaL6VFoXCQgU8YD1uJN97llVXav185ptcVa7yRblTd5E34I1jK5WLjsEXgs-ySc47P8')",
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />
        <div className="absolute inset-0 bg-black/20"></div>
      </div>

      {/* Clock Area */}
      <div className="relative z-10 flex flex-col items-center mt-8 animate-in fade-in slide-in-from-top-4 duration-1000">
        <h1 className="text-white text-[96px] font-thin leading-none tracking-tight select-none">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
        </h1>
        <h2 className="text-white text-xl font-medium mt-2 opacity-90 select-none">
          {new Date().toLocaleDateString(dateLocale, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
      </div>

      {/* Login / Setup Area - Added mb-24 for spacing */}
      <div className={`relative z-10 flex flex-col items-center w-full max-w-sm transition-all duration-300 mb-24 ${error ? 'animate-shake' : ''}`}>
        {!needsSetup && (
          <div className="w-[112px] h-[112px] rounded-full overflow-hidden border border-white/30 shadow-2xl mac-glass mb-6 flex items-center justify-center bg-gradient-to-br from-primary/20 to-orange-500/20">
            <span className="text-[56px] leading-none select-none drop-shadow-lg" role="img" aria-label="ClawDeckX">🦀</span>
          </div>
        )}

        {needsSetup ? (
          <div className="w-full mac-glass p-6 rounded-3xl border border-white/20 shadow-2xl animate-in zoom-in-95 duration-500">
            <h3 className="text-white text-lg font-bold mb-1 text-center">{t.initialSetup}</h3>
            <p className="text-white/60 text-xs mb-6 text-center leading-relaxed">{t.firstRunHint}</p>
            <form onSubmit={handleSetup} className="space-y-4">
              <input
                className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-1 focus:ring-primary outline-none placeholder:text-white/40"
                placeholder={t.adminPlaceholder}
                value={setupData.adminUser}
                onChange={e => setSetupData({ ...setupData, adminUser: e.target.value })}
              />
              <input
                type="password"
                className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-1 focus:ring-primary outline-none placeholder:text-white/40"
                placeholder={t.adminPassPlaceholder}
                value={setupData.adminPass}
                onChange={e => setSetupData({ ...setupData, adminPass: e.target.value })}
              />
              <input
                type="password"
                className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-1 focus:ring-primary outline-none placeholder:text-white/40"
                placeholder={t.confirmPassPlaceholder}
                value={setupData.confirmPass}
                onChange={e => setSetupData({ ...setupData, confirmPass: e.target.value })}
              />
              {errorMsg && <p className="text-mac-red text-xs text-center">{errorMsg}</p>}
              <button disabled={loading} className="w-full h-10 bg-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-primary/30 active:scale-95 transition-all disabled:opacity-50">
                {loading ? t.processing : t.initSystem}
              </button>
            </form>
          </div>
        ) : (
          <>
            {editingUsername ? (
              <input
                autoFocus
                className="text-white text-lg font-semibold mb-4 bg-transparent border-b border-white/40 outline-none text-center w-48 pb-1 placeholder:text-white/30"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onBlur={() => setEditingUsername(false)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingUsername(false); }}
                placeholder={t.usernamePlaceholder}
              />
            ) : (
              <h3
                className="text-white text-lg font-semibold mb-4 drop-shadow-md cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1.5 group"
                onClick={() => setEditingUsername(true)}
                title={t.clickToChangeUser}
              >
                {username || t.adminPlaceholder}
                <span className="material-symbols-outlined text-[14px] text-white/0 group-hover:text-white/50 transition-colors">edit</span>
              </h3>
            )}
            <form onSubmit={handleUnlock} className="relative w-full max-w-[280px] space-y-4">
              <input
                type="password"
                autoFocus={!editingUsername}
                className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-1 focus:ring-primary outline-none placeholder:text-white/40"
                placeholder={t.enterPassword}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {errorMsg && <p className="text-mac-red text-xs text-center">{errorMsg}</p>}
              <button type="submit" disabled={loading} className="w-full h-10 bg-primary text-white text-sm font-bold rounded-xl shadow-lg shadow-primary/30 active:scale-95 transition-all disabled:opacity-50">
                {loading ? t.signingIn : t.signIn}
              </button>
            </form>
            <p className="text-white/40 text-[11px] mt-8 cursor-default hover:text-white/60 transition-colors">
              {t.enterPwdHint}
            </p>
          </>
        )}
      </div>

      {/* System Controls - Functionality Updated */}
      <div className="relative z-10 flex items-center gap-12 mb-4">
        {/* Sleep Icon -> Toggle Theme */}
        <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={onToggleTheme}>
          <div className="w-10 h-10 rounded-full mac-glass flex items-center justify-center text-white opacity-80 group-hover:opacity-100 transition-all">
            <span className="material-symbols-outlined text-[20px]">bedtime</span>
          </div>
          <span className="text-white/80 text-[11px] font-medium group-hover:text-white">{t.themeLabel}</span>
        </div>

        {/* Language Switcher */}
        <LanguageSwitcher language={language} onChange={onChangeLanguage} variant="lockscreen" />

        {/* Power Icon -> System Reset */}
        <div className="flex flex-col items-center gap-2 group cursor-pointer" onClick={handleSystemReset}>
          <div className="w-10 h-10 rounded-full mac-glass flex items-center justify-center text-white opacity-80 group-hover:opacity-100 transition-all">
            <span className="material-symbols-outlined text-[20px]">power_settings_new</span>
          </div>
          <span className="text-white/80 text-[11px] font-medium group-hover:text-white">{t.resetLabel}</span>
        </div>
      </div>

      {/* Version */}
      <div className="relative z-10 text-white/30 text-[10px] font-mono mb-3">
        v{__APP_VERSION__}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default LockScreen;

import React, { useState, useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigCard, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField, AddButton, EmptyState } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

const NODE_MANAGER_OPTIONS = [
  { value: 'npm', label: 'npm' }, { value: 'pnpm', label: 'pnpm' },
  { value: 'yarn', label: 'yarn' }, { value: 'bun', label: 'bun' },
];

export const ExtensionsSection: React.FC<SectionProps> = ({ setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);

  // Skills
  const gs = (p: string[]) => getField(['skills', ...p]);
  const ss = (p: string[], v: any) => setField(['skills', ...p], v);
  const skillEntries = gs(['entries']) || {};
  const skillKeys = Object.keys(skillEntries);
  const [newSkillKey, setNewSkillKey] = useState('');

  // Plugins
  const gp = (p: string[]) => getField(['plugins', ...p]);
  const sp = (p: string[], v: any) => setField(['plugins', ...p], v);
  const pluginEntries = gp(['entries']) || {};
  const pluginKeys = Object.keys(pluginEntries);
  const [newPluginKey, setNewPluginKey] = useState('');

  // Tab
  const [tab, setTab] = useState<'skills' | 'plugins'>('skills');

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/[0.04]">
        <button onClick={() => setTab('skills')}
          className={`flex-1 h-7 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${tab === 'skills' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60'}`}>
          <span className="material-symbols-outlined text-[12px]">extension</span>
          {es.secSkills}
        </button>
        <button onClick={() => setTab('plugins')}
          className={`flex-1 h-7 text-[10px] font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${tab === 'plugins' ? 'bg-white dark:bg-white/10 text-primary shadow-sm' : 'text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60'}`}>
          <span className="material-symbols-outlined text-[12px]">power</span>
          {es.secPlugins}
        </button>
      </div>

      {/* Skills tab */}
      {tab === 'skills' && (
        <>
          <ConfigSection title={es.loadConfig} icon="download" iconColor="text-violet-500">
            <ArrayField label={es.allowBundled} tooltip={tip('skills.allowBundled')} value={gs(['allowBundled']) || []} onChange={v => ss(['allowBundled'], v)} placeholder={es.phSkillName} />
            <ArrayField label={es.extraDirs} tooltip={tip('skills.load.extraDirs')} value={gs(['load', 'extraDirs']) || []} onChange={v => ss(['load', 'extraDirs'], v)} placeholder={es.phSkillsPath} />
            <SwitchField label={es.watch} tooltip={tip('skills.load.watch')} value={gs(['load', 'watch']) !== false} onChange={v => ss(['load', 'watch'], v)} />
            <NumberField label={es.watchDebounceMs} tooltip={tip('skills.load.watchDebounceMs')} value={gs(['load', 'watchDebounceMs'])} onChange={v => ss(['load', 'watchDebounceMs'], v)} min={0} />
          </ConfigSection>

          <ConfigSection title={es.installConfig} icon="install_desktop" iconColor="text-violet-500" defaultOpen={false}>
            <SwitchField label={es.preferBrew} tooltip={tip('skills.install.preferBrew')} value={gs(['install', 'preferBrew']) === true} onChange={v => ss(['install', 'preferBrew'], v)} />
            <SelectField label={es.nodeManager} tooltip={tip('skills.install.nodeManager')} value={gs(['install', 'nodeManager']) || 'npm'} onChange={v => ss(['install', 'nodeManager'], v)} options={NODE_MANAGER_OPTIONS} />
          </ConfigSection>

          <ConfigSection
            title={es.skillEntries}
            icon="extension"
            iconColor="text-violet-500"
            desc={`${skillKeys.length} ${es.skillCount}`}
          >
            {skillKeys.length === 0 ? (
              <EmptyState message={es.noSkillEntries} icon="extension_off" />
            ) : (
              skillKeys.map(key => {
                const entry = skillEntries[key] || {};
                return (
                  <ConfigCard key={key} title={key} icon="extension" onDelete={() => deleteField(['skills', 'entries', key])}>
                    <SwitchField label={es.enabled} value={entry.enabled !== false} onChange={v => ss(['entries', key, 'enabled'], v)} />
                    <PasswordField label={es.apiKey} value={entry.apiKey || ''} onChange={v => ss(['entries', key, 'apiKey'], v)} />
                    <KeyValueField label={es.envVars} value={entry.env || {}} onChange={v => ss(['entries', key, 'env'], v)} />
                  </ConfigCard>
                );
              })
            )}
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newSkillKey}
                onChange={e => setNewSkillKey(e.target.value)}
                placeholder={es.skillName}
                className="flex-1 h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[11px] font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newSkillKey.trim()) {
                    ss(['entries', newSkillKey.trim()], { enabled: true });
                    setNewSkillKey('');
                  }
                }}
              />
              <button
                onClick={() => { if (newSkillKey.trim()) { ss(['entries', newSkillKey.trim()], { enabled: true }); setNewSkillKey(''); } }}
                className="h-8 px-3 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors"
              >
                + {es.add}
              </button>
            </div>
          </ConfigSection>
        </>
      )}

      {/* Plugins tab */}
      {tab === 'plugins' && (
        <>
          <ConfigSection title={es.pluginSettings} icon="power" iconColor="text-rose-500">
            <SwitchField label={es.enablePlugins} tooltip={tip('plugins.enabled')} value={gp(['enabled']) !== false} onChange={v => sp(['enabled'], v)} />
            <ArrayField label={es.allowList} tooltip={tip('plugins.allow')} value={gp(['allow']) || []} onChange={v => sp(['allow'], v)} placeholder={es.phPluginName} />
            <ArrayField label={es.denyList} tooltip={tip('plugins.deny')} value={gp(['deny']) || []} onChange={v => sp(['deny'], v)} placeholder={es.phPluginName} />
          </ConfigSection>

          <ConfigSection title={es.pluginSlots} icon="widgets" iconColor="text-rose-500" defaultOpen={false}>
            <TextField label={es.memoryPlugin} tooltip={tip('plugins.slots.memory')} value={gp(['slots', 'memory']) || ''} onChange={v => sp(['slots', 'memory'], v)} placeholder={es.phPluginName} />
          </ConfigSection>

          <ConfigSection
            title={es.pluginEntries}
            icon="extension"
            iconColor="text-rose-500"
            desc={`${pluginKeys.length} ${es.pluginCount}`}
          >
            {pluginKeys.length === 0 ? (
              <EmptyState message={es.noPluginEntries} icon="power_off" />
            ) : (
              pluginKeys.map(key => {
                const entry = pluginEntries[key] || {};
                return (
                  <ConfigCard key={key} title={key} icon="power" onDelete={() => deleteField(['plugins', 'entries', key])}>
                    <SwitchField label={es.enabled} value={entry.enabled !== false} onChange={v => sp(['entries', key, 'enabled'], v)} />
                  </ConfigCard>
                );
              })
            )}
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newPluginKey}
                onChange={e => setNewPluginKey(e.target.value)}
                placeholder={es.pluginName}
                className="flex-1 h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[11px] font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newPluginKey.trim()) {
                    sp(['entries', newPluginKey.trim()], { enabled: true });
                    setNewPluginKey('');
                  }
                }}
              />
              <button
                onClick={() => { if (newPluginKey.trim()) { sp(['entries', newPluginKey.trim()], { enabled: true }); setNewPluginKey(''); } }}
                className="h-8 px-3 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors"
              >
                + {es.add}
              </button>
            </div>
          </ConfigSection>
        </>
      )}
    </div>
  );
};

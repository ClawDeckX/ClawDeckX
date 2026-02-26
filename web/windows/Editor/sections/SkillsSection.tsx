import React, { useState, useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigCard, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField, AddButton, EmptyState } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

const NODE_MANAGER_OPTIONS = [
  { value: 'npm', label: 'npm' }, { value: 'pnpm', label: 'pnpm' },
  { value: 'yarn', label: 'yarn' }, { value: 'bun', label: 'bun' },
];

export const SkillsSection: React.FC<SectionProps> = ({ setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['skills', ...p]);
  const s = (p: string[], v: any) => setField(['skills', ...p], v);
  const entries = g(['entries']) || {};
  const entryKeys = Object.keys(entries);
  const [newSkillKey, setNewSkillKey] = useState('');

  return (
    <div className="space-y-4">
      <ConfigSection title={es.loadConfig} icon="download" iconColor="text-violet-500">
        <ArrayField label={es.allowBundled} tooltip={tip('skills.allowBundled')} value={g(['allowBundled']) || []} onChange={v => s(['allowBundled'], v)} placeholder={es.phSkillName} />
        <ArrayField label={es.extraDirs} tooltip={tip('skills.load.extraDirs')} value={g(['load', 'extraDirs']) || []} onChange={v => s(['load', 'extraDirs'], v)} placeholder={es.phSkillsPath} />
        <SwitchField label={es.watch} tooltip={tip('skills.load.watch')} value={g(['load', 'watch']) !== false} onChange={v => s(['load', 'watch'], v)} />
        <NumberField label={es.watchDebounceMs} tooltip={tip('skills.load.watchDebounceMs')} value={g(['load', 'watchDebounceMs'])} onChange={v => s(['load', 'watchDebounceMs'], v)} min={0} />
      </ConfigSection>

      <ConfigSection title={es.installConfig} icon="install_desktop" iconColor="text-violet-500" defaultOpen={false}>
        <SwitchField label={es.preferBrew} tooltip={tip('skills.install.preferBrew')} value={g(['install', 'preferBrew']) === true} onChange={v => s(['install', 'preferBrew'], v)} />
        <SelectField label={es.nodeManager} tooltip={tip('skills.install.nodeManager')} value={g(['install', 'nodeManager']) || 'npm'} onChange={v => s(['install', 'nodeManager'], v)} options={NODE_MANAGER_OPTIONS} />
      </ConfigSection>

      <ConfigSection
        title={es.skillEntries}
        icon="extension"
        iconColor="text-violet-500"
        desc={`${entryKeys.length} ${es.skillCount}`}
      >
        {entryKeys.length === 0 ? (
          <EmptyState message={es.noSkillEntries} icon="extension_off" />
        ) : (
          entryKeys.map(key => {
            const entry = entries[key] || {};
            return (
              <ConfigCard key={key} title={key} icon="extension" onDelete={() => deleteField(['skills', 'entries', key])}>
                <SwitchField label={es.enabled} value={entry.enabled !== false} onChange={v => s(['entries', key, 'enabled'], v)} />
                <PasswordField label={es.apiKey} value={entry.apiKey || ''} onChange={v => s(['entries', key, 'apiKey'], v)} />
                <KeyValueField label={es.envVars} value={entry.env || {}} onChange={v => s(['entries', key, 'env'], v)} />
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
                s(['entries', newSkillKey.trim()], { enabled: true });
                setNewSkillKey('');
              }
            }}
          />
          <button
            onClick={() => { if (newSkillKey.trim()) { s(['entries', newSkillKey.trim()], { enabled: true }); setNewSkillKey(''); } }}
            className="h-8 px-3 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors"
          >
            + {es.add}
          </button>
        </div>
      </ConfigSection>
    </div>
  );
};

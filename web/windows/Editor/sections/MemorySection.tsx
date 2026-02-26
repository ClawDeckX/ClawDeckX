import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const MemorySection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['memory', ...p]);
  const s = (p: string[], v: any) => setField(['memory', ...p], v);

  const BACKEND_OPTIONS = useMemo(() => [{ value: 'builtin', label: es.optBuiltin }, { value: 'qmd', label: es.optQmd }], [es]);
  const CITATIONS_OPTIONS = useMemo(() => [{ value: 'auto', label: es.optAuto }, { value: 'on', label: es.optOn }, { value: 'off', label: es.optOff }], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.memoryConfig} icon="neurology" iconColor="text-sky-500">
        <SelectField label={es.memoryProvider} tooltip={tip('memory.backend')} value={g(['backend']) || 'builtin'} onChange={v => s(['backend'], v)} options={BACKEND_OPTIONS} />
        <SelectField label={es.citations} tooltip={tip('memory.citations')} value={g(['citations']) || 'auto'} onChange={v => s(['citations'], v)} options={CITATIONS_OPTIONS} />
      </ConfigSection>

      {g(['backend']) === 'qmd' && (
        <ConfigSection title={es.optQmd} icon="database" iconColor="text-sky-500" defaultOpen={false}>
          <TextField label={es.qmdCommand} tooltip={tip('memory.qmd.command')} value={g(['qmd', 'command']) || ''} onChange={v => s(['qmd', 'command'], v)} placeholder={es.phQmdCommand} />
          <TextField label={es.qmdDataPath} tooltip={tip('memory.qmd.paths.data')} value={g(['qmd', 'paths', 'data']) || ''} onChange={v => s(['qmd', 'paths', 'data'], v)} />
          <NumberField label={es.maxMemories} tooltip={tip('memory.qmd.limits.maxEntries')} value={g(['qmd', 'limits', 'maxEntries'])} onChange={v => s(['qmd', 'limits', 'maxEntries'], v)} min={1} />
          <TextField label={es.scope} tooltip={tip('memory.qmd.scope')} value={g(['qmd', 'scope']) || ''} onChange={v => s(['qmd', 'scope'], v)} placeholder={es.phMemoryScope} />
        </ConfigSection>
      )}
    </div>
  );
};

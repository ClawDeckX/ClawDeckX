import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import SchemaRemainder from '../SchemaRemainder';

// Options moved inside component

export const MemorySection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const g = (p: string[]) => getField(['memory', ...p]);
  const s = (p: string[], v: any) => setField(['memory', ...p], v);
  // Dreaming config lives under plugins.entries['memory-core'].config.dreaming.*
  const dreamBase = ['plugins', 'entries', 'memory-core', 'config', 'dreaming'];
  const gDream = (p: string[]) => getField([...dreamBase, ...p]);
  const sDream = (p: string[], v: any) => setField([...dreamBase, ...p], v);

  const BACKEND_OPTIONS = useMemo(() => [{ value: 'builtin', label: es.optBuiltin }, { value: 'qmd', label: es.optQmd }], [es]);
  const CITATIONS_OPTIONS = useMemo(() => [{ value: 'auto', label: es.optAuto }, { value: 'on', label: es.optOn }, { value: 'off', label: es.optOff }], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.memoryConfig} icon="neurology" iconColor="text-sky-500">
        <SelectField label={es.memoryProvider} tooltip={tip('memory.backend')} value={g(['backend']) || 'builtin'} onChange={v => s(['backend'], v)} options={BACKEND_OPTIONS} />
        <SelectField label={es.citations} tooltip={tip('memory.citations')} value={g(['citations']) || 'auto'} onChange={v => s(['citations'], v)} options={CITATIONS_OPTIONS} />
      </ConfigSection>

      <ConfigSection title={es.dreaming || 'Dreaming'} icon="bedtime" iconColor="text-indigo-500" defaultOpen={false}>
        <SwitchField label={es.dreamingEnabled || 'Enabled'} tooltip={tip('plugins.entries.memory-core.config.dreaming.enabled')} value={gDream(['enabled']) === true} onChange={v => sDream(['enabled'], v)} />
        <TextField label={es.dreamingFrequency || 'Frequency'} tooltip={tip('plugins.entries.memory-core.config.dreaming.frequency')} value={gDream(['frequency']) || ''} onChange={v => sDream(['frequency'], v)} placeholder="0 3 * * *" />
        <NumberField label={es.dreamingMaxAge || 'Max Age (days)'} tooltip={tip('plugins.entries.memory-core.config.dreaming.phases.deep.maxAgeDays')} value={gDream(['phases', 'deep', 'maxAgeDays'])} onChange={v => sDream(['phases', 'deep', 'maxAgeDays'], v)} min={1} placeholder={def('plugins.entries.memory-core.config.dreaming.phases.deep.maxAgeDays')} />
      </ConfigSection>

      {g(['backend']) === 'qmd' && (
        <ConfigSection title={es.optQmd} icon="database" iconColor="text-sky-500" defaultOpen={false}>
          <TextField label={es.qmdCommand} tooltip={tip('memory.qmd.command')} value={g(['qmd', 'command']) || ''} onChange={v => s(['qmd', 'command'], v)} placeholder={es.phQmdCommand} />
          <TextField label={es.qmdDataPath} tooltip={tip('memory.qmd.paths.data')} value={g(['qmd', 'paths', 'data']) || ''} onChange={v => s(['qmd', 'paths', 'data'], v)} />
          <NumberField label={es.maxMemories} tooltip={tip('memory.qmd.limits.maxEntries')} value={g(['qmd', 'limits', 'maxEntries'])} onChange={v => s(['qmd', 'limits', 'maxEntries'], v)} min={1} placeholder={def('memory.qmd.limits.maxEntries')} />
          <TextField label={es.scope} tooltip={tip('memory.qmd.scope')} value={g(['qmd', 'scope']) || ''} onChange={v => s(['qmd', 'scope'], v)} placeholder={es.phMemoryScope} />
          <TextField label={es.qmdSearchMode || 'Search Mode'} tooltip={tip('memory.qmd.searchMode')} value={g(['qmd', 'searchMode']) || ''} onChange={v => s(['qmd', 'searchMode'], v)} placeholder="hybrid" />
          <TextField label={es.qmdSearchTool || 'Search Tool'} tooltip={tip('memory.qmd.searchTool')} value={g(['qmd', 'searchTool']) || ''} onChange={v => s(['qmd', 'searchTool'], v)} placeholder="auto" />
          <SwitchField label={es.qmdIncludeDefaultMemory || 'Include Default Memory'} tooltip={tip('memory.qmd.includeDefaultMemory')} value={g(['qmd', 'includeDefaultMemory']) !== false} onChange={v => s(['qmd', 'includeDefaultMemory'], v)} />
        </ConfigSection>
      )}

      <SchemaRemainder
        sectionPath="memory"
        handledKeys={[
          'backend', 'citations', 'search', 'dreaming', 'qmd',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Memory Fields'}
      />
    </div>
  );
};

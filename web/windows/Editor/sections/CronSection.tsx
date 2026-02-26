import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SwitchField, SelectField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

export const CronSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['cron', ...p]);
  const s = (p: string[], v: any) => setField(['cron', ...p], v);

  const WAKE_OPTIONS = useMemo(() => [
    { value: 'now', label: es.optNow },
    { value: 'next-heartbeat', label: es.optNextHeartbeat }
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.cronJobs} icon="schedule" iconColor="text-lime-500">
        <SwitchField label={es.enabled} tooltip={tip('cron.enabled')} value={g(['enabled']) !== false} onChange={v => s(['enabled'], v)} />
        <TextField label={es.cronStorePath} tooltip={tip('cron.store')} value={g(['store']) || ''} onChange={v => s(['store'], v)} placeholder={es.phCronStorePath} />
        <NumberField label={es.maxConcurrent} tooltip={tip('cron.maxConcurrentRuns')} value={g(['maxConcurrentRuns'])} onChange={v => s(['maxConcurrentRuns'], v)} min={1} />
        <SelectField label={es.cronWakeMode} tooltip={tip('cron.wakeMode')} value={g(['wakeMode']) || 'now'} onChange={v => s(['wakeMode'], v)} options={WAKE_OPTIONS} />
      </ConfigSection>
    </div>
  );
};

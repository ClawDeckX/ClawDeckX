import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, NumberField, SelectField, SwitchField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const CommandsSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['commands', ...p]);
  const s = (p: string[], v: any) => setField(['commands', ...p], v);

  const TRISTATE = useMemo(() => [{ value: 'auto', label: es.optAuto }, { value: 'true', label: es.optTrue }, { value: 'false', label: es.optFalse }], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.commandToggles} icon="toggle_on" iconColor="text-amber-500">
        <SelectField label={es.nativeCommands} desc={es.nativeCommandsDesc} tooltip={tip('commands.native')} value={String(g(['native']) ?? 'auto')} onChange={v => s(['native'], v)} options={TRISTATE} />
        <SelectField label={es.nativeSkills} tooltip={tip('commands.nativeSkills')} value={String(g(['nativeSkills']) ?? 'auto')} onChange={v => s(['nativeSkills'], v)} options={TRISTATE} />
        <SwitchField label={es.textCommands} tooltip={tip('commands.text')} value={g(['text']) !== false} onChange={v => s(['text'], v)} />
        <SwitchField label={es.bashCommands} tooltip={tip('commands.bash')} value={g(['bash']) !== false} onChange={v => s(['bash'], v)} />
        <SwitchField label={es.configCommands} tooltip={tip('commands.config')} value={g(['config']) !== false} onChange={v => s(['config'], v)} />
        <SwitchField label={es.debugCommands} tooltip={tip('commands.debug')} value={g(['debug']) === true} onChange={v => s(['debug'], v)} />
        <SwitchField label={es.restartCommand} tooltip={tip('commands.restart')} value={g(['restart']) !== false} onChange={v => s(['restart'], v)} />
      </ConfigSection>

      <ConfigSection title={es.bashConfig} icon="terminal" iconColor="text-green-500" defaultOpen={false}>
        <NumberField label={es.foregroundMs} desc="0-30000ms" tooltip={tip('commands.bashForegroundMs')} value={g(['bashForegroundMs'])} onChange={v => s(['bashForegroundMs'], v)} min={0} max={30000} step={500} />
      </ConfigSection>

      <ConfigSection title={es.accessControl} icon="admin_panel_settings" iconColor="text-red-500" defaultOpen={false}>
        <SwitchField label={es.useAccessGroups} tooltip={tip('commands.useAccessGroups')} value={g(['useAccessGroups']) === true} onChange={v => s(['useAccessGroups'], v)} />
        <ArrayField label={es.ownerAllowFrom} desc={es.ownerAllowFromDesc} tooltip={tip('commands.ownerAllowFrom')} value={(g(['ownerAllowFrom']) || []).map(String)} onChange={v => s(['ownerAllowFrom'], v)} placeholder={es.phUserId} />
      </ConfigSection>
    </div>
  );
};

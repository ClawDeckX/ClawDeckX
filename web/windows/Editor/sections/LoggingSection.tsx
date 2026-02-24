import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, SelectField, SwitchField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const LoggingSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);

  const LOG_LEVEL_OPTIONS = useMemo(() => [
    { value: 'silent', label: es.logSilent }, { value: 'fatal', label: es.logFatal }, { value: 'error', label: es.logError },
    { value: 'warn', label: es.logWarn }, { value: 'info', label: es.logInfo }, { value: 'debug', label: es.logDebug }, { value: 'trace', label: es.logTrace },
  ], [es]);
  const CONSOLE_STYLE_OPTIONS = useMemo(() => [
    { value: 'pretty', label: es.stylePretty }, { value: 'compact', label: es.styleCompact }, { value: 'json', label: es.styleJson },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.loggingConfig} icon="description" iconColor="text-yellow-500">
        <SelectField label={es.logLevel} tooltip={tip('logging.level')} value={getField(['logging', 'level']) || 'info'} onChange={v => setField(['logging', 'level'], v)} options={LOG_LEVEL_OPTIONS} />
        <TextField label={es.logFile} tooltip={tip('logging.file')} value={getField(['logging', 'file']) || ''} onChange={v => setField(['logging', 'file'], v)} placeholder="~/.openclaw/logs/gateway.log" />
        <SelectField label={es.consoleLevel} tooltip={tip('logging.consoleLevel')} value={getField(['logging', 'consoleLevel']) || 'info'} onChange={v => setField(['logging', 'consoleLevel'], v)} options={LOG_LEVEL_OPTIONS} />
        <SelectField label={es.consoleStyle} tooltip={tip('logging.consoleStyle')} value={getField(['logging', 'consoleStyle']) || 'pretty'} onChange={v => setField(['logging', 'consoleStyle'], v)} options={CONSOLE_STYLE_OPTIONS} />
      </ConfigSection>

      <ConfigSection title={es.diagnostics} icon="bug_report" iconColor="text-yellow-500" defaultOpen={false}>
        <SwitchField label={es.enableDiag} tooltip={tip('diagnostics.enabled')} value={getField(['diagnostics', 'enabled']) === true} onChange={v => setField(['diagnostics', 'enabled'], v)} />
        <SwitchField label={es.openTelemetry} tooltip={tip('diagnostics.otel.enabled')} value={getField(['diagnostics', 'otel', 'enabled']) === true} onChange={v => setField(['diagnostics', 'otel', 'enabled'], v)} />
        <TextField label={es.otelEndpoint} tooltip={tip('diagnostics.otel.endpoint')} value={getField(['diagnostics', 'otel', 'endpoint']) || ''} onChange={v => setField(['diagnostics', 'otel', 'endpoint'], v)} placeholder="http://localhost:4318" />
      </ConfigSection>
    </div>
  );
};

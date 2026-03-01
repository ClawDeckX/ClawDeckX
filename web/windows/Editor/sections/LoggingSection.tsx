import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, SelectField, SwitchField, NumberField, ArrayField } from '../fields';
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
  const REDACT_OPTIONS = useMemo(() => [
    { value: '', label: es.optOff || 'Off' }, { value: 'off', label: es.optOff || 'Off' }, { value: 'tools', label: es.redactTools || 'Tools' },
  ], [es]);
  const OTEL_PROTOCOL_OPTIONS = useMemo(() => [
    { value: 'http/protobuf', label: 'HTTP/Protobuf' }, { value: 'grpc', label: 'gRPC' },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.loggingConfig} icon="description" iconColor="text-yellow-500">
        <SelectField label={es.logLevel} tooltip={tip('logging.level')} value={getField(['logging', 'level']) || 'info'} onChange={v => setField(['logging', 'level'], v)} options={LOG_LEVEL_OPTIONS} />
        <TextField label={es.logFile} tooltip={tip('logging.file')} value={getField(['logging', 'file']) || ''} onChange={v => setField(['logging', 'file'], v)} placeholder={es.phGatewayLogPath} />
        <NumberField label={es.maxFileBytes} tooltip={tip('logging.maxFileBytes')} value={getField(['logging', 'maxFileBytes'])} onChange={v => setField(['logging', 'maxFileBytes'], v)} min={0} />
        <SelectField label={es.consoleLevel} tooltip={tip('logging.consoleLevel')} value={getField(['logging', 'consoleLevel']) || 'info'} onChange={v => setField(['logging', 'consoleLevel'], v)} options={LOG_LEVEL_OPTIONS} />
        <SelectField label={es.consoleStyle} tooltip={tip('logging.consoleStyle')} value={getField(['logging', 'consoleStyle']) || 'pretty'} onChange={v => setField(['logging', 'consoleStyle'], v)} options={CONSOLE_STYLE_OPTIONS} />
        <SelectField label={es.redactSensitive} tooltip={tip('logging.redactSensitive')} value={getField(['logging', 'redactSensitive']) || ''} onChange={v => setField(['logging', 'redactSensitive'], v)} options={REDACT_OPTIONS} />
        <ArrayField label={es.redactPatterns} tooltip={tip('logging.redactPatterns')} value={getField(['logging', 'redactPatterns']) || []} onChange={v => setField(['logging', 'redactPatterns'], v)} placeholder="regex-pattern" />
      </ConfigSection>

      <ConfigSection title={es.diagnostics} icon="bug_report" iconColor="text-yellow-500" defaultOpen={false}>
        <SwitchField label={es.enableDiag} tooltip={tip('diagnostics.enabled')} value={getField(['diagnostics', 'enabled']) === true} onChange={v => setField(['diagnostics', 'enabled'], v)} />
        <ArrayField label={es.diagFlags} tooltip={tip('diagnostics.flags')} value={getField(['diagnostics', 'flags']) || []} onChange={v => setField(['diagnostics', 'flags'], v)} placeholder="flag-name" />
      </ConfigSection>

      <ConfigSection title={es.otelConfig} icon="monitoring" iconColor="text-indigo-500" defaultOpen={false}>
        <SwitchField label={es.openTelemetry} tooltip={tip('diagnostics.otel.enabled')} value={getField(['diagnostics', 'otel', 'enabled']) === true} onChange={v => setField(['diagnostics', 'otel', 'enabled'], v)} />
        <TextField label={es.otelEndpoint} tooltip={tip('diagnostics.otel.endpoint')} value={getField(['diagnostics', 'otel', 'endpoint']) || ''} onChange={v => setField(['diagnostics', 'otel', 'endpoint'], v)} placeholder={es.phOtelEndpoint} />
        <SelectField label={es.otelProtocol} tooltip={tip('diagnostics.otel.protocol')} value={getField(['diagnostics', 'otel', 'protocol']) || 'http/protobuf'} onChange={v => setField(['diagnostics', 'otel', 'protocol'], v)} options={OTEL_PROTOCOL_OPTIONS} />
        <TextField label={es.otelServiceName} tooltip={tip('diagnostics.otel.serviceName')} value={getField(['diagnostics', 'otel', 'serviceName']) || ''} onChange={v => setField(['diagnostics', 'otel', 'serviceName'], v)} placeholder="openclaw-gateway" />
        <SwitchField label={es.otelTraces} tooltip={tip('diagnostics.otel.traces')} value={getField(['diagnostics', 'otel', 'traces']) !== false} onChange={v => setField(['diagnostics', 'otel', 'traces'], v)} />
        <SwitchField label={es.otelMetrics} tooltip={tip('diagnostics.otel.metrics')} value={getField(['diagnostics', 'otel', 'metrics']) !== false} onChange={v => setField(['diagnostics', 'otel', 'metrics'], v)} />
        <SwitchField label={es.otelLogs} tooltip={tip('diagnostics.otel.logs')} value={getField(['diagnostics', 'otel', 'logs']) !== false} onChange={v => setField(['diagnostics', 'otel', 'logs'], v)} />
        <NumberField label={es.otelSampleRate} tooltip={tip('diagnostics.otel.sampleRate')} value={getField(['diagnostics', 'otel', 'sampleRate'])} onChange={v => setField(['diagnostics', 'otel', 'sampleRate'], v)} min={0} max={1} step={0.1} />
        <NumberField label={es.otelFlushMs} tooltip={tip('diagnostics.otel.flushIntervalMs')} value={getField(['diagnostics', 'otel', 'flushIntervalMs'])} onChange={v => setField(['diagnostics', 'otel', 'flushIntervalMs'], v)} min={0} step={1000} />
      </ConfigSection>

      <ConfigSection title={es.cacheTrace} icon="timeline" iconColor="text-amber-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('diagnostics.cacheTrace.enabled')} value={getField(['diagnostics', 'cacheTrace', 'enabled']) === true} onChange={v => setField(['diagnostics', 'cacheTrace', 'enabled'], v)} />
        <TextField label={es.ctFilePath} tooltip={tip('diagnostics.cacheTrace.filePath')} value={getField(['diagnostics', 'cacheTrace', 'filePath']) || ''} onChange={v => setField(['diagnostics', 'cacheTrace', 'filePath'], v)} />
        <SwitchField label={es.ctIncludeMessages} tooltip={tip('diagnostics.cacheTrace.includeMessages')} value={getField(['diagnostics', 'cacheTrace', 'includeMessages']) === true} onChange={v => setField(['diagnostics', 'cacheTrace', 'includeMessages'], v)} />
        <SwitchField label={es.ctIncludePrompt} tooltip={tip('diagnostics.cacheTrace.includePrompt')} value={getField(['diagnostics', 'cacheTrace', 'includePrompt']) === true} onChange={v => setField(['diagnostics', 'cacheTrace', 'includePrompt'], v)} />
        <SwitchField label={es.ctIncludeSystem} tooltip={tip('diagnostics.cacheTrace.includeSystem')} value={getField(['diagnostics', 'cacheTrace', 'includeSystem']) === true} onChange={v => setField(['diagnostics', 'cacheTrace', 'includeSystem'], v)} />
      </ConfigSection>
    </div>
  );
};

/**
 * sectionRegistry.ts — Central registry of config keys covered by hand-coded Editor sections.
 *
 * Each entry maps a top-level config key (e.g. "gateway") to the set of dotted sub-paths
 * that the hand-coded UI explicitly handles. When a key is listed here, the
 * UnmappedConfigSection will skip it and let the hand-coded Section render it instead.
 *
 * Use `'*'` as a wildcard to indicate "the entire subtree is covered" (e.g. for sections
 * that handle dynamic/array content like channels, skills, plugins).
 *
 * To mark a new key as covered after adding it to a hand-coded Section:
 *   1. Add it to the appropriate array below
 *   2. That's it — UnmappedConfigSection will stop showing it
 */

// Gateway + discovery + web
const GATEWAY_KEYS = [
  'gateway.port', 'gateway.mode', 'gateway.bind', 'gateway.customBindHost',
  'gateway.channelHealthCheckMinutes', 'gateway.allowRealIpFallback',
  'gateway.auth.mode', 'gateway.auth.token', 'gateway.auth.password', 'gateway.auth.allowTailscale',
  'gateway.auth.rateLimit.*', 'gateway.auth.trustedProxy.*',
  'gateway.tailscale.mode', 'gateway.tailscale.resetOnExit',
  'gateway.tls.enabled', 'gateway.tls.autoGenerate', 'gateway.tls.certPath', 'gateway.tls.keyPath', 'gateway.tls.caPath',
  'gateway.remote.url', 'gateway.remote.transport', 'gateway.remote.token', 'gateway.remote.password',
  'gateway.remote.tlsFingerprint', 'gateway.remote.sshTarget', 'gateway.remote.sshIdentity',
  'gateway.reload.mode', 'gateway.reload.debounceMs',
  'gateway.controlUi.enabled', 'gateway.controlUi.basePath', 'gateway.controlUi.root',
  'gateway.controlUi.allowedOrigins', 'gateway.controlUi.allowInsecureAuth',
  'gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback', 'gateway.controlUi.dangerouslyDisableDeviceAuth',
  'gateway.http.endpoints.chatCompletions', 'gateway.http.endpoints.responses',
  'gateway.http.securityHeaders.*',
  'gateway.tools.*', 'gateway.nodes.*',
  'gateway.trustedProxies',
  'discovery.wideArea.enabled', 'discovery.mdns.mode',
  'web.enabled', 'web.heartbeatSeconds', 'web.reconnect.*',
];

// Models (dynamic provider list — mark subtree as covered)
const MODELS_KEYS = ['models.*'];

// Agents + bindings (dynamic agent list)
const AGENTS_KEYS = [
  'agents.*',
  'bindings.*',
];

// Channels (dynamic channel configs)
const CHANNELS_KEYS = ['channels.*'];

// Session
const SESSION_KEYS = ['session.*'];

// Messages + broadcast
const MESSAGES_KEYS = [
  'messages.*',
  'broadcast.strategy',
];

// Tools + canvasHost + media
const TOOLS_KEYS = [
  'tools.*',
  'canvasHost.enabled', 'canvasHost.root', 'canvasHost.port', 'canvasHost.liveReload',
  'media.preserveFilenames',
];

// Commands
const COMMANDS_KEYS = ['commands.*'];

// Logging + diagnostics
const LOGGING_KEYS = [
  'logging.level', 'logging.file', 'logging.maxFileBytes', 'logging.consoleLevel', 'logging.consoleStyle',
  'logging.redactSensitive', 'logging.redactPatterns',
  'diagnostics.enabled', 'diagnostics.flags',
  'diagnostics.otel.*', 'diagnostics.cacheTrace.*',
];

// Audio (talk + audio.transcription + messages.tts)
const AUDIO_KEYS = [
  'talk.provider', 'talk.voiceId', 'talk.modelId', 'talk.outputFormat', 'talk.apiKey', 'talk.interruptOnSpeech',
  'talk.providers.*', 'talk.voiceAliases',
  'audio.transcription.command', 'audio.transcription.timeoutSeconds',
  'messages.tts.provider', 'messages.tts.auto', 'messages.tts.mode', 'messages.tts.apiKey', 'messages.tts.voiceId',
];

// Auth
const AUTH_KEYS = [
  'auth.profiles', 'auth.order', 'auth.cooldowns',
  'auth.*',
];

// Memory
const MEMORY_KEYS = ['memory.*'];

// Browser
const BROWSER_KEYS = ['browser.*'];

// Hooks
const HOOKS_KEYS = ['hooks.*'];

// Cron
const CRON_KEYS = ['cron.*'];

// Skills
const SKILLS_KEYS = ['skills.*'];

// Plugins
const PLUGINS_KEYS = ['plugins.*'];

// Extensions
const EXTENSIONS_KEYS = ['extensions.*'];

// Misc (update + ui + env)
const MISC_KEYS = [
  'update.channel', 'update.checkOnStart', 'update.auto.*',
  'ui.seamColor', 'ui.assistant.name', 'ui.assistant.avatar',
  'env.shellEnv.*', 'env.vars',
  // Internal/meta keys — not user-facing, suppress from unmapped
  'meta.*', 'wizard.*', '$schema',
  // Remaining top-level sections with wildcard coverage
  'secrets.*', 'acp.*', 'approvals.*', 'nodeHost.*',
];

/** All explicitly registered keys across hand-coded sections */
const ALL_REGISTERED: string[] = [
  ...GATEWAY_KEYS, ...MODELS_KEYS, ...AGENTS_KEYS, ...CHANNELS_KEYS,
  ...SESSION_KEYS, ...MESSAGES_KEYS, ...TOOLS_KEYS, ...COMMANDS_KEYS,
  ...LOGGING_KEYS, ...AUDIO_KEYS, ...AUTH_KEYS, ...MEMORY_KEYS,
  ...BROWSER_KEYS, ...HOOKS_KEYS, ...CRON_KEYS, ...SKILLS_KEYS,
  ...PLUGINS_KEYS, ...EXTENSIONS_KEYS, ...MISC_KEYS,
];

/** Exact keys (no wildcard) */
const exactKeys = new Set(ALL_REGISTERED.filter(k => !k.endsWith('.*')));

/** Wildcard prefixes (e.g. "models" from "models.*") */
const wildcardPrefixes = ALL_REGISTERED
  .filter(k => k.endsWith('.*'))
  .map(k => k.slice(0, -2)); // strip ".*"

/**
 * Check whether a dotted config path is covered by hand-coded sections.
 * Returns true if the key (or its parent subtree) is registered.
 */
export function isKeyCovered(dottedPath: string): boolean {
  if (exactKeys.has(dottedPath)) return true;
  for (const prefix of wildcardPrefixes) {
    if (dottedPath === prefix || dottedPath.startsWith(prefix + '.')) return true;
  }
  return false;
}

/**
 * Given a flat list of all config keys from schema, return those NOT covered.
 */
export function getUnmappedKeys(allSchemaKeys: string[]): string[] {
  return allSchemaKeys.filter(k => !isKeyCovered(k));
}

/**
 * Extract all leaf-level dotted paths from a JSON Schema's properties tree.
 * Example: { gateway: { properties: { port: { type: 'number' } } } }
 *  → ['gateway.port']
 */
export function extractSchemaKeys(schema: any, prefix = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const props = schema.properties;
  if (!props) return prefix ? [prefix] : [];

  const keys: string[] = [];
  for (const [key, sub] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const subSchema = sub as any;
    if (subSchema.properties) {
      keys.push(...extractSchemaKeys(subSchema, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** Version key for schema diff tracking in localStorage */
export const SCHEMA_KEYS_STORAGE_KEY = 'editor.knownSchemaKeys';

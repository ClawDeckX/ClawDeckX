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
  'gateway.channelHealthCheckMinutes', 'gateway.channelStaleEventThresholdMinutes',
  'gateway.channelMaxRestartsPerHour', 'gateway.allowRealIpFallback',
  'gateway.auth.*',
  'gateway.tailscale.*',
  'gateway.tls.*',
  'gateway.remote.*',
  'gateway.reload.*',
  'gateway.controlUi.*',
  'gateway.http.*',
  'gateway.tools.*', 'gateway.nodes.*', 'gateway.webchat.*',
  'gateway.trustedProxies',
  'gateway.push.*',
  'discovery.*',
  'web.*',
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

// Tools + media
const TOOLS_KEYS = [
  'tools.*',
  'media.preserveFilenames', 'media.ttlHours',
];

// Commands
const COMMANDS_KEYS = ['commands.*'];

// Logging + diagnostics
const LOGGING_KEYS = [
  'logging.level', 'logging.file', 'logging.maxFileBytes', 'logging.consoleLevel', 'logging.consoleStyle',
  'logging.redactSensitive', 'logging.redactPatterns',
  'diagnostics.enabled', 'diagnostics.flags', 'diagnostics.stuckSessionWarnMs',
  'diagnostics.otel.*', 'diagnostics.cacheTrace.*',
];

// Audio (talk + audio.transcription)
const AUDIO_KEYS = [
  'talk.provider', 'talk.interruptOnSpeech', 'talk.silenceTimeoutMs', 'talk.speechLocale',
  'talk.providers.*', 'talk.openai.*', 'talk.realtime.*',
  'talk.consultThinkingLevel', 'talk.consultFastMode',
  'audio.transcription.command', 'audio.transcription.timeoutSeconds',
  'audio.transcription.echoTranscript', 'audio.transcription.echoFormat',
];

// Auth
const AUTH_KEYS = [
  'auth.profiles', 'auth.order', 'auth.cooldowns',
  'auth.*',
];

// Memory
const MEMORY_KEYS = ['memory.*'];

// Browser
const BROWSER_KEYS = ['browser.*', 'gateway.nodes.browser.*'];

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
  'gateway.controlUi.*',
  'env.shellEnv.*', 'env.vars',
  // CLI
  'cli.*',
  // Internal/meta keys — not user-facing, suppress from unmapped
  'meta.*', 'wizard.*', '$schema',
  // MCP (covers both camelCase and PascalCase schema variants)
  'mcpServers.*', 'mcp.*', 'MCP.*',
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

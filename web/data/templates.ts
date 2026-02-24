/**
 * OpenClaw Workspace File Templates
 *
 * Design principles:
 * 1. i18n-friendly: template content lives in locales/{lang}/templates.json,
 *    making it trivial to add more languages — just add a new JSON file.
 * 2. Shareable: templates are plain JSON-serialisable objects. Users can
 *    export / import them via JSON files.
 * 3. Extensible: community templates can be loaded at runtime via the
 *    `importTemplates` / `exportTemplates` helpers.
 */

import { Language } from '../types';
import templateZh from '../locales/zh/templates.json';
import templateEn from '../locales/en/templates.json';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface TemplateI18n {
  name: string;
  desc: string;
  content: string;
}

export interface WorkspaceTemplate {
  id: string;
  /** Which workspace file this template targets (e.g. "SOUL.md") */
  targetFile: string;
  icon: string;
  /** Category for grouping in the UI */
  category: 'persona' | 'identity' | 'user' | 'heartbeat' | 'agents' | 'tools' | 'memory';
  /** Translations keyed by Language code; at minimum zh + en */
  i18n: Record<string, TemplateI18n>;
  /** Optional tags for search / filtering */
  tags?: string[];
  /** Author info for shared templates */
  author?: string;
  /** Schema version for forward-compat */
  version?: number;
}

// ---------------------------------------------------------------------------
// i18n content map — keyed by language code
// To add a new language: import its JSON and add to this map.
// ---------------------------------------------------------------------------

const i18nMap: Record<string, Record<string, TemplateI18n>> = {
  zh: templateZh as Record<string, TemplateI18n>,
  en: templateEn as Record<string, TemplateI18n>,
};

/** Build i18n record for a template id from all available languages */
function buildI18n(id: string): Record<string, TemplateI18n> {
  const result: Record<string, TemplateI18n> = {};
  for (const [lang, map] of Object.entries(i18nMap)) {
    if (map[id]) result[lang] = map[id];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: resolve i18n with fallback
// ---------------------------------------------------------------------------

export function resolveTemplate(tpl: WorkspaceTemplate, lang: Language): TemplateI18n {
  return tpl.i18n[lang] || tpl.i18n['en'] || Object.values(tpl.i18n)[0];
}

// ---------------------------------------------------------------------------
// Import / Export helpers (for sharing)
// ---------------------------------------------------------------------------

export function exportTemplates(templates: WorkspaceTemplate[]): string {
  return JSON.stringify({ version: 1, templates }, null, 2);
}

export function importTemplates(json: string): WorkspaceTemplate[] {
  try {
    const data = JSON.parse(json);
    if (data?.version === 1 && Array.isArray(data.templates)) {
      return data.templates.filter(
        (t: any) => t.id && t.targetFile && t.i18n && typeof t.i18n === 'object'
      );
    }
  } catch { /* invalid JSON */ }
  return [];
}

// ---------------------------------------------------------------------------
// Built-in templates — structure only, i18n loaded from JSON
// ---------------------------------------------------------------------------

export const BUILTIN_TEMPLATES: WorkspaceTemplate[] = [
  { id: 'soul-professional', targetFile: 'SOUL.md', icon: 'work', category: 'persona', tags: ['professional', 'assistant'], i18n: buildI18n('soul-professional') },
  { id: 'soul-casual', targetFile: 'SOUL.md', icon: 'emoji_people', category: 'persona', tags: ['casual', 'friendly'], i18n: buildI18n('soul-casual') },
  { id: 'soul-coder', targetFile: 'SOUL.md', icon: 'code', category: 'persona', tags: ['coding', 'developer', 'technical'], i18n: buildI18n('soul-coder') },
  { id: 'soul-family', targetFile: 'SOUL.md', icon: 'family_restroom', category: 'persona', tags: ['family', 'safe', 'kids'], i18n: buildI18n('soul-family') },
  { id: 'identity-default', targetFile: 'IDENTITY.md', icon: 'badge', category: 'identity', tags: ['identity', 'default'], i18n: buildI18n('identity-default') },
  { id: 'user-profile', targetFile: 'USER.md', icon: 'person', category: 'user', tags: ['user', 'profile'], i18n: buildI18n('user-profile') },
  { id: 'heartbeat-daily', targetFile: 'HEARTBEAT.md', icon: 'favorite', category: 'heartbeat', tags: ['heartbeat', 'daily', 'checklist'], i18n: buildI18n('heartbeat-daily') },
  { id: 'heartbeat-minimal', targetFile: 'HEARTBEAT.md', icon: 'eco', category: 'heartbeat', tags: ['heartbeat', 'minimal', 'cost-saving'], i18n: buildI18n('heartbeat-minimal') },
  { id: 'agents-rules', targetFile: 'AGENTS.md', icon: 'gavel', category: 'agents', tags: ['agents', 'rules', 'guidelines'], i18n: buildI18n('agents-rules') },
  { id: 'tools-notes', targetFile: 'TOOLS.md', icon: 'build', category: 'tools', tags: ['tools', 'notes'], i18n: buildI18n('tools-notes') },
  { id: 'memory-structured', targetFile: 'MEMORY.md', icon: 'psychology', category: 'memory', tags: ['memory', 'structured', 'rules'], i18n: buildI18n('memory-structured') },
  { id: 'memory-minimal', targetFile: 'MEMORY.md', icon: 'eco', category: 'memory', tags: ['memory', 'minimal'], i18n: buildI18n('memory-minimal') },
];

/** Get templates filtered by target file name */
export function getTemplatesForFile(fileName: string): WorkspaceTemplate[] {
  return BUILTIN_TEMPLATES.filter(t => t.targetFile === fileName);
}

/** Get all unique target file names */
export function getTemplateTargetFiles(): string[] {
  return [...new Set(BUILTIN_TEMPLATES.map(t => t.targetFile))];
}

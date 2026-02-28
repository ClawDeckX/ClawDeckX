import { Language } from '../types';

export interface I18nOverride {
  name?: string;
  description?: string;
  content?: Record<string, any>;
  agents?: Record<string, { name?: string; role?: string; description?: string }>;
  workflow?: { description?: string; steps?: string[] };
  metadata?: Record<string, any>;
  tags?: Record<string, string>;
}

interface TemplateI18nFile {
  _tags?: Record<string, string>;
  [templateId: string]: I18nOverride | Record<string, string> | undefined;
}

interface TemplateI18nCache {
  [category: string]: {
    [lang: string]: TemplateI18nFile;
  };
}

// Static imports for bundled translations (zh is always included)
const staticTranslations: Record<string, Record<string, TemplateI18nFile>> = {};

// Lazy load translations
const translationLoaders: Record<string, Record<string, () => Promise<TemplateI18nFile>>> = {
  zh: {
    'scenarios/productivity': () => import('../../templates/official/i18n/zh/scenarios/productivity.json').then(m => m.default || m),
    'scenarios/social': () => import('../../templates/official/i18n/zh/scenarios/social.json').then(m => m.default || m),
    'scenarios/creative': () => import('../../templates/official/i18n/zh/scenarios/creative.json').then(m => m.default || m),
    'scenarios/devops': () => import('../../templates/official/i18n/zh/scenarios/devops.json').then(m => m.default || m),
    'scenarios/research': () => import('../../templates/official/i18n/zh/scenarios/research.json').then(m => m.default || m),
    'scenarios/finance': () => import('../../templates/official/i18n/zh/scenarios/finance.json').then(m => m.default || m),
    'scenarios/family': () => import('../../templates/official/i18n/zh/scenarios/family.json').then(m => m.default || m),
    'multi-agent': () => import('../../templates/official/i18n/zh/multi-agent.json').then(m => m.default || m),
    'agents': () => import('../../templates/official/i18n/zh/agents.json').then(m => m.default || m),
  },
};

class TemplateI18nManager {
  private cache: TemplateI18nCache = {};
  private loadingPromises: Map<string, Promise<void>> = new Map();

  async loadTranslations(category: string, subcategory: string | null, lang: Language): Promise<void> {
    if (lang === 'en') return; // English is default, no need to load

    const path = subcategory ? `${category}/${subcategory}` : category;
    const cacheKey = `${path}:${lang}`;

    // Check cache
    if (this.cache[path]?.[lang]) return;

    // Avoid duplicate loading
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey);
    }

    const loadPromise = this._loadTranslations(path, lang);
    this.loadingPromises.set(cacheKey, loadPromise);

    try {
      await loadPromise;
    } finally {
      this.loadingPromises.delete(cacheKey);
    }
  }

  private async _loadTranslations(path: string, lang: Language): Promise<void> {
    try {
      // Check static translations first
      if (staticTranslations[lang]?.[path]) {
        if (!this.cache[path]) this.cache[path] = {};
        this.cache[path][lang] = staticTranslations[lang][path];
        return;
      }

      // Try dynamic loader
      const loader = translationLoaders[lang]?.[path];
      if (loader) {
        const translations = await loader();
        if (!this.cache[path]) this.cache[path] = {};
        this.cache[path][lang] = translations;
        return;
      }

      // No translation available
      if (!this.cache[path]) this.cache[path] = {};
      this.cache[path][lang] = {};
    } catch (err) {
      console.warn(`[TemplateI18n] Failed to load ${path} for ${lang}:`, err);
      if (!this.cache[path]) this.cache[path] = {};
      this.cache[path][lang] = {};
    }
  }

  getLocalizedTemplate<T extends { id: string; metadata?: any; content?: any }>(
    template: T,
    category: string,
    subcategory: string | null,
    lang: Language
  ): T {
    if (lang === 'en') return template;

    const path = subcategory ? `${category}/${subcategory}` : category;
    const translations = this.cache[path]?.[lang];
    const override = translations?.[template.id] as I18nOverride | undefined;

    if (!override) return template;

    // Get _tags for tag translation
    const tagMap = (translations as any)?._tags || {};
    return this.mergeTranslation(template, override, tagMap);
  }

  getTagTranslations(category: string, subcategory: string | null, lang: Language): Record<string, string> {
    if (lang === 'en') return {};

    const path = subcategory ? `${category}/${subcategory}` : category;
    const translations = this.cache[path]?.[lang];
    
    // Return the _tags object if it exists
    return (translations as any)?._tags || {};
  }

  private mergeTranslation<T extends { id: string; metadata?: any; content?: any }>(
    template: T,
    translation: I18nOverride,
    tagMap: Record<string, string> = {}
  ): T {
    const result = { ...template };

    // Merge metadata
    if (translation.name || translation.description || translation.metadata) {
      result.metadata = {
        ...result.metadata,
        ...(translation.name && { name: translation.name }),
        ...(translation.description && { description: translation.description }),
        ...translation.metadata,
      };
    }

    // Translate tags using tagMap from _tags field
    if (result.metadata?.tags && Object.keys(tagMap).length > 0) {
      result.metadata = {
        ...result.metadata,
        tags: result.metadata.tags.map((tag: string) => tagMap[tag] || tag),
      };
    }

    // Merge content
    if (translation.content) {
      result.content = { ...result.content, ...translation.content };
    }

    // Merge agents (for multi-agent templates)
    if (translation.agents && (result as any).content?.agents) {
      const agents = [...(result as any).content.agents];
      for (let i = 0; i < agents.length; i++) {
        const agentOverride = translation.agents[agents[i].id];
        if (agentOverride) {
          agents[i] = {
            ...agents[i],
            ...(agentOverride.name && { name: agentOverride.name }),
            ...(agentOverride.role && { role: agentOverride.role }),
            ...(agentOverride.description && { description: agentOverride.description }),
          };
        }
      }
      (result as any).content = { ...(result as any).content, agents };
    }

    // Merge workflow
    if (translation.workflow && (result as any).content?.workflow) {
      (result as any).content = {
        ...(result as any).content,
        workflow: {
          ...(result as any).content.workflow,
          ...translation.workflow,
        },
      };
    }

    return result;
  }

  getLocalizedTemplates<T extends { id: string; metadata?: any; content?: any }>(
    templates: T[],
    category: string,
    subcategory: string | null,
    lang: Language
  ): T[] {
    return templates.map(t => this.getLocalizedTemplate(t, category, subcategory, lang));
  }

  async preloadLanguage(lang: Language, categories: string[]): Promise<void> {
    if (lang === 'en') return;

    const promises: Promise<void>[] = [];
    for (const category of categories) {
      // Load category-level translations
      promises.push(this.loadTranslations(category, null, lang));

      // Load subcategory translations for scenarios
      if (category === 'scenarios') {
        const subcategories = ['productivity', 'social', 'creative', 'devops', 'research', 'finance', 'family'];
        for (const sub of subcategories) {
          promises.push(this.loadTranslations(category, sub, lang));
        }
      }
    }

    await Promise.allSettled(promises);
  }

  clearCache(path?: string): void {
    if (path) {
      delete this.cache[path];
    } else {
      this.cache = {};
    }
  }

  // Get available languages
  getAvailableLanguages(): Language[] {
    return ['en', 'zh'] as Language[];
  }
}

export const templateI18n = new TemplateI18nManager();
export default templateI18n;

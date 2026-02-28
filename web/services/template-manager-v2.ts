import { Language } from '../types';
import { templateI18n } from './template-i18n';
import { templateSourceManager, TemplateSource } from './template-sources';
import { cdnLoader, githubLoader, localLoader, templateCache } from './template-loaders';

// Template types
export interface TemplateMetadata {
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  icon?: string;
  color?: string;
  tags?: string[];
  author?: string;
  license?: string;
  homepage?: string;
  newbie?: boolean;
  source?: string; // Source ID
}

export interface TemplateRequirements {
  skills?: string[];
  channels?: string[];
  minVersion?: string;
  maxVersion?: string;
}

// Advanced template features
export interface SkillConfig {
  name: string;
  version?: string;
  permissions?: string[];
  config?: Record<string, any>;
}

export interface CronJobConfig {
  name: string;
  schedule: string; // Cron expression
  task: string;
  enabled?: boolean;
  timezone?: string;
  model?: string;
}

export interface IntegrationConfig {
  service: string;
  permissions: string[];
  config?: Record<string, any>;
}

export interface TemplateAgent {
  id: string;
  name: string;
  role: string;
  icon?: string;
  color?: string;
  soulSnippet?: string;
  description?: string;
}

export interface TemplateWorkflow {
  type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
  description: string;
  steps: Array<{
    agent?: string;
    agents?: string[];
    action: string;
    parallel?: boolean;
    condition?: string;
    trigger?: string;
  }>;
}

export interface ScenarioTemplate {
  id: string;
  type: 'scenario';
  version: string;
  metadata: TemplateMetadata;
  requirements?: TemplateRequirements;
  content: {
    soulSnippet?: string;
    userSnippet?: string;
    memorySnippet?: string;
    heartbeatSnippet?: string;
    toolsSnippet?: string;      // TOOLS.md content
    bootSnippet?: string;       // BOOTSTRAP.md content
    examples?: string[];
  };
  // Advanced features
  skills?: SkillConfig[];
  cronJobs?: CronJobConfig[];
  integrations?: IntegrationConfig[];
}

export interface MultiAgentTemplate {
  id: string;
  type: 'multi-agent';
  version: string;
  metadata: TemplateMetadata;
  requirements?: TemplateRequirements;
  content: {
    agents: TemplateAgent[];
    workflow: TemplateWorkflow;
    examples?: string[];
  };
}

export interface AgentTemplate {
  id: string;
  type: 'agent';
  version: string;
  metadata: TemplateMetadata;
  content: {
    soulSnippet: string;
    traits?: string[];
    tone?: string;
    examples?: Array<{
      input: string;
      output: string;
    }>;
  };
}

export type Template = ScenarioTemplate | MultiAgentTemplate | AgentTemplate;

interface TemplateLoadResult<T> {
  data: T | null;
  source: string;
  error?: Error;
}

class TemplateManagerV2 {
  private scenarioCache = new Map<string, ScenarioTemplate[]>();
  private multiAgentCache = new Map<string, MultiAgentTemplate[]>();
  private agentCache = new Map<string, AgentTemplate[]>();

  // Load templates from multiple sources with fallback
  private async loadFromSources<T>(
    type: 'scenarios' | 'multi-agent' | 'agents',
    loader: (source: TemplateSource) => Promise<T>
  ): Promise<TemplateLoadResult<T>> {
    const sources = templateSourceManager.getEnabledSources();

    for (const source of sources) {
      try {
        console.log(`[TemplateManager] Trying source: ${source.name} (${source.type})`);
        const data = await loader(source);
        return { data, source: source.id };
      } catch (err: any) {
        console.warn(`[TemplateManager] Source ${source.name} failed:`, err.message);
        
        // Try fallback source
        if (source.fallback) {
          const fallbackSource = templateSourceManager.getSource(source.fallback);
          if (fallbackSource && fallbackSource.enabled) {
            try {
              console.log(`[TemplateManager] Trying fallback: ${fallbackSource.name}`);
              const data = await loader(fallbackSource);
              return { data, source: fallbackSource.id };
            } catch (fallbackErr: any) {
              console.warn(`[TemplateManager] Fallback failed:`, fallbackErr.message);
            }
          }
        }
      }
    }

    return { data: null, source: 'none', error: new Error('All sources failed') };
  }

  // Load scenario templates
  async loadScenarioTemplates(language: Language): Promise<ScenarioTemplate[]> {
    const cacheKey = language;
    if (this.scenarioCache.has(cacheKey)) {
      return this.scenarioCache.get(cacheKey)!;
    }

    const result = await this.loadFromSources<ScenarioTemplate[]>(
      'scenarios',
      async (source) => {
        let templates: ScenarioTemplate[] = [];

        if (source.type === 'local') {
          // Load from local files
          templates = await this.loadLocalScenarios();
        } else if (source.type === 'cdn') {
          // Load from CDN
          const index = await cdnLoader.loadIndex(source, 'scenarios');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              cdnLoader.load(source, `scenarios/${path}`)
            )
          );
        } else if (source.type === 'github') {
          // Load from GitHub
          const index = await githubLoader.loadIndex(source, 'scenarios');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              githubLoader.load(source, `scenarios/${path}`)
            )
          );
        }

        // Add source info to metadata
        templates.forEach(t => {
          t.metadata.source = source.id;
        });

        return templates;
      }
    );

    if (!result.data) {
      throw result.error || new Error('Failed to load scenarios');
    }

    // Apply i18n - load translations for each subcategory
    const subcategories = [...new Set(result.data.map(t => t.metadata.category))];
    await Promise.all(
      subcategories.map(subcat => templateI18n.loadTranslations('scenarios', subcat, language))
    );
    const localized = result.data.map((template) => {
      return templateI18n.getLocalizedTemplate(template, 'scenarios', template.metadata.category, language);
    });

    this.scenarioCache.set(cacheKey, localized);
    return localized;
  }

  // Load multi-agent templates
  async loadMultiAgentTemplates(language: Language): Promise<MultiAgentTemplate[]> {
    const cacheKey = language;
    if (this.multiAgentCache.has(cacheKey)) {
      return this.multiAgentCache.get(cacheKey)!;
    }

    const result = await this.loadFromSources<MultiAgentTemplate[]>(
      'multi-agent',
      async (source) => {
        let templates: MultiAgentTemplate[] = [];

        if (source.type === 'local') {
          templates = await this.loadLocalMultiAgent();
        } else if (source.type === 'cdn') {
          const index = await cdnLoader.loadIndex(source, 'multi-agent');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              cdnLoader.load(source, `multi-agent/${path}`)
            )
          );
        } else if (source.type === 'github') {
          const index = await githubLoader.loadIndex(source, 'multi-agent');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              githubLoader.load(source, `multi-agent/${path}`)
            )
          );
        }

        templates.forEach(t => {
          t.metadata.source = source.id;
        });

        return templates;
      }
    );

    if (!result.data) {
      throw result.error || new Error('Failed to load multi-agent templates');
    }

    await templateI18n.loadTranslations('multi-agent', null, language);
    const localized = result.data.map((template) => {
      return templateI18n.getLocalizedTemplate(template, 'multi-agent', null, language);
    });

    this.multiAgentCache.set(cacheKey, localized);
    return localized;
  }

  // Load agent templates
  async loadAgentTemplates(language: Language): Promise<AgentTemplate[]> {
    const cacheKey = language;
    if (this.agentCache.has(cacheKey)) {
      return this.agentCache.get(cacheKey)!;
    }

    const result = await this.loadFromSources<AgentTemplate[]>(
      'agents',
      async (source) => {
        let templates: AgentTemplate[] = [];

        if (source.type === 'local') {
          templates = await this.loadLocalAgents();
        } else if (source.type === 'cdn') {
          const index = await cdnLoader.loadIndex(source, 'agents');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              cdnLoader.load(source, `agents/${path}`)
            )
          );
        } else if (source.type === 'github') {
          const index = await githubLoader.loadIndex(source, 'agents');
          templates = await Promise.all(
            index.templates.map((path: string) =>
              githubLoader.load(source, `agents/${path}`)
            )
          );
        }

        templates.forEach(t => {
          t.metadata.source = source.id;
        });

        return templates;
      }
    );

    if (!result.data) {
      throw result.error || new Error('Failed to load agent templates');
    }

    await templateI18n.loadTranslations('agents', null, language);
    const localized = result.data.map((template) => {
      return templateI18n.getLocalizedTemplate(template, 'agents', null, language);
    });

    this.agentCache.set(cacheKey, localized);
    return localized;
  }

  // Local loaders (existing implementation)
  private async loadLocalScenarios(): Promise<ScenarioTemplate[]> {
    const loaders: Record<string, () => Promise<any>> = {
      'personal-assistant': () => import('../../templates/official/scenarios/productivity/personal-assistant.json'),
      'email-manager': () => import('../../templates/official/scenarios/productivity/email-manager.json'),
      'calendar-manager': () => import('../../templates/official/scenarios/productivity/calendar-manager.json'),
      'task-tracker': () => import('../../templates/official/scenarios/productivity/task-tracker.json'),
      'personal-crm': () => import('../../templates/official/scenarios/productivity/personal-crm.json'),
      'second-brain': () => import('../../templates/official/scenarios/productivity/second-brain.json'),
      'reddit-digest': () => import('../../templates/official/scenarios/social/reddit-digest.json'),
      'youtube-analyzer': () => import('../../templates/official/scenarios/social/youtube-analyzer.json'),
      'twitter-monitor': () => import('../../templates/official/scenarios/social/twitter-monitor.json'),
      'tech-news': () => import('../../templates/official/scenarios/social/tech-news.json'),
      'content-pipeline': () => import('../../templates/official/scenarios/creative/content-pipeline.json'),
      'blog-writer': () => import('../../templates/official/scenarios/creative/blog-writer.json'),
      'social-scheduler': () => import('../../templates/official/scenarios/creative/social-scheduler.json'),
      'dev-assistant': () => import('../../templates/official/scenarios/devops/dev-assistant.json'),
      'self-healing-server': () => import('../../templates/official/scenarios/devops/self-healing-server.json'),
      'log-analyzer': () => import('../../templates/official/scenarios/devops/log-analyzer.json'),
      'cicd-monitor': () => import('../../templates/official/scenarios/devops/cicd-monitor.json'),
      'knowledge-rag': () => import('../../templates/official/scenarios/research/knowledge-rag.json'),
      'paper-reader': () => import('../../templates/official/scenarios/research/paper-reader.json'),
      'learning-tracker': () => import('../../templates/official/scenarios/research/learning-tracker.json'),
      'market-research': () => import('../../templates/official/scenarios/research/market-research.json'),
      'expense-tracker': () => import('../../templates/official/scenarios/finance/expense-tracker.json'),
      'investment-monitor': () => import('../../templates/official/scenarios/finance/investment-monitor.json'),
      'home-assistant': () => import('../../templates/official/scenarios/family/home-assistant.json'),
      'meal-planner': () => import('../../templates/official/scenarios/family/meal-planner.json'),
      'kids-learning': () => import('../../templates/official/scenarios/family/kids-learning.json'),
    };

    const templates = await Promise.all(
      Object.entries(loaders).map(async ([id, loader]) => {
        const module = await loader();
        return module.default || module;
      })
    );

    return templates;
  }

  private async loadLocalMultiAgent(): Promise<MultiAgentTemplate[]> {
    const loaders: Record<string, () => Promise<any>> = {
      'content-factory': () => import('../../templates/official/multi-agent/content-factory.json'),
      'research-team': () => import('../../templates/official/multi-agent/research-team.json'),
      'devops-team': () => import('../../templates/official/multi-agent/devops-team.json'),
      'customer-support': () => import('../../templates/official/multi-agent/customer-support.json'),
      'data-pipeline': () => import('../../templates/official/multi-agent/data-pipeline.json'),
    };

    const templates = await Promise.all(
      Object.entries(loaders).map(async ([id, loader]) => {
        const module = await loader();
        return module.default || module;
      })
    );

    return templates;
  }

  private async loadLocalAgents(): Promise<AgentTemplate[]> {
    const loaders: Record<string, () => Promise<any>> = {
      'professional': () => import('../../templates/official/agents/personas/professional.json'),
      'friendly': () => import('../../templates/official/agents/personas/friendly.json'),
      'concise': () => import('../../templates/official/agents/personas/concise.json'),
      'creative': () => import('../../templates/official/agents/personas/creative.json'),
    };

    const templates = await Promise.all(
      Object.entries(loaders).map(async ([id, loader]) => {
        const module = await loader();
        return module.default || module;
      })
    );

    return templates;
  }

  // Search across all templates
  async searchTemplates(query: string, language: Language): Promise<Template[]> {
    const [scenarios, multiAgent, agents] = await Promise.all([
      this.loadScenarioTemplates(language),
      this.loadMultiAgentTemplates(language),
      this.loadAgentTemplates(language),
    ]);

    const allTemplates: Template[] = [...scenarios, ...multiAgent, ...agents];
    const lowerQuery = query.toLowerCase();

    return allTemplates.filter(
      (t) =>
        t.metadata.name.toLowerCase().includes(lowerQuery) ||
        t.metadata.description.toLowerCase().includes(lowerQuery) ||
        t.metadata.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  // Clear all caches
  clearCache(): void {
    this.scenarioCache.clear();
    this.multiAgentCache.clear();
    this.agentCache.clear();
    templateCache.clear();
  }

  // Refresh templates (clear cache and reload)
  async refresh(language: Language): Promise<void> {
    this.clearCache();
    await Promise.all([
      this.loadScenarioTemplates(language),
      this.loadMultiAgentTemplates(language),
      this.loadAgentTemplates(language),
    ]);
  }
}

export const templateManagerV2 = new TemplateManagerV2();

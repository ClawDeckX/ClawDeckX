import { Language } from '../types';

export type TemplateSourceType = 'local' | 'cdn' | 'github' | 'api';

export interface TemplateSource {
  id: string;
  name: string;
  type: TemplateSourceType;
  enabled: boolean;
  priority: number;
  offline?: boolean;
  
  // Local source
  path?: string;
  
  // CDN source
  url?: string;
  cacheTTL?: number;
  fallback?: string;
  
  // GitHub source
  repo?: string;
  branch?: string;
  githubPath?: string;
  requiresApproval?: boolean;
  
  // API source
  baseUrl?: string;
  auth?: {
    type: 'bearer' | 'apikey';
    token?: string;
  };
}

export interface TemplateSourceConfig {
  sources: TemplateSource[];
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  autoUpdate: {
    enabled: boolean;
    interval: number;
    checkOnStartup: boolean;
  };
}

export const DEFAULT_TEMPLATE_SOURCES: TemplateSource[] = [
  {
    id: 'local',
    name: 'Built-in Templates',
    type: 'local',
    enabled: true,
    priority: 100,
    offline: true,
    path: '../../templates/official'
  },
  {
    id: 'cdn',
    name: 'Official CDN',
    type: 'cdn',
    enabled: false,
    priority: 90,
    url: 'https://templates.clawdeckx.com',
    cacheTTL: 86400000, // 24 hours
    fallback: 'local'
  },
  {
    id: 'github',
    name: 'Community Templates',
    type: 'github',
    enabled: false,
    priority: 50,
    repo: 'clawdeckx/community-templates',
    branch: 'main',
    githubPath: 'templates',
    requiresApproval: true
  }
];

export const DEFAULT_CONFIG: TemplateSourceConfig = {
  sources: DEFAULT_TEMPLATE_SOURCES,
  cache: {
    enabled: true,
    ttl: 86400000, // 24 hours
    maxSize: 100 * 1024 * 1024 // 100MB
  },
  autoUpdate: {
    enabled: true,
    interval: 86400000, // 24 hours
    checkOnStartup: true
  }
};

export class TemplateSourceManager {
  private config: TemplateSourceConfig;
  private storageKey = 'clawdeckx_template_sources';

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): TemplateSourceConfig {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      console.error('Failed to load template source config:', err);
    }
    return DEFAULT_CONFIG;
  }

  saveConfig(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (err) {
      console.error('Failed to save template source config:', err);
    }
  }

  getConfig(): TemplateSourceConfig {
    return this.config;
  }

  getSources(): TemplateSource[] {
    return this.config.sources;
  }

  getEnabledSources(): TemplateSource[] {
    return this.config.sources
      .filter(s => s.enabled)
      .sort((a, b) => b.priority - a.priority);
  }

  getSource(id: string): TemplateSource | undefined {
    return this.config.sources.find(s => s.id === id);
  }

  updateSource(id: string, updates: Partial<TemplateSource>): void {
    const index = this.config.sources.findIndex(s => s.id === id);
    if (index !== -1) {
      this.config.sources[index] = { ...this.config.sources[index], ...updates };
      this.saveConfig();
    }
  }

  enableSource(id: string): void {
    this.updateSource(id, { enabled: true });
  }

  disableSource(id: string): void {
    this.updateSource(id, { enabled: false });
  }

  addSource(source: TemplateSource): void {
    this.config.sources.push(source);
    this.saveConfig();
  }

  removeSource(id: string): void {
    this.config.sources = this.config.sources.filter(s => s.id !== id);
    this.saveConfig();
  }

  resetToDefaults(): void {
    this.config = DEFAULT_CONFIG;
    this.saveConfig();
  }
}

export const templateSourceManager = new TemplateSourceManager();

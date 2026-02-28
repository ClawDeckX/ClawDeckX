import { TemplateSource } from './template-sources';

export interface TemplateCache {
  data: any;
  timestamp: number;
  source: string;
}

export class TemplateCacheManager {
  private cachePrefix = 'clawdeckx_template_cache_';
  private maxSize: number;

  constructor(maxSize: number = 100 * 1024 * 1024) {
    this.maxSize = maxSize;
  }

  private getCacheKey(url: string): string {
    return `${this.cachePrefix}${btoa(url).replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  get(url: string, ttl: number): TemplateCache | null {
    try {
      const key = this.getCacheKey(url);
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const parsed: TemplateCache = JSON.parse(cached);
      const age = Date.now() - parsed.timestamp;

      if (age > ttl) {
        this.remove(url);
        return null;
      }

      return parsed;
    } catch (err) {
      console.error('Cache get error:', err);
      return null;
    }
  }

  set(url: string, data: any, source: string): void {
    try {
      const key = this.getCacheKey(url);
      const cache: TemplateCache = {
        data,
        timestamp: Date.now(),
        source
      };
      localStorage.setItem(key, JSON.stringify(cache));
      this.cleanupIfNeeded();
    } catch (err) {
      console.error('Cache set error:', err);
    }
  }

  remove(url: string): void {
    try {
      const key = this.getCacheKey(url);
      localStorage.removeItem(key);
    } catch (err) {
      console.error('Cache remove error:', err);
    }
  }

  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.cachePrefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (err) {
      console.error('Cache clear error:', err);
    }
  }

  private cleanupIfNeeded(): void {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(k => k.startsWith(this.cachePrefix));
      
      let totalSize = 0;
      const items: Array<{ key: string; size: number; timestamp: number }> = [];

      cacheKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          const size = value.length * 2; // UTF-16
          try {
            const parsed: TemplateCache = JSON.parse(value);
            items.push({ key, size, timestamp: parsed.timestamp });
            totalSize += size;
          } catch {
            // Invalid cache entry, remove it
            localStorage.removeItem(key);
          }
        }
      });

      if (totalSize > this.maxSize) {
        // Remove oldest items
        items.sort((a, b) => a.timestamp - b.timestamp);
        let removed = 0;
        for (const item of items) {
          localStorage.removeItem(item.key);
          removed += item.size;
          if (totalSize - removed < this.maxSize * 0.8) break;
        }
      }
    } catch (err) {
      console.error('Cache cleanup error:', err);
    }
  }

  getCacheSize(): number {
    try {
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(k => k.startsWith(this.cachePrefix));
      let totalSize = 0;
      cacheKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += value.length * 2;
        }
      });
      return totalSize;
    } catch {
      return 0;
    }
  }
}

export class CDNTemplateLoader {
  private cache: TemplateCacheManager;

  constructor(cache: TemplateCacheManager) {
    this.cache = cache;
  }

  async load(source: TemplateSource, path: string): Promise<any> {
    if (!source.url) {
      throw new Error('CDN source missing URL');
    }

    const url = `${source.url}/${path}`;
    const ttl = source.cacheTTL || 86400000;

    // Check cache first
    const cached = this.cache.get(url, ttl);
    if (cached) {
      console.log(`[CDN] Loaded from cache: ${path}`);
      return cached.data;
    }

    // Fetch from CDN
    try {
      console.log(`[CDN] Fetching: ${url}`);
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error(`CDN fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.cache.set(url, data, source.id);
      console.log(`[CDN] Loaded and cached: ${path}`);
      return data;
    } catch (err: any) {
      console.error(`[CDN] Load error for ${path}:`, err);
      throw err;
    }
  }

  async loadManifest(source: TemplateSource): Promise<any> {
    return this.load(source, 'manifest.json');
  }

  async loadIndex(source: TemplateSource, type: string): Promise<any> {
    return this.load(source, `${type}/index.json`);
  }

  async loadTemplate(source: TemplateSource, type: string, id: string): Promise<any> {
    return this.load(source, `${type}/${id}.json`);
  }

  async loadI18n(source: TemplateSource, language: string, type: string, id: string): Promise<any> {
    return this.load(source, `i18n/${language}/${type}/${id}.json`);
  }
}

export class GitHubTemplateLoader {
  private cache: TemplateCacheManager;
  private apiBase = 'https://api.github.com';
  private rawBase = 'https://raw.githubusercontent.com';

  constructor(cache: TemplateCacheManager) {
    this.cache = cache;
  }

  private getRawUrl(repo: string, branch: string, path: string): string {
    return `${this.rawBase}/${repo}/${branch}/${path}`;
  }

  async load(source: TemplateSource, path: string): Promise<any> {
    if (!source.repo || !source.branch) {
      throw new Error('GitHub source missing repo or branch');
    }

    const basePath = source.githubPath || '';
    const fullPath = basePath ? `${basePath}/${path}` : path;
    const url = this.getRawUrl(source.repo, source.branch, fullPath);
    const ttl = 3600000; // 1 hour for GitHub

    // Check cache first
    const cached = this.cache.get(url, ttl);
    if (cached) {
      console.log(`[GitHub] Loaded from cache: ${path}`);
      return cached.data;
    }

    // Fetch from GitHub
    try {
      console.log(`[GitHub] Fetching: ${url}`);
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      this.cache.set(url, data, source.id);
      console.log(`[GitHub] Loaded and cached: ${path}`);
      return data;
    } catch (err: any) {
      console.error(`[GitHub] Load error for ${path}:`, err);
      throw err;
    }
  }

  async loadManifest(source: TemplateSource): Promise<any> {
    return this.load(source, 'manifest.json');
  }

  async loadIndex(source: TemplateSource, type: string): Promise<any> {
    return this.load(source, `${type}/index.json`);
  }

  async loadTemplate(source: TemplateSource, type: string, id: string): Promise<any> {
    return this.load(source, `${type}/${id}.json`);
  }

  async loadI18n(source: TemplateSource, language: string, type: string, id: string): Promise<any> {
    return this.load(source, `i18n/${language}/${type}/${id}.json`);
  }

  async listContents(source: TemplateSource, path: string = ''): Promise<any[]> {
    if (!source.repo || !source.branch) {
      throw new Error('GitHub source missing repo or branch');
    }

    const basePath = source.githubPath || '';
    const fullPath = basePath ? `${basePath}/${path}` : path;
    const url = `${this.apiBase}/repos/${source.repo}/contents/${fullPath}?ref=${source.branch}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API failed: ${response.status}`);
      }

      return await response.json();
    } catch (err: any) {
      console.error(`[GitHub] List contents error:`, err);
      throw err;
    }
  }
}

export class LocalTemplateLoader {
  async load(path: string): Promise<any> {
    try {
      console.log(`[Local] Loading: ${path}`);
      const module = await import(path);
      return module.default || module;
    } catch (err: any) {
      console.error(`[Local] Load error for ${path}:`, err);
      throw err;
    }
  }
}

export const templateCache = new TemplateCacheManager();
export const cdnLoader = new CDNTemplateLoader(templateCache);
export const githubLoader = new GitHubTemplateLoader(templateCache);
export const localLoader = new LocalTemplateLoader();

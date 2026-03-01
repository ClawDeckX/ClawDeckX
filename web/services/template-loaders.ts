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

export interface ManifestCategory {
  id: string;
  version: string;
  templateCount: number;
  path: string;
}

export interface TemplateManifest {
  version: string;
  lastUpdated: string;
  categories: ManifestCategory[];
}

export class GitHubTemplateLoader {
  private cache: TemplateCacheManager;
  private apiBase = 'https://api.github.com';
  private rawBase = 'https://raw.githubusercontent.com';
  private versionPrefix = 'clawdeckx_tpl_ver_';
  private bulkPrefix = 'clawdeckx_tpl_bulk_';
  private manifestTTL = 300000; // 5 minutes - manifest checked frequently
  private templateTTL = 86400000; // 24 hours - templates cached longer (version-gated)

  constructor(cache: TemplateCacheManager) {
    this.cache = cache;
  }

  private getRawUrl(repo: string, branch: string, path: string): string {
    return `${this.rawBase}/${repo}/${branch}/${path}`;
  }

  private getFullUrl(source: TemplateSource, path: string): string {
    const basePath = source.githubPath || '';
    const fullPath = basePath ? `${basePath}/${path}` : path;
    return this.getRawUrl(source.repo!, source.branch!, fullPath);
  }

  // ---- Version tracking ----

  private getStoredCategoryVersion(sourceId: string, category: string): string | null {
    try {
      return localStorage.getItem(`${this.versionPrefix}${sourceId}_${category}`);
    } catch { return null; }
  }

  private storeCategoryVersion(sourceId: string, category: string, version: string): void {
    try {
      localStorage.setItem(`${this.versionPrefix}${sourceId}_${category}`, version);
    } catch { /* ignore */ }
  }

  // ---- Bulk category cache ----

  private getBulkKey(sourceId: string, category: string): string {
    return `${this.bulkPrefix}${sourceId}_${category}`;
  }

  private getBulkCache(sourceId: string, category: string): any[] | null {
    try {
      const raw = localStorage.getItem(this.getBulkKey(sourceId, category));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  private setBulkCache(sourceId: string, category: string, data: any[]): void {
    try {
      localStorage.setItem(this.getBulkKey(sourceId, category), JSON.stringify(data));
    } catch { /* ignore */ }
  }

  // ---- Fetch helpers ----

  private async fetchJson(url: string): Promise<any> {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`GitHub fetch failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  // ---- Public API ----

  /**
   * Load manifest with short TTL (5min). This is the version-check entry point.
   */
  async loadManifest(source: TemplateSource): Promise<TemplateManifest> {
    if (!source.repo || !source.branch) {
      throw new Error('GitHub source missing repo or branch');
    }
    const url = this.getFullUrl(source, 'manifest.json');
    const cached = this.cache.get(url, this.manifestTTL);
    if (cached) {
      console.log(`[GitHub] Manifest from cache (${this.manifestTTL / 1000}s TTL)`);
      return cached.data;
    }
    console.log(`[GitHub] Fetching manifest: ${url}`);
    const data = await this.fetchJson(url);
    this.cache.set(url, data, source.id);
    return data;
  }

  /**
   * Check if a category needs update by comparing manifest version vs stored version.
   */
  isCategoryChanged(source: TemplateSource, manifest: TemplateManifest, category: string): boolean {
    const cat = manifest.categories.find(c => c.id === category);
    if (!cat) return true;
    const stored = this.getStoredCategoryVersion(source.id, category);
    if (!stored) return true;
    return stored !== cat.version;
  }

  /**
   * Load all templates for a category with incremental sync.
   * 1. Check manifest category version vs local
   * 2. Version matches → return bulk cache (0 requests)
   * 3. Version differs → fetch index + all templates, update bulk cache + version
   */
  async loadCategoryTemplates(
    source: TemplateSource,
    category: string,
    manifest?: TemplateManifest
  ): Promise<any[]> {
    if (!source.repo || !source.branch) {
      throw new Error('GitHub source missing repo or branch');
    }

    // Step 1: Get manifest (from cache if fresh)
    const m = manifest || await this.loadManifest(source);

    // Step 2: Version comparison
    if (!this.isCategoryChanged(source, m, category)) {
      const bulk = this.getBulkCache(source.id, category);
      if (bulk) {
        console.log(`[GitHub] Category "${category}" unchanged (v${this.getStoredCategoryVersion(source.id, category)}), using cache (${bulk.length} templates)`);
        return bulk;
      }
    }

    const catMeta = m.categories.find(c => c.id === category);
    const remoteVersion = catMeta?.version || 'unknown';
    console.log(`[GitHub] Category "${category}" changed → v${remoteVersion}, fetching...`);

    // Step 3: Fetch index
    const indexUrl = this.getFullUrl(source, `${category}/index.json`);
    const index = await this.fetchJson(indexUrl);
    this.cache.set(indexUrl, index, source.id);

    // Step 4: Fetch all templates in this category
    const templates = await Promise.all(
      (index.templates as string[]).map(async (path: string) => {
        const url = this.getFullUrl(source, `${category}/${path}`);
        // Individual template cache (24h) - reuse if still valid
        const cached = this.cache.get(url, this.templateTTL);
        if (cached) return cached.data;
        const data = await this.fetchJson(url);
        this.cache.set(url, data, source.id);
        return data;
      })
    );

    // Step 5: Store bulk cache + version
    this.setBulkCache(source.id, category, templates);
    this.storeCategoryVersion(source.id, category, remoteVersion);
    console.log(`[GitHub] Category "${category}" synced: ${templates.length} templates (v${remoteVersion})`);

    return templates;
  }

  /**
   * Load a single file (for i18n, individual templates, etc.)
   */
  async load(source: TemplateSource, path: string): Promise<any> {
    if (!source.repo || !source.branch) {
      throw new Error('GitHub source missing repo or branch');
    }

    const url = this.getFullUrl(source, path);

    // Check cache first (24h TTL for individual files)
    const cached = this.cache.get(url, this.templateTTL);
    if (cached) {
      console.log(`[GitHub] Loaded from cache: ${path}`);
      return cached.data;
    }

    console.log(`[GitHub] Fetching: ${url}`);
    const data = await this.fetchJson(url);
    this.cache.set(url, data, source.id);
    console.log(`[GitHub] Loaded and cached: ${path}`);
    return data;
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

  /**
   * Clear all version tracking and bulk caches
   */
  clearVersionCache(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.versionPrefix) || key.startsWith(this.bulkPrefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch { /* ignore */ }
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

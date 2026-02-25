/**
 * Smart Network Utilities
 * Provides intelligent CDN/mirror selection for international and China users
 */

export interface MirrorSource {
  name: string;
  url: string;
  priority: number;
}

export interface MirrorTestResult {
  source: MirrorSource;
  latency: number;
  success: boolean;
  error?: string;
}

// GitHub mirrors for China users
export const GITHUB_MIRRORS: MirrorSource[] = [
  { name: 'GitHub Official', url: 'https://github.com', priority: 1 },
  { name: 'ghproxy', url: 'https://ghproxy.com/https://github.com', priority: 2 },
  { name: 'mirror.ghproxy', url: 'https://mirror.ghproxy.com/https://github.com', priority: 3 },
];

// npm Registry mirrors
export const NPM_REGISTRY_MIRRORS: MirrorSource[] = [
  { name: 'npm Official', url: 'https://registry.npmjs.org', priority: 1 },
  { name: 'npmmirror (China)', url: 'https://registry.npmmirror.com', priority: 2 },
  { name: 'Tencent (China)', url: 'https://mirrors.cloud.tencent.com/npm', priority: 3 },
];

// Cache for best mirrors
const mirrorCache: Map<string, { source: MirrorSource; timestamp: number }> = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours - host network environment rarely changes

/**
 * Test a single mirror source
 */
async function testMirror(source: MirrorSource, testPath: string, timeout: number): Promise<MirrorTestResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();
  try {
    const response = await fetch(`${source.url}${testPath}`, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-cache',
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        source,
        latency: Date.now() - startTime,
        success: true,
      };
    }
    return { source, latency: 0, success: false, error: `HTTP ${response.status}` };
  } catch (err) {
    clearTimeout(timeoutId);
    return { source, latency: 0, success: false, error: String(err) };
  }
}

/**
 * Find the fastest mirror from a list of sources
 */
export async function findFastestMirror(
  sources: MirrorSource[],
  testPath: string,
  cacheKey: string,
  timeout = 3000
): Promise<MirrorSource> {
  // Check cache first
  const cached = mirrorCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`[Network] Using cached mirror: ${cached.source.name}`);
    return cached.source;
  }

  // Test all mirrors in parallel
  const results = await Promise.all(
    sources.map(source => testMirror(source, testPath, timeout))
  );

  // Filter successful results and sort by latency
  const successful = results
    .filter(r => r.success)
    .sort((a, b) => a.latency - b.latency);

  if (successful.length === 0) {
    console.warn('[Network] All mirrors failed, using first source as fallback');
    return sources[0];
  }

  const best = successful[0].source;
  console.log(`[Network] Selected mirror: ${best.name} (${successful[0].latency}ms)`);

  // Cache the result
  mirrorCache.set(cacheKey, { source: best, timestamp: Date.now() });

  return best;
}

/**
 * Get the best GitHub mirror URL for a given path
 */
export async function getGitHubURL(path: string): Promise<string> {
  const best = await findFastestMirror(
    GITHUB_MIRRORS,
    '/ClawDeckX/ClawDeckX',
    'github'
  );

  if (best.priority === 1) {
    return `https://github.com${path}`;
  }

  // For mirror URLs, we need to construct the full URL
  return best.url.replace('https://github.com', '') + `https://github.com${path}`;
}

/**
 * Transform a GitHub URL to use the best mirror
 */
export function transformGitHubURL(originalURL: string, mirror: MirrorSource): string {
  if (mirror.priority === 1) {
    return originalURL;
  }

  // ghproxy style: https://ghproxy.com/https://github.com/...
  if (originalURL.startsWith('https://github.com')) {
    return mirror.url.replace('https://github.com', '') + originalURL;
  }

  return originalURL;
}

/**
 * Get the best npm registry URL
 */
export async function getNPMRegistryURL(): Promise<string> {
  const best = await findFastestMirror(
    NPM_REGISTRY_MIRRORS,
    '/-/ping',
    'npm'
  );
  return best.url;
}

/**
 * Detect if user is likely in China based on timezone and language
 */
export function isLikelyInChina(): boolean {
  // Check timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const chinaTimezones = ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi'];
  if (chinaTimezones.includes(timezone)) {
    return true;
  }

  // Check language
  const lang = navigator.language || (navigator as any).userLanguage;
  if (lang && (lang.startsWith('zh-CN') || lang === 'zh')) {
    return true;
  }

  return false;
}

/**
 * Invalidate all mirror caches
 */
export function invalidateMirrorCache(): void {
  mirrorCache.clear();
  console.log('[Network] Mirror cache invalidated');
}

/**
 * Get all mirror test results for diagnostics
 */
export async function testAllMirrors(): Promise<{
  github: MirrorTestResult[];
  npm: MirrorTestResult[];
}> {
  const [githubResults, npmResults] = await Promise.all([
    Promise.all(GITHUB_MIRRORS.map(s => testMirror(s, '/ClawDeckX/ClawDeckX', 5000))),
    Promise.all(NPM_REGISTRY_MIRRORS.map(s => testMirror(s, '/-/ping', 5000))),
  ]);

  return {
    github: githubResults,
    npm: npmResults,
  };
}

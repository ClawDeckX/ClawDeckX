// i18n entry — dynamic locale loading with code-splitting.
// English is statically imported as fallback; all other languages are loaded on-demand.
// To add a new language: 1) copy en/ folder → xx/  2) translate  3) add loader to `loaders` map + Language type
import { Language } from '../types';

// --- en (static fallback, always bundled) ---
import commonEn from './en/common.json';
import swEn from './en/sw.json';
import mwEn from './en/mw.json';
import cwEn from './en/cw.json';
import owEn from './en/ow.json';
import gwEn from './en/gw.json';
import esEn from './en/es.json';
import ndEn from './en/nd.json';
import drEn from './en/dr.json';
import tooltipsEn from './en/tooltips.json';

function buildLocale(common: any, sw: any, mw: any, cw: any, ow: any, gw: any, es: any, nd: any, dr: any) {
  return { ...common, sw, mw, cw, ow, gw, es, nd, dr };
}

const en = buildLocale(commonEn, swEn, mwEn, cwEn, owEn, gwEn, esEn, ndEn, drEn);

// Runtime cache: loaded locales + tooltips
const localeMap: Record<string, any> = { en };
const tooltipMap: Record<string, any> = { en: tooltipsEn };

// Dynamic loaders — each language becomes an independent Vite chunk
type LocaleLoader = () => Promise<{ locale: any; tooltips: any }>;
const loaders: Record<string, LocaleLoader> = {
  zh: async () => {
    const [common, sw, mw, cw, ow, gw, es, nd, dr, tooltips] = await Promise.all([
      import('./zh/common.json'), import('./zh/sw.json'), import('./zh/mw.json'),
      import('./zh/cw.json'), import('./zh/ow.json'), import('./zh/gw.json'),
      import('./zh/es.json'), import('./zh/nd.json'),
      import('./zh/dr.json'),
      import('./zh/tooltips.json'),
    ]);
    return {
      locale: buildLocale(common.default, sw.default, mw.default, cw.default, ow.default, gw.default, es.default, nd.default, dr.default),
      tooltips: tooltips.default,
    };
  },
  // To add more languages, add a loader here:
  // ja: async () => { ... },
};

/**
 * Load a locale asynchronously. Returns true when the locale is ready.
 * Safe to call multiple times — cached after first load.
 */
export async function loadLocale(lang: Language): Promise<boolean> {
  if (localeMap[lang]) return true;
  const loader = loaders[lang];
  if (!loader) return false;
  try {
    const { locale, tooltips } = await loader();
    localeMap[lang] = locale;
    tooltipMap[lang] = tooltips;
    return true;
  } catch (err) {
    console.error(`[i18n] Failed to load locale "${lang}":`, err);
    return false;
  }
}

export const locales = localeMap;

/** Synchronous — returns cached locale or English fallback. Call loadLocale() first. */
export function getTranslation(lang: Language): any {
  return localeMap[lang] || localeMap['en'];
}

export function getTooltip(key: string, lang: Language): string {
  const map = tooltipMap[lang] || tooltipMap['en'];
  return map[key] || '';
}

/** Language codes that have translations: 'en' (static) + all dynamic loaders */
export const availableLanguages = new Set<Language>(['en', ...Object.keys(loaders)] as Language[]);

export type { Language };

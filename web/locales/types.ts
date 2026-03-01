/** Typed locale namespace — each nested namespace is a flat string map. */
export interface LocaleNamespace extends Record<string, string> {}

/** Top-level translation map returned by getTranslation(). */
export interface TranslationMap extends Record<string, string | LocaleNamespace> {
  // Common top-level keys (from common.json root)
  welcome: string;
  cancel: string;
  ok: string;

  // Nested namespaces
  set: LocaleNamespace;
  sw: LocaleNamespace;
  mw: LocaleNamespace;
  cw: LocaleNamespace;
  ow: LocaleNamespace;
  gw: LocaleNamespace;
  es: LocaleNamespace;
  nd: LocaleNamespace;
  dr: LocaleNamespace;
  hi: LocaleNamespace;
  cfgEditor: LocaleNamespace;
}

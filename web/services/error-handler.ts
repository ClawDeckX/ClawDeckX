/**
 * Error Handler Service
 * 
 * Provides unified error handling with i18n support.
 * Translates backend error codes to localized messages.
 */

import zhErrors from '../locales/zh/errors.json';
import enErrors from '../locales/en/errors.json';

type Language = 'zh' | 'en';
type ErrorMap = Record<string, string>;

const errorMaps: Record<Language, ErrorMap> = {
  zh: zhErrors,
  en: enErrors,
};

/**
 * Get localized error message from error code.
 * 
 * @param errorCode - The error code from backend (e.g., "GW_NOT_CONNECTED")
 * @param language - The target language ("zh" or "en")
 * @param params - Optional parameters for template substitution
 * @returns Localized error message
 */
export function getErrorMessage(
  errorCode: string,
  language: Language = 'en',
  params?: Record<string, string>
): string {
  const map = errorMaps[language] || errorMaps.en;
  let message = map[errorCode] || errorCode;

  // Template substitution: {{field}} -> value
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
  }

  return message;
}

/**
 * Parse API error response and return localized message.
 * 
 * @param response - The API response object
 * @param language - The target language
 * @returns Localized error message
 */
export function parseApiError(
  response: { error_code?: string; message?: string },
  language: Language = 'en'
): string {
  if (response.error_code) {
    const localizedMessage = getErrorMessage(response.error_code, language);
    // If we found a translation, use it; otherwise fall back to server message
    if (localizedMessage !== response.error_code) {
      return localizedMessage;
    }
  }
  
  // Fallback to server message or generic error
  return response.message || getErrorMessage('INTERNAL_ERROR', language);
}

/**
 * Create an Error object with localized message.
 * 
 * @param errorCode - The error code
 * @param language - The target language
 * @param params - Optional parameters for template substitution
 * @returns Error object with localized message
 */
export function createLocalizedError(
  errorCode: string,
  language: Language = 'en',
  params?: Record<string, string>
): Error {
  const message = getErrorMessage(errorCode, language, params);
  const error = new Error(message);
  (error as any).code = errorCode;
  return error;
}

/**
 * Check if an error code exists in the error map.
 * 
 * @param errorCode - The error code to check
 * @returns true if the error code has a translation
 */
export function hasErrorTranslation(errorCode: string): boolean {
  return errorCode in enErrors;
}

export default {
  getErrorMessage,
  parseApiError,
  createLocalizedError,
  hasErrorTranslation,
};

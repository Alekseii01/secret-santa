import { LOCALES, pickLocale } from './locales.js';

// The language is fixed for the whole page: the server puts it into index.html.
export const locale = pickLocale(window.__SANTA_LOCALE__);
export const t = LOCALES[locale];

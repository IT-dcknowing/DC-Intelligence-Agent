/**
 * Config front centralisée.
 * Règle : Vite n'expose que VITE_*. Les clés secrètes restent côté backend (functions/.env).
 * Le front appelle /api/chat en priorité ; les clés locales (Paramètres) ne sont qu'un fallback dev.
 */

export const API_BASE_URL =
  (import.meta as any)?.env?.VITE_API_BASE_URL?.trim?.() || '/api';

export const DEFAULT_GOOGLE_ACCOUNT_EMAIL =
  (import.meta as any)?.env?.VITE_GOOGLE_ACCOUNT_EMAIL?.trim?.() || '';

export const ENV_OPENROUTER_KEY =
  (import.meta as any)?.env?.VITE_OPENROUTER_API_KEY?.trim?.() || '';

export const ENV_ANTHROPIC_KEY =
  (import.meta as any)?.env?.VITE_ANTHROPIC_API_KEY?.trim?.() || '';

export const ENV_DEEPSEEK_KEY =
  (import.meta as any)?.env?.VITE_DEEPSEEK_API_KEY?.trim?.() || '';

export const ENV_GROQ_KEY =
  (import.meta as any)?.env?.VITE_GROQ_API_KEY?.trim?.() || '';

export function apiUrl(path: string): string {
  const base = API_BASE_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

import { ApiKeyConfig, ChatMessage, LLMModel, LLMProvider, ReasoningEffort } from '../types';
import { apiUrl, ENV_ANTHROPIC_KEY, ENV_DEEPSEEK_KEY, ENV_GROQ_KEY, ENV_OPENROUTER_KEY } from '../config/env';

/**
 * Modèle par défaut du cabinet : actif immédiatement, sans clé utilisateur.
 * La clé OpenRouter vit côté backend (OPENROUTER_API_KEY), le front passe par /api/chat et /api/models.
 */
export const DEFAULT_MODEL_ID = 'inclusionai/ling-3.0-flash-vl:free';

export const DEFAULT_MODEL: LLMModel = {
  id: DEFAULT_MODEL_ID,
  name: 'Ling 3.0 Flash VL',
  provider: 'openrouter',
  isFree: true,
  description: 'Modèle par défaut du cabinet (vision + texte) — actif sans configuration.',
};

/**
 * Catalogue par défaut : le modèle cabinet est toujours présent en premier.
 * Le reste est complété dynamiquement via le backend (/api/models, clé serveur).
 */
export const REAL_DEFAULT_MODELS: LLMModel[] = [DEFAULT_MODEL];

const CUSTOM_MODELS_STORAGE_KEY = 'compta_flow_custom_models';
const API_KEYS_STORAGE_KEY = 'compta_flow_api_keys';

/**
 * Load custom models from LocalStorage
 */
export function loadCustomModels(): LLMModel[] {
  try {
    const raw = localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Could not load custom models from localStorage', e);
  }
  return [];
}

/**
 * Save custom models to LocalStorage
 */
export function saveCustomModels(models: LLMModel[]): void {
  try {
    localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(models));
  } catch (e) {
    console.warn('Could not save custom models to localStorage', e);
  }
}

/**
 * Load saved API keys from LocalStorage, avec fallback VITE_* (dev uniquement).
 * En prod, la voie recommandée est le proxy backend /api/chat (clé serveur).
 */
export function loadSavedApiKeys(initialKeys: ApiKeyConfig[]): ApiKeyConfig[] {
  const envFallback: Record<string, string> = {
    openrouter: ENV_OPENROUTER_KEY,
    anthropic: ENV_ANTHROPIC_KEY,
    deepseek: ENV_DEEPSEEK_KEY,
    groq: ENV_GROQ_KEY,
  };
  const withEnv = initialKeys.map((k) => {
    const envKey = (envFallback[k.provider] || '').trim();
    if (envKey && !k.key) {
      return { ...k, key: envKey, isConfigured: true, lastSaved: 'via VITE_* (dev)' };
    }
    return k;
  });
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (raw) {
      const saved: Record<string, { key: string; isConfigured: boolean; lastSaved?: string }> =
        JSON.parse(raw);
      return withEnv.map((k) => {
        const item = saved[k.provider];
        if (item && item.key) {
          return {
            ...k,
            key: item.key,
            isConfigured: item.isConfigured,
            lastSaved: item.lastSaved,
          };
        }
        return k;
      });
    }
  } catch (e) {
    console.warn('Could not load api keys from localStorage', e);
  }
  return withEnv;
}

/**
 * Persist API keys to LocalStorage
 */
export function saveApiKeysToStorage(apiKeys: ApiKeyConfig[]): void {
  try {
    const map: Record<string, { key: string; isConfigured: boolean; lastSaved?: string }> = {};
    apiKeys.forEach((k) => {
      map[k.provider] = {
        key: k.key,
        isConfigured: k.isConfigured,
        lastSaved: k.lastSaved,
      };
    });
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Could not save api keys to localStorage', e);
  }
}

export interface LiveModelsResult {
  models: LLMModel[];
  // True quand le backend détient la clé cabinet : OpenRouter utilisable sans clé locale.
  backendManaged: boolean;
}

/**
 * Fetch live models : backend /api/models en priorité (clé serveur, sans clé user),
 * puis appel direct OpenRouter si une clé locale est fournie (dev/fallback).
 */
export async function fetchLiveOpenRouterModels(apiKey?: string): Promise<LLMModel[]> {
  const viaBackend = await fetchBackendModels().catch(() => null);
  if (viaBackend && viaBackend.models.length > 0) return viaBackend.models;

  if (!apiKey || !apiKey.trim()) {
    // Ni backend ni clé locale -> on garde au minimum le modèle par défaut.
    return [DEFAULT_MODEL];
  }

  const headers: Record<string, string> = {
    'HTTP-Referer': window.location.origin,
    'X-Title': 'DC Intelligence',
    'Authorization': `Bearer ${apiKey.trim()}`,
  };

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    throw new Error(`OpenRouter models API returned ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const rawData: any[] = json.data || [];

  return rawData.map((item) => {
    const promptPrice = item.pricing?.prompt ? parseFloat(item.pricing.prompt) : 0;
    const completionPrice = item.pricing?.completion ? parseFloat(item.pricing.completion) : 0;
    const isFree = (promptPrice === 0 && completionPrice === 0) || item.id.endsWith(':free');

    // Categorize provider
    let provider: LLMProvider = 'openrouter';
    if (item.id.startsWith('anthropic/')) {
      provider = 'anthropic';
    } else if (item.id.startsWith('deepseek/')) {
      provider = 'deepseek';
    }

    return {
      id: item.id,
      name: item.name || item.id,
      provider,
      isFree,
      description: item.description?.slice(0, 120) || 'Modèle OpenRouter vérifié',
    };
  });
}

/**
 * Catalogue via le backend (clé cabinet côté serveur).
 * Retourne aussi `backendManaged` pour afficher OpenRouter "Configuré" sans clé locale.
 */
export async function fetchBackendModels(): Promise<LiveModelsResult | null> {
  const res = await fetch(apiUrl('/models'), { method: 'GET' });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray((json as any).models)) return null;
  const models: LLMModel[] = (json as any).models
    .filter((m: any) => m && typeof m.id === 'string')
    .map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      provider: m.provider === 'anthropic' || m.provider === 'deepseek' ? m.provider : 'openrouter',
      isFree: Boolean(m.isFree),
      description: String(m.description || 'Modèle OpenRouter vérifié').slice(0, 160),
    }));
  // Le modèle par défaut reste toujours en tête de liste.
  const others = models.filter((m) => m.id !== DEFAULT_MODEL_ID);
  return { models: [DEFAULT_MODEL, ...others], backendManaged: Boolean((json as any).backendManaged) };
}

/**
 * Send chat message to real LLM (OpenRouter, DeepSeek direct, or Anthropic direct)
 */
export interface GenerateChatParams {
  model: LLMModel;
  conversationHistory: ChatMessage[];
  userMessage: string;
  apiKeys: ApiKeyConfig[];
  reasoningEffort: ReasoningEffort;
  agentContext?: {
    name: string;
    role: string;
    instructions: string;
  };
}

export async function generateChatResponse(params: GenerateChatParams): Promise<string> {
  const { model, conversationHistory, userMessage, apiKeys, reasoningEffort, agentContext } = params;

  // 0. Voie recommandée : proxy backend /api/chat (clé OPENROUTER côté serveur, jamais exposée).
  // Le backend lit ton .env racine (OPENROUTER_API_KEY). Si dispo, on l'utilise en priorité.
  try {
    const proxied = await callBackendChat(model.id, conversationHistory, userMessage, reasoningEffort, agentContext);
    if (proxied) return proxied;
  } catch (e: any) {
    // backend_not_configured / 404 en dev local -> fallback direct ci-dessous.
    const msg = String(e?.message || '');
    if (!/backend_not_configured|404|Failed to fetch|Load failed|NetworkError/i.test(msg)) {
      throw e;
    }
  }

  // 1. Fallback direct (dev / clé saisie dans Paramètres).
  const openRouterKey = apiKeys.find((k) => k.provider === 'openrouter')?.key?.trim();
  const anthropicKey = apiKeys.find((k) => k.provider === 'anthropic')?.key?.trim();
  const deepseekKey = apiKeys.find((k) => k.provider === 'deepseek')?.key?.trim();

  // If using Anthropic direct API
  if (model.provider === 'anthropic' && anthropicKey && !openRouterKey) {
    return callAnthropicDirect(anthropicKey, model.id, conversationHistory, userMessage, agentContext);
  }

  // If using DeepSeek direct API
  if (model.provider === 'deepseek' && deepseekKey && !openRouterKey) {
    return callDeepSeekDirect(deepseekKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext);
  }

  // Default & standard routing: OpenRouter
  // Check if OpenRouter key is available
  if (!openRouterKey) {
    // Check if any specific provider key exists that can be used
    if (model.provider === 'anthropic' && anthropicKey) {
      return callAnthropicDirect(anthropicKey, model.id, conversationHistory, userMessage, agentContext);
    }
    if (model.provider === 'deepseek' && deepseekKey) {
      return callDeepSeekDirect(deepseekKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext);
    }

    throw new Error(
      `AUCUNE_CLÉ_API: Backend /api/chat indisponible (OPENROUTER_API_KEY manquant côté functions) et aucune clé locale. Ajoute OPENROUTER_API_KEY dans ton .env backend puis redéploie, ou renseigne une clé dans Paramètres > Clés API.`
    );
  }

  // Real OpenRouter call
  return callOpenRouter(openRouterKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext);
}

/**
 * Appel via le proxy backend sécurisé (clé serveur).
 * Lève backend_not_configured si le backend n'a pas de clé.
 */
async function callBackendChat(
  modelId: string,
  history: ChatMessage[],
  userMessage: string,
  reasoningEffort: ReasoningEffort,
  agentContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  const systemPrompt =
    `Tu es un assistant comptable et financier d'élite de la plateforme DC Intelligence. ` +
    `Conformité SYSCOHADA Révisé (OHADA, Côte d'Ivoire). ` +
    (agentContext ? `Agent: ${agentContext.name}. Rôle: ${agentContext.role}. Instructions: ${agentContext.instructions}` : '') +
    ` Précis, rigoureux sur les comptes (401, 411, 521, 445...), concis. Réponds en français.`;
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];
  for (const m of history.slice(-8)) {
    messages.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content });
  }
  messages.push({ role: 'user', content: userMessage });

  let res: Response;
  try {
    res = await fetch(apiUrl('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, messages, temperature: 0.3 }),
    });
  } catch {
    throw new Error('backend_unreachable');
  }
  if (res.status === 404) throw new Error('404 backend /api/chat absent (dev sans émulateur)');
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && (data as any)?.error === 'backend_not_configured') {
    throw new Error('backend_not_configured');
  }
  if (!res.ok) {
    throw new Error(`backend_${res.status}: ${String((data as any)?.detail || (data as any)?.error || res.statusText).slice(0, 300)}`);
  }
  const reply = String((data as any)?.reply || '');
  if (!reply) throw new Error('backend_empty_reply');
  return reply;
}

/**
 * Call OpenRouter API with real model ID
 */
async function callOpenRouter(
  apiKey: string,
  modelId: string,
  history: ChatMessage[],
  userMessage: string,
  reasoningEffort: ReasoningEffort,
  agentContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  const systemPrompt = `Tu es un assistant comptable et financier d'élite de la plateforme Compta Flow.
Tu travailles en conformité stricte avec le système comptable SYSCOHADA Révisé (OHADA, Côte d'Ivoire et Afrique de l'Ouest/Centrale).
${agentContext ? `Nom de l'agent: ${agentContext.name}\nRôle: ${agentContext.role}\nInstructions métier: ${agentContext.instructions}` : ''}
Sois précis, professionnel, rigoureux sur les numéros de compte SYSCOHADA (ex: 401 Fournisseurs, 411 Clients, 521 Banque, 445 TVA), et concis. Réponds en français.`;

  // Build messages array
  const formattedMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Include last 8 messages for context
  const recentHistory = history.slice(-8);
  for (const m of recentHistory) {
    if (m.sender === 'user') {
      formattedMessages.push({ role: 'user', content: m.content });
    } else if (m.sender === 'agent') {
      formattedMessages.push({ role: 'assistant', content: m.content });
    }
  }

  formattedMessages.push({ role: 'user', content: userMessage });

  const requestBody: any = {
    model: modelId,
    messages: formattedMessages,
    temperature: 0.3,
  };

  // If model supports reasoning effort (e.g. DeepSeek R1 or reasoning models)
  if (modelId.includes('r1') || modelId.includes('reasoner') || modelId.includes('thinking')) {
    requestBody.reasoning = {
      effort: reasoningEffort.toLowerCase(),
    };
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Compta Flow',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errMessage = response.statusText;
    try {
      const errJson = await response.json();
      errMessage = errJson?.error?.message || JSON.stringify(errJson);
    } catch {
      // ignore
    }
    throw new Error(`Erreur OpenRouter (${response.status}): ${errMessage}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const replyText = choice?.message?.content || choice?.text || '';

  if (!replyText) {
    throw new Error('OpenRouter a retourné une réponse vide.');
  }

  return replyText;
}

/**
 * Direct call to DeepSeek API (OpenAI compatible)
 */
async function callDeepSeekDirect(
  apiKey: string,
  modelId: string,
  history: ChatMessage[],
  userMessage: string,
  reasoningEffort: ReasoningEffort,
  agentContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  const deepseekModel = modelId.includes('r1') || modelId.includes('reasoner')
    ? 'deepseek-reasoner'
    : 'deepseek-chat';

  const systemPrompt = `Tu es un assistant comptable SYSCOHADA pour Compta Flow. ${
    agentContext ? `Rôle: ${agentContext.role}. Instructions: ${agentContext.instructions}` : ''
  }`;

  const messages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history.slice(-6)) {
    messages.push({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.content,
    });
  }
  messages.push({ role: 'user', content: userMessage });

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: deepseekModel,
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    let err = res.statusText;
    try {
      const j = await res.json();
      err = j?.error?.message || err;
    } catch {}
    throw new Error(`Erreur DeepSeek (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Direct call to Anthropic API
 */
async function callAnthropicDirect(
  apiKey: string,
  modelId: string,
  history: ChatMessage[],
  userMessage: string,
  agentContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  // Map friendly ID to Anthropic API model name if needed
  let anthropicModel = modelId;
  if (!anthropicModel.startsWith('claude-')) {
    anthropicModel = 'claude-3-5-sonnet-20241022';
  }

  const system = `Tu es un expert comptable SYSCOHADA pour Compta Flow. ${
    agentContext ? `Rôle: ${agentContext.role}. Instructions: ${agentContext.instructions}` : ''
  }`;

  const messages: any[] = [];
  for (const m of history.slice(-6)) {
    messages.push({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.content,
    });
  }
  messages.push({ role: 'user', content: userMessage });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 1500,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    let err = res.statusText;
    try {
      const j = await res.json();
      err = j?.error?.message || err;
    } catch {}
    throw new Error(`Erreur Anthropic (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

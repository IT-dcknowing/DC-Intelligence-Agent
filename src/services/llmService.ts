import { ApiKeyConfig, ChatMessage, LLMModel, LLMProvider, ReasoningEffort } from '../types';

export const REAL_DEFAULT_MODELS: LLMModel[] = [
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'openrouter',
    isFree: false,
    description: 'Modèle phare OpenRouter pour la finance, le calcul et le référentiel SYSCOHADA.',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    isFree: false,
    description: 'Raisonnement approfondi pas-à-pas (CoT) pour audits fiscaux et équilibres bilanciels.',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Modèle OpenRouter 100% gratuit ultra-performant pour l’assistance courante.',
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Inférence instantanée gratuite sur OpenRouter, vitesse et analyse documentaire.',
  },
  {
    id: 'mistralai/mistral-small-24b-instruct-2501:free',
    name: 'Mistral Small 24B (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Modèle français haute précision gratuit sur OpenRouter.',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'openrouter',
    isFree: false,
    description: 'Excellence rédactionnelle et compréhension fine des liasses fiscales.',
  },
  {
    id: 'anthropic/claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'openrouter',
    isFree: false,
    description: 'Dernière génération Anthropic avec capacité de réflexion hybride.',
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B',
    provider: 'openrouter',
    isFree: false,
    description: 'Capacités multilingues et mathématiques de premier plan sur OpenRouter.',
  },
];

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
 * Load saved API keys from LocalStorage
 */
export function loadSavedApiKeys(initialKeys: ApiKeyConfig[]): ApiKeyConfig[] {
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (raw) {
      const saved: Record<string, { key: string; isConfigured: boolean; lastSaved?: string }> =
        JSON.parse(raw);
      return initialKeys.map((k) => {
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
  return initialKeys;
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

/**
 * Fetch real live models from OpenRouter public API
 */
export async function fetchLiveOpenRouterModels(apiKey?: string): Promise<LLMModel[]> {
  const headers: Record<string, string> = {
    'HTTP-Referer': window.location.origin,
    'X-Title': 'Compta Flow',
  };
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

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

  // 1. Identify which API key to use
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
      `AUCUNE_CLÉ_API: Pour envoyer une requête avec ${model.name}, veuillez renseigner votre clé OpenRouter (ou la clé dédiée du fournisseur) dans Paramètres > Clés API.`
    );
  }

  // Real OpenRouter call
  return callOpenRouter(openRouterKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext);
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

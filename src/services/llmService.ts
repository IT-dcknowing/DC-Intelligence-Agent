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
  // Spécialiste délégué : il prend le relais et signe de son nom (§3 handoff).
  specialistContext?: {
    name: string;
    role: string;
    instructions: string;
    displayName?: string;
  };
  // Pièces jointes déjà stockées (storagePath chat/...) : le backend les injecte
  // en vision au dernier message user. Ignorées sur les voies directes.
  images?: string[];
  // Ligne d'instruction vision ajoutée au system prompt (§4.2).
  hasImages?: boolean;
  // Streaming token-par-token (§1.3) : onToken reçoit chaque delta.
  stream?: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  // Délai max d'attente du PREMIER token en streaming (défaut 20 s, §5.1).
  firstTokenTimeoutMs?: number;
}

export async function generateChatResponse(params: GenerateChatParams): Promise<string> {
  const { model, conversationHistory, userMessage, apiKeys, reasoningEffort, agentContext } = params;

  // 0. Voie recommandée : proxy backend /api/chat (clé OPENROUTER côté serveur, jamais exposée).
  // Le backend lit ton .env racine (OPENROUTER_API_KEY). Si dispo, on l'utilise en priorité.
  const specialistContext = params.specialistContext;
  const hasImages = Boolean(params.images && params.images.length > 0);
  try {
    const proxied = await callBackendChat(model.id, conversationHistory, userMessage, reasoningEffort, agentContext, specialistContext, 0, {
      stream: params.stream,
      onToken: params.onToken,
      signal: params.signal,
      images: params.images,
      hasImages,
      firstTokenTimeoutMs: params.firstTokenTimeoutMs,
    });
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
    return callAnthropicDirect(anthropicKey, model.id, conversationHistory, userMessage, agentContext, specialistContext);
  }

  // If using DeepSeek direct API
  if (model.provider === 'deepseek' && deepseekKey && !openRouterKey) {
    return callDeepSeekDirect(deepseekKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext, specialistContext);
  }

  // Default & standard routing: OpenRouter
  // Check if OpenRouter key is available
  if (!openRouterKey) {
    // Check if any specific provider key exists that can be used
    if (model.provider === 'anthropic' && anthropicKey) {
      return callAnthropicDirect(anthropicKey, model.id, conversationHistory, userMessage, agentContext, specialistContext);
    }
    if (model.provider === 'deepseek' && deepseekKey) {
      return callDeepSeekDirect(deepseekKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext, specialistContext);
    }

    throw new Error(
      `AUCUNE_CLÉ_API: Backend /api/chat indisponible (OPENROUTER_API_KEY manquant côté functions) et aucune clé locale. Ajoute OPENROUTER_API_KEY dans ton .env backend puis redéploie, ou renseigne une clé dans Paramètres > Clés API.`
    );
  }

  // Real OpenRouter call
  return callOpenRouter(openRouterKey, model.id, conversationHistory, userMessage, reasoningEffort, agentContext, specialistContext);
}

export interface AgentContextShape {
  name: string;
  role: string;
  instructions: string;
  // Nom affiché pour signer les réponses du spécialiste (ex: "Compta Flow").
  displayName?: string;
}

/**
 * Façade unique : le CLIENT ne parle qu'à DC Intelligence.
 * L'identité visible SUIT toujours l'Agent d'Accueil (façade permanente).
 * Les spécialistes sont des EXÉCUTANTS INTERNES : leur expertise est injectée
 * comme contexte, jamais comme identité. Utilisé par les 4 builders ci-dessous.
 */
export const DC_FACADE_NAME = 'DC Intelligence';
export const DC_FACADE_ROLE = 'Interlocuteur unique — façade conversationnelle permanente';

const NEUTRAL_BASE =
  'Tu es DC Intelligence, interlocuteur unique du client. Réponds en français, avec précision et concision.';

export function buildAgentPrompt(agentContext?: AgentContextShape, opts?: { specialistContext?: AgentContextShape; hasImages?: boolean }): string {
  const specialist = opts?.specialistContext;
  const imageLine = opts?.hasImages
    ? ' Une pièce jointe IMAGE est fournie avec le dernier message (vision) : analyse son contenu visuel en priorité (montants, tiers, dates, références) et intègre les données extraites dans ta réponse.'
    : '';
  // Mémoire : l'historique (4-8 derniers messages) est injecté par l'appelant (App/Functions)
  // via `history` — jamais via le prompt statique. Le prompt liste les CAPACITÉS disponibles.
  const toolsLine = agentContext?.instructions?.includes('delegate_to_')
    ? ''
    : ' Capacités de délégation (via outils) : delegate_to_compta (SYSCOHADA), delegate_to_juridique (CGI/articles/sanctions), delegate_to_reco (521/rapprochement), ask_clarification, answer_directly.';
  // Cas 1 : pas de délégation → Accueil parle en son nom (AQQR).
  if (!specialist) {
    const base = agentContext
      ? `Tu es DC Intelligence, incarné par « ${agentContext.name} » (${agentContext.role}). ${agentContext.instructions}`
      : NEUTRAL_BASE;
    return (
      `${base}${toolsLine} Règle d'identité : tu restes DC Intelligence du premier au dernier message. ` +
      `Tu ne dis jamais « je suis l'Agent Comptabilité/Juridique/Reco ».` + imageLine
    );
  }
  // Cas 2 : délégation → le spécialiste prend le relais et SIGNE de son nom
  // (§3 : handoff explicite, pas de façade masquée). L'Accueil a déjà annoncé
  // le routage dans sa réponse brève ; ici le spécialiste répond en son nom.
  const signer = specialist.displayName || specialist.name;
  return (
    `Tu réponds en tant que « ${signer} », agent spécialisé de DC Intelligence. ` +
    `Tu disposes de l'expertise suivante : ${specialist.instructions} ` +
    `Consigne stricte : ne simule JAMAIS une consultation ou une vérification — si les données fournies (contexte, sources, pièces) sont insuffisantes, dis ce qu'il te manque au lieu d'inventer. ` +
    `Présente la réponse comme tienne (« Voici ce que j'ai trouvé... »), avec précision et concision.` + imageLine
  );
}

export interface AccueilDelegationDecision {
  action: 'delegate_to_compta' | 'delegate_to_juridique' | 'delegate_to_reco' | 'ask_clarification' | 'answer_directly';
  reason?: string;
  clarificationQuestion?: string;
  confidence: number;
}

const ACCUEIL_TOOLS_SPEC = `
Outils dont tu disposes (tu DOIS en appeler UN par tour dès que l'intention est claire) :
- delegate_to_compta(reason): compta SYSCOHADA (factures, HT/TVA, écritures, journaux, 706/401/411)
- delegate_to_juridique(reason): fiscal/juridique (CGI, article, sanction, obligation, déclaration, échéance, Code du Travail, Legal Flow)
- delegate_to_reco(reason): rapprochement bancaire (relevés, 521, écarts, pointage)
- ask_clarification(question): intention trop vague ou multi-entreprise ambiguë (une seule question ciblée)
- answer_directly(): simple salutation/accueil sans expertise
Réponds UNIQUEMENT en JSON {"action":"...","reason":"...","clarificationQuestion":"..."} — aucun texte hors JSON.
Mémoire à utiliser : historique des messages, contexte entreprise (plan/tiers/journaux) et résultats des tâches précédentes qui te seront fournis.
`.trim();

export function buildAccueilDelegationPrompt(
  agentContext: AgentContextShape,
  historySummary: string,
  accountingContextSummary: string,
  userMessage: string
): string {
  return (
    `Tu es DC Intelligence incarné par « ${agentContext.name} » (${agentContext.role}). ${agentContext.instructions}\n\n` +
    `${ACCUEIL_TOOLS_SPEC}\n\n` +
    `Contexte entreprise: ${accountingContextSummary}\n` +
    `Historique récent:\n${historySummary || '(première demande)'}\n\n` +
    `Message client à qualifier: "${userMessage}"\n` +
    `Décide maintenant quel OUTIL appeler.`
  );
}

export function parseAccueilDelegationReply(reply: string): AccueilDelegationDecision | null {
  try {
    const m = reply.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (!obj || typeof obj.action !== 'string') return null;
    if (!['delegate_to_compta', 'delegate_to_juridique', 'delegate_to_reco', 'ask_clarification', 'answer_directly'].includes(obj.action)) return null;
    return {
      action: obj.action,
      reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 300) : undefined,
      clarificationQuestion: typeof obj.clarificationQuestion === 'string' ? obj.clarificationQuestion.slice(0, 400) : undefined,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.85,
    };
  } catch {
    return null;
  }
}

/** Alias conservé pour compatibilité (anciens imports) : même contrat que buildAgentPrompt. */
export function buildIdentityLockedPrompt(_base: string, agentContext?: AgentContextShape): string {
  return buildAgentPrompt(agentContext);
}

export const RATE_LIMIT_MESSAGE =
  'Limite de requêtes IA atteinte (quota OpenRouter du modèle). Attendez ~1 minute ou basculez sur un autre modèle — un modèle payant comme DeepSeek n’a pas ces quotas.';

/**
 * Traduit une erreur d'inférence brute en message lisible pour l'utilisateur.
 */
export function friendlyInferenceError(err: any): string {
  const m = String(err?.message ?? err ?? '');
  if (/429|LIMITE_ATTEINTE|backend_429|openrouter_429|rate.?limit|quota|trop de requêtes/i.test(m)) {
    return RATE_LIMIT_MESSAGE;
  }
  if (/502|504|Bad Gateway|indisponible temporairement|backend_502|backend_504/i.test(m)) {
    return "Le service IA est momentanément indisponible. Réessai automatique en cours... Si cela persiste, je vous redirige vers un autre expert.";
  }
  return m || 'Échec de la réponse du modèle.';
}

/**
 * Appel via le proxy backend sécurisé (clé serveur).
 * Lève backend_not_configured si le backend n'a pas de clé.
 * Sur 429 : attend le délai conseillé (plafonné) puis rejoue UNE fois,
 * sinon lève LIMITE_ATTEINTE (message convivial via friendlyInferenceError).
 */
export interface BackendChatStreamOpts {
  stream?: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
  images?: string[];
  hasImages?: boolean;
  firstTokenTimeoutMs?: number;
  maxTokens?: number;
}

async function callBackendChat(
  modelId: string,
  history: ChatMessage[],
  userMessage: string,
  reasoningEffort: ReasoningEffort,
  agentContext?: { name: string; role: string; instructions: string },
  specialistContext?: { name: string; role: string; instructions: string; displayName?: string },
  attempt = 0,
  opts?: BackendChatStreamOpts
): Promise<string> {
  const systemPrompt = buildAgentPrompt(agentContext, { specialistContext, hasImages: opts?.hasImages });
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }];
  for (const m of history.slice(-8)) {
    messages.push({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Streaming SSE (§1.3) : affichage dès le 1er token, jamais d'attente complète.
  if (opts?.stream && opts?.onToken) {
    return streamBackendChat(modelId, messages, opts);
  }

  let res: Response;
  try {
    res = await fetch(apiUrl('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts?.signal,
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: 0.3,
        max_tokens: opts?.maxTokens || 3500,
        ...(opts?.images?.length ? { imagePaths: opts.images } : {}),
      }),
    });
  } catch (e: any) {
    if (String(e?.name) === 'AbortError') throw new Error('backend_aborted');
    throw new Error('backend_unreachable');
  }
  if (res.status === 404) throw new Error('404 backend /api/chat absent (dev sans émulateur)');
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && (data as any)?.error === 'backend_not_configured') {
    throw new Error('backend_not_configured');
  }
  if (res.status === 429) {
    if (attempt === 0) {
      const waitSec = Math.min(Number((data as any)?.retry_after_seconds) || 60, 20);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      return callBackendChat(modelId, history, userMessage, reasoningEffort, agentContext, specialistContext, 1, opts);
    }
    throw new Error('LIMITE_ATTEINTE');
  }
  if ((res.status === 502 || res.status === 504) && attempt === 0) {
    await new Promise((r) => setTimeout(r, 1500));
    return callBackendChat(modelId, history, userMessage, reasoningEffort, agentContext, specialistContext, 1, opts);
  }
  if (res.status === 502 || res.status === 504) {
    throw new Error(`backend_${res.status}: indisponible temporairement, réessayez`);
  }
  if (!res.ok) {
    throw new Error(`backend_${res.status}: ${String((data as any)?.detail || (data as any)?.error || res.statusText).slice(0, 300)}`);
  }
  const reply = String((data as any)?.reply || '');
  if (!reply) throw new Error('backend_empty_reply');
  return reply;
}

/**
 * Streaming SSE token-par-token (§1.3) via POST /api/chat { stream: true }.
 * Le 1er token doit arriver sous firstTokenTimeoutMs (défaut 20 s, §5.1),
 * sinon STREAM_FIRST_TOKEN_TIMEOUT. Tout le texte est retourné à la fin.
 */
async function streamBackendChat(
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  opts: BackendChatStreamOpts
): Promise<string> {
  const onToken = opts.onToken as (token: string) => void;
  const firstTokenTimeoutMs = opts.firstTokenTimeoutMs ?? 20000;
  let res: Response;
  try {
    res = await fetch(apiUrl('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      signal: opts.signal,
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: 0.3,
        max_tokens: opts.maxTokens || 3500,
        stream: true,
        ...(opts.images?.length ? { imagePaths: opts.images } : {}),
      }),
    });
  } catch (e: any) {
    if (String(e?.name) === 'AbortError') throw new Error('backend_aborted');
    throw new Error('backend_unreachable');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('text/event-stream')) {
    // Repli : le backend a répondu en JSON (erreur mappée ou réponse complète).
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('404 backend /api/chat absent (dev sans émulateur)');
    if (res.status === 503 && (data as any)?.error === 'backend_not_configured') throw new Error('backend_not_configured');
    if (res.status === 429) throw new Error('LIMITE_ATTEINTE');
    if (res.status === 502 || res.status === 504) throw new Error(`backend_${res.status}: indisponible temporairement, réessayez`);
    if (!res.ok) throw new Error(`backend_${res.status}: ${String((data as any)?.detail || (data as any)?.error || res.statusText).slice(0, 300)}`);
    const reply = String((data as any)?.reply || '');
    if (!reply) throw new Error('backend_empty_reply');
    onToken(reply);
    return reply;
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('backend_stream_unreadable');
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let gotFirstToken = false;
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (!gotFirstToken) {
      try { reader.cancel(); } catch {}
    }
  }, firstTokenTimeoutMs);
  const clearFirstTimer = () => {
    if (firstTokenTimer) { clearTimeout(firstTokenTimer); firstTokenTimer = null; }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            if (obj && typeof obj.error === 'string' && obj.error) {
              throw new Error(`backend_stream_error: ${obj.error.slice(0, 300)}`);
            }
            const content = obj && typeof obj.content === 'string' ? obj.content : '';
            if (content) {
              if (!gotFirstToken) { gotFirstToken = true; clearFirstTimer(); }
              full += content;
              onToken(content);
            }
          } catch (e: any) {
            if (String(e?.message || '').startsWith('backend_stream_error')) throw e;
            // Ligne non-JSON : ignorée.
          }
        }
      }
      if (opts.signal?.aborted) throw new Error('backend_aborted');
    }
  } catch (e: any) {
    clearFirstTimer();
    if (String(e?.message) === 'backend_aborted') throw e;
    if (!gotFirstToken) throw new Error('STREAM_FIRST_TOKEN_TIMEOUT');
    // Coupure après le 1er token : on rend le partiel, l'appelant décide.
    if (!full) throw new Error('backend_stream_interrompu');
    return full;
  }
  clearFirstTimer();
  if (!full) throw new Error('backend_empty_reply');
  return full;
}

/**
 * Réponse brève LLM (§2.1) : 1 à 2 phrases qui accusent réception, reformulent
 * si besoin et annoncent l'action. Appel court non-streamé (max 150 tokens,
 * timeout 8 s). En cas d'échec, l'appelant n'affiche RIEN (dots discrets).
 */
export async function callBackendBrief(params: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), params.timeoutMs ?? 8000);
  try {
    const res = await fetch(apiUrl('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: params.modelId,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.5,
        max_tokens: params.maxTokens ?? 150,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`backend_${res.status}`);
    const reply = String((data as any)?.reply || '').trim();
    if (!reply) throw new Error('backend_empty_reply');
    return reply;
  } catch (e: any) {
    if (String(e?.name) === 'AbortError') throw new Error('brief_timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  agentContext?: { name: string; role: string; instructions: string },
  specialistContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  const systemPrompt = buildAgentPrompt(agentContext, { specialistContext });

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
    max_tokens: 3500,
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
  agentContext?: { name: string; role: string; instructions: string },
  specialistContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  const deepseekModel = modelId.includes('r1') || modelId.includes('reasoner')
    ? 'deepseek-reasoner'
    : 'deepseek-chat';

  const systemPrompt = buildAgentPrompt(agentContext, { specialistContext });

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
      max_tokens: 3500,
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
  agentContext?: { name: string; role: string; instructions: string },
  specialistContext?: { name: string; role: string; instructions: string }
): Promise<string> {
  // Map friendly ID to Anthropic API model name if needed
  let anthropicModel = modelId;
  if (!anthropicModel.startsWith('claude-')) {
    anthropicModel = 'claude-3-5-sonnet-20241022';
  }

  const system = buildAgentPrompt(agentContext, { specialistContext });

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
      max_tokens: 3500,
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

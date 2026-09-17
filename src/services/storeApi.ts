/**
 * Persistance app — Firestore/Storage via le backend (/api/*).
 * Stratégie : write-through (backend d'abord, cache local en repli) et
 * lecture backend-au-chargement avec cache localStorage en repli offline.
 * Aucun secret n'est jamais envoyé : les endpoints refusent les champs token.
 */
import { apiUrl } from '../config/env';
import type { Agent, ChatMessage, ChatSession, KnowledgeDocument, WorkspaceIntegration } from '../types';

async function api<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(path), {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null; // offline / backend indisponible : le cache local prend le relais
  } finally {
    clearTimeout(timer);
  }
}

const post = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
const put = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });
const get = <T,>(path: string) => api<T>(path);

// ---------- Agents ----------
export async function fetchAgents(): Promise<Agent[] | null> {
  const data = await get<{ ok: boolean; agents: Agent[] }>('/agents');
  if (!data || !data.ok || !Array.isArray(data.agents)) return null;
  return data.agents;
}

export async function persistAgent(agent: Agent): Promise<void> {
  const { id, ...rest } = agent;
  await put(`/agents/${encodeURIComponent(id)}`, rest);
}

// ---------- Connaissances ----------
export async function fetchKnowledge(): Promise<KnowledgeDocument[] | null> {
  const data = await get<{ ok: boolean; documents: any[] }>('/knowledge');
  if (!data || !data.ok || !Array.isArray(data.documents)) return null;
  return data.documents.map(mapKnowledgeDoc);
}

function mapKnowledgeDoc(d: any): KnowledgeDocument {
  return {
    id: String(d.id),
    title: String(d.title || 'Document sans titre'),
    category: String(d.category || 'RÉFÉRENCES'),
    lastUpdated: String(d.lastUpdated || d.createdAt || ''),
    size: String(d.size || '—'),
    summary: String(d.summary || ''),
    status: typeof d.status === 'string' ? d.status : undefined,
    chunkCount: Number.isFinite(Number(d.chunkCount)) ? Number(d.chunkCount) : undefined,
    indexReason: typeof d.indexReason === 'string' && d.indexReason ? d.indexReason : undefined,
  };
}

export interface RagHit {
  docId: string;
  title: string;
  chunk: string;
  score: number;
}

/** Recherche vectorielle réelle (fail-soft : [] si backend indisponible). */
export async function searchKnowledge(query: string, topK = 2): Promise<RagHit[]> {
  try {
    if (!query || query.trim().length < 3) return [];
    const data = await post<{ ok: boolean; results: any[] }>('/knowledge/search', {
      query: query.slice(0, 2000),
      topK,
    });
    if (!data || !data.ok || !Array.isArray(data.results)) return [];
    return data.results
      .filter((r) => r && typeof r.chunk === 'string')
      .map((r) => ({
        docId: String(r.docId || ''),
        title: String(r.title || 'Document'),
        chunk: String(r.chunk || '').slice(0, 800),
        score: Number(r.score) || 0,
      }))
      .slice(0, topK);
  } catch {
    return [];
  }
}

/** Réindexation réelle côté serveur (chunks + embeddings reconstruits). */
export async function reindexKnowledge(id: string): Promise<KnowledgeDocument | null> {
  const data = await post<{ ok: boolean; document: any }>(
    `/knowledge/${encodeURIComponent(id)}/reindex`,
    {}
  );
  if (!data || !data.ok || !data.document) return null;
  return mapKnowledgeDoc({ ...data.document, id });
}

export async function seedKnowledge(docs: Array<Partial<KnowledgeDocument> & { id: string }>): Promise<void> {
  await post('/knowledge/seed', { docs });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(new Error('read_file_failed'));
    reader.readAsDataURL(file);
  });
}

export async function uploadKnowledge(file: File, category = 'RÉFÉRENCES'): Promise<KnowledgeDocument> {
  if (file.size <= 0 || file.size > 8_000_000) {
    throw new Error('Fichier invalide ou trop volumineux (max 8 Mo).');
  }
  const base64 = await fileToBase64(file);
  const data = await post<{ ok: boolean; document: any }>('/knowledge/upload', {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    base64,
    category,
  });
  if (!data || !data.ok || !data.document) {
    throw new Error('Échec de l’envoi vers le serveur. Réessayez.');
  }
  return mapKnowledgeDoc({ ...data.document, id: data.document.id });
}

export async function deleteKnowledgeDoc(id: string): Promise<boolean> {
  const data = await del<{ ok: boolean }>(`/knowledge/${encodeURIComponent(id)}`);
  return Boolean(data && data.ok);
}

export interface KnowledgeDownload {
  name: string;
  mimeType: string;
  base64: string;
}

export async function downloadKnowledge(id: string): Promise<KnowledgeDownload | null> {
  const data = await get<{ ok: boolean; name: string; mimeType: string; base64: string }>(
    `/knowledge/${encodeURIComponent(id)}/download`
  );
  if (!data || !data.ok || !data.base64) return null;
  return { name: data.name, mimeType: data.mimeType, base64: data.base64 };
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export { base64ToBlob };

// ---------- Conversations ----------
export function backendSessionToChat(s: any, messages: any[]): ChatSession {
  const toTime = (iso: string) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return '—';
    }
  };
  const toDate = (iso: string) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return sameDay ? `Aujourd’hui à ${hh}` : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${hh}`;
    } catch {
      return '';
    }
  };
  return {
    id: String(s.id),
    title: String(s.title || 'Session'),
    category: String(s.category || 'Général'),
    lastMessage: String(s.lastMessage || ''),
    lastMessageTime: toTime(String(s.lastMessageTime || s.updatedAt || '')),
    createdAt: toDate(String(s.createdAt || '')),
    activeAgentId: s.activeAgentId ? String(s.activeAgentId) : undefined,
    messages: (Array.isArray(messages) ? messages : []).map((m: any): ChatMessage => ({
      id: String(m.id || `msg-${Math.random().toString(36).slice(2, 8)}`),
      sender: m.sender === 'agent' ? 'agent' : m.sender === 'system' ? 'system' : 'user',
      senderName: String(m.senderName || 'Vous'),
      content: String(m.content || ''),
      timestamp: toTime(String(m.timestamp || m.createdAt || '')),
      ...(m.agentName
        ? {
            taskRef: {
              taskId: '',
              agentId: String(m.agentName),
              userId: '',
              companyId: '',
              action: 'PREPARE',
              input: '',
              status: 'COMPLETED',
              createdAt: '',
              updatedAt: '',
            },
          }
        : {}),
    })),
  };
}

export async function fetchSessions(): Promise<ChatSession[] | null> {
  const data = await get<{ ok: boolean; sessions: any[] }>('/conversations?limit=20');
  if (!data || !data.ok || !Array.isArray(data.sessions)) return null;
  const sessions = await Promise.all(
    data.sessions.map(async (s) => {
      const msgs = await get<{ ok: boolean; messages: any[] }>(
        `/conversations/${encodeURIComponent(String(s.id))}/messages?limit=200`
      );
      return backendSessionToChat(s, msgs && msgs.ok ? msgs.messages : []);
    })
  );
  return sessions;
}

export async function createSessionRemote(title: string, category = 'Général'): Promise<ChatSession | null> {
  const data = await post<{ ok: boolean; session: any }>('/conversations', { title, category });
  if (!data || !data.ok || !data.session) return null;
  return backendSessionToChat(data.session, []);
}

export async function appendMessageRemote(
  sessionId: string,
  msg: { sender: 'user' | 'agent' | 'system'; senderName: string; content: string; agentName?: string }
): Promise<void> {
  await post(`/conversations/${encodeURIComponent(sessionId)}/messages`, { message: msg });
}

export async function renameSessionRemote(sessionId: string, title: string): Promise<void> {
  await put(`/conversations/${encodeURIComponent(sessionId)}`, { title });
}

export async function deleteSessionRemote(sessionId: string): Promise<void> {
  await del(`/conversations/${encodeURIComponent(sessionId)}`);
}

export async function migrateLocalSessions(sessions: ChatSession[]): Promise<void> {
  for (const s of sessions.slice(0, 20)) {
    try {
      const created = await createSessionRemote(s.title, s.category || 'Général');
      if (!created) continue;
      for (const m of (s.messages || []).slice(0, 200)) {
        await appendMessageRemote(created.id, {
          sender: m.sender,
          senderName: m.senderName,
          content: m.content,
          agentName: m.taskRef?.agentId,
        });
      }
    } catch {
      // migration best-effort : on continue avec les suivantes
    }
  }
}

// ---------- Intégrations (statuts uniquement, jamais de tokens) ----------
const VALID_INTEGRATION_IDS = ['google-sheets', 'google-docs', 'legal-flow', 'compta-flow'] as const;

/**
 * Normalise un objet d'intégration venu du cache local ou de Firestore.
 * Retourne null si l'objet est inexploitable (id inconnu/absent).
 * C'est le rempart contre les caches empoisonnés : un `scopes` manquant ou une
 * entrée `null` faisait planter le rendu (.join/.map sur undefined) à chaque
 * visite, en boucle permanente car l'état empoisonné était ré-écrit tel quel.
 */
export function normalizeIntegration(raw: unknown): WorkspaceIntegration | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id || '');
  if (!(VALID_INTEGRATION_IDS as readonly string[]).includes(id)) return null;
  const status = r.status === 'connected' ? 'connected' : r.status === 'connecting' ? 'connecting' : 'disconnected';
  const scopes = Array.isArray(r.scopes) ? r.scopes.filter((s): s is string => typeof s === 'string') : [];
  const syncHistory = Array.isArray(r.syncHistory)
    ? r.syncHistory.filter((l) => l && typeof l === 'object')
    : [];
  const strOrUndef = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  return {
    id: id as WorkspaceIntegration['id'],
    name: typeof r.name === 'string' && r.name ? r.name : id,
    description: typeof r.description === 'string' ? r.description : '',
    iconType: r.iconType === 'docs' ? 'docs' : r.iconType === 'legal-flow' ? 'legal-flow' : 'sheets',
    status,
    accountEmail: strOrUndef(r.accountEmail),
    connectedAt: strOrUndef(r.connectedAt),
    lastSyncAt: strOrUndef(r.lastSyncAt),
    targetResource: strOrUndef(r.targetResource),
    endpointUrl: strOrUndef(r.endpointUrl),
    scopes,
    syncCount: Number.isFinite(Number(r.syncCount)) ? Number(r.syncCount) : 0,
    syncHistory: syncHistory as WorkspaceIntegration['syncHistory'],
  };
}

/**
 * Fusion catalogue-first : la liste des cartes est TOUJOURS définie par `base`
 * (INITIAL_INTEGRATIONS). Les `overrides` (Firestore, cache local) ne font que
 * surcharger des attributs (statut, email, ressource…) des cartes connues.
 * Un doc distant inconnu, incomplet ou empoisonné ne peut donc ni vider la liste,
 * ni faire planter le rendu — c'est la réponse structurelle à la question
 * "pourquoi Firestore est concerné par cette partie" : il ne l'est plus pour
 * l'existence des cartes, seulement pour leurs attributs. Le coffre OAuth
 * (`users/admin/connections`, lu via /api/google/status) reste la source de
 * vérité pour "connecté / pas connecté" côté Google.
 */
export function mergeIntegrationOverrides(
  base: WorkspaceIntegration[],
  overrides: unknown
): WorkspaceIntegration[] {
  if (!Array.isArray(overrides)) return [...base];
  const byId = new Map<string, WorkspaceIntegration>();
  for (const raw of overrides) {
    const clean = normalizeIntegration(raw);
    if (clean) byId.set(clean.id, clean);
  }
  return base.map((card) => {
    const over = byId.get(card.id);
    if (!over) return card;
    // Les attributs distants gagnent, mais jamais au prix d'un champ vital :
    // on repart de la carte saine et on n'écrase qu'avec des valeurs définies.
    const merged: WorkspaceIntegration = { ...card };
    if (over.status) merged.status = over.status;
    if (over.accountEmail !== undefined) merged.accountEmail = over.accountEmail;
    if (over.connectedAt !== undefined) merged.connectedAt = over.connectedAt;
    if (over.lastSyncAt !== undefined) merged.lastSyncAt = over.lastSyncAt;
    if (over.targetResource !== undefined) merged.targetResource = over.targetResource;
    if (over.endpointUrl !== undefined) merged.endpointUrl = over.endpointUrl;
    if (over.scopes.length > 0) merged.scopes = over.scopes;
    if (typeof over.syncCount === 'number') merged.syncCount = over.syncCount;
    if (over.syncHistory && over.syncHistory.length > 0) merged.syncHistory = over.syncHistory;
    return merged;
  });
}

export async function fetchIntegrations(): Promise<WorkspaceIntegration[] | null> {
  const data = await get<{ ok: boolean; integrations: WorkspaceIntegration[] }>('/integrations');
  if (!data || !data.ok || !Array.isArray(data.integrations)) return null;
  return data.integrations;
}

export async function persistIntegration(item: WorkspaceIntegration): Promise<void> {
  const { id, ...rest } = item as WorkspaceIntegration & { id: string };
  const { ...safe } = rest as Record<string, unknown>;
  await put(`/integrations/${encodeURIComponent(id)}`, safe);
}

// ---------- Signaux utilisateur cross-canal (§2.2) ----------
// Identité web best-effort : id navigateur persistant. Le chaînage avec
// l'identité WhatsApp (numéro vérifié) requiert une auth ou un numéro
// vérifié côté web — P1, cf. PERSONA_SYSTEM_CONTRACT.md.
const BROWSER_USER_KEY = 'dc_user_id';

export function getBrowserUserId(): string {
  try {
    let id = localStorage.getItem(BROWSER_USER_KEY);
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto as Crypto).randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(BROWSER_USER_KEY, id);
    }
    return id;
  } catch {
    return `web-${Date.now()}`;
  }
}

// Miroir de la détection backend (whatsapp.js FRUSTRATION_RX, version courte) :
// toute évolution doit être reportée des deux côtés.
const FRUSTRATION_RX =
  /(merde|putain|bordel|fait chier|\bcon\b|connard|débile|stupide|incompétent|incompetent|nul+|nulle|marre|ras[- ]?le[- ]?bol|ça marche pas|ca marche pas|ne fonctionne pas|fonctionne pas|toujours pas|jamais.*répon|arnaque|escro|honteux|foutage|foutaise|nique)/i;

export function isFrustratedText(text: string): boolean {
  return FRUSTRATION_RX.test(String(text || ''));
}

export async function postUserSignal(
  kind: 'frustration' | 'clarification' | 'reset',
  userId?: string
): Promise<void> {
  try {
    await post('/user-signals/event', { userId: userId || getBrowserUserId(), kind });
  } catch {
    // télémétrie best-effort : jamais bloquante
  }
}

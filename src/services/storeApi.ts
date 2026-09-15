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
  };
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

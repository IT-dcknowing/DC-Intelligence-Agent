import type { Page, Route, Request } from '@playwright/test';
import { INITIAL_AGENTS, INITIAL_KNOWLEDGE, INITIAL_INTEGRATIONS } from '../../../src/mockData';

/**
 * Fake backend e2e : intercepte TOUTES les requêtes `/api/**` et rejoue le
 * contrat exact du vrai backend (mêmes enveloppes `{ok, ...}`, mêmes champs).
 * But : tester le front de bout en bout (persistance après reload, câblage
 * RAG, routage) sans émulateur Firebase, de façon 100 % déterministe.
 *
 * Stratégie de preuve : le faux `/api/chat` ne génère rien — il ÉCHO le
 * contenu du prompt système (marqueurs E2E, nom d'agent, refs [doc:...]).
 * Si la réponse UI contient ces éléments, c'est que le moteur les a lus.
 */

export interface FakeDoc {
  id: string;
  title: string;
  category: string;
  size: string;
  mimeType: string;
  content: string;
  summary: string;
  lastUpdated: string;
}

export interface FakeMessage {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  agentName?: string;
}

export interface FakeSession {
  id: string;
  title: string;
  category: string;
  lastMessage: string;
  lastMessageTime: string;
  createdAt: string;
  activeAgentId?: string;
  messages: FakeMessage[];
}

export interface FakeDb {
  agents: any[];
  docs: FakeDoc[];
  sessions: FakeSession[];
  integrations: any[];
  chatCalls: { system: string; user: string }[];
  docSeq: number;
  sessionSeq: number;
  msgSeq: number;
}

function isoNow(): string {
  return new Date().toISOString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createFakeDb(): FakeDb {
  const now = isoNow();
  return {
    agents: JSON.parse(JSON.stringify(INITIAL_AGENTS)),
    docs: INITIAL_KNOWLEDGE.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      size: d.size,
      mimeType: 'application/pdf',
      content: `Contenu de référence : ${d.title}. ${d.summary}`,
      summary: d.summary,
      lastUpdated: d.lastUpdated,
    })),
    sessions: [
      {
        id: 'session-e2e-1',
        title: 'Session E2E',
        category: 'Général',
        lastMessage: '',
        lastMessageTime: now,
        createdAt: now,
        activeAgentId: 'agent-router',
        messages: [],
      },
    ],
    integrations: JSON.parse(JSON.stringify(INITIAL_INTEGRATIONS)),
    chatCalls: [],
    docSeq: 100,
    sessionSeq: 100,
    msgSeq: 100,
  };
}

/** Réponse déterministe du faux LLM : écho du prompt, jamais d'invention. */
export function fakeChatReply(body: any): string {
  const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const system = String(messages.find((m) => m?.role === 'system')?.content || '');
  const user = String([...messages].reverse().find((m) => m?.role === 'user')?.content || '');

  // 1. Consigne de classification multimodale -> document générique.
  if (/Classifie en UN mot/i.test(system) || /Classifie en UN mot/i.test(user)) {
    return '"general_query"';
  }
  // 2. Sinon : écho des preuves que le moteur a lues.
  const markers = [...new Set(system.match(/\b[A-Z]{2,}_E2E_\d+\b/g) || [])];
  const agentMatch =
    /expert interne « ([^»]+) »/.exec(system) || /incarné par « ([^»]+) »/.exec(system);
  const agent = agentMatch ? agentMatch[1] : 'inconnu';
  const docs = [...new Set(user.match(/\[doc:([^\]]+)\]/g) || [])];
  let out = `MOTEUR-FAKE — Agent: ${agent}. Marqueurs: ${
    markers.length > 0 ? markers.join(',') : 'aucun'
  }. Docs: ${docs.length > 0 ? docs.join(',') : 'aucune'}.`;
  if (/BANANA/.test(user)) {
    out += ' Mot de passe trouvé : BANANA.';
  }
  return out;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function stripMessages(s: any): any {
  const { messages, ...rest } = s;
  return rest;
}

export async function installFakeBackend(page: Page, db: FakeDb): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    // Playwright intercepte avant le proxy Vite : on ne traite que nos chemins.
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = req.method().toUpperCase();
    let body: any = {};
    try {
      body = req.postDataJSON() || {};
    } catch {
      body = {};
    }

    // ---- Catalogue modèles / statuts Google (neutres, jamais bloquants) ----
    if (method === 'GET' && path === '/models') {
      return json(route, 200, { ok: true, models: [], backendManaged: false });
    }
    if (method === 'GET' && path === '/google/status') {
      return json(route, 200, { ok: true, connected: false });
    }
    if (method === 'POST' && path === '/audit') {
      return json(route, 200, { ok: true });
    }
    if (method === 'POST' && path === '/user-signals/event') {
      return json(route, 200, { ok: true });
    }

    // ---- Agents ----
    if (method === 'GET' && path === '/agents') {
      return json(route, 200, { ok: true, agents: db.agents });
    }
    {
      const m = path.match(/^\/agents\/([^/]+)$/);
      if (m && method === 'PUT') {
        const id = decodeURIComponent(m[1]);
        const idx = db.agents.findIndex((a) => a.id === id);
        const merged = { ...(idx >= 0 ? db.agents[idx] : { id }), ...body, id };
        if (idx >= 0) db.agents[idx] = merged;
        else db.agents.unshift(merged);
        return json(route, 200, { ok: true, agent: merged });
      }
    }

    // ---- Connaissances ----
    if (method === 'GET' && path === '/knowledge') {
      return json(route, 200, {
        ok: true,
        documents: db.docs.map(({ content, ...meta }) => meta),
      });
    }
    if (method === 'POST' && path === '/knowledge/upload') {
      const name = String(body.name || 'document.bin');
      const content = Buffer.from(String(body.base64 || ''), 'base64').toString('utf8');
      const id = `doc-e2e-${++db.docSeq}`;
      const doc: FakeDoc = {
        id,
        title: name.replace(/\.[^/.]+$/, '') || name,
        category: String(body.category || 'RÉFÉRENCES'),
        size: formatSize(Buffer.byteLength(content, 'utf8')),
        mimeType: String(body.mimeType || 'application/octet-stream'),
        content,
        summary: content.slice(0, 120),
        lastUpdated: isoNow(),
      };
      db.docs.unshift(doc);
      const { content: _c, ...meta } = doc;
      return json(route, 200, { ok: true, document: { ...meta, id } });
    }
    if (method === 'POST' && path === '/knowledge/search') {
      const query = String(body.query || '').toLowerCase();
      const words = query.split(/[^a-zà-ÿ0-9]+/i).filter((w) => w.length >= 4);
      const topK = Math.min(Math.max(Number(body.topK) || 2, 1), 5);
      const scored = db.docs
        .map((d) => {
          const hay = `${d.title} ${d.content}`.toLowerCase();
          const score = words.reduce((acc, w) => acc + (hay.split(w).length - 1), 0);
          return { d, score };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => ({
          docId: s.d.id,
          title: s.d.title,
          chunk: s.d.content.slice(0, 800),
          score: s.score,
        }));
      return json(route, 200, { ok: true, results: scored });
    }
    {
      const m = path.match(/^\/knowledge\/([^/]+)$/);
      if (m && method === 'DELETE') {
        const id = decodeURIComponent(m[1]);
        db.docs = db.docs.filter((d) => d.id !== id);
        return json(route, 200, { ok: true });
      }
    }

    // ---- Conversations ----
    if (method === 'GET' && path === '/conversations') {
      return json(route, 200, { ok: true, sessions: db.sessions.map(stripMessages) });
    }
    if (method === 'POST' && path === '/conversations') {
      const s: FakeSession = {
        id: `session-e2e-${++db.sessionSeq}`,
        title: String(body.title || 'Session'),
        category: String(body.category || 'Général'),
        lastMessage: '',
        lastMessageTime: isoNow(),
        createdAt: isoNow(),
        messages: [],
      };
      db.sessions.unshift(s);
      return json(route, 200, { ok: true, session: stripMessages(s) });
    }
    {
      const m = path.match(/^\/conversations\/([^/]+)\/messages$/);
      if (m) {
        const s = db.sessions.find((x) => x.id === decodeURIComponent(m[1]));
        if (!s) return json(route, 404, { ok: false, error: 'session introuvable' });
        if (method === 'GET') return json(route, 200, { ok: true, messages: s.messages });
        if (method === 'POST') {
          const msg = body.message || {};
          const saved: FakeMessage = {
            id: `msg-e2e-${++db.msgSeq}`,
            sender: msg.sender || 'user',
            senderName: msg.senderName || 'Vous',
            content: String(msg.content || ''),
            timestamp: isoNow(),
            ...(msg.agentName ? { agentName: String(msg.agentName) } : {}),
          };
          s.messages.push(saved);
          s.lastMessage = saved.content.slice(0, 80);
          s.lastMessageTime = saved.timestamp;
          return json(route, 200, { ok: true, message: saved });
        }
      }
    }
    {
      const m = path.match(/^\/conversations\/([^/]+)$/);
      if (m && (method === 'PUT' || method === 'DELETE')) {
        const s = db.sessions.find((x) => x.id === decodeURIComponent(m[1]));
        if (!s) return json(route, 404, { ok: false, error: 'session introuvable' });
        if (method === 'PUT') {
          if (typeof body.title === 'string') s.title = body.title;
          return json(route, 200, { ok: true });
        }
        db.sessions = db.sessions.filter((x) => x !== s);
        return json(route, 200, { ok: true });
      }
    }

    // ---- Intégrations ----
    if (method === 'GET' && path === '/integrations') {
      return json(route, 200, { ok: true, integrations: db.integrations });
    }
    {
      const m = path.match(/^\/integrations\/([^/]+)$/);
      if (m && method === 'PUT') {
        const id = decodeURIComponent(m[1]);
        const idx = db.integrations.findIndex((i) => i.id === id);
        const merged = { ...(idx >= 0 ? db.integrations[idx] : { id }), ...body, id };
        if (idx >= 0) db.integrations[idx] = merged;
        else db.integrations.push(merged);
        return json(route, 200, { ok: true, integration: merged });
      }
    }

    // ---- Chat LLM (dispatcher classification / écho) ----
    if (method === 'POST' && path === '/chat') {
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system = String(messages.find((mm: any) => mm?.role === 'system')?.content || '');
      const user = String([...messages].reverse().find((mm: any) => mm?.role === 'user')?.content || '');
      db.chatCalls.push({ system, user });
      return json(route, 200, { reply: fakeChatReply(body) });
    }

    // Route inconnue : 404 explicite pour détecter les trous du mock.
    return json(route, 404, { error: `fake-backend: ${method} ${path} non mocké` });
  });
}

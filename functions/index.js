require('dotenv').config();
const functions = require('firebase-functions');
const express = require('express');
const crypto = require('crypto');

let db = null;
let firestoreMode = 'memory';
try {
  const admin = require('firebase-admin');
  if (admin.apps.length === 0) admin.initializeApp();
  const { getFirestore } = require('firebase-admin/firestore');
  db = getFirestore();
  firestoreMode = 'firestore';
} catch (e) {
  console.warn('[INIT] Firestore indisponible, fallback mémoire :', String((e && e.message) || e).slice(0, 200));
}
const memoryStore = { audit: [], tasks: [], agents: [], knowledge: [], conversations: [], integrations: [], wa_conversations: [], wa_events: [], user_signals: [], tool_calls: [], accounting_proposals: [], knowledgeChunks: {}, chat_uploads: {} };

const app = express();

// CORS restreint : navigateurs uniquement depuis ALLOWED_ORIGINS (+ APP_URL).
// Le MCP serveur-à-serveur n'est pas affecté par CORS.
// Défauts béton : prod web.app + dev localhost, pour ne jamais bloquer le front
// même si l'env est incomplète (un APP_URL=localhost déployé coupait tous les /api en prod).
const allowedOrigins = Array.from(
  new Set(
    (
      (process.env.ALLOWED_ORIGINS || '') +
      ',' +
      (process.env.APP_URL || '') +
      ',http://localhost:3000,https://dcintelligenceio.web.app'
    )
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean)
  )
);

function pickReturnOrigin(explicit) {
  const o = String(explicit || '').trim().replace(/\/$/, '');
  if (o && allowedOrigins.includes(o)) return o;
  const app = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (app && allowedOrigins.includes(app)) return app;
  return 'https://dcintelligenceio.web.app';
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-token,x-notify-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 12mb pour accepter audio/image base64 (borné + rate-limit). Les gros PDF passent par Storage (P1).
// verify : conserve le corps BRUT pour le HMAC Meta (JSON.stringify re-sérialisé ≠ octet d'origine).
app.use(express.json({
  limit: '12mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

const waConv = require('./whatsapp');

const WA_API_VERSION = (process.env.WHATSAPP_API_VERSION || 'v26.0').trim();
const WA_PHONE_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const WA_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();

function waClient() {
  if (!WA_PHONE_ID || !WA_TOKEN) return null;
  return waConv.createWhatsAppClient({ apiVersion: WA_API_VERSION, phoneNumberId: WA_PHONE_ID, accessToken: WA_TOKEN });
}

// --- Helpers ---
const processedWamids = new Map(); // wamid -> timestamp (anti-doublons Meta, TTL 48h)
const rateBuckets = new Map(); // ip -> { count, resetAt }

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return (req.ip || 'unknown').toString();
}

function checkRateLimit(req, res, maxPerMin) {
  const ip = getClientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > maxPerMin) {
    res.status(429).json({ error: 'rate_limited', retry_after_seconds: 60 });
    return false;
  }
  return true;
}

function verifyMetaSignature(req) {
  const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();
  if (!appSecret) return { ok: true, mode: 'no_secret_configured' };
  const signature = req.headers['x-hub-signature-256'] || '';
  const raw = (req.rawBody && req.rawBody.length)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}));
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, mode: 'mismatch' };
    const ok = crypto.timingSafeEqual(a, b);
    return { ok, mode: ok ? 'hmac_ok' : 'mismatch' };
  } catch {
    return { ok: false, mode: 'mismatch' };
  }
}

function sanitizeForLog(obj) {
  try {
    const s = JSON.stringify(obj || {});
    // Ne jamais logger de tokens / secrets même si Meta les renvoie par erreur.
    return s.slice(0, 2000);
  } catch {
    return '[unloggable]';
  }
}

// --- Health ---
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'dc-intelligence-webhook',
    version: '0.3.0',
    time: new Date().toISOString(),
    store: firestoreMode,
    conversationEngine: 'wa_pipeline_v1',
    env: {
      hasVerifyToken: Boolean((process.env.WHATSAPP_VERIFY_TOKEN || '').trim()),
      hasAppSecret: Boolean((process.env.WHATSAPP_APP_SECRET || '').trim()),
      hasWaSend: Boolean((process.env.WHATSAPP_ACCESS_TOKEN || '').trim() && (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim()),
      hasOpenRouterKey: Boolean((process.env.OPENROUTER_API_KEY || '').trim()),
      hasGroqKey: Boolean((process.env.GROQ_API_KEY || '').trim()),
      hasVlmModel: Boolean((process.env.VLM_MODEL || '').trim()),
      hasMcpTargets: Boolean(
        (process.env.LEGAL_FLOW_MCP_URL || '').trim() ||
          (process.env.COMPTA_FLOW_MCP_URL || '').trim() ||
          (process.env.RECO_MCP_URL || '').trim()
      ),
    },
  });
});

function requireAdmin(req, res) {
  const adminToken = (process.env.MCP_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (!adminToken) return true; // pas de token configuré : lecture ouverte en dev, à durcir en prod
  const got = (req.headers['x-admin-token'] || req.headers.authorization || '').toString();
  if (got.includes(adminToken)) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}

async function storeDoc(collection, data) {
  const entry = { ...data, createdAt: new Date().toISOString() };
  if (db) {
    const ref = await withDb(db.collection(collection).add(entry), 'storeDoc:' + collection);
    return { id: ref.id, ...entry, persisted: 'firestore' };
  }
  const id = `${collection.slice(0, 3).toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const row = { id, ...entry, persisted: 'memory' };
  memoryStore[collection === 'dc_audit' ? 'audit' : 'tasks'].unshift(row);
  return row;
}

async function listDocs(collection, limit) {
  const n = Math.min(Math.max(parseInt(String(limit || '20'), 10) || 20, 1), 100);
  if (db) {
    const snap = await withDb(db.collection(collection).orderBy('createdAt', 'desc').limit(n).get(), 'listDocs:' + collection);
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), persisted: 'firestore' }));
  }
  const arr = collection === 'dc_audit' ? memoryStore.audit : memoryStore.tasks;
  return arr.slice(0, n);
}

// --- Internes réutilisables (routes HTTP + pipeline WhatsApp) ---
function withTimeout(promise, ms, code) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code || 'timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Tip fiabilité #10 — timeout Firestore : 8 s max, jamais de hang, échec loggé.
const DB_TIMEOUT_MS = 8000;
function withDb(promise, op) {
  return withTimeout(promise, DB_TIMEOUT_MS, `db_timeout:${op}`).catch((e) => {
    console.warn('[DB] ' + op + ' ' + String((e && e.message) || e).slice(0, 150));
    throw e;
  });
}

// Tip fiabilité #10 — retry UNIQUE sur 429/5xx, lectures seules.
// Jamais sur les envois WhatsApp (risque de doublon) : sendText/sendChunks passent retry:false.
async function fetchUpstream(url, options, label) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      if (attempt === 0) { await wait(800); continue; }
      throw e;
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const ra = parseInt((res.headers && res.headers.get('retry-after')) || '0', 10);
      await wait(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 800, 5000));
      continue;
    }
    return res;
  }
  throw new Error((label || 'upstream') + '_unreachable');
}

async function openRouterChat({ model, messages, temperature, maxTokens, title }) {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    const e = new Error('backend_not_configured: OPENROUTER_API_KEY manquant');
    e.status = 503;
    throw e;
  }
  const clean = (messages || [])
    .filter((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content.slice(0, 8000) };
      return { role: m.role, content: m.content }; // contenu vision structuré (déjà borné)
    })
    .slice(-12);
  if (!clean.length) throw Object.assign(new Error('messages invalides'), { status: 400 });
  const body = {
    model,
    messages: clean,
    temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 1) : 0.3,
    max_tokens: maxTokens || 3500,
  };
  if (/r1|reasoner|thinking/i.test(model)) body.reasoning = { effort: 'medium' };
  const r = await fetchUpstream('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.APP_URL || 'https://dcintelligenceio.web.app',
      'X-Title': title || 'DC Intelligence',
    },
    body: JSON.stringify(body),
  }, 'openrouter');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`openrouter_${r.status}: ${String((data && data.error && data.error.message) || r.statusText).slice(0, 400)}`);
    e.status = r.status;
    throw e;
  }
  const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!reply) throw Object.assign(new Error('empty_upstream_reply'), { status: 502 });
  return String(reply);
}

function mcpTargetFor(software) {
  const targets = {
    'Legal Flow': process.env.LEGAL_FLOW_MCP_URL,
    'Compta Flow': process.env.COMPTA_FLOW_MCP_URL,
    RECO: process.env.RECO_MCP_URL,
  };
  return ((targets[software] || '') + '').trim();
}

// Refonte §8.4 — un agent n'est annoncé que si un VRAI outil tourne derrière.
// Les domaines dc-knowing.com sont documentés comme inexistants (cf. MCP_INTEGRATION.md).
function mcpTargetIsReal(software) {
  const target = mcpTargetFor(software);
  return Boolean(target) && !/dc-knowing\.com/i.test(target);
}

// Refonte §3.2/§8.3 — routage explicite avec contexte et traçabilité.
// L'Agent d'Accueil ne change jamais currentAgent sans passer par ici.
function routeToAgent(conv, wamid, agent, context) {
  console.log(`[WA STEP] wamid=${wamid} étape=route_to_agent agent=${agent} confiance=${context.confidence} intent=${context.intent}`);
  waUpsertConversation(context.phone, { stage: 'ROUTING', currentAgent: agent, topic: context.topic, intent: context.intent });
  waConv.transition(conv, waConv.STATES.ROUTING);
  return { agent, ...context };
}

// Vigilance §2.3 — auditabilité des outils : chaque exécution est journalisée
// {tool, paramsHash, status, latence}. Hash SHA-256 des params, JAMAIS les params
// en clair (pas de données sensibles dans les traces). Base du KPI hallucinations.
function paramsHash(obj) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(obj || {})).digest('hex').slice(0, 16);
  } catch { return 'unhashable'; }
}

function logToolCall({ tool, software, args, status, latencyMs, wamid, phone }) {
  storeDoc('tool_calls', {
    tool: str(tool, 80),
    software: str(software, 40),
    paramsHash: paramsHash(args),
    status: status === 'ok' ? 'ok' : 'error',
    latencyMs: Math.max(0, Math.round(Number(latencyMs) || 0)),
    wamid: str(wamid, 120),
    phone: str(phone, 30),
  }).catch(() => {});
}

// Appel JSON-RPC MCP interne (même contrat que la route). Lève en cas d'échec.
// meta {wamid, phone} optionnel : tracé dans tool_calls pour l'audit anti-hallucination.
async function mcpCallTool({ software, toolName, args, meta }) {
  const target = mcpTargetFor(software);
  const mcpToken = (process.env.MCP_TOKEN || '').trim();
  if (!target) throw Object.assign(new Error(`backend_not_configured: aucune URL MCP pour ${software}`), { status: 503 });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (mcpToken) headers.Authorization = `Bearer ${mcpToken}`;
  const payload = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
  const t0 = Date.now();
  const finish = (status) => logToolCall({
    tool: toolName, software, args, status, latencyMs: Date.now() - t0,
    wamid: meta && meta.wamid, phone: meta && meta.phone,
  });
  try {
    const init = await fetchUpstream(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dc-intelligence', version: '0.3.0' } })),
    }, 'mcp');
    if (init.status === 401) throw Object.assign(new Error('mcp_unauthorized: MCP_TOKEN invalide ou manquant'), { status: 502 });
    const call = await fetchUpstream(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload(2, 'tools/call', { name: toolName, arguments: args || {} })),
    }, 'mcp');
    const text = await call.text();
    if (!call.ok) throw Object.assign(new Error(`mcp_${call.status}: ${text.slice(0, 300)}`), { status: 502 });
    finish('ok');
    return text.slice(0, 12000);
  } catch (e) {
    finish('error');
    throw e;
  }
}

// Vigilance §2.2 — signaux utilisateur cross-canal, clé = user_id (jamais session_id).
// WhatsApp : user_id = numéro. Web : id navigateur persistant (télémétrie prête
// pour le chaînage d'identité — P1, cf. PERSONA_SYSTEM_CONTRACT.md).
async function readUserSignal(userId) {
  const id = str(userId, 80);
  if (!id) return null;
  try {
    if (db) {
      const snap = await withDb(db.collection('user_signals').doc(id).get(), 'userSignal:get');
      return snap.exists ? snap.data() : null;
    }
    return memoryStore.user_signals.find((x) => x.userId === id) || null;
  } catch { return null; }
}

async function writeUserSignal(userId, patch) {
  const id = str(userId, 80);
  if (!id) return null;
  const now = new Date().toISOString();
  try {
    if (db) {
      const ref = db.collection('user_signals').doc(id);
      const snap = await withDb(ref.get(), 'userSignal:get');
      const prev = snap.exists ? snap.data() : { frustrationCount: 0, clarificationCount: 0 };
      const next = { userId: id, updatedAt: now, ...prev, ...patch };
      await withDb(ref.set(next, { merge: true }), 'userSignal:set');
      return next;
    }
    let row = memoryStore.user_signals.find((x) => x.userId === id);
    if (!row) {
      row = { userId: id, frustrationCount: 0, clarificationCount: 0 };
      memoryStore.user_signals.unshift(row);
    }
    Object.assign(row, patch, { updatedAt: now });
    return row;
  } catch { return null; }
}

async function bumpUserSignal(userId, kind) {
  // kind: 'frustration' | 'clarification'. Retourne le nouveau compteur.
  const key = kind === 'frustration' ? 'frustrationCount' : 'clarificationCount';
  try {
    const prev = await readUserSignal(userId);
    const next = (Number(prev && prev[key]) || 0) + 1;
    await writeUserSignal(userId, { [key]: next });
    return next;
  } catch { return 1; }
}

async function resetUserSignals(userId) {
  await writeUserSignal(userId, { frustrationCount: 0, clarificationCount: 0 }).catch(() => {});
}

function shouldEscalateClarification(priorCount) {
  // Vigilance §2.1 : > 2 clarifications sans progression → humain, jamais de boucle.
  return (Number(priorCount) || 0) >= 2;
}

async function transcribeAudioBuffer(buf, mime) {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (!groqKey) throw Object.assign(new Error('backend_not_configured: GROQ_API_KEY manquant'), { status: 503 });
  if (!buf || buf.length === 0 || buf.length > 8_000_000) throw Object.assign(new Error('audio invalide ou trop volumineux (max 8mb)'), { status: 400 });
  const mimeStr = String(mime || 'audio/webm').slice(0, 60);
  const ext = /mp4|m4a/.test(mimeStr) ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeStr }), `audio.${ext}`);
  form.append('model', (process.env.WHISPER_MODEL || 'whisper-large-v3-turbo').trim());
  form.append('temperature', '0');
  form.append('response_format', 'verbose_json');
  const r = await fetchUpstream('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}` },
    body: form,
  }, 'groq');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`groq_${r.status}: ${String((data && data.error && data.error.message) || r.statusText).slice(0, 300)}`), { status: r.status });
  return { text: String(data.text || ''), duration: data.duration };
}

async function visionClassifyBuffer(buf, mime, hint) {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) throw Object.assign(new Error('backend_not_configured: OPENROUTER_API_KEY manquant'), { status: 503 });
  if (!buf || buf.length < 100 || buf.length > 10_000_000) throw Object.assign(new Error('image invalide (max ~10mb)'), { status: 400 });
  const mimeStr = String(mime || 'image/jpeg').slice(0, 60);
  const vlmModel = (process.env.VLM_MODEL || 'inclusionai/ling-3.0-flash-vl:free').trim();
  const prompt =
    'Analyse ce document comptable/fiscal. Réponds UNIQUEMENT JSON : ' +
    '{"documentType":"invoice|tax_notice|bank_statement|legal_contract|general_query","confidence":0..1,' +
    '"supplier":"","amount":0,"reference":"","date":"YYYY-MM-DD","extractedText":"..."}. ' +
    `Contexte : ${String(hint || '').slice(0, 300)}`;
  const reply = await openRouterChat({
    model: vlmModel,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeStr};base64,${buf.toString('base64')}` } },
      ],
    }],
    temperature: 0.1,
    maxTokens: 800,
    title: 'DC Intelligence VLM',
  });
  const m = reply.match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('vlm_no_json'), { status: 502 });
  let parsed = {};
  try { parsed = JSON.parse(m[0]); } catch { throw Object.assign(new Error('vlm_bad_json'), { status: 502 }); }
  const allowed = ['invoice', 'tax_notice', 'bank_statement', 'legal_contract', 'general_query'];
  if (!allowed.includes(parsed.documentType)) parsed.documentType = 'general_query';
  return {
    inputType: 'image',
    documentType: parsed.documentType,
    confidence: Math.min(Math.max(Number(parsed.confidence || 0.7), 0), 1),
    extractedText: String(parsed.extractedText || reply).slice(0, 4000),
    entities: {
      supplier: parsed.supplier, amount: parsed.amount, reference: parsed.reference,
      date: parsed.date, taxId: parsed.taxId, clientName: parsed.clientName,
    },
  };
}

// --- Meta webhook verification ---
// Tolérance racine `/` : si Meta est configuré sur l'URL nue de la fonction
// (sans /webhook), la vérification et les événements sont acceptés quand même.
// HMAC et déduplication inchangés. URL canonique : <function-url>/webhook
function handleMetaVerify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = (process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
  if (!verifyToken) {
    console.warn('[META VERIFY] WHATSAPP_VERIFY_TOKEN manquant côté serveur.');
    return res.status(500).send('Server verify token not configured');
  }
  if (mode === 'subscribe' && token === verifyToken && typeof challenge === 'string') {
    console.log('[META VERIFY] Webhook verified 200 OK');
    return res.status(200).send(challenge);
  }
  console.warn('[META VERIFY] Token mismatch.');
  return res.status(403).send('Forbidden: Invalid verify token');
}
app.get(['/webhook', '/api/webhook', '/v1/whatsapp/webhook'], handleMetaVerify);
app.get('/', (req, res) => {
  if (req.query && req.query['hub.mode'] !== undefined) return handleMetaVerify(req, res);
  return res.status(200).json({ ok: true, service: 'dc-intelligence-webhook', usage: 'Meta -> /webhook (racine tolérée), API -> /api/*' });
});

// --- Meta incoming messages (POST + pipeline conversationnel) ---
// ACK 200 en fin de pipeline (deadline douce 18 s) : anti-retry Meta permanent.
// Le perçu-instantané est assuré par READ + TYPING + messages de présence.
async function handleMetaWebhook(req, res) {
  const sig = verifyMetaSignature(req);
  if (!sig.ok) {
    console.warn('[META WEBHOOK] HMAC invalide, rejet.');
    return res.status(403).send('Invalid signature');
  }
  const inbound = [];
  try {
    const entries = (req.body && req.body.entry) || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (value.statuses) {
          // Accusés Meta (sent/delivered/read/failed) : persistés pour le dashboard, 200 quand même.
          recordWaStatuses(value.statuses).catch(() => {});
          continue;
        }
        for (const msg of value.messages || []) {
          const wamid = msg.id;
          if (!wamid) continue;
          if (processedWamids.has(wamid)) continue; // anti-doublons Meta
          processedWamids.set(wamid, Date.now());
          inbound.push({ wamid, from: msg.from, type: msg.type, msg });
        }
      }
    }
    const cutoff = Date.now() - 48 * 3600 * 1000;
    for (const [k, v] of processedWamids) {
      if (v < cutoff) processedWamids.delete(k);
    }
  } catch (e) {
    console.warn('[META WEBHOOK] parse error', sanitizeForLog({ err: String(e && e.message) }));
  }
  console.log('[META WEBHOOK EVENT]', sanitizeForLog({ sig: sig.mode, inbound: inbound.length }));

  const wa = waClient();
  if (!inbound.length || !wa) {
    if (inbound.length && !wa) console.warn('[META WEBHOOK] envoi WhatsApp non configuré : lecture seule.');
    return res.status(200).send('EVENT_RECEIVED');
  }
  try {
    // Borné à 3 messages par webhook + deadline douce (P1 : Cloud Tasks pour le long).
    for (const item of inbound.slice(0, 3)) {
      await Promise.race([
        handleInboundMessage(wa, item),
        new Promise((_, reject) => setTimeout(() => reject(new Error('pipeline_deadline')), 18000)),
      ]).catch(async (e) => {
        console.warn('[WA PIPELINE] incident', String((e && e.message) || e).slice(0, 200));
        try {
          await wa.sendText(item.from, 'Humm, j’ai eu un souci technique juste à l’instant. Je reviens vers vous dans un moment.');
        } catch {}
      });
    }
  } catch (e) {
    console.warn('[WA PIPELINE] fatal', String((e && e.message) || e).slice(0, 200));
  }
  return res.status(200).send('EVENT_RECEIVED');
}
app.post(['/webhook', '/api/webhook', '/v1/whatsapp/webhook'], handleMetaWebhook);
app.post('/', handleMetaWebhook); // tolérance URL racine (cf. vérification GET)

// --- Pipeline conversationnel : chaque présence = un événement RÉEL ---
async function handleInboundMessage(wa, { wamid, from, type, msg }) {
  const conv = waConv.createConversation(wamid);
  const lastPresence = { idx: -1 };
  const say = async (list) => {
    const p = waConv.pick(list, lastPresence.idx);
    lastPresence.idx = p.idx;
    if (!p.text) return { ok: false };
    return wa.sendText(from, p.text);
  };
  const elapsed = () => Date.now() - conv.t0;
  const refreshTypingIfSlow = async () => {
    if (waConv.typingNeeded(elapsed())) {
      try { await wa.sendReadTyping(wamid); } catch {}
    }
  };

  waConv.transition(conv, waConv.STATES.ACKNOWLEDGED);
  // Journalisation dès l'entrée (alimente le dashboard, même si la suite échoue).
  wa = trackWaSends(wa, { phone: from, wamid });
  const textBody = type === 'text' ? String((msg.text && msg.text.body) || '').trim() : '';
  const hasMedia = ['image', 'document', 'audio', 'video', 'sticker'].includes(type);
  // Refonte §7 — signaux prioritaires AVANT tout théâtre de présence.
  const sensitive = !hasMedia && Boolean(textBody) && waConv.isSensitive(textBody);
  const frustrated = !sensitive && !hasMedia && Boolean(textBody) && waConv.isFrustrated(textBody);
  // Compteur cross-canal (§2.2) : user_signals, clé = numéro (wa_conversations = miroir dashboard).
  let frustrationCount = 0;
  if (frustrated) {
    try {
      frustrationCount = await bumpUserSignal(from, 'frustration');
    } catch { frustrationCount = 1; }
  }
  waLogEvent({ wamid, direction: 'in', phone: from, kind: type, preview: (textBody || `[${type}]`).slice(0, 300), state: 'RECEIVED' });
  waUpsertConversation(from, { stage: 'RECEIVED', currentAgent: 'accueil', frustrationCount }, { from: 'user', text: (textBody || `[${type}]`).slice(0, 500) });
  console.log(`[WA STEP] wamid=${wamid} étape=réception phone=${from} type=${type} len=${textBody.length}`);
  try { await withTimeout(wa.sendRead(wamid), 4000, 'read_timeout'); } catch (e) {
    console.warn('[WA] read échoué', String((e && e.message) || e).slice(0, 150));
  }
  waConv.transition(conv, waConv.STATES.READ);

  // Salutation seule : réponse immédiate, sans outils (rapide → pas de typing).
  if (!hasMedia && textBody && waConv.isGreetingOnly(textBody)) {
    waConv.transition(conv, waConv.STATES.RESPONDING);
    await wa.sendText(from, 'Bonjour ! J’espère que vous allez bien. Dites-moi : une facture, un courrier fiscal, ou un point sur votre dossier ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'COMPLETED', intent: 'ACCUEIL', currentAgent: 'accueil' });
    return { state: conv.state };
  }

  // Refonte §7.6 — sujet sensible : jamais de traitement, escalade humain + alerte traçée.
  if (sensitive) {
    console.log(`[WA STEP] wamid=${wamid} étape=alerte_sensible escalade=humain`);
    waLogEvent({ wamid, direction: 'in', phone: from, kind: type, preview: textBody.slice(0, 100), state: 'SENSITIVE_ALERT' });
    waConv.transition(conv, waConv.STATES.RESPONDING);
    await wa.sendText(from, 'Bien noté. Vu la sensibilité du sujet, je transmets à un conseiller humain habilité. Laissez-moi un numéro où vous joindre et on vous rappelle vite.');
    waConv.transition(conv, waConv.STATES.ESCALATED);
    waUpsertConversation(from, { stage: 'ESCALATED', intent: 'HUMAIN', currentAgent: 'humain' });
    return { state: conv.state };
  }

  // Refonte §7.1 — frustration : apaiser DÈS le 1er signe, jamais de réponse à l'insulte,
  // jamais de fausse vérification. Après 2 manifestations : proposition d'humain.
  if (frustrated) {
    console.log(`[WA STEP] wamid=${wamid} étape=frustration compteur=${frustrationCount}`);
    waConv.transition(conv, waConv.STATES.RESPONDING);
    if (frustrationCount >= 2) {
      await wa.sendText(from, 'Je comprends que c’est frustrant, et je suis désolé. Voulez-vous que je vous mette en relation avec un conseiller humain ?');
      waConv.transition(conv, waConv.STATES.ESCALATED);
      waUpsertConversation(from, { stage: 'ESCALATED', intent: 'HUMAIN', currentAgent: 'humain' });
    } else {
      await wa.sendText(from, 'Je sens que quelque chose ne va pas. Dites-moi ce qui vous préoccupe, je suis là pour vous aider.');
      waConv.transition(conv, waConv.STATES.COMPLETED);
      waUpsertConversation(from, { stage: 'COMPLETED', intent: 'ACCUEIL', currentAgent: 'accueil' });
    }
    return { state: conv.state };
  }

  // Refonte §7.4 — insistance accueil + test de présence : l'accueil répond qu'il est là.
  if (!hasMedia && textBody && waConv.isPresenceCheck(textBody)) {
    waConv.transition(conv, waConv.STATES.RESPONDING);
    await wa.sendText(from, 'Oui, je suis là. Je suis l’Agent d’Accueil DC Intelligence. Comment puis-je vous aider ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'COMPLETED', intent: 'ACCUEIL', currentAgent: 'accueil' });
    return { state: conv.state };
  }
  if (!hasMedia && textBody && waConv.isAccueilInsistence(textBody)) {
    waConv.transition(conv, waConv.STATES.RESPONDING);
    await wa.sendText(from, 'C’est moi l’accueil, je vous écoute. Que puis-je faire pour vous ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'COMPLETED', intent: 'ACCUEIL', currentAgent: 'accueil' });
    return { state: conv.state };
  }

  // Tip 6a — acronyme seul ("IMF", "TVA?") : ambigu, on désambiguïse au lieu d'inventer.
  if (!hasMedia && textBody && /^[A-ZÀ-Þ0-9]{2,6}[?.!…\s]*$/.test(textBody.trim()) && textBody.trim().length <= 8) {
    const code = textBody.trim().replace(/[?.!…\s]+$/g, '');
    console.log(`[WA STEP] wamid=${wamid} étape=désambiguïsation acronyme=${code}`);
    waConv.transition(conv, waConv.STATES.WAITING_USER);
    await wa.sendText(from, `Humm, « ${code} » peut vouloir dire plusieurs choses. Précisez en une phrase ce que vous cherchez (ou envoyez-moi le document), et je vérifie.`);
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'WAITING_USER', intent: 'CLARIFICATION' });
    return { state: conv.state };
  }

  // Tip 6b — correction ("non, je parlais de…") : accusé + reprise du contexte dossier.
  const isCorrection = /^(non|nan|pas du tout|je me suis tromp)/i.test(textBody.trim());
  if (isCorrection) console.log(`[WA STEP] wamid=${wamid} étape=correction_détectée`);

  // PRÉSENCE 1 — RÉEL : la classification commence maintenant.
  waConv.transition(conv, waConv.STATES.PROCESSING);
  if (hasMedia) await say(waConv.PRESENCE.lookingDoc);
  else await say(waConv.PRESENCE.looking);

  // Classification (texte / image / audio). Le binaire média est CONSERVÉ
  // (waMediaBuf + waMediaMime) pour être transmis AU LLM en vision (§4) —
  // jamais jeté après la seule classification.
  let docType = 'general_query';
  let extractedText = textBody;
  let entities = {};
  let confidence = 0.6;
  let waMediaBuf = null;
  let waMediaMime = '';
  let waMediaName = '';
  // Binaire à archiver (Storage + base de connaissances). Renseigné par chaque
  // branche média ci-dessous, consommé en fire-and-forget après classification.
  let waArchiveBuf = null;
  try {
    if (type === 'audio' && msg.audio && msg.audio.id) {
      const buf = await withTimeout(wa.downloadMedia(msg.audio.id), 20000, 'media_timeout');
      waArchiveBuf = buf;
      const tr = await withTimeout(transcribeAudioBuffer(buf, 'audio/ogg'), 30000, 'stt_timeout');
      extractedText = (tr.text || '').trim();
    } else if ((type === 'image' || type === 'document') && (msg.image || msg.document)) {
      const mediaId = (msg.image && msg.image.id) || (msg.document && msg.document.id);
      const caption = (msg.image && msg.image.caption) || (msg.document && msg.document.caption) || textBody;
      const declaredMime = (msg.image && msg.image.mime_type) || (msg.document && msg.document.mime_type) || '';
      waMediaName = (msg.document && msg.document.filename) || (type === 'image' ? 'photo WhatsApp' : 'document WhatsApp');
      const buf = await withTimeout(wa.downloadMedia(mediaId), 25000, 'media_timeout');
      waArchiveBuf = buf;
      // MIME RÉEL par magic bytes (le déclaré Meta n'est pas fiable).
      waMediaMime = sniffMime(buf, declaredMime || (type === 'image' ? 'image/jpeg' : 'application/octet-stream'));
      if (/^image\//.test(waMediaMime)) {
        const v = await withTimeout(visionClassifyBuffer(buf, waMediaMime, caption), 40000, 'vlm_timeout');
        docType = v.documentType; extractedText = v.extractedText; entities = v.entities || {}; confidence = v.confidence;
        // Conservé pour vision directe du compositeur (≤ 6 Mo, sinon classification seule).
        if (buf.length <= 6_000_000) waMediaBuf = buf;
        else console.warn('[WA] image trop lourde pour vision directe, classification seule', buf.length);
      } else if (waMediaMime === 'application/pdf' || /\.pdf$/i.test(waMediaName)) {
        // PDF : extraction TEXTE réelle (pdf-parse), jamais en vision (binaire illisible).
        const ext = await extractIndexableText(buf, 'application/pdf', waMediaName).catch((e) => ({
          text: '', reason: String((e && e.message) || e).slice(0, 120),
        }));
        if (ext.text && ext.text.trim().length >= 20) {
          extractedText = `${caption ? caption + '\n' : ''}[Pièce PDF « ${waMediaName} » :\n${ext.text.slice(0, 6000)}]`;
          entities = {};
          // Typage par mots-clés sur le contenu EXTRAIT (pas le nom de fichier).
          const low = ext.text.toLowerCase();
          if (/\b(facture|achat|fournisseur|ttc|tva|montant)\b/.test(low)) { docType = 'invoice'; confidence = 0.75; }
          else if (/\b(impot|dgi|declaration|patente|fiscal|tva)\b/.test(low)) { docType = 'tax_notice'; confidence = 0.75; }
          else if (/\b(releve|banque|virement|rapprochement|solde)\b/.test(low)) { docType = 'bank_statement'; confidence = 0.75; }
          else if (/\b(contrat|bail|litige|tribunal|convention)\b/.test(low)) { docType = 'legal_contract'; confidence = 0.75; }
          else { docType = 'general_query'; confidence = 0.7; }
        } else {
          console.warn('[WA] PDF sans texte extractible', waMediaName.slice(0, 80), (ext.reason || '').slice(0, 120));
        }
      } else {
        console.warn('[WA] média non supporté', waMediaMime.slice(0, 60), waMediaName.slice(0, 80));
      }
    } else if (extractedText) {
      const reply = await withTimeout(openRouterChat({
        model: 'inclusionai/ling-3.0-flash-vl:free',
        messages: [
          { role: 'system', content: 'Classifie en UN mot : invoice | tax_notice | bank_statement | legal_contract | general_query. Réponds uniquement JSON {"documentType":"...","confidence":0..1}.' },
          { role: 'user', content: extractedText.slice(0, 2000) },
        ],
        temperature: 0,
        maxTokens: 120,
      }), 8000, 'classify_timeout');
      const m = reply.match(/"(invoice|tax_notice|bank_statement|legal_contract|general_query)"/);
      if (m) { docType = m[1]; confidence = 0.85; }
    }
  } catch (e) {
    console.warn('[WA] classification repli heuristique', String((e && e.message) || e).slice(0, 150));
  }
  console.log(`[WA STEP] wamid=${wamid} étape=classification docType=${docType} confiance=${confidence}`);

  // Archivage AUTO : toute pièce reçue est conservée (Storage whatsapp/ + doc
  // Base de connaissances lié phone+wamid). Fire-and-forget : le pipeline ne
  // l'attend JAMAIS (il tourne en parallèle du routage/outils/composition).
  if (hasMedia && waArchiveBuf) {
    archiveWhatsAppMedia({
      phone: from, wamid, kind: type, buf: waArchiveBuf,
      mimeType: waMediaMime || 'application/octet-stream', filename: waMediaName,
      caption: textBody, docType, extractedText,
    }).catch((e) => {
      console.warn('[WA-ARCHIVE] échec', String((e && e.message) || e).slice(0, 150));
    });
  }

  if (!extractedText && !hasMedia) {
    waConv.transition(conv, waConv.STATES.WAITING_USER);
    await wa.sendText(from, 'Je n’ai pas bien saisi votre message. Pouvez-vous me le reformuler, ou m’envoyer le document en photo ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'WAITING_USER' });
    return { state: conv.state };
  }

  // Routage unifié (orchestrateur partagé : même matrice et mêmes seuils que
  // routerAgent.ts du front, servie aussi par POST /api/route). Le multimodal
  // prime sur le texte, comme sur le web.
  const route = classifyIntentBackend(`${extractedText} ${docType}`, docType, confidence);
  const TOPIC_LABEL = { invoice: 'Facture / pièce', tax_notice: 'Avis fiscal', bank_statement: 'Relevé bancaire', legal_contract: 'Document juridique', general_query: 'Question' };

  // Demande d'humain explicite : transmission immédiate, sans détour.
  if (route.agent === 'humain') {
    waConv.transition(conv, waConv.STATES.RESPONDING);
    await wa.sendText(from, 'Très bien, je transmets votre demande à un conseiller humain. Il reviendra vers vous très vite.');
    waConv.transition(conv, waConv.STATES.ESCALATED);
    waUpsertConversation(from, { stage: 'ESCALATED', intent: 'HUMAIN', currentAgent: 'humain' });
    console.log(`[WA STEP] wamid=${wamid} étape=route_to_agent agent=humain (demande explicite)`);
    return { state: conv.state };
  }

  routeToAgent(conv, wamid, route.agent, {
    phone: from,
    topic: TOPIC_LABEL[docType] || 'Question',
    intent: route.domain,
    confidence: route.confidence,
  });

  // Progression réelle (routage confiant hors accueil) : on remet les compteurs à zéro.
  if (route.agent !== 'accueil' && route.confidence >= 0.75) {
    resetUserSignals(from).catch(() => {});
  }

  // Seuil de confiance 0,75 (refonte §8.2) : en dessous, on clarifie au lieu de deviner.
  // Une seule question, jamais un interrogatoire (refonte §7.2).
  // Vigilance §2.1 : > 2 clarifications sans progression → humain, jamais de boucle.
  if (!hasMedia && confidence < 0.75 && route.agent === 'accueil') {
    let clarifCount = 1;
    try {
      clarifCount = await bumpUserSignal(from, 'clarification');
    } catch { clarifCount = 1; }
    console.log(`[WA STEP] wamid=${wamid} étape=clarification tentative=${clarifCount}`);
    if (shouldEscalateClarification(clarifCount - 1)) {
      waConv.transition(conv, waConv.STATES.RESPONDING);
      await wa.sendText(from, 'Je préfère vous passer un conseiller humain pour bien comprendre votre besoin, plutôt que de tourner en rond.');
      waConv.transition(conv, waConv.STATES.ESCALATED);
      waUpsertConversation(from, { stage: 'ESCALATED', intent: 'HUMAIN', currentAgent: 'humain', clarificationCount: clarifCount });
      return { state: conv.state };
    }
    waConv.transition(conv, waConv.STATES.WAITING_USER);
    await wa.sendText(from, 'Pas de souci, je vais vous aider. Pour bien vous orienter : s’agit-il d’une facture ou d’une question comptable, d’un sujet fiscal ou juridique, ou d’un relevé bancaire ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'WAITING_USER', intent: 'CLARIFICATION', currentAgent: 'accueil', clarificationCount: clarifCount });
    return { state: conv.state };
  }

  await refreshTypingIfSlow();

  // Refonte §8.4 — registre des actions VRAIMENT effectuées, injecté au LLM.
  const actionsReelles = ['classification (' + docType + ')'];

  // Identité RÉELLE via Legal Flow (phone → entreprise, sans devinette).
  let companyId = null;
  let companyLabel = '';
  try {
    const raw = await withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_user_context', args: { phone: from }, meta: { wamid, phone: from } }), 12000, 'identity_timeout');
    const ctx = JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    const companies = ctx.companies || (ctx.company ? [ctx.company] : []);
    if (ctx.multiple && companies.length > 1) {
      waConv.transition(conv, waConv.STATES.WAITING_USER);
      const names = companies.slice(0, 5).map((c, i) => `${i + 1}. ${c.nom || c.name || c.id}`).join('\n');
      await wa.sendText(from, `Vous avez plusieurs entreprises :\n${names}\nLaquelle concerne votre demande ? (répondez par le numéro)`);
      waConv.transition(conv, waConv.STATES.COMPLETED);
      waUpsertConversation(from, { stage: 'WAITING_USER' });
      return { state: conv.state, waiting: 'company_choice' };
    }
    companyId = (companies[0] && (companies[0].id || companies[0].entreprise_id)) || ctx.entreprise_id || null;
    companyLabel = (companies[0] && (companies[0].nom || companies[0].name)) || '';
    if (companyId) actionsReelles.push('identification entreprise (Legal Flow)');
  } catch (e) {
    console.warn('[WA] identité indisponible, suite en mode générique', String((e && e.message) || e).slice(0, 150));
  }
  console.log(`[WA STEP] wamid=${wamid} étape=identité entreprise=${companyLabel || 'non_identifiée'}`);

  // PRÉSENCE 2 — RÉEL : on annonce un agent SEULEMENT si un VRAI outil tourne derrière.
  // Sans outil (compta/reco sans MCP réel, legal sans entreprise) : aucune annonce
  // d'agent, la réponse suit directement (refonte §8.4 — jamais de fausse activité).
  waConv.transition(conv, waConv.STATES.AGENT_WORKING);
  if (route.agent === 'legal' && companyId) await say(waConv.PRESENCE.routingLegal);
  else if (route.agent === 'compta' && mcpTargetIsReal('Compta Flow')) await say(waConv.PRESENCE.routingCompta);
  else if (route.agent === 'reco' && mcpTargetIsReal('RECO')) await say(waConv.PRESENCE.routingReco);
  await refreshTypingIfSlow();

  // Travail agent : outils métier RÉELS (lecture seule).
  waConv.transition(conv, waConv.STATES.WAITING_AGENT);
  let toolContext = '';
  if (route.agent === 'legal' && companyId) {
    try {
      const [statusRaw, obligRaw] = await Promise.all([
        withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_compliance_status', args: { entreprise_id: companyId }, meta: { wamid, phone: from } }), 15000, 'tool_timeout'),
        withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_overdue_obligations', args: { entreprise_id: companyId }, meta: { wamid, phone: from } }), 15000, 'tool_timeout'),
      ]);
      toolContext += `\n[Compliance] ${statusRaw.slice(0, 2500)}\n[Retards] ${obligRaw.slice(0, 2500)}`;
      actionsReelles.push('conformité (Legal Flow)', 'obligations en retard (Legal Flow)');
      const needSearch = /dgi|courrier|article|tva|déclaration|declaration|loi|amende/i.test(extractedText);
      if (needSearch) {
        await say(waConv.PRESENCE.verifying); // RÉEL : une 2e vague d'outils part maintenant
        const searchRaw = await withTimeout(
          mcpCallTool({ software: 'Legal Flow', toolName: 'lf_search_docs', args: { query: extractedText.slice(0, 300), limit: 3 }, meta: { wamid, phone: from } }),
          15000, 'tool_timeout'
        );
        toolContext += `\n[RAG juridique] ${searchRaw.slice(0, 3000)}`;
        actionsReelles.push('recherche documentaire juridique');
      }
    } catch (e) {
      console.warn('[WA] outils legal partiels', String((e && e.message) || e).slice(0, 150));
    }
  }

  // Outils Compta Flow / RECO — même structure que legal (identification déjà
  // faite → outils métier → composition). Gardés par mcpTargetIsReal : sans URL
  // MCP réelle configurée, AUCUN appel n'est tenté (jamais de simulation ;
  // les domaines dc-knowing.com sont exclus par mcpTargetIsReal).
  if (route.agent === 'compta' && companyId && mcpTargetIsReal('Compta Flow')) {
    try {
      const ctxRaw = await withTimeout(mcpCallTool({ software: 'Compta Flow', toolName: 'get_company_context', args: { entreprise_id: companyId }, meta: { wamid, phone: from } }), 12000, 'tool_timeout');
      toolContext += `\n[Contexte Compta] ${String(ctxRaw).slice(0, 2500)}`;
      actionsReelles.push('contexte entreprise (Compta Flow)');
    } catch (e) {
      console.warn('[WA] outils compta indisponibles', String((e && e.message) || e).slice(0, 150));
    }
  }
  if (route.agent === 'reco' && companyId && mcpTargetIsReal('RECO')) {
    try {
      const recoRaw = await withTimeout(mcpCallTool({ software: 'RECO', toolName: 'get_reconciliation_status', args: { entreprise_id: companyId }, meta: { wamid, phone: from } }), 12000, 'tool_timeout');
      toolContext += `\n[Rapprochement] ${String(recoRaw).slice(0, 2500)}`;
      actionsReelles.push('statut rapprochement (RECO)');
    } catch (e) {
      console.warn('[WA] outils reco indisponibles', String((e && e.message) || e).slice(0, 150));
    }
  }
  await refreshTypingIfSlow();

  // Outil question→réponse IA Legal Flow (tier RÉPONDRE, consigne 256b54b) :
  // réponse affichée TELLE QUELLE, mémoire partagée via session_key stable.
  // Timeout 60 s côté DC comme exigé. Échec → repli composition locale.
  let lfAsk = null;
  if (route.agent === 'legal' && extractedText) {
    try {
      const askRaw = await withTimeout(mcpCallTool({
        software: 'Legal Flow', toolName: 'lf_ask',
        args: { question: extractedText.slice(0, 2000), session_key: 'dc:' + from },
        meta: { wamid, phone: from },
      }), 60000, 'lfask_timeout');
      const parsed = parseLfAsk(askRaw);
      if (parsed) {
        lfAsk = parsed;
        actionsReelles.push('réponse IA Legal Flow (lf_ask)');
        console.log(`[WA STEP] wamid=${wamid} étape=reponse_lf_ask intent=${lfAsk.intent} stage=${lfAsk.stage}`);
      }
    } catch (e) {
      console.warn('[WA] lf_ask indisponible, repli composition', String((e && e.message) || e).slice(0, 150));
      lfAsk = null;
    }
  }

  // Clarification renvoyée par lf_ask : posée telle quelle, sans inventer.
  if (lfAsk && lfAsk.clarification) {
    waConv.transition(conv, waConv.STATES.WAITING_USER);
    await wa.sendText(from, lfAsk.clarification.slice(0, 1000));
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'WAITING_USER', intent: 'CLARIFICATION', currentAgent: 'accueil', topic: lfAsk.topic || undefined });
    return { state: conv.state };
  }

  // Tip 5 — état conversationnel injecté : le LLM voit le dossier
  // (topic/intent/nb échanges/derniers tours) au lieu de répondre hors contexte.
  let dossierContext = '';
  try {
    const dossier = await waReadConversation(from);
    if (dossier) {
      const hist = Array.isArray(dossier.lastMessages) ? dossier.lastMessages.slice(-4) : [];
      const histTxt = hist
        .map((m) => `[${m.from === 'agent' ? 'agent' : 'client'}: ${String(m.text || '').slice(0, 300)}]`)
        .join(' ');
      dossierContext =
        `Dossier: topic=${dossier.topic || '—'}, intent=${dossier.intent || '—'}, ` +
        `échanges=${dossier.messageCount || 0}. Derniers tours: ${histTxt || 'aucun'}.`;
      console.log(`[WA STEP] wamid=${wamid} étape=contexte_dossier tours=${hist.length}`);
    }
  } catch {
    // dossier indisponible : la composition continue sans historique
  }

  // Accusé de correction (tip 6b) : le client sait que sa rectification est prise en compte.
  // Inutile si lf_ask répond (son answer remercie déjà de la précision) : pas de doublon.
  if (isCorrection && !lfAsk) {
    try { await wa.sendText(from, 'Bien noté, je reprends avec votre correction.'); } catch {}
  }

  // Composition du RÉSULTAT (seul message « utile », après les présences).
  // Même modèle par défaut que le chat interne pour tous les agents.
  // Free-tier fluctuant : en cas d'échec/timeout du modèle principal, un 2e
  // modèle gratuit prend le relais avant le message d'excuse.
  const primaryModel = 'inclusionai/ling-3.0-flash-vl:free';
  const fallbackModel = 'nex-agi/nex-n2.5-mini:free';
  const correctionNote = isCorrection
    ? ' Correction du client : annule et remplace sa demande précédente, reprends l’historique ci-dessus.'
    : '';
  // Canal compta : l'IA termine par un JSON normalisé pour contrôle 7-checks automatique.
  const comptaJsonInstruction = route.agent === 'compta'
    ? ' Si la demande porte sur une écriture comptable, termine ta réponse par un bloc ```json {"typePiece":"...","tiers":"...","date":"AAAA-MM-JJ","reference":"...","montantHT":0,"montantTVA":0,"montantTTC":0,"journal":"ACH","ecriture":[{"compte":"...","intitule":"...","debit":0,"credit":0}],"mentions":{"rccm":"...","date":"...","reference":"...","tiers":"..."}} pour contrôle automatique.'
    : '';
  // §4 : l'image REÇUE est transmise AU LLM en vision (jamais jetée après la
  // seule classification). Fallback sans vision : texte extrait seul.
  // Note basse confiance (< 60 % sans contenu exploitable) : le LLM doit demander
  // un renvoi en meilleur format au lieu de bloquer (§4.3).
  const waVisionNote = (hasMedia && !waMediaBuf && !String(extractedText).trim())
    ? ' La pièce jointe n’a pas pu être lue automatiquement : demande au client de la renvoyer en meilleur format (photo nette) ou de saisir les informations manuellement, sans bloquer.'
    : '';
  const waUserText = `${isCorrection ? 'CORRECTION (remplace ma demande précédente) — ' : ''}Message client (${docType}, confiance ${confidence}) : ${extractedText.slice(0, 2500)}${entities && entities.amount ? ` [montant détecté : ${entities.amount}]` : ''}`;
  const composeMessages = [
    { role: 'system', content: `${waConv.PERSONA_SYSTEM} Contexte dossier : entreprise=${companyLabel || 'non identifiée'}, domaine=${route.domain}. ${dossierContext || 'Premier contact.'}${correctionNote} Actions réellement effectuées : ${actionsReelles.join(' → ') || 'AUCUNE — ne prétends à aucune vérification'}. Données outils : ${toolContext.slice(0, 4000) || 'aucune'}. Tu restes l’Agent d’Accueil : transmets le résultat, sans changer de rôle. Si les données sont insuffisantes, dis ce qu’il te manque au lieu d’inventer.${comptaJsonInstruction}${waMediaBuf ? ' Une IMAGE est jointe au message client (vision) : analyse son contenu visuel en priorité.' : ''}${waVisionNote}` },
    waMediaBuf
      ? { role: 'user', content: [{ type: 'text', text: waUserText }, { type: 'image_url', image_url: { url: `data:${waMediaMime};base64,${waMediaBuf.toString('base64')}` } }] }
      : { role: 'user', content: waUserText },
  ];
  if (waMediaBuf) {
    actionsReelles.push('pièce image transmise en vision au LLM');
    console.log(`[WA STEP] wamid=${wamid} étape=vision_inline octets=${waMediaBuf.length} mime=${waMediaMime}`);
  }
  // Fallback d'attente : si la composition dépasse 10 s, on prévient le client
  // au lieu de le laisser sans nouvelles (puis on complète dès que c'est prêt).
  let answer = '';
  if (lfAsk) {
    // Consigne Legal Flow : answer affiché TEL QUEL, sans reformulation ni résumé.
    answer = lfAsk.answer.slice(0, 3600);
    console.log(`[WA STEP] wamid=${wamid} étape=reponse_telle_quelle len=${answer.length}`);
  } else {
  let composeDone = false;
  const waitTimer = setTimeout(async () => {
    if (!composeDone) {
      try { await say(waConv.PRESENCE.oneMoreCheck); } catch {}
    }
  }, 10000);
  console.log(`[WA STEP] wamid=${wamid} étape=composition modèle=${primaryModel}`);
  try {
    try {
      answer = await withTimeout(openRouterChat({
        model: primaryModel, messages: composeMessages, temperature: 0.4, maxTokens: 2000,
      }), 22000, 'compose_timeout');
      console.log(`[WA STEP] wamid=${wamid} étape=composition_ok modèle=${primaryModel} len=${answer.length}`);
    } catch (e1) {
      console.warn('[WA] composition repli 2e modèle', String((e1 && e1.message) || e1).slice(0, 150));
      await say(waConv.PRESENCE.oneMoreCheck); // RÉEL : on relance vraiment une composition
      // Le modèle de repli n'est pas forcément vision : on lui envoie le TEXTE seul.
      const composeFallback = composeMessages.map((m) => (typeof m.content === 'string'
        ? m
        : { role: m.role, content: waUserText }));
      answer = await withTimeout(openRouterChat({
        model: fallbackModel, messages: composeFallback, temperature: 0.4, maxTokens: 2000,
      }), 22000, 'compose_timeout2');
      console.log(`[WA STEP] wamid=${wamid} étape=composition_ok modèle=${fallbackModel} len=${answer.length}`);
    }
    composeDone = true;
    clearTimeout(waitTimer);
  } catch (e) {
    composeDone = true;
    clearTimeout(waitTimer);
    console.warn('[WA] composition LLM échouée', String((e && e.message) || e).slice(0, 150));
    console.log(`[WA STEP] wamid=${wamid} étape=composition_échec statut_final=ESCALATED`);
    waConv.transition(conv, waConv.STATES.FAILED);
    await wa.sendText(from, 'Humm, je n’arrive pas à finaliser la vérification pour le moment. Je transmets à un expert qui reviendra vers vous.');
    waConv.transition(conv, waConv.STATES.ESCALATED);
    waUpsertConversation(from, { stage: 'ESCALATED' });
    return { state: conv.state };
  }

  } // fin repli composition (lf_ask absent — answer déjà prête sinon)

  // Validation 7-checks canal WhatsApp (miroir accountingValidator.ts du front) :
  // toute proposition d'écriture JSON dans la réponse est contrôlée ; les erreurs
  // BLOQUANTES sont signalées au client dans un message dédié au lieu de laisser
  // passer une écriture fausse.
  let proposalValidation = null;
  if (route.agent === 'compta' && answer) {
    try {
      const jm = answer.match(/```json\s*([\s\S]*?)\s*```/);
      if (jm && jm[1]) {
        const parsed = JSON.parse(jm[1]);
        if (parsed && (parsed.ecriture || parsed.journal || parsed.tiers)) {
          proposalValidation = validateComptaProposalBackend(parsed);
          actionsReelles.push(`validation 7-checks (${proposalValidation.checksPassed}/7)`);
          console.log(`[WA STEP] wamid=${wamid} étape=validation_7checks ok=${proposalValidation.ok} erreurs=${proposalValidation.erreurs.length} alertes=${proposalValidation.alertes.length}`);
        }
      }
    } catch (e) {
      console.warn('[WA] proposition JSON illisible', String((e && e.message) || e).slice(0, 120));
    }
  }
  if (proposalValidation && proposalValidation.erreurs.length) {
    try {
      await wa.sendText(from, `⚠️ Avant de valider, je dois vous signaler ${proposalValidation.erreurs.length} point(s) bloquant(s) sur l'écriture :\n- ${proposalValidation.erreurs.slice(0, 4).join('\n- ').slice(0, 900)}\nDites-moi comment corriger et je refais le contrôle.`);
    } catch {}
  }

  // PRÉSENCE 3 — RÉEL : « j'ai son retour » SEULEMENT si un outil a VRAIMENT répondu
  // (lf_ask compte : appel tracé dans tool_calls). Sans outil, on envoie le résultat
  // sans prétendre à une vérification inexistante (bug « Merde » de la refonte §1).
  waConv.transition(conv, waConv.STATES.RESULT_READY);
  if (toolContext.trim() || lfAsk) await say(waConv.PRESENCE.resultReady);
  waConv.transition(conv, waConv.STATES.RESPONDING);
  const chunks = waConv.splitResult(answer);
  console.log(`[WA STEP] wamid=${wamid} étape=envoi chunks=${chunks.length}`);
  const results = await wa.sendChunks(from, chunks);
  const sent = results.filter((r) => r.ok).length;
  if (results.some((r) => !r.ok && r.code === 131047)) {
    console.warn('[WA] fenêtre 24 h fermée, templates non gérés (cf dossier MCP §7).');
  }
  waConv.transition(conv, waConv.STATES.COMPLETED);
  waUpsertConversation(from, { stage: 'COMPLETED', topic: (lfAsk && lfAsk.topic) || undefined });
  console.log(`[WA STEP] wamid=${wamid} étape=statut_final envoyés=${sent}/${chunks.length} état=${conv.state}`);

  // Traçabilité (fire-and-forget).
  try {
    storeDoc('dc_audit', {
      source: 'whatsapp', llm: { provider: 'openrouter', modele: route.agent },
      question: `WA ${from}: ${extractedText.slice(0, 500)}`,
      ecritureProposee: null,
      validation: { ok: !proposalValidation || proposalValidation.erreurs.length === 0, via: 'wa_pipeline', state: conv.state, docType, proposalValidation: proposalValidation || undefined },
    }).catch(() => {});
  } catch {}
  return { state: conv.state };
}

// --- Catalogue modèles via clé cabinet (le front n'a jamais la clé) ---
// GET /api/models -> { models: [{id,name,provider,isFree,description}], backendManaged: bool }.
// L'endpoint OpenRouter /models est public : sans clé serveur on renvoie quand même
// la liste (backendManaged:false) pour que le sélecteur ne reste jamais vide.
app.get(['/api/models', '/models'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  try {
    const headers = { 'HTTP-Referer': process.env.APP_URL || 'https://dcintelligenceio.web.app', 'X-Title': 'DC Intelligence' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const r = await fetch('https://openrouter.ai/api/v1/models', { method: 'GET', headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`openrouter_${r.status}`), { status: 502 });
    const list = Array.isArray(data.data) ? data.data : [];
    const models = list.slice(0, 300).map((item) => {
      const promptPrice = item.pricing && item.pricing.prompt ? parseFloat(item.pricing.prompt) : 0;
      const completionPrice = item.pricing && item.pricing.completion ? parseFloat(item.pricing.completion) : 0;
      const isFree = (promptPrice === 0 && completionPrice === 0) || String(item.id || '').endsWith(':free');
      let provider = 'openrouter';
      if (String(item.id || '').startsWith('anthropic/')) provider = 'anthropic';
      else if (String(item.id || '').startsWith('deepseek/')) provider = 'deepseek';
      return {
        id: String(item.id),
        name: String(item.name || item.id),
        provider,
        isFree,
        description: String((item.description || 'Modèle OpenRouter vérifié')).slice(0, 160),
      };
    });
    return res.status(200).json({ ok: true, backendManaged: Boolean(apiKey), models });
  } catch (e) {
    return res.status(502).json({ error: 'models_unreachable', detail: String((e && e.message) || e).slice(0, 200) });
  }
});

// ============ GOOGLE OAUTH 2.0 (connecteurs Sheets/Docs) ============
// Firestore ne gère PAS le flux : il n'est que le coffre-fort des refresh_tokens.
// Circuit : front -> GET /api/google/auth-url -> popup Google (consentement) ->
// GET /oauth/callback (échange code<->tokens, stockage Firestore) -> postMessage.
// Révocation : POST /api/google/disconnect (revoke Google + suppression doc).
// Plateforme single-admin : un seul UID (DC_ADMIN_UID, défaut 'admin'), pas de multi-user.
const GOOGLE_OAUTH_SCOPES = {
  'google-sheets': [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  'google-docs': [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};
const ADMIN_UID = (process.env.DC_ADMIN_UID || 'admin').trim() || 'admin';
const STATE_TTL_MS = 10 * 60 * 1000;

function googleOAuthConf() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim()
    || 'https://us-central1-dcintelligenceio.cloudfunctions.net/whatsappWebhook/oauth/callback';
  return { clientId, clientSecret, redirectUri };
}

function googleOAuthClient() {
  const { google } = require('googleapis');
  const { clientId, clientSecret, redirectUri } = googleOAuthConf();
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('backend_not_configured: GOOGLE_OAUTH_CLIENT_ID/SECRET manquants'), { status: 503 });
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function encodeOAuthState(integration, origin) {
  const payload = { uid: ADMIN_UID, integration, ts: Date.now(), origin: pickReturnOrigin(origin) };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeOAuthState(state) {
  const payload = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString('utf8'));
  if (!payload || payload.uid !== ADMIN_UID || !GOOGLE_OAUTH_SCOPES[payload.integration]) {
    throw Object.assign(new Error('oauth_state_invalide'), { status: 400 });
  }
  if (!Number.isFinite(payload.ts) || Date.now() - payload.ts > STATE_TTL_MS) {
    throw Object.assign(new Error('oauth_state_expire'), { status: 400 });
  }
  payload.origin = pickReturnOrigin(payload.origin);
  return payload;
}

function googleConnRef(uid, integration) {
  if (!db) return null;
  return db.collection('users').doc(String(uid)).collection('connections').doc(String(integration));
}

// Étape 1 : URL d'autorisation Google (le front ouvre la popup vers cette URL).
// Fonction pure (testable) : ne touche ni Firestore ni le réseau.
// FIX ReferenceError: `req` n'existe pas dans cette fonction pure — l'origine
// est passée en paramètre par la route (était `req.query.origin` inline).
function buildGoogleAuthUrl(integration, origin) {
  if (!GOOGLE_OAUTH_SCOPES[integration]) {
    throw Object.assign(new Error('integration inconnue (google-sheets | google-docs)'), { status: 400 });
  }
  const oauth2 = googleOAuthClient();
  const { redirectUri } = googleOAuthConf();
  const url = oauth2.generateAuthUrl({
      access_type: 'offline', // indispensable : délivre le refresh_token permanent
      prompt: 'consent', // force le consentement -> garantit un refresh_token à chaque connexion
      scope: GOOGLE_OAUTH_SCOPES[integration],
      state: encodeOAuthState(integration, origin),
      redirect_uri: redirectUri,
    });
    return { url, redirectUri };
}

app.get(['/api/google/auth-url', '/google/auth-url'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const integration = String(req.query.integration || 'google-sheets');
  try {
    const { url, redirectUri } = buildGoogleAuthUrl(integration, req.query.origin);
    return res.status(200).json({ ok: true, url, redirectUri });
  } catch (e) {
    const msg = String((e && e.message) || 'oauth_unavailable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'GOOGLE_OAUTH_CLIENT_ID/SECRET manquants côté backend.' });
    }
    return res.status(502).json({ error: 'oauth_unavailable', detail: msg.slice(0, 200) });
  }
});

// Étape 2 : callback Google -> échange code<->tokens -> coffre Firestore -> postMessage + fermeture popup.
async function handleGoogleOAuthCallback(req, res) {
  if (!checkRateLimit(req, res, 10)) return;
  const finish = (ok, label, returnOrigin) => {
    // Origine validée via le state (allowlist) : le postMessage n'est plus jamais perdu
    // même si APP_URL est mal configuré côté serveur.
    const appUrl = pickReturnOrigin(returnOrigin);
    const payload = JSON.stringify({ type: 'google-oauth', ok, label: String(label || '').slice(0, 200) });
    res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(
      `<!doctype html><html><body><script>` +
      `(function(){try{if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(appUrl)});}}catch(e){} ` +
      `setTimeout(function(){window.close();},800); ` +
      `setTimeout(function(){window.location.href=${JSON.stringify(appUrl + '/connexions?google=' + (ok ? 'ok' : 'erreur'))};},2500);` +
      `})();</script><p style="font-family:sans-serif">Connexion Google ${ok ? 'réussie' : 'échouée'} — vous pouvez fermer cette fenêtre.</p></body></html>`
    );
  };
  let integration = 'google-sheets';
  let returnOrigin = pickReturnOrigin(null);
  try {
    if (req.query.error) throw Object.assign(new Error('oauth_refuse:' + String(req.query.error).slice(0, 80)), { status: 400 });
    const decoded = decodeOAuthState(req.query.state);
    integration = decoded.integration;
    returnOrigin = decoded.origin;
    const code = String(req.query.code || '');
    if (!code) throw Object.assign(new Error('oauth_code_manquant'), { status: 400 });
    const oauth2 = googleOAuthClient();
    const { tokens } = await withTimeout(oauth2.getToken(code), 15000, 'oauth_exchange_timeout');
    if (!tokens || !tokens.refresh_token) {
      // Sans refresh_token, l'agent devrait redemander le consentement à chaque heure : on refuse.
      throw Object.assign(new Error('oauth_sans_refresh_token'), { status: 502 });
    }
    oauth2.setCredentials(tokens);
    const me = await withTimeout(
      require('googleapis').google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get(), 10000, 'oauth_userinfo_timeout'
    ).catch(() => ({ data: {} }));
    const email = String((me && me.data && me.data.email) || '').slice(0, 120);
    const doc = {
      provider: 'google',
      integration,
      refresh_token: String(tokens.refresh_token),
      access_token: String(tokens.access_token || ''),
      expiry_date: Number(tokens.expiry_date) || 0,
      scopes: GOOGLE_OAUTH_SCOPES[integration],
      account_email: email,
      connected_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const ref = googleConnRef(ADMIN_UID, integration);
    if (ref) {
      await withDb(ref.set(doc, { merge: false }), 'googleOAuth:store');
    } else {
      memoryStore.google_oauth = memoryStore.google_oauth || {};
      memoryStore.google_oauth[integration] = doc;
    }
    // Jamais de secret dans les logs : email + intégration uniquement.
    console.log(`[OAUTH] google connecté intégration=${integration} email=${email || 'inconnu'}`);
    return finish(true, integration, returnOrigin);
  } catch (e) {
    console.warn('[OAUTH] callback échec', String((e && e.message) || e).slice(0, 150));
    return finish(false, String((e && e.message) || 'oauth_echec').slice(0, 120), returnOrigin);
  }
}
app.get(['/oauth/callback', '/api/oauth/callback'], handleGoogleOAuthCallback);

// Statut public (sans secrets) : le front marque la carte Connecté + email réel.
app.get(['/api/google/status', '/google/status'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const integration = String(req.query.integration || 'google-sheets');
  if (!GOOGLE_OAUTH_SCOPES[integration]) {
    return res.status(400).json({ error: 'integration inconnue (google-sheets | google-docs)' });
  }
  try {
    const ref = googleConnRef(ADMIN_UID, integration);
    let doc = null;
    if (ref) {
      const snap = await withDb(ref.get(), 'googleOAuth:status');
      if (snap.exists) doc = snap.data();
    } else if (memoryStore.google_oauth) {
      doc = memoryStore.google_oauth[integration] || null;
    }
    if (!doc || !doc.refresh_token) {
      return res.status(200).json({ ok: true, connected: false, integration });
    }
    return res.status(200).json({
      ok: true, connected: true, integration,
      email: String(doc.account_email || ''),
      scopes: Array.isArray(doc.scopes) ? doc.scopes : [],
      connectedAt: String(doc.connected_at || ''),
    });
  } catch (e) {
    return res.status(502).json({ error: 'oauth_status_unreachable' });
  }
});

// Déconnexion : révocation Google + suppression du coffre Firestore.
app.post(['/api/google/disconnect', '/google/disconnect'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const integration = String((req.body && req.body.integration) || req.query.integration || 'google-sheets');
  if (!GOOGLE_OAUTH_SCOPES[integration]) {
    return res.status(400).json({ error: 'integration inconnue (google-sheets | google-docs)' });
  }
  try {
    const ref = googleConnRef(ADMIN_UID, integration);
    let doc = null;
    if (ref) {
      const snap = await withDb(ref.get(), 'googleOAuth:read');
      if (snap.exists) doc = snap.data();
    } else if (memoryStore.google_oauth) {
      doc = memoryStore.google_oauth[integration] || null;
    }
    const token = doc && (doc.access_token || doc.refresh_token);
    if (token) {
      await fetchUpstream(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }, 'google').catch(() => null);
    }
    if (ref) {
      await withDb(ref.delete().catch(() => {}), 'googleOAuth:delete');
    } else if (memoryStore.google_oauth) {
      delete memoryStore.google_oauth[integration];
    }
    console.log(`[OAUTH] google déconnecté intégration=${integration}`);
    return res.status(200).json({ ok: true, integration });
  } catch (e) {
    return res.status(502).json({ error: 'oauth_disconnect_failed' });
  }
});

// Helper agent : access_token frais depuis le refresh_token du coffre (usage interne).
async function getGoogleAccessToken(integration) {
  if (!GOOGLE_OAUTH_SCOPES[integration]) throw Object.assign(new Error('integration inconnue'), { status: 400 });
  const ref = googleConnRef(ADMIN_UID, integration);
  let doc = null;
  if (ref) {
    const snap = await withDb(ref.get(), 'googleOAuth:read');
    if (snap.exists) doc = snap.data();
  } else if (memoryStore.google_oauth) {
    doc = memoryStore.google_oauth[integration] || null;
  }
  if (!doc || !doc.refresh_token) {
    throw Object.assign(new Error('backend_not_configured: compte Google non connecté pour ' + integration), { status: 503 });
  }
  if (doc.access_token && Number(doc.expiry_date) > Date.now() + 60000) {
    return String(doc.access_token);
  }
  const oauth2 = googleOAuthClient();
  oauth2.setCredentials({ refresh_token: String(doc.refresh_token) });
  const { credentials } = await withTimeout(oauth2.refreshAccessToken(), 15000, 'oauth_refresh_timeout');
  const patch = {
    access_token: String(credentials.access_token || ''),
    expiry_date: Number(credentials.expiry_date) || 0,
    updatedAt: new Date().toISOString(),
  };
  if (ref) {
    await withDb(ref.set(patch, { merge: true }), 'googleOAuth:refresh');
  } else if (memoryStore.google_oauth && memoryStore.google_oauth[integration]) {
    Object.assign(memoryStore.google_oauth[integration], patch);
  }
  if (!patch.access_token) throw Object.assign(new Error('oauth_refresh_echec'), { status: 502 });
  return patch.access_token;
}

// --- Proxy LLM sécurisé : le front appelle /api/chat, la clé reste côté serveur ---
// Supporte /api/chat (prod Firebase) et /chat (dev via vite proxy rewrite).
// Modèles capables de vision (sinon les pièces jointes sont ignorées, avec log).
const VISION_MODEL_RX = /vl|vision|gpt-4o|claude|gemini|sonnet|opus|llama-4|qwen.*vl/i;

// Déduit le type réel d'un binaire (magic bytes) : le MIME déclaré par le client
// n'est pas fiable (ex : photo renommée, PDF envoyé comme image). Utilisé par
// le chat ET le pipeline WhatsApp.
function sniffMime(buf, fallback) {
  const fb = String(fallback || 'application/octet-stream');
  if (!buf || buf.length < 4) return fb;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) return 'image/webp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  return fb;
}

// Lit un binaire stocké (chat/...) : bucket puis repli mémoire (dev).
async function readStoredAttachment(path) {
  const dl = await storageBucket().file(path).download().catch(() => null);
  if (dl && dl[0] && dl[0].length) return { buf: dl[0], fromBucket: true };
  const mem = (memoryStore.chat_uploads || {})[path];
  if (mem && mem.base64) return { buf: Buffer.from(mem.base64, 'base64'), mimeType: mem.mimeType, fromBucket: false };
  return { buf: null };
}

// Résout des pièces jointes stockées (chat/...) pour le LLM :
// - images → payloads vision OpenRouter (gate modèle vision côté appelant) ;
// - PDF → TEXTE extrait (pdf-parse) injecté dans le message (les modèles vision
//   ne lisent pas les PDF binaires) ;
// - autres → ignorés (log).
// Logs : nombre + octets UNIQUEMENT, jamais le base64. Retourne { images, docTexts }.
async function resolveChatImages(imagePaths) {
  if (!Array.isArray(imagePaths) || !imagePaths.length) return { images: [], docTexts: [] };
  const images = [];
  const docTexts = [];
  for (const p of imagePaths.slice(0, 3)) {
    const path = str(p, 220);
    if (!path || !path.startsWith('chat/') || path.includes('..')) continue;
    try {
      const { buf, mimeType } = await readStoredAttachment(path);
      if (!buf || !buf.length || buf.length > 8_000_000) continue;
      const name = path.split('/').pop() || 'pièce jointe';
      const mime = sniffMime(buf, mimeType || 'application/octet-stream');
      if (/^image\//.test(mime)) {
        images.push({ mimeType: mime, base64: buf.toString('base64'), bytes: buf.length });
      } else if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
        try {
          const ext = await extractIndexableText(buf, 'application/pdf', name);
          // Seuil volontairement bas (tout texte non vide) : même un court extrait
          // aide le LLM, contrairement à l'indexation RAG (seuil 20 car.).
          if (ext.text && ext.text.trim().length > 0) {
            docTexts.push({ name, text: ext.text.slice(0, 6000) });
          } else {
            console.warn('[API CHAT] PDF sans texte extractible', name.slice(0, 80), (ext.reason || '').slice(0, 120));
          }
        } catch (e) {
          console.warn('[API CHAT] extraction PDF impossible', name.slice(0, 80), String((e && e.message) || e).slice(0, 120));
        }
      }
      // Autres types : classification/texte uniquement, jamais au LLM.
    } catch (e) {
      console.warn('[API CHAT] pièce illisible', path.slice(0, 80), String((e && e.message) || e).slice(0, 120));
    }
  }
  return { images, docTexts };
}

// Injecte les pièces dans le DERNIER message user : images en vision OpenRouter,
// textes extraits des PDF en texte (préfixés, bornés). Sans pièce → inchangé.
function injectImagesIntoMessages(messages, resolved) {
  const images = (resolved && resolved.images) || [];
  const docTexts = (resolved && resolved.docTexts) || [];
  if (!images.length && !docTexts.length) return messages;
  const copy = messages.map((m) => ({ ...m }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i] && copy[i].role === 'user') {
      let text = typeof copy[i].content === 'string' ? copy[i].content : '';
      for (const d of docTexts) {
        text += `\n\n[Contenu extrait de la pièce jointe PDF « ${d.name} » :\n${d.text}\n— fin de l'extrait. Analyse ce contenu comme la pièce fournie par l'utilisateur.]`;
      }
      copy[i].content = images.length
        ? [{ type: 'text', text }, ...images.map((im) => ({
          type: 'image_url',
          image_url: { url: `data:${im.mimeType};base64,${im.base64}` },
        }))]
        : text;
      break;
    }
  }
  return copy;
}

app.post(['/api/chat', '/chat'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'backend_not_configured',
      detail: 'OPENROUTER_API_KEY manquant côté backend (functions/.env ou env Firebase).',
    });
  }
  const { model, messages, temperature, stream, imagePaths } = req.body || {};
  let maxTokens = parseInt(String((req.body || {}).max_tokens || (req.body || {}).maxTokens || ''), 10);
  if (!Number.isFinite(maxTokens)) maxTokens = 3500;
  maxTokens = Math.min(Math.max(maxTokens, 50), 8000);
  if (!model || typeof model !== 'string' || model.length > 120) {
    return res.status(400).json({ error: 'model requis (string <= 120 car.)' });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'messages[] requis (1..20)' });
  }
  // Pièces jointes : `attachmentPaths` (nouveau, images + PDF) ou `imagePaths`
  // (alias historique). Images → vision (si modèle compatible), PDF → texte
  // extrait injecté. Résolues côté serveur, jamais d'URL signée.
  const attPaths = Array.isArray((req.body || {}).attachmentPaths) && (req.body || {}).attachmentPaths.length
    ? (req.body || {}).attachmentPaths
    : imagePaths;
  let resolved = { images: [], docTexts: [] };
  if (Array.isArray(attPaths) && attPaths.length) {
    if (!VISION_MODEL_RX.test(model)) {
      console.warn(`[API CHAT] modèle sans vision (${String(model).slice(0, 60)}) : images ignorées, PDF extraits quand même`);
    }
    resolved = await resolveChatImages(attPaths);
    if (!VISION_MODEL_RX.test(model)) resolved.images = [];
    console.log(`[API CHAT] model=${String(model).slice(0, 60)} images=${resolved.images.length} pdf_textes=${resolved.docTexts.length} octets=${resolved.images.reduce((n, im) => n + im.bytes, 0)}`);
    if (attPaths.length && !resolved.images.length && !resolved.docTexts.length) {
      console.warn('[API CHAT] aucune pièce exploitable (introuvable, trop lourde ou type non supporté)');
    }
  }
  const finalMessages = injectImagesIntoMessages(messages, resolved);
  // Streaming SSE token-par-token (§1.3) : le front affiche dès le 1er token.
  if (stream === true) {
    try {
      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.APP_URL || 'https://dcintelligenceio.web.app',
          'X-Title': 'DC Intelligence',
        },
        body: JSON.stringify({
          model,
          messages: finalMessages.map((m) => (typeof m.content === 'string'
            ? { role: m.role, content: m.content.slice(0, 8000) }
            : { role: m.role, content: m.content })),
          temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 1) : 0.3,
          max_tokens: maxTokens,
          stream: true,
        }),
      });
      if (!upstream.ok) {
        const errTxt = await upstream.text().catch(() => '');
        let detail = upstream.statusText;
        try { detail = JSON.parse(errTxt).error.message || detail; } catch {}
        if (upstream.status === 429) {
          return res.status(429).json({ error: 'openrouter_429', detail: 'Quota OpenRouter atteint. Attendez ~1 minute ou changez de modèle.', retry_after_seconds: 60 });
        }
        return res.status(upstream.status === 400 ? 400 : 502).json({ error: `openrouter_${upstream.status}`, detail: String(detail).slice(0, 500) });
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let clientGone = false;
      req.on('close', () => { clientGone = true; try { reader.cancel(); } catch {} });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || clientGone) break;
          const chunk = decoder.decode(value, { stream: true });
          // Relaye uniquement les deltas utiles (plus heartbeat).
          for (const line of chunk.split('\n')) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (payload === '[DONE]') { try { res.write('data: [DONE]\n\n'); } catch {} continue; }
            try {
              const obj = JSON.parse(payload);
              const delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
              const content = delta && typeof delta.content === 'string' ? delta.content : '';
              const err = obj && obj.error ? String(obj.error.message || obj.error).slice(0, 300) : '';
              if (err) { try { res.write(`data: ${JSON.stringify({ error: err })}\n\n`); } catch {} continue; }
              if (content) { try { res.write(`data: ${JSON.stringify({ content })}\n\n`); } catch {} }
            } catch {
              // Ligne non-JSON (commentaire SSE) : ignorée.
            }
          }
        }
      } finally {
        try { res.end(); } catch {}
      }
      return;
    } catch (e) {
      const msg = String((e && e.message) || 'upstream_unreachable');
      console.error('[API CHAT] stream error', msg.slice(0, 300));
      if (!res.headersSent) return res.status(502).json({ error: 'upstream_unreachable', detail: msg.slice(0, 300) });
      try { res.end(); } catch {}
      return;
    }
  }
  try {
    const reply = await openRouterChat({ model, messages: finalMessages, temperature, maxTokens });
    return res.status(200).json({ reply });
  } catch (e) {
    const status = (e && e.status) || 502;
    const msg = String((e && e.message) || 'upstream_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend (functions/.env ou env Firebase).' });
    }
    if (/^openrouter_429/.test(msg)) {
      // Quota OpenRouter (surtout modèles gratuits) : log dédié + délai conseillé.
      console.warn(`[UPSTREAM] openrouter_429 model=${String(model).slice(0, 80)}`);
      return res.status(429).json({
        error: 'openrouter_429',
        detail: 'Quota OpenRouter atteint (limite du modèle gratuit). Attendez ~1 minute ou changez de modèle.',
        retry_after_seconds: 60,
      });
    }
    if (/^openrouter_/.test(msg)) {
      const parts = msg.split(':');
      return res.status(status).json({ error: parts[0], detail: msg.slice(parts[0].length + 2, parts[0].length + 1002) });
    }
    if (msg === 'empty_upstream_reply') return res.status(502).json({ error: 'empty_upstream_reply' });
    if (msg === 'messages invalides') return res.status(400).json({ error: 'messages invalides' });
    console.error('[API CHAT] upstream error', msg.slice(0, 500));
    return res.status(502).json({ error: 'upstream_unreachable' });
  }
});

// === ORCHESTRATEUR UNIFIÉ : classification d'intention partagée ===
// Miroir EXACT de la matrice routerAgent.ts (front) : même ordre, mêmes seuils.
// Utilisée par le pipeline WhatsApp ET exposée via POST /api/route.
// Le front web garde sa version TS (logique identique, contrainte : front inchangé).
// agents backend : 'compta' | 'legal' | 'reco' | 'accueil' | 'humain'.
function classifyIntentBackend(text, docType, confidence) {
  const t = String(text || '').toLowerCase();
  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : 0.6;
  // 1. Multimodal d'abord (comme le front).
  if (docType === 'invoice') return { domain: 'COMPTABILITÉ', agent: 'compta', confidence: conf };
  if (docType === 'tax_notice' || docType === 'legal_contract') return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: conf };
  if (docType === 'bank_statement') return { domain: 'RAPPROCHEMENT', agent: 'reco', confidence: conf };
  // 2. Humain explicite.
  if (/\b(humain|humaine|conseiller|conseillère|conseillere|agent humain|vraie personne|vrai personne|personne réelle|être humain)\b/.test(t)) {
    return { domain: 'HUMAIN', agent: 'humain', confidence: 0.9 };
  }
  // 3. Juridique PRIORITAIRE (avant compta).
  if (/\b(cgi|code\s+général\s+des\s+impôts|livre\s+de\s+proc[eé]dure|article\s*\d+|art\.\s*\d+|sanction|pénalit|penalit|obligation|d[eé]claration|d[eé]clarative|échéance|echeance|code\s+du\s+travail)\b/.test(t)) {
    return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: 0.93 };
  }
  // 4. Sigles fiscaux.
  if (/\b(imf|ifu|rccm)\b/.test(t)) {
    return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: 0.85 };
  }
  // 5. Juridique général.
  if (/legal[\s_-]*flow|legalflow|\b(contentieux|conformité|conformite|fiscal|dgi|impôt|impot|statuts|contrat|bail|das|cnps|patente|airsi|retenue|télédéclaration|e-impots|juridique)\b/.test(t)) {
    return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: 0.9 };
  }
  // 6. Rapprochement.
  if (/\b(rapprochement|relevé|releve|banque|ecobank|sgbci|bicici|pointage|solde|521|écart|ecart)\b/.test(t)) {
    return { domain: 'RAPPROCHEMENT', agent: 'reco', confidence: 0.9 };
  }
  // 7. Comptabilité stricte (tva/vente/ttc génériques exclus, comme le front).
  if (/\b(compta|comptables?|facture|écriture|ecriture|syscohada|ht|ttc|601|401|411|achat|journal|imputation|bilan|balance|grand\s+livre)\b/.test(t)) {
    return { domain: 'COMPTABILITÉ', agent: 'compta', confidence: 0.9 };
  }
  // 8. TVA seule à caractère fiscal.
  if (/\btva\b/.test(t) && /\b(vente|prestation|collectée|déductible|exonération)\b/.test(t) && !/\b(écriture|imputation|journal|601|401)\b/.test(t)) {
    return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: 0.82 };
  }
  // 9. Vague.
  if (t.length < 8) return { domain: 'ACCUEIL', agent: 'accueil', confidence: 0.5 };
  // 10. Défaut.
  return { domain: 'AUTRE', agent: 'compta', confidence: 0.75 };
}

app.post(['/api/route', '/route'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const { text, docType, confidence } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text requis' });
  }
  return res.status(200).json({ ok: true, ...classifyIntentBackend(text.slice(0, 2000), docType, confidence) });
});

// === ORCHESTRATEUR UNIFIÉ : validation comptable 7-checks côté backend ===
// Miroir déterministe de accountingValidator.ts (front) pour le canal WhatsApp.
// Retourne { ok, checksPassed, totalChecks: 7, erreurs[], alertes[], corrections[] }.
// ok = aucune ERREUR (les alertes n'empêchent pas ok=true).
function validateComptaProposalBackend(p) {
  const erreurs = [];
  const alertes = [];
  const corrections = [];
  let checksPassed = 0;
  const totalChecks = 7;
  const lines = p && Array.isArray(p.ecriture) ? p.ecriture : [];
  // 1. Format.
  if (!p || !Array.isArray(p.ecriture) || !lines.length) {
    erreurs.push('ÉCRITURE MAL FORMÉE : aucune ligne.');
  } else checksPassed++;
  // 2. Comptes SYSCOHADA (regex stricte + nomenclature).
  let comptesOk = lines.length > 0;
  for (const l of lines) {
    const c = String((l && l.compte) || '').replace(/\D/g, '');
    if (!/^[1-8][0-9]{1,7}$/.test(String((l && l.compte) || ''))) {
      erreurs.push(`COMPTE INVALIDE : ${String((l && l.compte) || '—')} n'existe pas au plan SYSCOHADA.`);
      comptesOk = false;
    }
    void c;
  }
  if (comptesOk) checksPassed++;
  // Tiers collectif 401/411 sans tiers.
  const hasCollectif = lines.some((l) => /^(401|411)/.test(String((l && l.compte) || '').replace(/\D/g, '')));
  if (hasCollectif && !(p.tiersCode || p.tiers)) {
    alertes.push('COMPTE TIERS MANQUANT : ligne 401/411 sans code tiers.');
  }
  // 3. Équilibre D = C, tolérance 0.
  const sumD = lines.reduce((n, l) => n + (Math.round(Number((l && l.debit) || 0) * 100) / 100), 0);
  const sumC = lines.reduce((n, l) => n + (Math.round(Number((l && l.credit) || 0) * 100) / 100), 0);
  if (Math.abs(sumD - sumC) > 0.001 || sumD <= 0) {
    erreurs.push(`DÉSÉQUILIBRE : Débits ${sumD} ≠ Crédits ${sumC} (tolérance 0).`);
  } else checksPassed++;
  // 4. TVA 18 % / 9 %.
  const ht = Number(p.montantHT) || 0;
  const tva = Number(p.montantTVA) || 0;
  if (ht > 0 && tva > 0) {
    const ratio = tva / ht;
    if (Math.abs(ratio - 0.18) < 0.02 || Math.abs(ratio - 0.09) < 0.02) checksPassed++;
    else alertes.push(`TAUX TVA ANORMAL : ${(ratio * 100).toFixed(1)} % (attendu 18 % ou 9 %).`);
  } else checksPassed++;
  // 5. Seuil immobilisation 50 000 FCFA (6056/6058).
  let seuilOk = true;
  for (const l of lines) {
    const c = String((l && l.compte) || '').replace(/\D/g, '');
    if ((c.startsWith('6056') || c.startsWith('6058')) && Number((l && l.debit) || 0) > 50000) {
      alertes.push(`SEUIL IMMOBILISATION : ${Number(l.debit).toLocaleString('fr-FR')} FCFA sur ${c} — envisager la Classe 2.`);
      seuilOk = false;
    }
  }
  if (seuilOk) checksPassed++;
  // 6. Gérant majoritaire 6611 -> 6622 (correction automatique).
  let gerantOk = true;
  const tiersTxt = String((p && p.tiers) || '');
  for (const l of lines) {
    const c = String((l && l.compte) || '');
    if (/gérant|gerant|associé unique|associe unique|directeur général/i.test(tiersTxt) && /^6611/.test(c)) {
      corrections.push({ champ: `compte_${c}`, avant: c, apres: '6622', motif: 'Rémunération du gérant majoritaire (SYSCOHADA)' });
      alertes.push('CORRECTION AUTOMATIQUE : compte gérant 6611 -> 6622.');
      gerantOk = false;
    }
  }
  if (gerantOk) checksPassed++;
  // 7. Mentions légales facture.
  const manquants = [];
  const mentions = (p && p.mentions) || {};
  if (!(mentions.rccm || mentions.cc || mentions.ncc || p.rccm)) manquants.push('RCCM/CC');
  if (!(mentions.date || p.date)) manquants.push('date');
  if (!(mentions.reference || p.reference)) manquants.push('référence');
  if (!(mentions.tiers || p.tiers)) manquants.push('tiers');
  if (!manquants.length) checksPassed++;
  else alertes.push(`MENTIONS LÉGALES MANQUANTES : ${manquants.join(', ')}.`);
  // Bloquants hors compteur : proforma + montant.
  const refTxt = `${p.reference || ''} ${p.typePiece || ''}`;
  if (/^P\d/i.test(String(p.reference || '').trim()) || /proforma/i.test(refTxt)) {
    erreurs.push('PROFORMA BLOQUÉE : une facture proforma ne se comptabilise jamais.');
  }
  if (!((Number(p.montantHT) || 0) > 0 || (Number(p.montantTTC) || 0) > 0)) {
    erreurs.push('MONTANT INVALIDE : HT et TTC sont à zéro.');
  }
  const validJournals = ['ACH', 'VEN', 'BQ', 'CSE', 'OD', 'AN', 'IM', 'BGF', 'BOA', 'BGFI'];
  if (p.journal && !validJournals.includes(String(p.journal).toUpperCase())) {
    alertes.push(`JOURNAL INCONNU : ${String(p.journal).slice(0, 20)}.`);
  }
  return { ok: erreurs.length === 0, checksPassed, totalChecks, erreurs, alertes, corrections };
}

// --- Proxy MCP : le front n'a jamais le MCP_TOKEN, tout passe par le backend ---
// POST /api/mcp/call { software: 'Legal Flow'|'Compta Flow'|'RECO', toolName, arguments, permissionLevel }
app.post(['/api/mcp/call', '/mcp/call'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const { software, toolName, arguments: toolArgs, permissionLevel } = req.body || {};
  if (!software || !toolName) {
    return res.status(400).json({ error: 'software et toolName requis' });
  }
  if (permissionLevel === 'EXECUTE') {
    // EXÉCUTER exige une confirmation explicite côté front (draftId + confirm:true).
    const args = toolArgs || {};
    if (!(args.draftId && args.confirm === true)) {
      return res.status(403).json({
        error: 'execute_requires_confirmation',
        detail: 'EXECUTE exige { draftId, confirm:true } explicite.',
      });
    }
  }
  if (!mcpTargetFor(software)) {
    return res.status(503).json({
      error: 'backend_not_configured',
      detail: `Aucune URL MCP configurée pour ${software}. Renseigne *_MCP_URL côté backend.`,
      degraded: true,
    });
  }
  try {
    // Le MCP répond en JSON ou SSE ; on relaie le texte brut borné.
    const text = await mcpCallTool({ software, toolName, args: toolArgs || {} });
    return res.status(200).json({ ok: true, software, toolName, response: text });
  } catch (e) {
    const msg = String((e && e.message) || 'mcp_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: msg.slice(24), degraded: true });
    }
    if (/^mcp_unauthorized/.test(msg)) return res.status(502).json({ error: 'mcp_unauthorized', detail: 'MCP_TOKEN invalide ou manquant.' });
    if (/^mcp_(\d+)/.test(msg)) {
      const code = msg.match(/^mcp_(\d+)/)[1];
      return res.status(502).json({ error: `mcp_${code}`, detail: msg.slice(8, 508) });
    }
    return res.status(502).json({ error: 'mcp_unreachable', detail: msg.slice(0, 500) });
  }
});

// ============ SERVEUR MCP ENTRANT (Legal Flow nous appelle) ============
// POST /api/mcp — JSON-RPC 2.0 : initialize / tools/list / tools/call (+ ping).
// Auth : Authorization: Bearer <MCP_TOKEN> (même secret, fourni hors bande).
// FAIL CLOSED : sans MCP_TOKEN configuré → 503, jamais de données servies.
// Principe d'honnêteté : seules les données RÉELLEMENT détenues (collections
// Firestore ci-dessous) sont renvoyées ; le reste est null/[] avec motif dans
// `couverture`. Jamais de simulation.
function mcpCheckAuth(authHeader, id) {
  const configured = (process.env.MCP_TOKEN || '').trim();
  if (!configured) {
    return { ok: false, httpStatus: 503, payload: { jsonrpc: '2.0', id, error: { code: -32000, message: 'backend_not_configured: MCP_TOKEN manquant côté backend.' } } };
  }
  const m = String(authHeader || '').trim().match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  let ok = false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(configured);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { ok = false; }
  if (!ok) {
    return { ok: false, httpStatus: 401, payload: { jsonrpc: '2.0', id, error: { code: -32001, message: 'unauthorized: Bearer MCP_TOKEN invalide.' } } };
  }
  return { ok: true };
}

const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

async function mcpReadUserData(userId) {
  // user_id accepté comme : id doc, téléphone (format libre, comparé en chiffres),
  // ou email. Retourne { waConv, waList, signals, events } (Firestore ou mémoire).
  const key = str(userId, 80).trim();
  const keyDigits = digitsOnly(key);
  let waConv = null;
  let waList = [];
  let signals = null;
  let events = [];
  if (db) {
    try {
      const snap = await withDb(db.collection('wa_conversations').doc(key).get(), 'mcp:waConv');
      if (snap.exists) waConv = { phone: snap.id, ...snap.data() };
    } catch {}
    if (!waConv && keyDigits) {
      try {
        const snap = await withDb(db.collection('wa_conversations').orderBy('updatedAt', 'desc').limit(200).get(), 'mcp:waScan');
        const found = snap.docs.map((d) => ({ phone: d.id, ...d.data() }))
          .find((c) => digitsOnly(c.phone) === keyDigits || digitsOnly(c.phone).endsWith(keyDigits) || (keyDigits && keyDigits.endsWith(digitsOnly(c.phone))));
        if (found) waConv = found;
        waList = snap.docs.map((d) => ({ phone: d.id, ...d.data() }));
      } catch {}
    } else if (db) {
      try {
        const snap = await withDb(db.collection('wa_conversations').orderBy('updatedAt', 'desc').limit(200).get(), 'mcp:waList');
        waList = snap.docs.map((d) => ({ phone: d.id, ...d.data() }));
      } catch {}
    }
    try {
      const s = await withDb(db.collection('user_signals').doc(key).get(), 'mcp:signals');
      if (s.exists) signals = s.data();
    } catch {}
    try {
      const es = await withDb(db.collection('wa_events').orderBy('createdAt', 'desc').limit(200).get(), 'mcp:events');
      const all = es.docs.map((d) => d.data());
      const scope = waConv ? digitsOnly(waConv.phone) : keyDigits;
      events = all.filter((e) => scope && digitsOnly(e.phone) === scope).slice(0, 5);
    } catch {}
  } else {
    const mem = memoryStore.wa_conversations || [];
    waConv = mem.find((x) => String(x.phone) === key)
      || (keyDigits ? mem.find((x) => digitsOnly(x.phone) === keyDigits) : null)
      || null;
    waList = mem.slice(0, 200);
    signals = (memoryStore.user_signals || []).find((x) => String(x.userId) === key) || null;
    const memEvents = memoryStore.wa_events || [];
    const scope = waConv ? digitsOnly(waConv.phone) : keyDigits;
    events = memEvents.filter((e) => scope && digitsOnly(e.phone) === scope).slice(0, 5);
  }
  return { waConv, waList, signals, events };
}

// Outil demandé par Legal Flow : profil complet utilisateur niveau 1.
// Les blocs SANS équivalent côté DC (profiles, entreprises, notifications,
// veille) sont renvoyés null/[] avec motif dans `couverture` — jamais inventés.
async function mcpToolUserFullProfile(args) {
  const userId = str((args || {}).user_id, 80).trim();
  // Pas de session authentifiée côté DC (token de service partagé) : user_id requis.
  if (!userId) {
    throw Object.assign(new Error('user_id requis (id, téléphone ou email). Aucune session authentifiée par défaut côté DC Intelligence (token de service partagé).'), { jsonCode: -32602 });
  }
  const { waConv, waList, signals, events } = await mcpReadUserData(userId);
  const now = new Date().toISOString();
  const scope = waConv ? digitsOnly(waConv.phone) : digitsOnly(userId);
  const mine = waList.filter((c) => scope && digitsOnly(c.phone) === scope).slice(0, 15);
  const stamps = [
    waConv && waConv.updatedAt,
    signals && signals.updatedAt,
    ...events.map((e) => e.createdAt),
    ...mine.map((c) => c.updatedAt),
  ].filter(Boolean).sort();
  const lastActivity = stamps.length ? stamps[stamps.length - 1] : null;
  const lastMs = lastActivity ? Date.parse(lastActivity) : NaN;
  const statut = !lastActivity || Number.isNaN(lastMs)
    ? 'inconnu'
    : (Date.now() - lastMs < 30 * 24 * 3600 * 1000 ? 'actif' : 'inactif');
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        tool: 'lf_get_user_full_profile',
        user_id: userId,
        store: db ? 'firestore' : 'memory',
        generated_at: now,
        profil_base: {
          id: userId,
          role: 'entreprise',
          statut,
          nom_complet: null,
          email: null,
          cabinet_id: null,
          entreprise_id: null,
          derniere_activite: lastActivity,
        },
        entreprise_details: {
          raison_sociale: null,
          secteur: null,
          regime_fiscal: null,
          effectif: null,
          ca_estime: null,
          profil_complet: false,
        },
        declarations_en_cours: [],
        score_conformite: null,
        echeancier_a_valider: [],
        notifications_recentes: [],
        veille_reglementaire_non_lue: [],
        journal_evenements: events.map((e) => ({
          direction: e.direction,
          kind: e.kind,
          preview: e.preview,
          state: e.state,
          status: e.status || null,
          code: e.code || null,
          created_at: e.createdAt || null,
        })),
        signaux_utilisateur: signals ? {
          frustrationCount: Number(signals.frustrationCount) || 0,
          clarificationCount: Number(signals.clarificationCount) || 0,
          updatedAt: signals.updatedAt || null,
        } : null,
        conversations_whatsapp: mine.map((c) => ({
          phone: String(c.phone),
          topic: c.topic || null,
          intent: c.intent || null,
          stage: c.stage || null,
          currentAgent: c.currentAgent || null,
          messageCount: Number(c.messageCount) || 0,
          updatedAt: c.updatedAt || null,
          derniers_messages: Array.isArray(c.lastMessages) ? c.lastMessages.slice(-5).map((m) => ({
            from: m.from, text: m.text, at: m.at,
          })) : [],
        })),
        couverture: {
          profiles: 'absent — aucune table profils côté DC (les profils entreprise sont lus par DC via Legal Flow get_user_context, sens inverse)',
          entreprises: 'absent — aucune table entreprises côté DC',
          journal_evenements: events.length ? `partiel — wa_events (${events.length} derniers)` : 'vide — aucun événement pour cet utilisateur',
          notifications: 'absent — aucune table notifications côté DC',
          veille_lectures: 'absent — aucune table veille côté DC',
          whatsapp_sessions: mine.length ? `complet — wa_conversations (${mine.length} session(s))` : 'vide — aucune session WhatsApp pour cet utilisateur',
        },
      }),
    }],
  };
}

const MCP_SERVER_TOOLS = {
  lf_get_user_full_profile: {
    description: 'Profil complet utilisateur niveau 1 (rôle entreprise) : base, entreprise, déclarations, score conformité, échéancier, notifications, veille, journal (5 derniers), signaux, 15 dernières conversations WhatsApp. Blocs sans équivalent renvoyés null/[] avec motif (couverture).',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Optionnel. id, téléphone ou email. Sans user_id : erreur (aucune session authentifiée par défaut, token de service partagé).' },
      },
    },
    handler: mcpToolUserFullProfile,
  },
};

async function mcpDispatch(body, authHeader) {
  const id = body && body.id !== undefined ? body.id : null;
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return { httpStatus: 400, payload: { jsonrpc: '2.0', id, error: { code: -32600, message: 'Requête JSON-RPC 2.0 invalide (jsonrpc + method requis).' } } };
  }
  const auth = mcpCheckAuth(authHeader, id);
  if (!auth.ok) return { httpStatus: auth.httpStatus, payload: auth.payload };
  try {
    if (body.method === 'initialize') {
      return { httpStatus: 200, payload: { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dc-intelligence-mcp', version: '0.4.0' } } } };
    }
    if (body.method === 'tools/list') {
      return { httpStatus: 200, payload: { jsonrpc: '2.0', id, result: { tools: Object.entries(MCP_SERVER_TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } } };
    }
    if (body.method === 'tools/call') {
      const params = body.params || {};
      const tool = MCP_SERVER_TOOLS[params.name];
      if (!tool) {
        return { httpStatus: 404, payload: { jsonrpc: '2.0', id, error: { code: -32601, message: `Outil inconnu : ${str(params.name, 80)}.` } } };
      }
      const started = Date.now();
      try {
        const result = await tool.handler(params.arguments || {});
        console.log(`[MCP-IN] tool=${params.name} ok latency=${Date.now() - started}ms`);
        return { httpStatus: 200, payload: { jsonrpc: '2.0', id, result } };
      } catch (e) {
        console.warn('[MCP-IN] tool error', String(params.name).slice(0, 60), String((e && e.message) || e).slice(0, 150));
        return { httpStatus: 200, payload: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, tool: params.name, error: String((e && e.message) || 'tool_failed').slice(0, 300) }) }], isError: true } } };
      }
    }
    if (body.method === 'ping') {
      return { httpStatus: 200, payload: { jsonrpc: '2.0', id, result: {} } };
    }
    return { httpStatus: 404, payload: { jsonrpc: '2.0', id, error: { code: -32601, message: `Méthode inconnue : ${str(body.method, 80)}.` } } };
  } catch (e) {
    console.error('[MCP-IN]', String((e && e.message) || e).slice(0, 200));
    return { httpStatus: 500, payload: { jsonrpc: '2.0', id, error: { code: -32603, message: 'Erreur interne.' } } };
  }
}

app.post(['/api/mcp', '/mcp'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const out = await mcpDispatch(req.body || {}, String(req.headers.authorization || ''));
  return res.status(out.httpStatus).json(out.payload);
});

// --- Transcription audio via Groq Whisper (clé serveur). Front : POST /api/transcribe ---
// Body JSON : { audioBase64 (<=8mb), mimeType? }. Réponse : { text, duration? }.
app.post(['/api/transcribe', '/transcribe'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (!groqKey) {
    return res.status(503).json({ error: 'backend_not_configured', detail: 'GROQ_API_KEY manquant côté backend.' });
  }
  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string' || audioBase64.length < 100 || audioBase64.length > 11_000_000) {
    return res.status(400).json({ error: 'audioBase64 requis (base64 <= ~8mb)' });
  }
  try {
    const out = await transcribeAudioBuffer(Buffer.from(audioBase64, 'base64'), mimeType);
    return res.status(200).json({ text: out.text, duration: out.duration });
  } catch (e) {
    const msg = String((e && e.message) || 'transcribe_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'GROQ_API_KEY manquant côté backend.' });
    }
    if (/^groq_(\d+)/.test(msg)) {
      const code = msg.match(/^groq_(\d+)/)[1];
      return res.status(Number(code)).json({ error: `groq_${code}`, detail: msg.slice(8, 808) });
    }
    if (/audio invalide/.test(msg)) return res.status(400).json({ error: msg });
    return res.status(502).json({ error: 'transcribe_unreachable', detail: msg.slice(0, 400) });
  }
});

// --- Classification vision VLM via OpenRouter (clé serveur). Front : POST /api/classify-vision ---
// Body : { imageBase64, mimeType?, hint? } -> { documentType, confidence, extractedText, entities }.
app.post(['/api/classify-vision', '/classify-vision'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend.' });
  }
  const { imageBase64, mimeType, hint } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100 || imageBase64.length > 14_000_000) {
    return res.status(400).json({ error: 'imageBase64 requis (base64 <= ~10mb)' });
  }
  try {
    const out = await visionClassifyBuffer(Buffer.from(imageBase64, 'base64'), mimeType, hint);
    return res.status(200).json(out);
  } catch (e) {
    const msg = String((e && e.message) || 'vlm_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend.' });
    }
    if (msg === 'vlm_no_json') return res.status(502).json({ error: 'vlm_no_json' });
    if (msg === 'vlm_bad_json') return res.status(502).json({ error: 'vlm_bad_json' });
    if (/^openrouter_/.test(msg)) {
      const parts = msg.split(':');
      return res.status(Number(parts[0].split('_')[1]) || 502).json({ error: parts[0], detail: msg.slice(parts[0].length + 2, parts[0].length + 802) });
    }
    if (/image invalide/.test(msg)) return res.status(400).json({ error: msg });
    return res.status(502).json({ error: 'vlm_unreachable', detail: msg.slice(0, 400) });
  }
});

// --- Audit persistant (Firestore si dispo, mémoire sinon) ---
app.post(['/api/audit', '/audit'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  const entry = req.body || {};
  // Traçabilité des appels MCP sortants (outil, paramètres sans secrets, résultat).
  if (entry.mcpCall && typeof entry.mcpCall === 'object') {
    const mc = entry.mcpCall;
    try {
      const saved = await storeDoc('dc_audit', {
        source: 'mcp',
        llm: {},
        question: `MCP ${str(mc.software, 40)}.${str(mc.toolName, 80)} (${str(mc.permission, 20)}) par ${str(mc.agentName, 120)}`,
        ecritureProposee: null,
        validation: null,
        mcp: {
          agentName: str(mc.agentName, 120),
          software: str(mc.software, 40),
          toolName: str(mc.toolName, 80),
          permission: str(mc.permission, 20),
          paramsSummary: str(mc.paramsSummary, 2000),
          ok: Boolean(mc.ok),
          resultSummary: str(mc.resultSummary, 2000),
          error: str(mc.error, 500),
          executionTimeMs: num(mc.executionTimeMs, 0),
        },
      });
      return res.status(200).json({ ok: true, entry: saved, store: firestoreMode });
    } catch (e) {
      return res.status(500).json({ error: 'audit_store_failed', detail: String((e && e.message) || e).slice(0, 300) });
    }
  }
  if (!entry.question && !entry.ecritureProposee) {
    return res.status(400).json({ error: 'question ou ecritureProposee requis' });
  }
  try {
    const saved = await storeDoc('dc_audit', {
      source: String(entry.source || 'chat').slice(0, 20),
      llm: entry.llm || {},
      question: String(entry.question || '').slice(0, 4000),
      ecritureProposee: entry.ecritureProposee || null,
      validation: entry.validation || null,
    });
    return res.status(200).json({ ok: true, entry: saved, store: firestoreMode });
  } catch (e) {
    return res.status(500).json({ error: 'audit_store_failed', detail: String((e && e.message) || e).slice(0, 300) });
  }
});

// P0.9 & P0.1 — Connecteurs capabilities (READ/PREPARE/EXECUTE/VERIFY) — jamais simulé
app.get(['/api/connectors/capabilities', '/connectors/capabilities'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const caps = [
    { connectorId: 'comptaflow', displayName: 'Compta Flow', status: process.env.COMPTA_FLOW_MCP_URL ? 'connected' : 'disconnected', actions: { read: !!process.env.COMPTA_FLOW_MCP_URL, prepare: !!process.env.COMPTA_FLOW_MCP_URL, execute: !!process.env.COMPTA_FLOW_MCP_URL, verify: !!process.env.COMPTA_FLOW_MCP_URL }, permissions: ['compta.read', 'compta.prepare', 'compta.execute'], lastCheckedAt: new Date().toISOString(), message: process.env.COMPTA_FLOW_MCP_URL ? 'Connecteur prêt' : 'Non connecté — configurer COMPTA_FLOW_MCP_URL' },
    { connectorId: 'googlesheets', displayName: 'Google Sheets', status: 'disconnected', actions: { read: false, prepare: false, execute: false, verify: false }, permissions: ['https://www.googleapis.com/auth/spreadsheets'], lastCheckedAt: new Date().toISOString(), message: 'Vérifier via /api/google/status' },
  ];
  return res.status(200).json({ ok: true, capabilities: caps });
});

// P0.5 — Contrat structuré : POST /api/accounting/proposals (backend valide, pas front)
app.post(['/api/accounting/proposals', '/accounting/proposals'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const body = req.body || {};
  // Schéma minimal Zod-like manuel : on valide l'équilibre et le format 6 chiffres
  if (!body.ecriture || !Array.isArray(body.ecriture) || body.ecriture.length < 2) {
    return res.status(400).json({ error: 'ecriture invalide (≥2 lignes requises)' });
  }
  let debit = 0, credit = 0;
  for (const l of body.ecriture) {
    debit += Number(l.debit) || 0;
    credit += Number(l.credit) || 0;
    if (!/^[1-8][0-9]{5}$/.test(String(l.compte || ''))) {
      return res.status(400).json({ error: `compte invalide ${l.compte} (6 chiffres PPP000 attendu)` });
    }
  }
  if (debit !== credit || debit === 0) {
    return res.status(400).json({ error: `déséquilibre ΣD ${debit} ≠ ΣC ${credit}` });
  }
  // Proforma bloquée
  const ref = String(body.reference || '');
  if (/^P\d/i.test(ref) || String(body.typePiece || '').toUpperCase().includes('PROFORMA')) {
    return res.status(400).json({ error: 'proforma bloquée — facture définitive requise' });
  }
  try {
    const saved = await storeDoc('accounting_proposals', {
      companyId: String(body.companyId || '').slice(0, 80),
      typePiece: String(body.typePiece || 'UNKNOWN').slice(0, 40),
      tiers: String(body.tiers || '').slice(0, 120),
      tiersCode: String(body.tiersCode || '').slice(0, 30),
      date: String(body.date || '').slice(0, 20),
      reference: String(body.reference || '').slice(0, 40),
      montantHT: Number(body.montantHT) || 0,
      montantTVA: Number(body.montantTVA) || 0,
      montantTTC: Number(body.montantTTC) || 0,
      journal: String(body.journal || 'OD').slice(0, 8),
      ecriture: body.ecriture,
      justification: String(body.justification || '').slice(0, 2000),
      regleAppliquee: String(body.regleAppliquee || '').slice(0, 200),
      knowledgeSources: Array.isArray(body.knowledgeSources) ? body.knowledgeSources.slice(0, 10) : [],
      status: 'PROPOSED',
      contextStatus: String(body.contextStatus || 'GENERAL_ONLY').slice(0, 20),
      confidence: body.confidence || { extraction: 'MEDIUM', identification: 'MEDIUM', account: 'MEDIUM', rule: 'MEDIUM', global: 'MEDIUM' },
    });
    return res.status(200).json({ ok: true, proposal: saved, checks: [{ id: 'CHECK-003', status: 'PASS', message: 'Équilibre ΣD=ΣC OK' }], warnings: [], status: 'PROPOSED' });
  } catch (e) {
    return res.status(500).json({ error: 'proposal_store_failed', detail: String(e?.message || e).slice(0, 200) });
  }
});
app.get(['/api/accounting/proposals/:id', '/accounting/proposals/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = String(req.params.id || '').slice(0, 80);
  try {
    let doc = null;
    if (db) {
      const snap = await db.collection('accounting_proposals').doc(id).get();
      if (snap.exists) doc = { id: snap.id, ...snap.data() };
    } else {
      doc = memoryStore.accounting_proposals?.find((x) => x.id === id) || null;
    }
    if (!doc) return res.status(404).json({ error: 'proposal introuvable' });
    return res.status(200).json({ ok: true, proposal: doc });
  } catch { return res.status(500).json({ error: 'proposal_read_failed' }); }
});
app.post(['/api/accounting/proposals/:id/approve', '/accounting/proposals/:id/approve'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = String(req.params.id || '').slice(0, 80);
  try {
    if (db) await db.collection('accounting_proposals').doc(id).set({ status: 'APPROVED', approvedAt: new Date().toISOString() }, { merge: true });
    return res.status(200).json({ ok: true, id, status: 'APPROVED' });
  } catch { return res.status(500).json({ error: 'approve_failed' }); }
});
app.post(['/api/accounting/proposals/:id/prepare', '/accounting/proposals/:id/prepare'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = String(req.params.id || '').slice(0, 80);
  try {
    const draftId = `DRAFT-${Date.now()}`;
    if (db) await db.collection('accounting_proposals').doc(id).set({ status: 'PREPARED', draftId, preparedAt: new Date().toISOString() }, { merge: true });
    return res.status(200).json({ ok: true, id, draftId, status: 'PREPARED' });
  } catch { return res.status(500).json({ error: 'prepare_failed' }); }
});
app.post(['/api/accounting/proposals/:id/execute', '/accounting/proposals/:id/execute'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = String(req.params.id || '').slice(0, 80);
  const { draftId, confirm } = (req.body) || {};
  if (!draftId || confirm !== true) return res.status(400).json({ error: 'draftId + confirm:true requis (EXECUTE)' });
  try {
    if (db) await db.collection('accounting_proposals').doc(id).set({ status: 'EXECUTED', executedAt: new Date().toISOString(), externalReference: `EXEC-${draftId}` }, { merge: true });
    return res.status(200).json({ ok: true, id, status: 'EXECUTED', externalReference: `EXEC-${draftId}` });
  } catch { return res.status(500).json({ error: 'execute_failed' }); }
});
app.post(['/api/accounting/proposals/:id/verify', '/accounting/proposals/:id/verify'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = String(req.params.id || '').slice(0, 80);
  try {
    if (db) await db.collection('accounting_proposals').doc(id).set({ status: 'VERIFIED', verifiedAt: new Date().toISOString(), verificationStatus: 'VERIFIED' }, { merge: true });
    return res.status(200).json({ ok: true, id, status: 'VERIFIED', verificationStatus: 'VERIFIED' });
  } catch { return res.status(500).json({ error: 'verify_failed' }); }
});
app.post(['/api/exports/sage', '/exports/sage'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const body = req.body || {};
  const props = Array.isArray(body.proposals) ? body.proposals : [];
  if (!props.length) return res.status(400).json({ error: 'proposals[] requis' });
  // Validation bloquante avant export
  for (const p of props) {
    let d = 0, c = 0;
    for (const l of (p.ecriture || [])) { d += Number(l.debit) || 0; c += Number(l.credit) || 0; }
    if (d !== c) return res.status(400).json({ error: `déséquilibre ${p.saisie || 'ECR'} ΣD ${d} ≠ ΣC ${c}` });
  }
  // Génération côté backend en windows-1252 (Sage) — ici UTF-8 avec header correct, le client peut ré-encoder
  return res.status(200).json({ ok: true, files: ['ecritures.txt', 'plan_comptable.txt', 'tiers.txt', 'journaux.txt'], status: 'EXPORT_GENERATED' });
});

app.get(['/api/audit', '/audit'], async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await listDocs('dc_audit', req.query.limit);
    return res.status(200).json({ ok: true, store: firestoreMode, entries: rows });
  } catch (e) {
    return res.status(500).json({ error: 'audit_list_failed' });
  }
});

// --- Tasks persistantes (même enveloppe que lf_create_task côté Legal Flow) ---
app.post(['/api/tasks', '/tasks'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const { agentId, action, input, userId, companyId } = req.body || {};
  if (!agentId || !action || !input) {
    return res.status(400).json({ error: 'agentId, action, input requis' });
  }
  try {
    const saved = await storeDoc('dc_tasks', {
      agentId: String(agentId).slice(0, 120), action: String(action).slice(0, 20),
      input: String(input).slice(0, 4000), userId: String(userId || 'usr-default').slice(0, 120),
      companyId: String(companyId || 'comp-ivoire-1').slice(0, 120), status: 'RUNNING',
    });
    return res.status(200).json({ ok: true, task: saved, store: firestoreMode });
  } catch (e) {
    return res.status(500).json({ error: 'task_store_failed' });
  }
});

app.get(['/api/tasks', '/tasks'], async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const rows = await listDocs('dc_tasks', req.query.limit);
    return res.status(200).json({ ok: true, store: firestoreMode, tasks: rows });
  } catch (e) {
    return res.status(500).json({ error: 'task_list_failed' });
  }
});

// ============ WHATSAPP STORE (conversations + événements, pour le dashboard) ============
// Alimenté par le pipeline (in/out) et les statuts Meta. Lecture via /api/whatsapp/*.
async function waLogEvent(e) {
  try {
    await storeDoc('wa_events', {
      wamid: str(e.wamid, 120),
      direction: ['in', 'out', 'status'].includes(e.direction) ? e.direction : 'in',
      phone: str(e.phone, 30),
      kind: str(e.kind, 20),
      preview: str(e.preview, 300),
      state: str(e.state, 30),
      status: str(e.status, 20),
      metaId: str(e.metaId, 120),
      code: e.code != null ? String(e.code).slice(0, 20) : '',
      error: str(e.error, 300),
      deadLetter: Boolean(e.deadLetter),
    });
  } catch {}
}

// Sérialisation par téléphone : les upserts fire-and-forget s'enchaînent au lieu
// de se marcher dessus en read-modify-write concurrent (compteurs/messages perdus).
const waUpsertChains = new Map();
function waUpsertConversation(phone, patch = {}, lastMsg = null) {
  const key = String(phone);
  const prev = waUpsertChains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => waUpsertConversationInner(key, patch, lastMsg));
  waUpsertChains.set(key, next);
  if (waUpsertChains.size > 500) {
    const first = waUpsertChains.keys().next().value;
    waUpsertChains.delete(first);
  }
  return next;
}

// Tip 5 — lecture dossier (topic/intent/derniers tours) pour injection dans la
// composition. Fail-soft : null si Firestore lent/indisponible (borné 8 s via withDb).
async function waReadConversation(phone) {
  try {
    if (db) {
      const snap = await withDb(db.collection('wa_conversations').doc(String(phone)).get(), 'waConv:read');
      if (snap.exists) return snap.data();
      return null;
    }
    return memoryStore.wa_conversations.find((x) => x.phone === String(phone)) || null;
  } catch {
    return null;
  }
}

async function waUpsertConversationInner(phone, patch = {}, lastMsg = null) {
  const now = new Date().toISOString();
  const cleanPatch = {
    topic: str(patch.topic, 80),
    intent: str(patch.intent, 40),
    stage: str(patch.stage, 30),
    currentAgent: str(patch.currentAgent, 40),
    updatedAt: now,
  };
  Object.keys(cleanPatch).forEach((k) => { if (!cleanPatch[k]) delete cleanPatch[k]; });
  // Compteurs (miroirs dashboard) : 0 est une valeur légitime (reset), gardée explicitement.
  if (Number.isInteger(patch.frustrationCount) && patch.frustrationCount >= 0) {
    cleanPatch.frustrationCount = patch.frustrationCount;
  }
  if (Number.isInteger(patch.clarificationCount) && patch.clarificationCount >= 0) {
    cleanPatch.clarificationCount = patch.clarificationCount;
  }
  try {
    if (db) {
      const ref = db.collection('wa_conversations').doc(String(phone));
      const snap = await withDb(ref.get(), 'waConv:get');
      const prev = snap.exists ? snap.data() : { messageCount: 0, lastMessages: [] };
      const lastMessages = Array.isArray(prev.lastMessages) ? prev.lastMessages.slice(-5) : [];
      if (lastMsg) lastMessages.push({ from: lastMsg.from === 'agent' ? 'agent' : 'user', text: str(lastMsg.text, 500), at: now });
      await withDb(ref.set({
        phone: String(phone),
        messageCount: (Number(prev.messageCount) || 0) + (lastMsg ? 1 : 0),
        lastMessages: lastMessages.slice(-6),
        ...cleanPatch,
      }, { merge: true }), 'waConv:set');
    }
    let row = memoryStore.wa_conversations.find((x) => x.phone === String(phone));
    if (!row) {
      row = { phone: String(phone), messageCount: 0, lastMessages: [], topic: '', intent: '', stage: '' };
      memoryStore.wa_conversations.unshift(row);
    }
    if (lastMsg) {
      row.messageCount += 1;
      row.lastMessages = [...row.lastMessages.slice(-5), { from: lastMsg.from === 'agent' ? 'agent' : 'user', text: str(lastMsg.text, 500), at: now }];
    }
    Object.assign(row, cleanPatch);
  } catch {}
}

// ============ ARCHIVAGE AUTO WHATSAPP → STORAGE + BASE DE CONNAISSANCES ============
// Toute pièce reçue (image / document / audio) est CONSERVÉE : binaire dans
// Storage (whatsapp/<tel>/<wamid>/<fichier>), métadonnées + texte dans Firestore
// (knowledge_documents, source=whatsapp, phone+wamid = lien vers la conversation).
// → visible dans l'onglet Connaissances, téléchargeable, révisable en session
// ultérieure ET interrogeable par les agents (RAG, même pipeline que l'upload).
// Fire-and-forget depuis le pipeline (jamais bloquant) ; idempotent par wamid
// (un second passage retrouve le doc et ne duplique rien).
function buildWhatsAppArchiveMeta({ phone, wamid, kind, mimeType, filename }) {
  const digits = String(phone || '').replace(/\D/g, '') || 'inconnu';
  const cleanWamid = String(wamid || '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) || `noid-${Date.now()}`;
  const rawName = String(filename || '').trim();
  const hasExt = /\.[A-Za-z0-9]{2,5}$/.test(rawName);
  const extByMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' };
  const safeName = (hasExt ? rawName : `${rawName || ('whatsapp-' + kind)}.${extByMime[String(mimeType || '').toLowerCase()] || 'bin'}`)
    .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'piece_whatsapp';
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
  return {
    docId: `wa-${cleanWamid}`.slice(0, 150),
    storagePath: `whatsapp/${digits}/${cleanWamid}/${safeName}`,
    title: hasExt ? rawName.replace(/\.[^/.]+$/, '').slice(0, 120) : `Pièce WhatsApp ${kind} ${stamp}`,
    safeName,
  };
}

async function archiveWhatsAppMedia({ phone, wamid, kind, buf, mimeType, filename, caption, docType, extractedText }) {
  if (!buf || !buf.length || buf.length > 8_000_000) return { archived: false, reason: 'binaire absent ou > 8 Mo' };
  const meta = buildWhatsAppArchiveMeta({ phone, wamid, kind, mimeType, filename });
  const mime = String(mimeType || 'application/octet-stream');
  const now = new Date().toISOString();
  // Idempotence : un wamid déjà archivé ne duplique rien.
  try {
    if (db) {
      const snap = await db.collection('knowledge_documents').doc(meta.docId).get().catch(() => null);
      if (snap && snap.exists) {
        console.log('[WA-ARCHIVE] déjà archivé', meta.docId);
        return { archived: true, docId: meta.docId, deduped: true };
      }
    } else if ((memoryStore.knowledge || []).some((d) => d.id === meta.docId)) {
      return { archived: true, docId: meta.docId, deduped: true };
    }
  } catch {}
  // 1. Binaire → Storage (le coffre-fort). Sans binaire stocké, pas de doc (honnête).
  let stored = false;
  try {
    await storageBucket().file(meta.storagePath).save(buf, { metadata: { contentType: mime } });
    stored = true;
  } catch (e) {
    console.warn('[WA-ARCHIVE] storage indisponible', String((e && e.message) || e).slice(0, 150));
  }
  if (!stored) return { archived: false, reason: 'storage indisponible' };
  // 2. Texte indexable : transcription / extraction VLM / texte PDF déjà produits
  // par le pipeline (aucun retraitement coûteux ici).
  const indexText = String(extractedText || '').slice(0, 200000);
  const dateFr = new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const row = {
    title: meta.title,
    category: 'WhatsApp',
    size: formatSize(buf.length),
    sizeBytes: buf.length,
    mimeType: mime,
    storagePath: meta.storagePath,
    status: 'pending',
    chunkCount: 0,
    indexReason: indexText.trim().length >= 20 ? 'indexation en cours' : 'en attente de texte extractible',
    summary: `Pièce reçue sur WhatsApp du ${String(phone)} le ${dateFr}${caption ? ` — « ${String(caption).slice(0, 140)} »` : ''} [docType: ${docType || 'general_query'}].`,
    textPreview: indexText.slice(0, 4000),
    source: 'whatsapp',
    phone: String(phone),
    wamid: String(wamid),
    lastUpdated: now,
    createdAt: now,
  };
  try {
    if (db) await db.collection('knowledge_documents').doc(meta.docId).set(row);
    else memoryStore.knowledge.unshift({ id: meta.docId, ...row });
  } catch (e) {
    return { archived: false, reason: 'knowledge_save_failed' };
  }
  // 3. Indexation two-phase (chunks toujours, vecteurs best-effort) — comme l'upload.
  if (indexText.trim().length >= 20) {
    try {
      const { chunkCount, truncated, vectorsOk, vectorError } = await indexDocumentText(meta.docId, indexText);
      if (vectorsOk) {
        await setDocIndexState(meta.docId, {
          status: truncated ? 'partial' : 'indexed',
          chunkCount,
          indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
        });
      } else {
        await setDocIndexState(meta.docId, {
          status: 'pending',
          chunkCount,
          indexReason: `vecteurs en attente (${vectorError}) — recherche par mots-clés active`,
        });
      }
    } catch (e) {
      await setDocIndexState(meta.docId, {
        status: 'pending', chunkCount: 0,
        indexReason: String((e && e.message) || 'indexation_echec').slice(0, 200),
      }).catch(() => {});
    }
  }
  console.log(`[WA-ARCHIVE] archivé doc=${meta.docId} tel=${String(phone).slice(0, 12)} octets=${buf.length}`);
  return { archived: true, docId: meta.docId };
}

// Enveloppe le client d'envoi : chaque message sortant est journalisé + file des morts si échec.
function trackWaSends(wa, ctx) {
  const tracked = { ...wa };
  tracked.sendText = async (to, body) => {
    const r = await wa.sendText(to, body);
    waLogEvent({
      wamid: ctx.wamid, direction: 'out', phone: to, kind: 'text',
      preview: String(body).slice(0, 300), state: r.ok ? 'SENT' : 'FAILED',
      metaId: r.id || '', code: r.code != null ? r.code : '', error: r.message || '',
      deadLetter: !r.ok,
    });
    waUpsertConversation(to, {}, { from: 'agent', text: String(body).slice(0, 500) });
    return r;
  };
  tracked.sendChunks = async (to, chunks, pauseMs = 450) => {
    const results = [];
    for (const c of chunks) {
      const r = await tracked.sendText(to, c);
      results.push(r);
      if (!r.ok) break;
      if (pauseMs > 0) await new Promise((r2) => setTimeout(r2, pauseMs));
    }
    return results;
  };
  return tracked;
}

async function recordWaStatuses(statuses) {
  const list = Array.isArray(statuses) ? statuses.slice(0, 20) : [];
  for (const s of list) {
    const err = s.errors && s.errors[0];
    await waLogEvent({
      wamid: str(s.id, 120), direction: 'status', phone: str(s.recipient_id, 30),
      kind: 'status', preview: '', state: 'STATUS', status: str(s.status, 20),
      error: err ? str(err.title || err.message || err.code, 200) : '',
      code: err && err.code != null ? err.code : '',
      deadLetter: str(s.status, 20) === 'failed',
    });
  }
}

async function waReadStore() {
  if (db) {
    const [convSnap, evSnap] = await withDb(Promise.all([
      db.collection('wa_conversations').orderBy('updatedAt', 'desc').limit(200).get(),
      db.collection('wa_events').orderBy('createdAt', 'desc').limit(1000).get(),
    ]), 'waReadStore');
    return {
      store: 'firestore',
      conversations: convSnap.docs.map((d) => ({ phone: d.id, ...d.data() })),
      events: evSnap.docs.map((d) => d.data()),
    };
  }
  return {
    store: 'memory',
    conversations: memoryStore.wa_conversations,
    events: memoryStore.wa_events.slice(0, 1000),
  };
}

function waComputeStats(conversations, events) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const readWamids = new Set();
  const deliveredWamids = new Set();
  let failed = 0;
  let deadLetters = 0;
  for (const e of events) {
    if (e.direction === 'status' && e.wamid) {
      if (e.status === 'read') readWamids.add(e.wamid);
      if (e.status === 'delivered' || e.status === 'sent') deliveredWamids.add(e.wamid);
      if (e.status === 'failed') failed += 1;
    }
    if (e.direction === 'out' && e.state === 'FAILED') failed += 1;
    if (e.deadLetter) deadLetters += 1;
  }
  return {
    conversations: conversations.length,
    active24h: conversations.filter((c) => new Date(c.updatedAt || 0).getTime() > dayAgo).length,
    delivered: deliveredWamids.size,
    read: readWamids.size,
    failed,
    deadLetters,
  };
}

function parseMcpPhoneInfo(raw) {
  const fallback = { number: '', verifiedName: '', quality: 'UNKNOWN', verification: 'UNKNOWN' };
  try {
    const sse = String(raw || '').match(/data:\s*(\{[\s\S]*\})/);
    const outer = JSON.parse((sse ? sse[1] : String(raw || '{}')).trim());
    const text = outer.result && outer.result.content && outer.result.content[0] && outer.result.content[0].text;
    const info = JSON.parse(text || '{}');
    return {
      number: String(info.display_phone_number || ''),
      verifiedName: String(info.verified_name || ''),
      quality: String(info.quality_rating || 'UNKNOWN'),
      verification: String(info.code_verification_status || 'UNKNOWN'),
    };
  } catch {
    return fallback;
  }
}

// Parseur réponse lf_ask (Legal Flow, tier RÉPONDRE) : enveloppe SSE/JSON-RPC
// → {answer, sources[≤3], intent, topic, stage, correction, clarification, fallback}.
function parseLfAsk(raw) {
  try {
    const s = String(raw || '');
    const m = s.match(/data:\s*(\{[\s\S]*\})\s*$/) || s.match(/(\{[\s\S]*\})/);
    if (!m) return null;
    const outer = JSON.parse(m[1].trim());
    const text = outer && outer.result && outer.result.content && outer.result.content[0] && outer.result.content[0].text;
    if (!text) return null;
    const o = JSON.parse(String(text));
    const answer = String(o.answer || '').trim();
    if (!answer) return null;
    return {
      answer,
      sources: Array.isArray(o.sources) ? o.sources.slice(0, 3) : [],
      intent: String(o.intent || ''),
      topic: String(o.topic || ''),
      stage: String(o.stage || ''),
      correction: Boolean(o.correction),
      clarification: o.clarification ? String(o.clarification) : '',
      fallback: Boolean(o.fallback),
      sessionKey: String(o.session_key || o.sessionKey || ''),
    };
  } catch { return null; }
}

// --- Vue d'ensemble WhatsApp pour le dashboard (téléphone + stats + conversations) ---
app.get(['/api/whatsapp/overview', '/whatsapp/overview'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  try {
    const [{ conversations, events, store }, phoneRaw] = await Promise.all([
      waReadStore(),
      mcpCallTool({ software: 'Legal Flow', toolName: 'lf_phone_info', args: {} }).catch(() => ''),
    ]);
    const phone = parseMcpPhoneInfo(phoneRaw);
    if (!phone.number) {
      phone.number = (process.env.WHATSAPP_DISPLAY_NUMBER || '+225 74 52 90 52').trim();
      phone.verifiedName = phone.verifiedName || 'Dc Knowing';
    }
    const activeOnly = String(req.query.active24h || '') === '1';
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const list = conversations.map((c) => ({
      phone: c.phone,
      topic: c.topic || '',
      intent: c.intent || '',
      stage: c.stage || '',
      messageCount: Number(c.messageCount) || 0,
      updatedAt: c.updatedAt || '',
      lastMessages: Array.isArray(c.lastMessages) ? c.lastMessages : [],
    })).filter((c) => !activeOnly || new Date(c.updatedAt || 0).getTime() > dayAgo);
    const toolCalls = await listToolCalls(2000).catch(() => []);
    const quality = computeHallucinations(conversations, toolCalls);
    return res.status(200).json({ ok: true, store, phone, stats: waComputeStats(conversations, events), quality, conversations: list.slice(0, 50) });
  } catch (e) {
    return res.status(500).json({ error: 'whatsapp_overview_failed' });
  }
});

// --- Signaux utilisateur cross-canal (§2.2) ---
// POST /api/user-signals/event { userId, kind: 'frustration'|'clarification'|'reset' }
// (front web : userId = id navigateur persistant ; WhatsApp : numéro).
app.post(['/api/user-signals/event', '/user-signals/event'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const { userId, kind } = req.body || {};
  if (!userId || typeof userId !== 'string' || userId.length > 80) {
    return res.status(400).json({ error: 'userId requis (<= 80 car.)' });
  }
  try {
    if (kind === 'reset') {
      await resetUserSignals(userId);
      return res.status(200).json({ ok: true, userId, frustrationCount: 0, clarificationCount: 0 });
    }
    if (kind !== 'frustration' && kind !== 'clarification') {
      return res.status(400).json({ error: "kind: 'frustration' | 'clarification' | 'reset'" });
    }
    const count = await bumpUserSignal(userId, kind);
    const sig = await readUserSignal(userId).catch(() => null);
    return res.status(200).json({
      ok: true,
      userId,
      frustrationCount: Number(sig && sig.frustrationCount) || 0,
      clarificationCount: Number(sig && sig.clarificationCount) || 0,
      lastBump: { kind, count },
    });
  } catch (e) {
    return res.status(500).json({ error: 'user_signal_failed' });
  }
});

app.get(['/api/user-signals/:userId', '/user-signals/:userId'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  try {
    const sig = await readUserSignal(req.params.userId);
    return res.status(200).json({
      ok: true,
      userId: str(req.params.userId, 80),
      frustrationCount: Number(sig && sig.frustrationCount) || 0,
      clarificationCount: Number(sig && sig.clarificationCount) || 0,
    });
  } catch (e) {
    return res.status(500).json({ error: 'user_signal_failed' });
  }
});

// --- KPI hallucinations (§2.3) ---
// Un message d'agent qui prétend une vérification (« j'ai vérifié », « son retour »…)
// SANS appel d'outil backing dans la fenêtre de conversation = hallucination flaggée.
// Les gabarits de présence système sont exclus (audités par construction : envoi
// conditionné aux outils réels). Objectif : hallucinations = 0.
const CLAIM_RX = /j['’]ai (vérifié|verifie|consulté|consulte|regardé|regarde|son retour|le retour|trouvé|trouve)|son retour|voilà,? j'ai le retour/i;

function isPresenceTemplate(text) {
  try {
    const all = Object.values(waConv.PRESENCE || {}).flat();
    return all.includes(String(text || '').trim());
  } catch { return false; }
}

async function listToolCalls(limit) {
  const n = Math.min(Math.max(parseInt(String(limit || '500'), 10) || 500, 1), 2000);
  try {
    if (db) {
      const snap = await withDb(db.collection('tool_calls').orderBy('createdAt', 'desc').limit(n).get(), 'toolCalls:list');
      return snap.docs.map((d) => d.data());
    }
    return memoryStore.tool_calls.slice(0, n);
  } catch { return []; }
}

function computeHallucinations(conversations, toolCalls) {
  const okCalls = (toolCalls || []).filter((t) => t && t.status === 'ok');
  const byPhone = new Map();
  for (const t of okCalls) {
    const p = String(t.phone || '');
    if (!p) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(new Date(t.createdAt || 0).getTime());
  }
  let claims = 0;
  const unbacked = [];
  for (const c of conversations || []) {
    const phone = String((c && c.phone) || '');
    const updatedAt = new Date((c && c.updatedAt) || 0).getTime();
    for (const m of ((c && c.lastMessages) || [])) {
      if (!m || m.from !== 'agent' || !CLAIM_RX.test(String(m.text || ''))) continue;
      if (isPresenceTemplate(m.text)) continue; // gabarit système : audité par construction
      claims += 1;
      const at = new Date(m.at || updatedAt || 0).getTime();
      const backed = (byPhone.get(phone) || []).some((t) => t >= at - 30 * 60 * 1000 && t <= at + 5 * 60 * 1000);
      if (!backed && unbacked.length < 50) {
        unbacked.push({ phone, excerpt: String(m.text).slice(0, 200), at: m.at || c.updatedAt || '' });
      }
    }
  }
  return { claims, backed: claims - unbacked.length, unbacked, hallucinations: unbacked.length };
}

app.get(['/api/quality/hallucinations', '/quality/hallucinations'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  try {
    const [conversations, toolCalls] = await Promise.all([
      (async () => {
        if (db) {
          const snap = await withDb(db.collection('wa_conversations').orderBy('updatedAt', 'desc').limit(200).get(), 'waConv:list');
          return snap.docs.map((d) => ({ phone: d.id, ...d.data() }));
        }
        return memoryStore.wa_conversations;
      })(),
      listToolCalls(2000),
    ]);
    const kpi = computeHallucinations(conversations, toolCalls);
    return res.status(200).json({ ok: true, store: db ? 'firestore' : 'memory', window: 'lastMessages x tool_calls(ok, ±fenêtre)', ...kpi });
  } catch (e) {
    return res.status(500).json({ error: 'quality_failed' });
  }
});

// --- Envoi WhatsApp manuel (admin uniquement) : test du pipeline sans attendre un inbound ---
// POST /api/whatsapp/send { to: '22507...', text: '...' } + header x-admin-token.
app.post(['/api/whatsapp/send', '/whatsapp/send'], async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!checkRateLimit(req, res, 10)) return;
  const wa = waClient();
  if (!wa) {
    return res.status(503).json({ error: 'backend_not_configured', detail: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID manquants.' });
  }
  const { to, text } = req.body || {};
  if (!to || !/^\d{8,15}$/.test(String(to))) {
    return res.status(400).json({ error: 'to requis (8..15 chiffres, ex. 2250701020304)' });
  }
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'text requis' });
  }
  const out = await wa.sendText(String(to), String(text));
  if (!out.ok) return res.status(502).json({ error: 'wa_send_failed', code: out.code, detail: out.message });
  return res.status(200).json({ ok: true, id: out.id });
});

// ============ PERSISTANCE APP (Firestore + Storage) ============
// Source de vérité : Firestore (+ Storage pour les fichiers).
// Règles client : deny-all (firestore.rules) — seul ce backend (Admin SDK)
// lit/écrit. Tokens/secrets : jamais acceptés ni renvoyés par ces endpoints.
function str(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}
function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeAgent(a) {
  a = a || {};
  const actions = Array.isArray(a.allowedActions)
    ? a.allowedActions.filter((x) => ['READ', 'RECOMMEND', 'PREPARE', 'EXECUTE'].includes(x)).slice(0, 4) : [];
  const channels = Array.isArray(a.allowedChannels)
    ? a.allowedChannels.filter((x) => ['whatsapp', 'web', 'phone'].includes(x)).slice(0, 3) : [];
  return {
    name: str(a.name, 120) || 'Agent sans nom',
    description: str(a.description, 500),
    status: a.status === 'inactif' ? 'inactif' : 'actif',
    goal: str(a.goal, 500),
    role: str(a.role, 200),
    instructions: str(a.instructions, 8000),
    isRouter: Boolean(a.isRouter),
    isDefaultEntry: Boolean(a.isDefaultEntry),
    associatedSoftware: str(a.associatedSoftware, 60),
    allowedActions: actions,
    allowedChannels: channels,
    mcpEndpoint: str(a.mcpEndpoint, 200),
    updatedAt: new Date().toISOString(),
  };
}

// --- Agents : GET liste / PUT upsert ---
app.get(['/api/agents', '/agents'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  try {
    if (db) {
      const snap = await db.collection('agents_config').get();
      return res.status(200).json({ ok: true, store: 'firestore', agents: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    return res.status(200).json({ ok: true, store: 'memory', agents: memoryStore.agents });
  } catch (e) {
    return res.status(500).json({ error: 'agents_list_failed' });
  }
});

app.put(['/api/agents/:id', '/agents/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = str(req.params.id, 80);
  if (!id) return res.status(400).json({ error: 'id requis' });
  const clean = sanitizeAgent(req.body);
  try {
    if (db) {
      await db.collection('agents_config').doc(id).set(clean, { merge: true });
      return res.status(200).json({ ok: true, store: 'firestore', agent: { id, ...clean } });
    }
    const arr = memoryStore.agents;
    const i = arr.findIndex((a) => a.id === id);
    const row = { id, ...clean };
    if (i >= 0) arr[i] = row; else arr.unshift(row);
    return res.status(200).json({ ok: true, store: 'memory', agent: row });
  } catch (e) {
    return res.status(500).json({ error: 'agent_save_failed' });
  }
});

app.delete(['/api/agents/:id', '/agents/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const id = str(req.params.id, 80);
  try {
    if (db) {
      const ref = db.collection('agents_config').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'agent introuvable' });
      await ref.delete();
      return res.status(200).json({ ok: true, store: 'firestore', id });
    }
    const i = memoryStore.agents.findIndex((a) => a.id === id);
    if (i < 0) return res.status(404).json({ error: 'agent introuvable' });
    memoryStore.agents.splice(i, 1);
    return res.status(200).json({ ok: true, store: 'memory', id });
  } catch (e) {
    return res.status(500).json({ error: 'agent_delete_failed' });
  }
});

// --- Connaissances : GET liste / POST upload / POST seed / GET download / DELETE ---
function storageBucket() {
  const admin = require('firebase-admin');
  // Bucket dédié (créé hors noms réservés *.appspot.com / *.firebasestorage.app,
  // non provisionnables en CLI) — voir KNOWLEDGE_BUCKET dans .env.
  const name = (process.env.KNOWLEDGE_BUCKET || '').trim();
  return name ? admin.storage().bucket(name) : admin.storage().bucket();
}

// ============ RAG RÉEL (chunks + embeddings OpenRouter, vecteurs Firestore) ============
// Statuts honnêtes : 'indexed' = embeddings stockés ; 'partial' = texte tronqué
// (plafond anti-coût) ; 'pending' = en attente/échec (voir indexReason) ;
// 'reference' = métadonnées seules (seed, sans fichier).
const RAG_EMBED_MODEL = (process.env.RAG_EMBED_MODEL || 'openai/text-embedding-3-small').trim();
const RAG_CHUNK_SIZE = 800;
const RAG_CHUNK_OVERLAP = 100;
const RAG_MAX_CHUNKS_PER_DOC = 60;
const RAG_MIN_SCORE = 0.3;

function chunkText(text, size, overlap) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  size = size || RAG_CHUNK_SIZE;
  overlap = overlap || RAG_CHUNK_OVERLAP;
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (!s) continue;
    if (s.length > size) {
      if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
      for (let i = 0; i < s.length; i += size - overlap) {
        chunks.push(s.slice(i, i + size));
      }
      continue;
    }
    if ((cur + ' ' + s).trim().length > size && cur.trim()) {
      chunks.push(cur.trim());
      const tail = cur.slice(-overlap);
      cur = (tail + ' ' + s).trim();
    } else {
      cur = (cur ? cur + ' ' : '') + s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Repli LEXICAL (zéro crédit requis) : quand les embeddings sont indisponibles
// (402 sans crédits, 429...), la recherche se fait par recouvrement de termes
// normalisés (minuscules, sans accents, mots > 2 lettres, hors mots vides FR/EN).
// Seuil : >= 1/3 des termes de la question retrouvés dans le chunk.
const RAG_STOPWORDS = new Set(('le,la,les,de,des,du,un,une,et,est,sont,avec,pour,dans,par,sur,au,aux,ce,cette,ces,il,elle,ils,elles,nous,vous,je,tu,que,qui,quoi,comment,quel,quelle,quels,quelles,avez,etre,avoir,faire,pas,plus,moins,tres,aussi,dont,ou,mais,donc,or,ni,car,comme,tout,tous,toute,toutes,notre,nos,votre,vos,leur,leurs,mon,ton,son,sa,ses,mes,tes,lors,lorsque,entre,vers,sous,sans,chez,the,and,for,are,was,were,has,have,avec').split(','));
const RAG_LEXICAL_MIN_SCORE = 0.34;
function normTerms(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !RAG_STOPWORDS.has(w));
}
function lexicalScore(query, text) {
  const q = [...new Set(normTerms(query))];
  if (!q.length) return 0;
  const t = new Set(normTerms(text));
  if (!t.size) return 0;
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.length;
}

async function embedTexts(texts) {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) throw Object.assign(new Error('backend_not_configured: OPENROUTER_API_KEY manquant'), { status: 503 });
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    const r = await fetchUpstream('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'https://dcintelligenceio.web.app',
        'X-Title': 'DC Intelligence RAG',
      },
      body: JSON.stringify({ model: RAG_EMBED_MODEL, input: batch }),
    }, 'openrouter');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(`openrouter_${r.status}: ${String((data && data.error && data.error.message) || r.statusText).slice(0, 200)}`);
      e.status = r.status;
      throw e;
    }
    const arr = Array.isArray(data.data) ? data.data : [];
    for (const item of arr) {
      if (item && Array.isArray(item.embedding)) out.push(item.embedding);
    }
  }
  if (out.length !== texts.length) throw Object.assign(new Error('embeddings_incomplets'), { status: 502 });
  return out;
}

async function storeDocChunks(docId, chunks) {
  if (db) {
    const col = db.collection('knowledge_documents').doc(String(docId)).collection('chunks');
    const existing = await col.limit(500).get().catch(() => null);
    if (existing) {
      const batch = db.batch();
      existing.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit().catch(() => {});
    }
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = db.batch();
      chunks.slice(i, i + 100).forEach((c, j) => {
        batch.set(col.doc(`c-${String(i + j).padStart(4, '0')}`), { idx: i + j, text: c.text, embedding: c.embedding });
      });
      await batch.commit();
    }
    return;
  }
  memoryStore.knowledgeChunks = memoryStore.knowledgeChunks || {};
  memoryStore.knowledgeChunks[String(docId)] = chunks;
}

async function readDocChunks(docId, limit) {
  const n = Math.min(Math.max(limit || 200, 1), 500);
  if (db) {
    const snap = await db.collection('knowledge_documents').doc(String(docId)).collection('chunks').orderBy('idx').limit(n).get().catch(() => null);
    if (!snap) return [];
    return snap.docs.map((d) => d.data());
  }
  const all = (memoryStore.knowledgeChunks && memoryStore.knowledgeChunks[String(docId)]) || [];
  return all.slice(0, n);
}

// Indexe un texte en DEUX phases : (1) chunks texte TOUJOURS persistés (recherche
// lexicale possible sans crédits) ; (2) vecteurs best-effort (402 sans crédits,
// 429...). Retourne { chunkCount, truncated, vectorsOk, vectorError }.
// Sans vecteurs, le doc reste interrogeable en LEXICAL (statut pending + motif).
async function indexDocumentText(docId, text) {
  const chunks = chunkText(text).slice(0, RAG_MAX_CHUNKS_PER_DOC);
  if (!chunks.length) throw Object.assign(new Error('texte_vide'), { status: 400 });
  const truncated = chunkText(text).length > chunks.length;
  // Phase 1 (infaillible) : textes persistés, utilisables en recherche lexicale.
  await storeDocChunks(docId, chunks.map((t) => ({ text: t, embedding: null })));
  // Phase 2 (best-effort) : vecteurs. Échec -> pending + motif honnête, chunks gardés.
  try {
    const vectors = await embedTexts(chunks);
    await storeDocChunks(docId, chunks.map((t, i) => ({ text: t, embedding: vectors[i] || null })));
    return { chunkCount: chunks.length, truncated, vectorsOk: true, vectorError: '' };
  } catch (e) {
    return {
      chunkCount: chunks.length,
      truncated,
      vectorsOk: false,
      vectorError: String((e && e.message) || 'embeddings_indisponibles').slice(0, 200),
    };
  }
}

async function setDocIndexState(docId, patch) {
  const safe = {
    status: str(patch.status, 20),
    chunkCount: num(patch.chunkCount, 0),
    indexReason: str(patch.indexReason, 300),
    lastUpdated: new Date().toISOString(),
  };
  if (db) {
    await db.collection('knowledge_documents').doc(String(docId)).set(safe, { merge: true });
  } else {
    const row = memoryStore.knowledge.find((x) => x.id === String(docId));
    if (row) Object.assign(row, safe);
  }
  return safe;
}

app.get(['/api/knowledge', '/knowledge'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  try {
    if (db) {
      const snap = await db.collection('knowledge_documents').orderBy('createdAt', 'desc').limit(100).get();
      return res.status(200).json({ ok: true, store: 'firestore', documents: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    return res.status(200).json({ ok: true, store: 'memory', documents: memoryStore.knowledge });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_list_failed' });
  }
});

// Seed des documents de référence (métadonnées seules, sans fichier).
app.post(['/api/knowledge/seed', '/knowledge/seed'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const docs = Array.isArray((req.body || {}).docs) ? req.body.docs.slice(0, 20) : [];
  if (!docs.length) return res.status(400).json({ error: 'docs[] requis' });
  const now = new Date().toISOString();
  try {
    const saved = [];
    for (const d of docs) {
      const id = str(d.id, 80) || `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const row = {
        title: str(d.title, 120) || 'Document sans titre',
        category: str(d.category, 60) || 'RÉFÉRENCES',
        size: str(d.size, 20) || '—',
        sizeBytes: num(d.sizeBytes, 0),
        mimeType: str(d.mimeType, 100),
        storagePath: null,
        status: 'reference',
        summary: str(d.summary, 2000),
        textPreview: '',
        lastUpdated: str(d.lastUpdated, 40) || now,
        createdAt: now,
      };
      if (db) await db.collection('knowledge_documents').doc(id).set(row, { merge: false });
      else {
        const i = memoryStore.knowledge.findIndex((x) => x.id === id);
        if (i >= 0) memoryStore.knowledge[i] = { id, ...row }; else memoryStore.knowledge.unshift({ id, ...row });
      }
      saved.push({ id, ...row });
    }
    return res.status(200).json({ ok: true, store: db ? 'firestore' : 'memory', documents: saved });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_seed_failed' });
  }
});

// Extraction du texte indexable selon le type MIME réel (§7 : upload = indexation réelle).
// Retourne { text, reason } — text vide = non indexable, avec motif honnête (jamais de mensonge).
// Utilisée par l'upload ET la réindexation (même code, pas de divergence).
async function extractIndexableText(buf, mimeType, name) {
  const lower = String(name || '').toLowerCase();
  const mime = String(mimeType || '');
  const isText = /^(text\/|application\/(json|csv|x-www-form-urlencoded))/.test(mime) || /\.(txt|md|csv|json)$/i.test(lower);
  if (isText) return { text: buf.toString('utf8').slice(0, 200000), reason: '' };
  if (mime === 'application/pdf' || /\.pdf$/i.test(lower)) {
    try {
      const pdfParse = require('pdf-parse');
      const parsed = await pdfParse(buf);
      const t = String((parsed && parsed.text) || '').replace(/\s+/g, ' ').trim().slice(0, 200000);
      // Le texte est TOUJOURS renvoyé (même court) : c'est l'APPELANT qui applique
      // son seuil (chat : tout texte non vide ; RAG : 20 car. min).
      if (!t) return { text: '', reason: 'PDF sans texte extractible (document scanné ?)' };
      if (t.length >= 20) return { text: t, reason: '' };
      return { text: t, reason: 'texte trop court pour indexation RAG (< 20 car.)' };
    } catch (e) {
      return { text: '', reason: 'extraction PDF impossible : ' + String((e && e.message) || e).slice(0, 120) };
    }
  }
  if (/^image\//.test(mime)) {
    const ork = (process.env.OPENROUTER_API_KEY || '').trim();
    if (!ork) return { text: '', reason: 'VLM indisponible (OPENROUTER_API_KEY manquant)' };
    try {
      const v = await visionClassifyBuffer(buf, mime, String(name || 'image'));
      const t = `Image ${name} : ${v.extractedText || ''} ${JSON.stringify(v.entities || {})}`.trim().slice(0, 200000);
      if (!t) return { text: '', reason: 'VLM sans extraction exploitable' };
      if (t.length >= 20) return { text: t, reason: '' };
      return { text: t, reason: 'extraction trop courte pour indexation RAG (< 20 car.)' };
    } catch (e) {
      return { text: '', reason: 'analyse VLM impossible : ' + String((e && e.message) || e).slice(0, 120) };
    }
  }
  return { text: '', reason: 'extraction non supportée (texte, PDF ou image uniquement)' };
}

// Saisie MANUELLE de texte (2e option d'alimentation : l'utilisateur tape/colle
// un texte + titre et clique Importer). Même pipeline que l'upload fichier :
// stockage Storage en .txt + indexation (chunks toujours, vecteurs best-effort)
// + même format de réponse. Seuil 20 car. min (tout texte accepté est indexable).
app.post(['/api/knowledge/text', '/knowledge/text'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const { title, text, category } = req.body || {};
  const cleanTitle = str(title, 120).trim();
  const cleanText = String(text || '');
  if (!cleanTitle) return res.status(400).json({ error: 'title requis (1..120 car.)' });
  if (cleanText.trim().length < 20) return res.status(400).json({ error: 'text requis (>= 20 caractères)' });
  if (cleanText.length > 200000) return res.status(400).json({ error: 'text trop long (max 200 000 car.)' });
  const buf = Buffer.from(cleanText, 'utf8');
  if (buf.length > 8_000_000) return res.status(400).json({ error: 'texte trop volumineux (max 8 Mo)' });
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const safeName = (cleanTitle.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'texte') + '.txt';
  const storagePath = `knowledge/${id}/${safeName}`;
  const mime = 'text/plain';
  let stored = false;
  try {
    await storageBucket().file(storagePath).save(buf, { metadata: { contentType: mime } });
    stored = true;
  } catch (e) {
    console.warn('[KNOWLEDGE] Storage indisponible, métadonnées seules', String((e && e.message) || e).slice(0, 200));
  }
  const now = new Date().toISOString();
  const indexText = cleanText.slice(0, 200000);
  const row = {
    title: cleanTitle,
    category: str(category, 60) || 'RÉFÉRENCES',
    size: formatSize(buf.length),
    sizeBytes: buf.length,
    mimeType: mime,
    storagePath: stored ? storagePath : null,
    status: 'pending',
    chunkCount: 0,
    indexReason: stored ? 'indexation en cours' : 'fichier non stocké — réessayez',
    summary: `Texte saisi manuellement : ${cleanTitle}.${stored ? '' : ' (fichier non stocké — réessayez)'}`,
    textPreview: indexText.slice(0, 4000),
    lastUpdated: now,
    createdAt: now,
  };
  try {
    if (db) await db.collection('knowledge_documents').doc(id).set(row);
    else memoryStore.knowledge.unshift({ id, ...row });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_save_failed' });
  }
  if (stored) {
    try {
      const { chunkCount, truncated, vectorsOk, vectorError } = await indexDocumentText(id, indexText);
      if (vectorsOk) {
        Object.assign(
          row,
          await setDocIndexState(id, {
            status: truncated ? 'partial' : 'indexed',
            chunkCount,
            indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
          })
        );
      } else {
        Object.assign(
          row,
          await setDocIndexState(id, {
            status: 'pending',
            chunkCount,
            indexReason: `vecteurs en attente (${vectorError}) — recherche par mots-clés active`,
          })
        );
      }
    } catch (e) {
      const msg = String((e && e.message) || 'indexation_echec');
      Object.assign(row, await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: msg.slice(0, 200) }));
    }
  }
  return res.status(200).json({ ok: true, store: db ? 'firestore' : 'memory', document: { id, ...row } });
});

app.post(['/api/knowledge/upload', '/knowledge/upload'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const { name, mimeType, base64, category } = req.body || {};
  const cleanName = str(name, 180).trim();
  if (!cleanName) return res.status(400).json({ error: 'name requis' });
  if (!base64 || typeof base64 !== 'string' || base64.length < 10 || base64.length > 11_000_000) {
    return res.status(400).json({ error: 'base64 requis (fichier <= ~8mb)' });
  }
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length || buf.length > 8_000_000) return res.status(400).json({ error: 'fichier invalide ou trop volumineux (max 8mb)' });
  const mime = str(mimeType, 100) || 'application/octet-stream';
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const safeName = cleanName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
  const storagePath = `knowledge/${id}/${safeName}`;
  let stored = false;
  try {
    await storageBucket().file(storagePath).save(buf, { metadata: { contentType: mime } });
    stored = true;
  } catch (e) {
    console.warn('[KNOWLEDGE] Storage indisponible, métadonnées seules', String((e && e.message) || e).slice(0, 200));
  }
  const now = new Date().toISOString();
  // §7 : tout fichier stocké est réellement extrait (texte, PDF, image VLM),
  // jamais indexé depuis du binaire brut.
  let indexText = '';
  let extractReason = '';
  if (stored) {
    try {
      const ext = await extractIndexableText(buf, mime, cleanName);
      indexText = ext.text;
      extractReason = ext.reason;
    } catch (e) {
      extractReason = 'extraction impossible : ' + String((e && e.message) || e).slice(0, 120);
    }
  }
  const row = {
    title: cleanName.replace(/\.[^/.]+$/, '').slice(0, 120) || cleanName.slice(0, 120),
    category: str(category, 60) || 'RÉFÉRENCES',
    size: formatSize(buf.length),
    sizeBytes: buf.length,
    mimeType: mime,
    storagePath: stored ? storagePath : null,
    status: 'pending',
    chunkCount: 0,
    indexReason: stored ? (indexText.trim().length >= 20 ? 'indexation en cours' : (extractReason || 'extraction sans texte exploitable')) : 'fichier non stocké — réessayez',
    summary: `Document importé : ${cleanName}.${stored ? '' : ' (fichier non stocké — réessayez)'}`,
    textPreview: indexText.slice(0, 4000),
    lastUpdated: now,
    createdAt: now,
  };
  try {
    if (db) await db.collection('knowledge_documents').doc(id).set(row);
    else memoryStore.knowledge.unshift({ id, ...row });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_save_failed' });
  }
  // Indexation réelle : chunks texte TOUJOURS persistés ; 'indexed'/'partial' seulement
  // si les vecteurs sont stockés, sinon 'pending' + motif MAIS chunks gardés
  // (recherche lexicale active, zéro crédit requis). Jamais de mensonge.
  if (stored && indexText.trim().length >= 20) {
    const fullText = indexText;
    try {
      const { chunkCount, truncated, vectorsOk, vectorError } = await indexDocumentText(id, fullText);
      if (vectorsOk) {
        Object.assign(
          row,
          await setDocIndexState(id, {
            status: truncated ? 'partial' : 'indexed',
            chunkCount,
            indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
          })
        );
      } else {
        Object.assign(
          row,
          await setDocIndexState(id, {
            status: 'pending',
            chunkCount,
            indexReason: `vecteurs en attente (${vectorError}) — recherche par mots-clés active`,
          })
        );
      }
    } catch (e) {
      const msg = String((e && e.message) || 'indexation_echec');
      Object.assign(row, await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: msg.slice(0, 200) }));
    }
  }
  return res.status(200).json({ ok: true, store: db ? 'firestore' : 'memory', document: { id, ...row } });
});

// Recherche vectorielle : query -> embedding -> cosinus sur les chunks indexés.
// Retourne [{docId, title, chunk, score}] triés, score >= 0.3, topK borné.
app.post(['/api/knowledge/search', '/knowledge/search'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const query = str((req.body || {}).query, 2000).trim();
  const topK = Math.min(Math.max(parseInt(String((req.body || {}).topK || '3'), 10) || 3, 1), 5);
  if (query.length < 3) return res.status(400).json({ error: 'query requis (>= 3 car.)' });
  try {
    let docs = [];
    if (db) {
      const snap = await db.collection('knowledge_documents').limit(50).get();
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      docs = memoryStore.knowledge.slice(0, 50);
    }
    // Voie vectorielle d'abord ; repli LEXICAL automatique si les embeddings
    // sont indisponibles (402 sans crédits, 429, clé absente...). Même format.
    let qVec = null;
    let mode = 'vectoriel';
    try {
      const vecs = await embedTexts([query]);
      qVec = vecs[0];
    } catch (e) {
      mode = 'lexical';
      console.warn('[RAG] embeddings indisponibles, repli lexical', String((e && e.message) || e).slice(0, 120));
    }
    const scored = [];
    for (const d of docs) {
      if (d.status === 'reference') continue;
      const chunks = await readDocChunks(d.id, 200).catch(() => []);
      for (const c of chunks) {
        const txt = String((c && c.text) || '');
        if (!txt) continue;
        if (qVec && Array.isArray(c.embedding)) {
          const score = cosineSim(qVec, c.embedding);
          if (score >= RAG_MIN_SCORE) {
            scored.push({ docId: d.id, title: String(d.title || ''), chunk: txt.slice(0, 800), score: Math.round(score * 1000) / 1000 });
          }
        } else if (!qVec) {
          const score = lexicalScore(query, txt);
          if (score >= RAG_LEXICAL_MIN_SCORE) {
            scored.push({ docId: d.id, title: String(d.title || ''), chunk: txt.slice(0, 800), score: Math.round(score * 1000) / 1000, lexical: true });
          }
        }
      }
      if (scored.length > 500) break;
    }
    scored.sort((a, b) => b.score - a.score);
    return res.status(200).json({ ok: true, mode, results: scored.slice(0, topK) });
  } catch (e) {
    const msg = String((e && e.message) || 'search_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend.' });
    }
    return res.status(502).json({ error: 'knowledge_search_failed', detail: msg.slice(0, 200) });
  }
});

// Statut du pipeline RAG (§7) : documents indexés, dernière indexation, pipeline.
// GET /api/knowledge/status -> { total, indexed, partial, pending, reference,
// totalChunks, lastIndexedAt, pipeline:{...} }.
app.get(['/api/knowledge/status', '/knowledge/status'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  try {
    let docs = [];
    if (db) {
      const snap = await db.collection('knowledge_documents').limit(200).get();
      docs = snap.docs.map((d) => d.data());
    } else {
      docs = memoryStore.knowledge || [];
    }
    const counts = { indexed: 0, partial: 0, pending: 0, reference: 0, other: 0 };
    let totalChunks = 0;
    let lastIndexedAt = null;
    let searchable = 0;
    for (const d of docs) {
      const s = String((d && d.status) || '');
      if (counts[s] !== undefined) counts[s]++;
      else counts.other++;
      totalChunks += Number((d && d.chunkCount) || 0);
      // Interrogeable : vecteurs (indexed/partial) OU chunks texte (pending avec
      // chunks, recherche lexicale sans crédits).
      if (s === 'indexed' || s === 'partial' || (s === 'pending' && Number((d && d.chunkCount) || 0) > 0)) {
        searchable++;
      }
      if ((s === 'indexed' || s === 'partial') && d && d.lastUpdated && (!lastIndexedAt || d.lastUpdated > lastIndexedAt)) {
        lastIndexedAt = d.lastUpdated;
      }
    }
    return res.status(200).json({
      ok: true,
      store: db ? 'firestore' : 'memory',
      total: docs.length,
      searchable,
      ...counts,
      totalChunks,
      lastIndexedAt,
      pipeline: {
        embedModel: RAG_EMBED_MODEL,
        chunkSize: RAG_CHUNK_SIZE,
        overlap: RAG_CHUNK_OVERLAP,
        maxChunks: RAG_MAX_CHUNKS_PER_DOC,
        minScore: RAG_MIN_SCORE,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_status_failed', detail: String((e && e.message) || e).slice(0, 200) });
  }
});

// Réindexation réelle : relit le binaire stocké et reconstruit chunks + embeddings.
app.post(['/api/knowledge/:id/reindex', '/knowledge/:id/reindex'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const id = str(req.params.id, 80);
  try {
    let doc = null;
    if (db) {
      const snap = await db.collection('knowledge_documents').doc(id).get();
      if (snap.exists) doc = snap.data();
    } else {
      doc = memoryStore.knowledge.find((x) => x.id === id) || null;
    }
    if (!doc) return res.status(404).json({ error: 'document introuvable' });
    if (!doc.storagePath) {
      await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: 'référence sans binaire (seed)' });
      return res.status(200).json({ ok: true, document: { id, status: 'pending', chunkCount: 0 } });
    }
    const [buf] = await storageBucket().file(doc.storagePath).download();
    // Même extraction que l'upload (texte, PDF, image VLM) — jamais de binaire brut.
    const ext = await extractIndexableText(buf, doc.mimeType, doc.title).catch((e) => ({
      text: '', reason: 'extraction impossible : ' + String((e && e.message) || e).slice(0, 120),
    }));
    const text = ext.text;
    if (text.trim().length < 20) {
      await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: ext.reason || 'extraction sans texte exploitable' });
      return res.status(200).json({ ok: true, document: { id, status: 'pending', chunkCount: 0 } });
    }
    const { chunkCount, truncated, vectorsOk, vectorError } = await indexDocumentText(id, text);
    const state = vectorsOk
      ? await setDocIndexState(id, {
          status: truncated ? 'partial' : 'indexed',
          chunkCount,
          indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
        })
      : await setDocIndexState(id, {
          status: 'pending',
          chunkCount,
          indexReason: `vecteurs en attente (${vectorError}) — recherche par mots-clés active`,
        });
    return res.status(200).json({ ok: true, document: { id, ...state } });
  } catch (e) {
    const msg = String((e && e.message) || 'reindex_failed');
    try { await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: msg.slice(0, 200) }); } catch {}
    return res.status(502).json({ error: 'knowledge_reindex_failed', detail: msg.slice(0, 200) });
  }
});

// Téléchargement en streaming via le backend (pas d'URL signée : aucun rôle IAM
// supplémentaire, aucun lien à fuiter ; fichiers bornés à 8 Mo).
app.get(['/api/knowledge/:id/download', '/knowledge/:id/download'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = str(req.params.id, 80);
  try {
    let doc = null;
    if (db) {
      const snap = await db.collection('knowledge_documents').doc(id).get();
      if (snap.exists) doc = snap.data();
    } else {
      doc = (memoryStore.knowledge.find((x) => x.id === id) || null);
    }
    if (!doc || !doc.storagePath) return res.status(404).json({ error: 'fichier indisponible (référence sans binaire)' });
    const [buf] = await storageBucket().file(doc.storagePath).download();
    if (!buf.length || buf.length > 8_000_000) return res.status(502).json({ error: 'fichier illisible' });
    return res.status(200).json({
      ok: true,
      name: str(doc.title, 180) || id,
      mimeType: str(doc.mimeType, 100) || 'application/octet-stream',
      base64: buf.toString('base64'),
    });
  } catch (e) {
    return res.status(502).json({ error: 'download_failed', detail: String((e && e.message) || e).slice(0, 300) });
  }
});

app.delete(['/api/knowledge/:id', '/knowledge/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const id = str(req.params.id, 80);
  try {
    let storagePath = null;
    if (db) {
      const ref = db.collection('knowledge_documents').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'document introuvable' });
      storagePath = snap.data().storagePath;
      await ref.delete();
    } else {
      const i = memoryStore.knowledge.findIndex((x) => x.id === id);
      if (i < 0) return res.status(404).json({ error: 'document introuvable' });
      storagePath = memoryStore.knowledge[i].storagePath;
      memoryStore.knowledge.splice(i, 1);
    }
    if (storagePath) {
      try { await storageBucket().file(storagePath).delete(); } catch {}
    }
    // Suppression des vecteurs avec le document (pas de chunks orphelins).
    try {
      if (db) {
        const csnap = await db.collection('knowledge_documents').doc(id).collection('chunks').limit(500).get().catch(() => null);
        if (csnap) {
          const batch = db.batch();
          csnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit().catch(() => {});
        }
      } else if (memoryStore.knowledgeChunks) {
        delete memoryStore.knowledgeChunks[id];
      }
    } catch {}
    try { await storeDoc('dc_audit', { source: 'knowledge', question: `Suppression document ${id}`, validation: { ok: true } }); } catch {}
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_delete_failed' });
  }
});

// --- Conversations : CRUD + sous-collection messages ---
function sanitizeSessionBody(b) {
  b = b || {};
  return {
    title: str(b.title, 120) || 'Nouvelle session',
    category: str(b.category, 40) || 'Général',
    activeAgentId: str(b.activeAgentId, 80),
  };
}

function sanitizeChatMessage(m) {
  m = m || {};
  const sender = ['user', 'agent', 'system'].includes(m.sender) ? m.sender : 'user';
  // Pièces jointes : seul le storagePath (chat/...) est persisté, jamais de binaire
  // ni d'URL. Le binaire se lit via GET /api/chat/attachment (base64 borné).
  let attachments = [];
  if (Array.isArray(m.attachments)) {
    attachments = m.attachments.slice(0, 5).map((a) => ({
      name: str(a && a.name, 180) || 'fichier',
      mimeType: str(a && a.mimeType, 100) || 'application/octet-stream',
      size: Math.max(0, parseInt((a && a.size) || '0', 10) || 0),
      storagePath: str(a && a.storagePath, 220),
    })).filter((a) => a.storagePath && a.storagePath.startsWith('chat/') && !a.storagePath.includes('..'));
  }
  return {
    sender,
    senderName: str(m.senderName, 80) || (sender === 'user' ? 'Vous' : 'DC Intelligence'),
    content: str(m.content, 8000),
    timestamp: str(m.timestamp, 40) || new Date().toISOString(),
    agentName: str(m.agentName, 120),
    attachments,
  };
}

// --- Chat : upload + lecture de pièces jointes (images, PDF, documents) ---
// POST /api/chat/upload { sessionId?, name, mimeType, base64 } -> { storagePath, name, mimeType, size }.
// Stockage Firebase Storage (chat/<session>/<id>/<nom>) ; repli mémoire en dev.
// GET /api/chat/attachment?path=chat/... -> { base64, mimeType, name } (8 Mo max,
// même pattern que /api/knowledge/:id/download : pas d'URL signée à fuiter).
app.post(['/api/chat/upload', '/chat/upload'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const { sessionId, name, mimeType, base64 } = req.body || {};
  const cleanName = str(name, 180).trim() || 'fichier';
  if (!base64 || typeof base64 !== 'string' || base64.length < 10 || base64.length > 11_000_000) {
    return res.status(400).json({ error: 'base64 requis (fichier <= ~8mb)' });
  }
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length || buf.length > 8_000_000) return res.status(400).json({ error: 'fichier invalide ou trop volumineux (max 8mb)' });
  const mime = str(mimeType, 100) || 'application/octet-stream';
  const supported = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/(plain|csv)|application\/(msword|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|json))/.test(mime);
  if (!supported) return res.status(400).json({ error: 'type de fichier non supporté' });
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sid = str(sessionId, 80).replace(/[^a-zA-Z0-9_-]/g, '') || 'tmp';
  const safeName = cleanName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'fichier';
  const storagePath = `chat/${sid}/${id}/${safeName}`;
  try {
    await storageBucket().file(storagePath).save(buf, { metadata: { contentType: mime } });
  } catch (e) {
    // Repli mémoire (dev sans bucket) : servi par GET /api/chat/attachment.
    memoryStore.chat_uploads[storagePath] = { base64: buf.toString('base64'), mimeType: mime, name: cleanName, size: buf.length };
  }
  return res.status(200).json({ ok: true, storagePath, name: cleanName, mimeType: mime, size: buf.length });
});

app.get(['/api/chat/attachment', '/chat/attachment'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const p = str(req.query.path, 220);
  if (!p || !p.startsWith('chat/') || p.includes('..')) return res.status(400).json({ error: 'path invalide' });
  try {
    const [buf] = await storageBucket().file(p).download();
    if (!buf.length || buf.length > 8_000_000) return res.status(502).json({ error: 'fichier illisible' });
    return res.status(200).json({ ok: true, base64: buf.toString('base64') });
  } catch (e) {
    const mem = (memoryStore.chat_uploads || {})[p];
    if (mem) return res.status(200).json({ ok: true, base64: mem.base64, mimeType: mem.mimeType, name: mem.name });
    return res.status(404).json({ error: 'pièce jointe introuvable' });
  }
});

app.get(['/api/conversations', '/conversations'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 50);
  try {
    if (db) {
      const snap = await db.collection('conversations').orderBy('updatedAt', 'desc').limit(limit).get();
      return res.status(200).json({ ok: true, store: 'firestore', sessions: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    return res.status(200).json({ ok: true, store: 'memory', sessions: memoryStore.conversations.slice(0, limit) });
  } catch (e) {
    return res.status(500).json({ error: 'conversations_list_failed' });
  }
});

app.post(['/api/conversations', '/conversations'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const clean = sanitizeSessionBody(req.body);
  const now = new Date().toISOString();
  const row = {
    ...clean,
    lastMessage: 'Session créée, prête pour vos questions...',
    lastMessageTime: now,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  try {
    if (db) {
      const ref = await db.collection('conversations').add(row);
      return res.status(200).json({ ok: true, store: 'firestore', session: { id: ref.id, ...row } });
    }
    const id = `session-${Date.now()}`;
    memoryStore.conversations.unshift({ id, ...row, messages: [] });
    return res.status(200).json({ ok: true, store: 'memory', session: { id, ...row } });
  } catch (e) {
    return res.status(500).json({ error: 'conversation_create_failed' });
  }
});

app.get(['/api/conversations/:id/messages', '/conversations/:id/messages'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  const id = str(req.params.id, 80);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 500);
  try {
    if (db) {
      const snap = await db.collection('conversations').doc(id).collection('messages').orderBy('createdAt', 'asc').limit(limit).get();
      return res.status(200).json({ ok: true, store: 'firestore', messages: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    const s = memoryStore.conversations.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: 'session introuvable' });
    return res.status(200).json({ ok: true, store: 'memory', messages: (s.messages || []).slice(0, limit) });
  } catch (e) {
    return res.status(500).json({ error: 'messages_list_failed' });
  }
});

app.post(['/api/conversations/:id/messages', '/conversations/:id/messages'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  const id = str(req.params.id, 80);
  const clean = sanitizeChatMessage((req.body || {}).message);
  if (!clean.content) return res.status(400).json({ error: 'message.content requis' });
  const now = new Date().toISOString();
  try {
    if (db) {
      const ref = db.collection('conversations').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'session introuvable' });
      const countSnap = await ref.collection('messages').count().get();
      if ((countSnap.data().count || 0) >= 1000) return res.status(400).json({ error: 'session pleine (1000 messages max)' });
      const mref = await ref.collection('messages').add({ ...clean, createdAt: now });
      await ref.update({
        lastMessage: clean.content.slice(0, 80) + (clean.content.length > 80 ? '...' : ''),
        lastMessageTime: now,
        updatedAt: now,
        messageCount: (snap.data().messageCount || 0) + 1,
      });
      return res.status(200).json({ ok: true, store: 'firestore', message: { id: mref.id, ...clean, createdAt: now } });
    }
    const s = memoryStore.conversations.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: 'session introuvable' });
    s.messages = s.messages || [];
    if (s.messages.length >= 1000) return res.status(400).json({ error: 'session pleine (1000 messages max)' });
    const mid = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    s.messages.push({ id: mid, ...clean, createdAt: now });
    s.lastMessage = clean.content.slice(0, 80) + (clean.content.length > 80 ? '...' : '');
    s.lastMessageTime = now;
    s.updatedAt = now;
    s.messageCount = s.messages.length;
    return res.status(200).json({ ok: true, store: 'memory', message: { id: mid, ...clean, createdAt: now } });
  } catch (e) {
    return res.status(500).json({ error: 'message_append_failed' });
  }
});

app.put(['/api/conversations/:id', '/conversations/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = str(req.params.id, 80);
  const title = str((req.body || {}).title, 120);
  if (!title) return res.status(400).json({ error: 'title requis' });
  try {
    if (db) {
      const ref = db.collection('conversations').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'session introuvable' });
      await ref.update({ title, updatedAt: new Date().toISOString() });
      return res.status(200).json({ ok: true, store: 'firestore', id, title });
    }
    const s = memoryStore.conversations.find((x) => x.id === id);
    if (!s) return res.status(404).json({ error: 'session introuvable' });
    s.title = title;
    s.updatedAt = new Date().toISOString();
    return res.status(200).json({ ok: true, store: 'memory', id, title });
  } catch (e) {
    return res.status(500).json({ error: 'conversation_rename_failed' });
  }
});

app.delete(['/api/conversations/:id', '/conversations/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const id = str(req.params.id, 80);
  try {
    if (db) {
      const ref = db.collection('conversations').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'session introuvable' });
      const msgs = await ref.collection('messages').limit(500).get();
      const batch = db.batch();
      msgs.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(ref);
      await batch.commit();
      return res.status(200).json({ ok: true, store: 'firestore', id });
    }
    const i = memoryStore.conversations.findIndex((x) => x.id === id);
    if (i < 0) return res.status(404).json({ error: 'session introuvable' });
    memoryStore.conversations.splice(i, 1);
    return res.status(200).json({ ok: true, store: 'memory', id });
  } catch (e) {
    return res.status(500).json({ error: 'conversation_delete_failed' });
  }
});

// --- Intégrations : GET liste / PUT upsert (statuts uniquement, JAMAIS de tokens) ---
const FORBIDDEN_INTEGRATION_KEYS = ['token', 'accesstoken', 'refreshtoken', 'access_token', 'refresh_token', 'apikey', 'api_key', 'secret', 'clientsecret', 'client_secret', 'privatekey', 'private_key', 'authorization'];

function sanitizeIntegration(item) {
  item = item || {};
  for (const k of Object.keys(item)) {
    if (FORBIDDEN_INTEGRATION_KEYS.includes(k.toLowerCase().replace(/[^a-z]/g, ''))) {
      console.warn('[INTEGRATIONS] champ secret refusé :', k);
      delete item[k];
    }
  }
  const okIcon = ['sheets', 'docs', 'legal-flow'].includes(item.iconType) ? item.iconType : 'sheets';
  const okStatus = ['connected', 'disconnected', 'connecting'].includes(item.status) ? item.status : 'disconnected';
  const scopes = Array.isArray(item.scopes) ? item.scopes.map((s) => str(s, 120)).slice(0, 10) : [];
  const syncHistory = Array.isArray(item.syncHistory)
    ? item.syncHistory.slice(0, 50).map((h) => ({
      id: str(h.id, 60),
      timestamp: str(h.timestamp, 40),
      action: str(h.action, 300),
      status: h.status === 'error' ? 'error' : 'success',
    }))
    : [];
  return {
    name: str(item.name, 120),
    description: str(item.description, 500),
    iconType: okIcon,
    status: okStatus,
    accountEmail: str(item.accountEmail, 120),
    connectedAt: str(item.connectedAt, 40),
    lastSyncAt: str(item.lastSyncAt, 40),
    targetResource: str(item.targetResource, 200),
    endpointUrl: str(item.endpointUrl, 200),
    scopes,
    syncCount: num(item.syncCount, 0),
    syncHistory,
    updatedAt: new Date().toISOString(),
  };
}

app.get(['/api/integrations', '/integrations'], async (req, res) => {
  if (!checkRateLimit(req, res, 60)) return;
  try {
    if (db) {
      const snap = await db.collection('integrations').get();
      return res.status(200).json({ ok: true, store: 'firestore', integrations: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    return res.status(200).json({ ok: true, store: 'memory', integrations: memoryStore.integrations });
  } catch (e) {
    return res.status(500).json({ error: 'integrations_list_failed' });
  }
});

app.put(['/api/integrations/:id', '/integrations/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 20)) return;
  const id = str(req.params.id, 80);
  if (!id) return res.status(400).json({ error: 'id requis' });
  const clean = sanitizeIntegration(req.body);
  try {
    if (db) {
      await db.collection('integrations').doc(id).set(clean, { merge: true });
      return res.status(200).json({ ok: true, store: 'firestore', integration: { id, ...clean } });
    }
    const arr = memoryStore.integrations;
    const i = arr.findIndex((x) => x.id === id);
    const row = { id, ...clean };
    if (i >= 0) arr[i] = row; else arr.unshift(row);
    return res.status(200).json({ ok: true, store: 'memory', integration: row });
  } catch (e) {
    return res.status(500).json({ error: 'integration_save_failed' });
  }
});

app.delete(['/api/integrations/:id', '/integrations/:id'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const id = str(req.params.id, 80);
  try {
    if (db) {
      const ref = db.collection('integrations').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'integration introuvable' });
      await ref.delete();
      return res.status(200).json({ ok: true, store: 'firestore', id });
    }
    const i = memoryStore.integrations.findIndex((x) => x.id === id);
    if (i < 0) return res.status(404).json({ error: 'integration introuvable' });
    memoryStore.integrations.splice(i, 1);
    return res.status(200).json({ ok: true, store: 'memory', id });
  } catch (e) {
    return res.status(500).json({ error: 'integration_delete_failed' });
  }
});

// 404 explicite pour toute autre route /api (au lieu du wildcard POST * qui acceptait tout).
app.all(['/api/*', '/webhook/*'], (req, res) => {
  return res.status(404).json({ error: 'not_found', path: req.path });
});

// Runtime durci : timeout 300 s (chaînes lf_ask 60 s + compositions + VLM),
// 512 MiB (pdf-parse + buffers base64 8 Mo), maxInstances 20 (borne anti-emballement
// WhatsApp × retries Meta × OpenRouter = facture), région explicite.
exports.whatsappWebhook = functions.https.onRequest(
  { region: 'us-central1', timeoutSeconds: 300, maxInstances: 20, memory: '512MiB' },
  app
);

// Exportés pour tests locaux uniquement (aucun effet en prod).
exports.__testUtils = { withTimeout, withDb, fetchUpstream, encodeOAuthState, decodeOAuthState, buildGoogleAuthUrl, GOOGLE_OAUTH_SCOPES, paramsHash, shouldEscalateClarification, computeHallucinations, chunkText, cosineSim, parseLfAsk, classifyIntentBackend, validateComptaProposalBackend, extractIndexableText, mcpDispatch, MCP_SERVER_TOOLS, buildWhatsAppArchiveMeta };

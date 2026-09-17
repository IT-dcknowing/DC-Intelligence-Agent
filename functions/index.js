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
const memoryStore = { audit: [], tasks: [], agents: [], knowledge: [], conversations: [], integrations: [], wa_conversations: [], wa_events: [], user_signals: [], tool_calls: [] };

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
    max_tokens: maxTokens || 1500,
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

  // Classification (texte / image / audio).
  let docType = 'general_query';
  let extractedText = textBody;
  let entities = {};
  let confidence = 0.6;
  try {
    if (type === 'audio' && msg.audio && msg.audio.id) {
      const buf = await withTimeout(wa.downloadMedia(msg.audio.id), 20000, 'media_timeout');
      const tr = await withTimeout(transcribeAudioBuffer(buf, 'audio/ogg'), 30000, 'stt_timeout');
      extractedText = (tr.text || '').trim();
    } else if ((type === 'image' || type === 'document') && (msg.image || msg.document)) {
      const mediaId = (msg.image && msg.image.id) || (msg.document && msg.document.id);
      const caption = (msg.image && msg.image.caption) || (msg.document && msg.document.caption) || textBody;
      const buf = await withTimeout(wa.downloadMedia(mediaId), 25000, 'media_timeout');
      const v = await withTimeout(visionClassifyBuffer(buf, 'image/jpeg', caption), 40000, 'vlm_timeout');
      docType = v.documentType; extractedText = v.extractedText; entities = v.entities || {}; confidence = v.confidence;
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

  if (!extractedText && !hasMedia) {
    waConv.transition(conv, waConv.STATES.WAITING_USER);
    await wa.sendText(from, 'Je n’ai pas bien saisi votre message. Pouvez-vous me le reformuler, ou m’envoyer le document en photo ?');
    waConv.transition(conv, waConv.STATES.COMPLETED);
    waUpsertConversation(from, { stage: 'WAITING_USER' });
    return { state: conv.state };
  }

  // Routage explicite (refonte §3.2/§6/§8.2-8.3).
  const route = waConv.routeText(`${extractedText} ${docType}`);
  if (docType === 'tax_notice' || docType === 'legal_contract') { route.domain = 'JURIDIQUE_FISCAL'; route.agent = 'legal'; }
  else if (docType === 'invoice') { route.domain = 'COMPTABILITÉ'; route.agent = 'compta'; }
  else if (docType === 'bank_statement') { route.domain = 'RAPPROCHEMENT'; route.agent = 'reco'; }
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
  const composeMessages = [
    { role: 'system', content: `${waConv.PERSONA_SYSTEM} Contexte dossier : entreprise=${companyLabel || 'non identifiée'}, domaine=${route.domain}. ${dossierContext || 'Premier contact.'}${correctionNote} Actions réellement effectuées : ${actionsReelles.join(' → ') || 'AUCUNE — ne prétends à aucune vérification'}. Données outils : ${toolContext.slice(0, 4000) || 'aucune'}. Tu restes l’Agent d’Accueil : transmets le résultat, sans changer de rôle. Si les données sont insuffisantes, dis ce qu’il te manque au lieu d’inventer.` },
    { role: 'user', content: `${isCorrection ? 'CORRECTION (remplace ma demande précédente) — ' : ''}Message client (${docType}, confiance ${confidence}) : ${extractedText.slice(0, 2500)}${entities && entities.amount ? ` [montant détecté : ${entities.amount}]` : ''}` },
  ];
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
        model: primaryModel, messages: composeMessages, temperature: 0.4, maxTokens: 700,
      }), 16000, 'compose_timeout');
      console.log(`[WA STEP] wamid=${wamid} étape=composition_ok modèle=${primaryModel} len=${answer.length}`);
    } catch (e1) {
      console.warn('[WA] composition repli 2e modèle', String((e1 && e1.message) || e1).slice(0, 150));
      await say(waConv.PRESENCE.oneMoreCheck); // RÉEL : on relance vraiment une composition
      answer = await withTimeout(openRouterChat({
        model: fallbackModel, messages: composeMessages, temperature: 0.4, maxTokens: 700,
      }), 16000, 'compose_timeout2');
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
      validation: { ok: true, via: 'wa_pipeline', state: conv.state, docType },
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
function buildGoogleAuthUrl(integration) {
  if (!GOOGLE_OAUTH_SCOPES[integration]) {
    throw Object.assign(new Error('integration inconnue (google-sheets | google-docs)'), { status: 400 });
  }
  const oauth2 = googleOAuthClient();
  const { redirectUri } = googleOAuthConf();
  const url = oauth2.generateAuthUrl({
      access_type: 'offline', // indispensable : délivre le refresh_token permanent
      prompt: 'consent', // force le consentement -> garantit un refresh_token à chaque connexion
      scope: GOOGLE_OAUTH_SCOPES[integration],
      state: encodeOAuthState(integration, req.query.origin),
      redirect_uri: redirectUri,
    });
    return { url, redirectUri };
}

app.get(['/api/google/auth-url', '/google/auth-url'], async (req, res) => {
  if (!checkRateLimit(req, res, 10)) return;
  const integration = String(req.query.integration || 'google-sheets');
  try {
    const { url, redirectUri } = buildGoogleAuthUrl(integration);
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
app.post(['/api/chat', '/chat'], async (req, res) => {
  if (!checkRateLimit(req, res, 30)) return;
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'backend_not_configured',
      detail: 'OPENROUTER_API_KEY manquant côté backend (functions/.env ou env Firebase).',
    });
  }
  const { model, messages, temperature } = req.body || {};
  if (!model || typeof model !== 'string' || model.length > 120) {
    return res.status(400).json({ error: 'model requis (string <= 120 car.)' });
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'messages[] requis (1..20)' });
  }
  try {
    const reply = await openRouterChat({ model, messages, temperature });
    return res.status(200).json({ reply });
  } catch (e) {
    const status = (e && e.status) || 502;
    const msg = String((e && e.message) || 'upstream_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend (functions/.env ou env Firebase).' });
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

// Indexe un texte : chunks -> embeddings -> stockage. Retourne {chunkCount, truncated}.
// Ne lève jamais de secret ; toute erreur remonte avec un code (statut pending + motif).
async function indexDocumentText(docId, text) {
  const chunks = chunkText(text).slice(0, RAG_MAX_CHUNKS_PER_DOC);
  if (!chunks.length) throw Object.assign(new Error('texte_vide'), { status: 400 });
  const vectors = await embedTexts(chunks);
  await storeDocChunks(docId, chunks.map((t, i) => ({ text: t, embedding: vectors[i] })));
  return { chunkCount: chunks.length, truncated: chunkText(text).length > chunks.length };
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
  const lower = cleanName.toLowerCase();
  const isText = /^(text\/|application\/(json|csv|x-www-form-urlencoded))/.test(mime) || /\.(txt|md|csv|json)$/i.test(lower);
  const now = new Date().toISOString();
  const fullText = isText ? buf.toString('utf8').slice(0, 200000) : '';
  const row = {
    title: cleanName.replace(/\.[^/.]+$/, '').slice(0, 120) || cleanName.slice(0, 120),
    category: str(category, 60) || 'RÉFÉRENCES',
    size: formatSize(buf.length),
    sizeBytes: buf.length,
    mimeType: mime,
    storagePath: stored ? storagePath : null,
    status: 'pending',
    chunkCount: 0,
    indexReason: stored ? (isText ? 'indexation en cours' : 'extraction non supportée (texte uniquement : .txt/.md/.csv/.json)') : 'fichier non stocké — réessayez',
    summary: `Document importé : ${cleanName}.${stored ? '' : ' (fichier non stocké — réessayez)'}`,
    textPreview: isText ? buf.toString('utf8').slice(0, 4000) : '',
    lastUpdated: now,
    createdAt: now,
  };
  try {
    if (db) await db.collection('knowledge_documents').doc(id).set(row);
    else memoryStore.knowledge.unshift({ id, ...row });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_save_failed' });
  }
  // Indexation réelle (chunks + embeddings) : le statut ne passe à 'indexed'
  // que si les vecteurs sont stockés. Échec -> 'pending' + motif, jamais de mensonge.
  if (stored && fullText.trim().length >= 20) {
    try {
      const { chunkCount, truncated } = await indexDocumentText(id, fullText);
      Object.assign(
        row,
        await setDocIndexState(id, {
          status: truncated ? 'partial' : 'indexed',
          chunkCount,
          indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
        })
      );
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
    const [qVec] = await embedTexts([query]);
    let docs = [];
    if (db) {
      const snap = await db.collection('knowledge_documents').limit(50).get();
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      docs = memoryStore.knowledge.slice(0, 50);
    }
    const scored = [];
    for (const d of docs) {
      if (d.status !== 'indexed' && d.status !== 'partial') continue;
      const chunks = await readDocChunks(d.id, 200).catch(() => []);
      for (const c of chunks) {
        if (!c || !Array.isArray(c.embedding)) continue;
        const score = cosineSim(qVec, c.embedding);
        if (score >= RAG_MIN_SCORE) {
          scored.push({ docId: d.id, title: String(d.title || ''), chunk: String(c.text || '').slice(0, 800), score: Math.round(score * 1000) / 1000 });
        }
      }
      if (scored.length > 500) break;
    }
    scored.sort((a, b) => b.score - a.score);
    return res.status(200).json({ ok: true, results: scored.slice(0, topK) });
  } catch (e) {
    const msg = String((e && e.message) || 'search_unreachable');
    if (/^backend_not_configured/.test(msg)) {
      return res.status(503).json({ error: 'backend_not_configured', detail: 'OPENROUTER_API_KEY manquant côté backend.' });
    }
    return res.status(502).json({ error: 'knowledge_search_failed', detail: msg.slice(0, 200) });
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
    const text = buf.toString('utf8').slice(0, 200000);
    if (text.trim().length < 20) {
      await setDocIndexState(id, { status: 'pending', chunkCount: 0, indexReason: 'extraction non supportée (texte uniquement)' });
      return res.status(200).json({ ok: true, document: { id, status: 'pending', chunkCount: 0 } });
    }
    const { chunkCount, truncated } = await indexDocumentText(id, text);
    const state = await setDocIndexState(id, {
      status: truncated ? 'partial' : 'indexed',
      chunkCount,
      indexReason: truncated ? `texte tronqué à ${chunkCount} chunks (plafond anti-coût)` : '',
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
  return {
    sender,
    senderName: str(m.senderName, 80) || (sender === 'user' ? 'Vous' : 'DC Intelligence'),
    content: str(m.content, 8000),
    timestamp: str(m.timestamp, 40) || new Date().toISOString(),
    agentName: str(m.agentName, 120),
  };
}

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

exports.whatsappWebhook = functions.https.onRequest(app);

// Exportés pour tests locaux uniquement (aucun effet en prod).
exports.__testUtils = { withTimeout, withDb, fetchUpstream, encodeOAuthState, decodeOAuthState, buildGoogleAuthUrl, GOOGLE_OAUTH_SCOPES, paramsHash, shouldEscalateClarification, computeHallucinations, chunkText, cosineSim, parseLfAsk };

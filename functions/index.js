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
const memoryStore = { audit: [], tasks: [], agents: [], knowledge: [], conversations: [], integrations: [], wa_conversations: [], wa_events: [] };

const app = express();

// CORS restreint : navigateurs uniquement depuis APP_URL / ALLOWED_ORIGINS.
// Le MCP serveur-à-serveur n'est pas affecté par CORS.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.APP_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

// Appel JSON-RPC MCP interne (même contrat que la route). Lève en cas d'échec.
async function mcpCallTool({ software, toolName, args }) {
  const target = mcpTargetFor(software);
  const mcpToken = (process.env.MCP_TOKEN || '').trim();
  if (!target) throw Object.assign(new Error(`backend_not_configured: aucune URL MCP pour ${software}`), { status: 503 });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (mcpToken) headers.Authorization = `Bearer ${mcpToken}`;
  const payload = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
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
  return text.slice(0, 12000);
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
  waLogEvent({ wamid, direction: 'in', phone: from, kind: type, preview: (textBody || `[${type}]`).slice(0, 300), state: 'RECEIVED' });
  waUpsertConversation(from, { stage: 'RECEIVED' }, { from: 'user', text: (textBody || `[${type}]`).slice(0, 500) });
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
    waUpsertConversation(from, { stage: 'COMPLETED', intent: 'ACCUEIL' });
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

  // Routage.
  waConv.transition(conv, waConv.STATES.ROUTING);
  const route = waConv.routeText(`${extractedText} ${docType}`);
  if (docType === 'tax_notice' || docType === 'legal_contract') { route.domain = 'JURIDIQUE_FISCAL'; route.agent = 'legal'; }
  else if (docType === 'invoice') { route.domain = 'COMPTABILITÉ'; route.agent = 'compta'; }
  else if (docType === 'bank_statement') { route.domain = 'RAPPROCHEMENT'; route.agent = 'reco'; }
  const TOPIC_LABEL = { invoice: 'Facture / pièce', tax_notice: 'Avis fiscal', bank_statement: 'Relevé bancaire', legal_contract: 'Document juridique', general_query: 'Question' };
  waUpsertConversation(from, { stage: 'ROUTING', topic: TOPIC_LABEL[docType] || 'Question', intent: route.domain });
  console.log(`[WA STEP] wamid=${wamid} étape=routage domaine=${route.domain} agent=${route.agent}`);

  await refreshTypingIfSlow();

  // Identité RÉELLE via Legal Flow (phone → entreprise, sans devinette).
  let companyId = null;
  let companyLabel = '';
  try {
    const raw = await withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_user_context', args: { phone: from } }), 12000, 'identity_timeout');
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
  } catch (e) {
    console.warn('[WA] identité indisponible, suite en mode générique', String((e && e.message) || e).slice(0, 150));
  }
  console.log(`[WA STEP] wamid=${wamid} étape=identité entreprise=${companyLabel || 'non_identifiée'}`);

  // PRÉSENCE 2 — RÉEL : on lance VRAIMENT l'agent / les outils maintenant.
  waConv.transition(conv, waConv.STATES.AGENT_WORKING);
  if (route.agent === 'legal') await say(waConv.PRESENCE.routingLegal);
  else if (route.agent === 'compta') await say(waConv.PRESENCE.routingCompta);
  else if (route.agent === 'reco') await say(waConv.PRESENCE.routingReco);
  await refreshTypingIfSlow();

  // Travail agent : outils métier RÉELS (lecture seule).
  waConv.transition(conv, waConv.STATES.WAITING_AGENT);
  let toolContext = '';
  if (route.agent === 'legal' && companyId) {
    try {
      const [statusRaw, obligRaw] = await Promise.all([
        withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_compliance_status', args: { entreprise_id: companyId } }), 15000, 'tool_timeout'),
        withTimeout(mcpCallTool({ software: 'Legal Flow', toolName: 'get_overdue_obligations', args: { entreprise_id: companyId } }), 15000, 'tool_timeout'),
      ]);
      toolContext += `\n[Compliance] ${statusRaw.slice(0, 2500)}\n[Retards] ${obligRaw.slice(0, 2500)}`;
      const needSearch = /dgi|courrier|article|tva|déclaration|declaration|loi|amende/i.test(extractedText);
      if (needSearch) {
        await say(waConv.PRESENCE.verifying); // RÉEL : une 2e vague d'outils part maintenant
        const searchRaw = await withTimeout(
          mcpCallTool({ software: 'Legal Flow', toolName: 'lf_search_docs', args: { query: extractedText.slice(0, 300), limit: 3 } }),
          15000, 'tool_timeout'
        );
        toolContext += `\n[RAG juridique] ${searchRaw.slice(0, 3000)}`;
      }
    } catch (e) {
      console.warn('[WA] outils legal partiels', String((e && e.message) || e).slice(0, 150));
    }
  }
  await refreshTypingIfSlow();

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
  if (isCorrection) {
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
    { role: 'system', content: `${waConv.PERSONA_SYSTEM} Contexte dossier : entreprise=${companyLabel || 'non identifiée'}, domaine=${route.domain}. ${dossierContext || 'Premier contact.'}${correctionNote} Données outils : ${toolContext.slice(0, 4000) || 'aucune'}. Si les données sont insuffisantes, dis ce qu’il te manque au lieu d’inventer.` },
    { role: 'user', content: `${isCorrection ? 'CORRECTION (remplace ma demande précédente) — ' : ''}Message client (${docType}, confiance ${confidence}) : ${extractedText.slice(0, 2500)}${entities && entities.amount ? ` [montant détecté : ${entities.amount}]` : ''}` },
  ];
  // Fallback d'attente : si la composition dépasse 10 s, on prévient le client
  // au lieu de le laisser sans nouvelles (puis on complète dès que c'est prêt).
  let answer = '';
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

  // PRÉSENCE 3 — RÉEL : le résultat est prêt, on l’envoie découpé.
  waConv.transition(conv, waConv.STATES.RESULT_READY);
  await say(waConv.PRESENCE.resultReady);
  waConv.transition(conv, waConv.STATES.RESPONDING);
  const chunks = waConv.splitResult(answer);
  console.log(`[WA STEP] wamid=${wamid} étape=envoi chunks=${chunks.length}`);
  const results = await wa.sendChunks(from, chunks);
  const sent = results.filter((r) => r.ok).length;
  if (results.some((r) => !r.ok && r.code === 131047)) {
    console.warn('[WA] fenêtre 24 h fermée, templates non gérés (cf dossier MCP §7).');
  }
  waConv.transition(conv, waConv.STATES.COMPLETED);
  waUpsertConversation(from, { stage: 'COMPLETED' });
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
    updatedAt: now,
  };
  Object.keys(cleanPatch).forEach((k) => { if (!cleanPatch[k]) delete cleanPatch[k]; });
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
    return res.status(200).json({ ok: true, store, phone, stats: waComputeStats(conversations, events), conversations: list.slice(0, 50) });
  } catch (e) {
    return res.status(500).json({ error: 'whatsapp_overview_failed' });
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
  const row = {
    title: cleanName.replace(/\.[^/.]+$/, '').slice(0, 120) || cleanName.slice(0, 120),
    category: str(category, 60) || 'RÉFÉRENCES',
    size: formatSize(buf.length),
    sizeBytes: buf.length,
    mimeType: mime,
    storagePath: stored ? storagePath : null,
    status: stored ? 'indexed' : 'pending',
    summary: `Document importé : ${cleanName}.${stored ? '' : ' (fichier non stocké — réessayez)'}`,
    textPreview: isText ? buf.toString('utf8').slice(0, 4000) : '',
    lastUpdated: now,
    createdAt: now,
  };
  try {
    if (db) await db.collection('knowledge_documents').doc(id).set(row);
    else memoryStore.knowledge.unshift({ id, ...row });
    return res.status(200).json({ ok: true, store: db ? 'firestore' : 'memory', document: { id, ...row } });
  } catch (e) {
    return res.status(500).json({ error: 'knowledge_save_failed' });
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
exports.__testUtils = { withTimeout, withDb, fetchUpstream };

/**
 * DC INTELLIGENCE — Moteur conversationnel WhatsApp.
 *
 * Pattern officiel Meta (docs 06/2026) :
 *   MESSAGE → webhook → ACK(200) → READ(✓✓) → TYPING(« écrit… ») → réponse.
 *   Même message.id pour le lu ET le typing. Typing levé à l'envoi ou après 25 s.
 *
 * Règles d'or (spec agent IA) :
 *  1. Chaque message de PRÉSENCE correspond à un événement RÉEL (jamais de fausse activité).
 *  2. Messages courts et progressifs, jamais un seul mur de texte.
 *  3. Distinction présence (maintien du lien) vs résultat (information utile).
 *  4. Personnalité : chaleureux, naturel, pro, ivoirien léger — jamais caricatural.
 *  5. Typing seulement si vraie réponse en préparation ; refresh ≤ 25 s, pas de boucle.
 */

const GRAPH_BASE = 'https://graph.facebook.com';

// --- Machine à états conversationnelle ---
const STATES = {
  RECEIVED: 'RECEIVED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  READ: 'READ',
  PROCESSING: 'PROCESSING',
  ROUTING: 'ROUTING',
  AGENT_WORKING: 'AGENT_WORKING',
  WAITING_AGENT: 'WAITING_AGENT',
  RESULT_READY: 'RESULT_READY',
  RESPONDING: 'RESPONDING',
  COMPLETED: 'COMPLETED',
  WAITING_USER: 'WAITING_USER',
  WAITING_DOCUMENT: 'WAITING_DOCUMENT',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  FAILED: 'FAILED',
  ESCALATED: 'ESCALATED',
};

function createConversation(wamid) {
  return { wamid, state: STATES.RECEIVED, history: [{ s: STATES.RECEIVED, at: Date.now() }], t0: Date.now() };
}

function transition(conv, next) {
  conv.state = next;
  conv.history.push({ s: next, at: Date.now() });
}

// --- Persona Agent Accueil (réceptionniste) — refonte §4 ---
const PERSONA_SYSTEM = [
  'Tu es DC, l’Agent d’Accueil et Routeur central de DC Intelligence, cabinet d’expertise comptable et fiscale en Côte d’Ivoire.',
  'IDENTITÉ VERROUILLÉE : tu es et tu restes l’Agent d’Accueil du premier au dernier message. Tu ne dis JAMAIS « je suis l’agent comptabilité/legal », ni « je ne suis pas l’agent d’accueil ». Ta mission unique : accueillir, qualifier, rassurer, router. Tu ne traites JAMAIS une demande spécialisée toi-même : tu transmets le résultat des vérifications effectuées pour le client.',
  'ANTI-HALLUCINATION : tu ne prétends JAMAIS avoir consulté un dossier ou obtenu un retour sans preuve. La liste « Actions réellement effectuées » fournie dans le contexte est la SEULE vérité ; si elle est vide, dis ce qu’il te manque au lieu d’inventer.',
  'ÉCOUTE ET EMPATHIE : reformule la demande pour montrer que tu as compris ; si le client est frustré, reconnais l’émotion d’abord (« Je comprends que c’est frustrant »), sans répondre à l’insulte.',
  'EFFICACITÉ : une question à la fois, jamais 10 informations d’un coup ; pas de jargon, pas de listes interminables.',
  'Ton ton : chaleureux, naturel, professionnel, légèrement conversationnel.',
  'Tu peux utiliser OCCASIONNELLEMENT une touche locale légère (« Humm », « D’accord », « Pas de souci », « Oui, je vois »).',
  'INTERDIT : caricature ivoirienne, argot forcé, familiarité excessive, plus d’un emoji par message.',
  'Réponds en français, en messages COURTS (1 à 3 phrases max). Jamais de mur de texte.',
  'SÉCURITÉ : ne divulgue jamais d’information sensible ; en cas de sujet sensible, transmets à un humain.',
].join(' ');

// Messages de PRÉSENCE — chacun n’est envoyé qu’au moment où l’événement correspondant a VRAIMENT lieu.
const PRESENCE = {
  looking: [
    'Je regarde ça.',
    'Humm, je regarde ça pour vous.',
    'Oui, je regarde.',
    'Je jette un œil tout de suite.',
  ],
  lookingDoc: [
    'Oui, je regarde le document.',
    'Bien reçu, je regarde le document.',
  ],
  verifying: [
    'Je vérifie un point dans votre dossier.',
    'Humm… je vérifie votre dossier.',
    'Je consulte votre dossier.',
  ],
  routingLegal: [
    'Ça concerne bien votre situation fiscale. Je passe ça à l’agent juridique pour vérifier.',
    'Je passe ça à l’agent juridique pour vérifier ce que ça implique pour votre entreprise.',
  ],
  routingCompta: [
    'Je passe ça à l’agent comptable pour vérifier.',
    'Bien noté, je fais vérifier ça par l’agent comptable.',
  ],
  routingReco: [
    'Je passe ça à l’agent rapprochement pour pointer avec votre banque.',
  ],
  resultReady: [
    'C’est bon, j’ai son retour.',
    'Voilà, j’ai le retour.',
    'C’est bon, j’ai vérifié.',
  ],
  oneMoreCheck: [
    'J’ai trouvé quelque chose, je vérifie juste un dernier point.',
  ],
};

function pick(list, lastUsed) {
  if (!list.length) return { text: '', idx: -1 };
  let idx = Math.floor(Math.random() * list.length);
  if (list.length > 1 && idx === lastUsed) idx = (idx + 1) % list.length;
  return { text: list[idx], idx };
}

// --- Découpage résultat : plusieurs messages courts, jamais un mur ---
function splitResult(text, maxLen = 900) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const parts = clean.split(/\n{2,}|\n/);
  const chunks = [];
  let current = '';
  const pushSentences = (block) => {
    const sentences = block.split(/(?<=[.!?…])\s+/);
    for (const s of sentences) {
      if (!s.trim()) continue;
      if ((current + ' ' + s).trim().length > maxLen && current) {
        chunks.push(current.trim());
        current = s;
      } else {
        current = (current ? current + ' ' : '') + s;
      }
    }
  };
  for (const block of parts) {
    if (!block.trim()) continue;
    if (block.length > maxLen && !current) {
      pushSentences(block);
    } else if ((current + '\n\n' + block).length > maxLen && current) {
      chunks.push(current.trim());
      current = '';
      pushSentences(block);
    } else {
      current = current ? current + '\n\n' + block : block;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean).slice(0, 8); // garde-fou : 8 messages max
}

function isGreetingOnly(text) {
  // Salutation SEULE (aucune question derrière) -> réponse immédiate sans pipeline.
  // Inclut les variantes courtes FR/EN ("Hey", "hi", "yo") qui partaient à tort en pipeline complet.
  return /^(bonjour|bonsoir|salut|hello|hi|hey|yo|yop|bjr|cc|coucou|bonjour\s+dc|salut\s+dc|hello\s+dc|hey\s+dc)[\s!.…]*$/i.test((text || '').trim());
}

// Routeur local (miroir allégé du routerAgent front) — classification rapide avant LLM/outils.
// Matrice refonte §6 : « Legal Flow » route vers legal (jamais « je n’ai pas accès »),
// demande d'humain explicite vers humain.
function routeText(text) {
  const t = (text || '').toLowerCase();
  if (/\b(humain|humaine|conseiller|conseillère|conseillere|agent humain|vraie personne|vrai personne|personne réelle|être humain)\b/.test(t)) {
    return { domain: 'HUMAIN', agent: 'humain', confidence: 0.9 };
  }
  if (/\b(facture|achat|fournisseur|ttc|tva|601|401|bilan|écriture|ecriture|syscohada|compta|salaire|paie)\b/.test(t)) {
    return { domain: 'COMPTABILITÉ', agent: 'compta', confidence: 0.85 };
  }
  if (/\b(rapprochement|relevé|releve|banque|ecobank|sgbci|bicici|pointage|solde|521|écart|ecart|virement|lettrage)\b/.test(t)) {
    return { domain: 'RAPPROCHEMENT', agent: 'reco', confidence: 0.85 };
  }
  if (/legal[\s_-]*flow|legalflow|\b(rccm|contentieux|conformité|conformite|fiscal|dgi|impôt|impot|statuts|contrat|bail|courrier|das|cnps|patente|retenue|télédéclaration|déclaration|declaration|juridique|tribunal|litige|amende|redressement|avis)\b/.test(t)) {
    return { domain: 'JURIDIQUE_FISCAL', agent: 'legal', confidence: 0.85 };
  }
  return { domain: 'ACCUEIL', agent: 'accueil', confidence: 0.6 };
}

// --- Détections refonte §7 (pures, testables) ---
// Frustration/colère : on apaise dès le 1er signe, on ne répond jamais à l'insulte.
const FRUSTRATION_RX = /(merde|putain|bordel|fait chier|con\b|connard|débile|stupide|incompétent|incompetent|nul+|nulle|marre|ras[- ]?le[- ]?bol|ça marche pas|ca marche pas|ne fonctionne pas|fonctionne pas|toujours pas|jamais.*répon|arnaque|escro|honteux|foutage|foutaise|nique)/i;
function isFrustrated(text) {
  return FRUSTRATION_RX.test(String(text || ''));
}

// Sujet sensible (contexte militaire) : escalade humain + alerte, jamais de traitement.
const SENSITIVE_RX = /(secret[ -]?défense|secret defense|militaire|armée|armee|arme|munition|explosif|confidentiel|classifié|classifie|renseignement|opération secrète|operation secrete)/i;
function isSensitive(text) {
  return SENSITIVE_RX.test(String(text || ''));
}

// Test de présence (« tu es là ? ») : l'accueil répond qu'il est là.
function isPresenceCheck(text) {
  return /(tu es l[àa]|t['’ ]?es l[àa]|vous êtes l[àa]|es-tu l[àa]|êtes-vous l[àa]|y a (quelqu|kelk)|il y a quelqu|quelqu'un.*l[àa])[^?.!…]{0,20}[?.!…]*$/i.test((text || '').trim());
}

// Insistance accueil (« je veux parler à l'accueil ») : « C'est moi ».
function isAccueilInsistence(text) {
  const t = (text || '').toLowerCase();
  return /\baccueil\b/.test(t) && /(parler|voir|voir|appeler|contacter|je veux|donne|passe)/.test(t);
}

// --- Client WhatsApp Cloud API ---
// Retry unique 429/5xx, lectures seules (media, read receipts). Jamais les envois.
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

function createWhatsAppClient({ apiVersion, phoneNumberId, accessToken }) {
  const base = `${GRAPH_BASE}/${apiVersion || 'v26.0'}/${phoneNumberId}/messages`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  // Retry unique 429/5xx, lectures seules. opts.retry=false pour les ENVOIS
  // (un retry d'envoi = risque de doublon, l'idempotence wamid ne couvre que l'inbound).
  async function graphPost(body, opts) {
    const doPost = () => fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
    let r;
    if (opts && opts.retry === false) {
      r = await doPost();
    } else {
      r = await fetchUpstream(base, { method: 'POST', headers, body: JSON.stringify(body) }, 'meta');
    }
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  function metaError(data) {
    const e = (data && data.error) || {};
    return { code: e.code, message: String(e.message || 'unknown').slice(0, 300) };
  }

  // Marque lu (✓✓ bleus). Sans typing.
  async function sendRead(wamid) {
    return graphPost({ messaging_product: 'whatsapp', status: 'read', message_id: wamid });
  }

  // Lu + « écrit… » en UN appel (payload officiel). À rappeler ≤ 25 s pour prolonger.
  async function sendReadTyping(wamid) {
    return graphPost({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
      typing_indicator: { type: 'text' },
    });
  }

  // Message texte. Renvoie {ok, id?} ou {ok:false, code, message}.
  async function sendText(to, body) {
    const text = String(body || '').slice(0, 4096).trim();
    if (!text) return { ok: false, code: 'empty', message: 'texte vide' };
    const res = await graphPost({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    }, { retry: false });
    if (res.ok) {
      const id = res.data && res.data.messages && res.data.messages[0] && res.data.messages[0].id;
      return { ok: true, id };
    }
    return { ok: false, ...metaError(res.data) };
  }

  // Envois séquencés avec micro-pause (préserve l'ordre, cadence naturelle).
  async function sendChunks(to, chunks, pauseMs = 450) {
    const results = [];
    for (const c of chunks) {
      const r = await sendText(to, c);
      results.push(r);
      if (!r.ok) break; // fenêtre 24 h fermée (131047) ou autre : on arrête, on ne spamme pas
      if (pauseMs > 0) await new Promise((r2) => setTimeout(r2, pauseMs));
    }
    return results;
  }

  async function getMediaUrl(mediaId) {
    const r = await fetchUpstream(`${GRAPH_BASE}/${apiVersion || 'v26.0'}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 'meta');
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(`media_url_${r.status}`);
    return { url: data.url, mimeType: data.mime_type, size: data.file_size };
  }

  async function downloadMedia(mediaId, maxBytes = 10_000_000) {
    const { url } = await getMediaUrl(mediaId);
    const r = await fetchUpstream(url, { headers: { Authorization: `Bearer ${accessToken}` } }, 'meta');
    if (!r.ok) throw new Error(`media_dl_${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) throw new Error('media_trop_volumineux');
    return buf;
  }

  return { sendRead, sendReadTyping, sendText, sendChunks, downloadMedia, metaError };
}

// Politique typing (§8 spec) : < 1 s rien, 1–2 s lu seul, > 2 s lu + typing, refresh ≤ 25 s.
function typingNeeded(elapsedMs) {
  return elapsedMs > 2000;
}

module.exports = {
  STATES,
  PERSONA_SYSTEM,
  PRESENCE,
  createConversation,
  transition,
  pick,
  splitResult,
  isGreetingOnly,
  routeText,
  isFrustrated,
  isSensitive,
  isPresenceCheck,
  isAccueilInsistence,
  typingNeeded,
  createWhatsAppClient,
};

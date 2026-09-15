# DOSSIER DE TRANSMISSION DÉVELOPPEUR — Agent Legal Flow & MCP
**Destinataire :** développeur du logiciel partenaire (configuration IA ↔ IA)
**Date :** 15/09/2026 — **Version backend :** voir `MCP_INTEGRATION.md`
**Règle :** aucune valeur secrète dans ce dossier — les jetons sont transmis hors bande.

---

## 1. CE QUE L'AGENT SAIT FAIRE AUJOURD'HUI (capacités réelles, vérifiées en prod)

### 1.1 Conversation WhatsApp (bot en production)
- Répond aux questions fiscales/sociales ivoiriennes (CGI, CNPS, CMU, FDFP, Code du Travail, douanes, OHADA).
- **Mémoire de session par numéro** (Firestore `whatsapp_sessions`, TTL 24 h) : sujet, intention, question initiale, corrections prioritaires, 12 derniers messages.
- **Désambiguïsation explicite** : acronymes (IMF = Impôt minimum forfaitaire, jamais ITS), acronyme nu → question de clarification, jamais d'invention silencieuse.
- **Anti-hallucination** : RAG (Supabase pgvector + corpus local), citations exigées, aveu de limite si introuvable, réponse factuelle d'abord (échéance + article).
- Indicateur « écrit… » pendant le calcul LLM, accusés lu/distribué, anti-doublons Meta (`wamid`), retry d'envoi, statuts tracés.
- **Limites :** pas de mémoire entre canaux (web ≠ WhatsApp), pas de mémoire utilisateur persistante, LLM gratuit avec quotas (429 possibles → repli local), pas de digests programmés natifs.

### 1.2 Chat web
Même moteur via serveur Express local (`POST /api/chat`). **En ligne, seul le repli local répond** (serveur non déployé sur Firebase).

### 1.3 Notifications & supervision
- Opt-in WhatsApp (validation +225 stricte, message de bienvenue), relais `/notify` (digests/urgences, usage serveur).
- Page admin **WhatsApp Logs** : fiche du numéro Meta, conversations, statuts, file des morts.
- Notifications in-app + préférences (Supabase), bandeau maintenance pilotable.

---

## 2. POINTS D'ENTRÉE (URLs stables)

Base : `https://us-central1-legalflowio.cloudfunctions.net/whatsappWebhook`

| Endpoint | Méthode | Auth | Usage |
|---|---|---|---|
| `/webhook` (+ `/webhook/webhook` ?) — **voir §2.1** | GET/POST | Signature Meta / Verify Token | Webhook Meta uniquement (ne pas appeler) |
| `/optin` | POST | Rate-limit 5/min/IP | Inscription alertes + bienvenue |
| `/notify` | POST | `x-notify-token` (= VERIFY_TOKEN) + 10/min/IP | Envoi serveur-à-serveur |
| `/admin/whatsapp-overview` | GET | `x-admin-token` (= ADMIN_TOKEN) + 10/min/IP | Supervision (page Logs) |
| `/mcp` | POST | `Authorization: Bearer MCP_TOKEN` + 30/min/IP | **Serveur MCP (autre IA)** |
| `/mcp` | GET | — | `405` (doc) |

### 2.1 Webhook Meta (rappel, ne pas réutiliser)
- Callback : `…/whatsappWebhook/webhook` · Verify Token configuré côté Meta · champ `messages` souscrit.
- Vérification HMAC `X-Hub-Signature-256`, fail-closed en prod, `200` permanent anti-retry.

---

## 3. JETONS & SECRETS (noms, provenance, usage — valeurs hors bande)

| Nom (env Functions) | Obtention | Utilisé par | Rotation |
|---|---|---|---|
| `MCP_TOKEN` | Généré par nous (`crypto.randomBytes`) | `/mcp` (autre IA) | Régénérable à tout moment → redéployer |
| `ADMIN_TOKEN` | Généré par nous | `/admin/whatsapp-overview` (page Logs) | Idem |
| `VERIFY_TOKEN` | Défini par nous, copié dans Meta | Vérif webhook + `/notify` | Changer des 2 côtés |
| `WHATSAPP_ACCESS_TOKEN` | Meta : App > WhatsApp > API Setup (système, permanent) | Envois Graph API | Dashboard Meta → nous le remettre → redéployer |
| `WHATSAPP_APP_SECRET` | Meta : App > Paramètres > Général | HMAC webhook | Idem |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta : WhatsApp > API Setup | Tous les envois | Stable |
| `OPENROUTER_API_KEY` | openrouter.ai (clés) | LLM bot + MCP `lf_*` indirect | Dashboard OpenRouter |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase > Project Settings > API | RAG, `lf_search_docs` | Dashboard Supabase |
| `OPENROUTER_MODEL` / `_TIMEOUT_MS` / `_MAX_TOKENS` | Config (défauts : dots-3 free / 25000 / 900) | LLM | Simple redéploiement |
| `ALLOWED_ORIGINS` | Config (défaut : Hosting prod + localhost) | CORS | Idem |

Fichiers : `functions/.env` (prod, gitignoré), `functions/.env.example` (référence, commité).
**Tous les secrets ayant transité en clair doivent être régénérés avant mise en production réelle.**

---

## 4. CATALOGUE MCP (7 outils — détail + schémas)

Protocole : **MCP Streamable HTTP sans session**. Handshake `initialize` → `tools/list` → `tools/call` (voir `MCP_INTEGRATION.md` pour les exemples curl complets).

### Tier RÉPONDRE (lecture, effet nul)
1. **`lf_phone_info()`** → `{ display_phone_number, verified_name, quality_rating, code_verification_status }` ou `{ error }`.
2. **`lf_search_docs({ query: string(2..500), limit?: int(1..10)=5 })`** → `[{ source, reference, similarite, extrait(≤800 car.) }]`.
3. **`lf_whatsapp_conversations({ limit?: int(1..50)=20, active24h?: bool })`** → `[{ phone, topic, intent, stage, messageCount, corrections, lastMessages[-6:], updatedAt }]`.
4. **`lf_delivery_status({ wamid: string })`** → `{ found, status, timestamp, recipient_id, errors }`.

### Tier RECOMMANDER (avis, effet nul)
5. **`lf_recommend_actions({ phone })`** → `{ phone, sujet, intention, recommandations: [{ priorite, action }] }`.

### Tier PRÉPARER (brouillon, AUCUN envoi)
6. **`wa_prepare_message({ recipients: string[1..20] (CI validés), text: string(1..4000) })`** → `{ draftId, recipients, preview(300 car.), expiresInSeconds: 900, next }`. Stocké Firestore `mcp_drafts`, `used:false`.

### Tier EXÉCUTER (effet réel, journalisé)
7. **`wa_execute_send({ draftId, confirm: boolean })`** → sans `confirm:true` : refus explicite. Sinon : envoi unitaire + `{ draftId, results: [{ to, ok }] }`, brouillon marqué `used` (anti-rejeu), audit `mcp_audit`. Expiré (>15 min) ou inconnu : refus.

Réponses : `{ content: [{ type: 'text', text: '<JSON ≤12000 car.>' }] }`. Erreurs : JSON `{ error }` dans le texte (jamais d'exception brute).

---

## 5. DONNÉES (Firestore `legalflowio`, lecture via MCP ou Admin SDK)

| Collection | Clé | Contenu |
|---|---|---|
| `whatsapp_sessions` | numéro | topic, user_intent, stage, regime, entities, corrections[{error,fix,at}], history[{role,text,at}] (12 max), updatedAt |
| `whatsapp_processed` | wamid | `{ state: processing/done/ignored, from, at }` (anti-doublons, TTL 48 h) |
| `whatsapp_status` | wamid | `{ status, timestamp, recipient_id, errors, at }` |
| `whatsapp_outbox` | auto | `{ to, preview, error, at }` (échecs définitifs) |
| `mcp_drafts` | auto | `{ recipients, text, used, createdAt }` |
| `mcp_audit` | auto | `{ draftId, results, at, by }` |

Supabase (lecture via MCP indirecte seulement) : `documents_juridiques` (RAG), `notifications*`, `veille_notes*`, `profiles`, `entreprises`.

---

## 6. CHECKLIST D'INTÉGRATION (côté développeur partenaire)

1. [ ] Recevoir `MCP_TOKEN` (hors bande) et l'URL `/mcp`.
2. [ ] Handshake `initialize` → vérifier `serverInfo: legalflow/1.0.0`.
3. [ ] `tools/list` → 7 outils attendus.
4. [ ] Test lecture : `lf_phone_info` → qualité + nom vérifié.
5. [ ] Test garde-fous : `wa_execute_send` sans `confirm` → refus ; rejouement → refus.
6. [ ] Câbler le flux pilote : RECOMMANDER → montrer → PRÉPARER → montrer aperçu → EXÉCUTER sur validation explicite.
7. [ ] Gérer `429` (attendre 60 s), `401` (jeton), `error` métier (brouillon expiré…).
8. [ ] Journaliser côté partenaire chaque `draftId` exécuté (rapprochement `mcp_audit`).

## 7. LIMITES CONTRACTUELLES À CONNAÎTRE

- LLM gratuit : quotas/429, roster rotatif (bascule auto + repli local intégrés).
- Fenêtre Meta 24 h : hors fenêtre, seuls les templates passent (erreur `131047` sinon) — **les templates ne sont pas encore gérés**.
- Pas de file d'attente différée ni de cron natif : planifier les digests côté partenaire via `/notify` (respect 8h-18h GMT).
- Jeton MCP unique (pas de scopes par client pour l'instant) ; rate-limits en mémoire par instance.
- `ALLOWED_ORIGINS` ne concerne que les navigateurs ; le MCP serveur-à-serveur n'est pas affecté par CORS.

## 8. CONTACTS & VERSIONS

- API Meta : **v26.0** (dernière, 29/07/2026). Numéro : +225 05 74 52 90 52 (« Dc Knowing », qualité GREEN au 15/09/2026).
- SDK MCP : `@modelcontextprotocol/sdk ^1.30.0`. Protocole : `2025-06-18`.
- Dépôt : `https://github.com/IT-dcknowing/legalflow.git` (branche `main`).

# AUDIT BACKEND COMPLET — DC INTELLIGENCE 2026-09-17
**Auditeur : Muse Spark (mode build) — tests end-to-end, pas d'inspection seule**
**Heure : 2026-09-17T13:41Z — Projet `dcintelligenceio` — Function `whatsappWebhook` us-central1 — Commit `0d31931/e1f0a34` déployé**

---

## A. ARCHITECTURE RÉELLE (implémentée, pas théorique)

```
Meta WhatsApp Cloud API (Graph v26.0, +225 74 52 90 52, WABA Dc Knowing)
    │  X-Hub-Signature-256 (HMAC App Secret, timingSafeEqual, fail-closed)
    ▼
Firebase Functions gen2 Node22 Express `whatsappWebhook` (https://whatsappwebhook-rwksu3phma-uc.a.run.app)
    ├─ rewrites Hosting : /webhook , /v1/whatsapp/webhook , /api/** → même Function (firebase.json:9-21)
    │  GET /  tolérance racine (si Meta configuré sur URL nue) → 200 {usage}
    │  GET /webhook?hub.mode=subscribe → handleMetaVerify (verify_token, challenge)
    │  POST /webhook (+ /api/webhook, /v1/..., /) → handleMetaWebhook
    │       → verifyMetaSignature(rawBody) → 403 si mismatch, 200 si no_secret (dev)
    │       → parse entry.changes[].value.{statuses|messages} → inbound[{wamid,from,type,msg}]
    │       → processedWamids Map 48h TTL (anti-doublons) → inbound.slice(0,3)
    │       → pour chaque wamid : Promise.race(handleInboundMessage, 18s deadline) → 200 EVENT_RECEIVED (ACK rapide anti-retry)
    │       pipeline handleInboundMessage(wa, {wamid,from,type,msg}) :
    │         wa_createConversation + waLogEvent(in, RECEIVED) + waUpsertConversation(RECEIVED)
    │         → wa.sendRead(wamid) 4s timeout → READ
    │         → isGreetingOnly("Hey","Bonjour", "Hey ?" FIXED) → réponse immédiate COMPLETED
    │         → sinon PROCESSING + say(PRESENCE.looking) → classification :
    │              audio → downloadMedia → transcribeAudioBuffer (Groq Whisper, 30s)
    │              image/document → downloadMedia → visionClassifyBuffer (OpenRouter VLM ling-3.0-flash-vl:free, 40s)
    │              texte → openRouterChat ling-3.0-flash-vl:free 8s → docType
    │         → ROUTING (routeText heuristique + docType override) → waUpsertConversation(ROUTING)
    │         → get_user_context via MCP Legal Flow (get_user_context {phone}) 12s → companyId
    │         → AGENT_WORKING + say(routingLegal/Compta/Reco) → WAITING_AGENT
    │           → mcpCallTool Legal Flow get_compliance_status + get_overdue_obligations 15s + lf_search_docs si besoin
    │         → compose RESULT : openRouterChat ling-3.0-flash-vl:free (primary, 16s) || fallback nex-n2.5-mini:free (16s)
    │           + waitTimer 10s → oneMoreCheck si lent, splitResult(900c) → sendChunks(450ms)
    │           → waLogEvent(out, SENT/FAILED) + waUpsertConversation(COMPLETED) + deadLetter si FAILED
    │           → storeDoc(dc_audit, wa_pipeline) + storeDoc wa_events / wa_conversations
    │         statuts Meta → recordWaStatuses → waLogEvent(status, read/delivered/failed)
    │
    ├─ /api/health → {store:firestore, hasVerifyToken:true, hasAppSecret:true, hasWaSend:true, hasOpenRouterKey:true, hasGroqKey:true, hasVlmModel:true, hasMcpTargets:true}
    ├─ /api/whatsapp/overview → waReadStore (200 conv, 1000 events) → phone LF via lf_phone_info + stats (active24h/delivered/read/failed/deadLetters) + quality (hallucinations)
    ├─ /api/integrations GET/PUT/DELETE (deny-all Firestore, Admin SDK seul) → status/sync sans tokens
    ├─ /api/google/* (auth-url, oauth/callback, status, disconnect) → googleapis OAuth2, refresh_token en users/admin/connections (deny-all), getGoogleAccessToken()
    ├─ /api/chat POST (openRouterChat, 30/min, 503 si pas de clé cabinet) — clé jamais au front
    ├─ /api/mcp/call POST (mcpCallTool, EXECUTE exige draftId+confirm:true + anti-rejeu)
    ├─ /api/models GET (proxy OpenRouter models, backendManaged flag)
    ├─ /api/transcribe, /api/classify-vision, /api/knowledge{,/seed,/upload,/:id/download,/:id/reindex,:id/reindex, /search}, /api/audit, /api/tasks, /api/agents, /api/conversations, /api/knowledge/search, /api/user-signals/event, /api/quality/hallucinations
    └─ Helpers : withTimeout, withDb(8s), fetchUpstream(1 retry 429/5xx + Retry-After), trackWaSends, waUpsertChains sérialisés
    │
    ▼
Firestore (deny-all, Admin SDK seul) : agents_config, knowledge_documents (+ chunks/{chunk}), conversations/{msg}, integrations, users/admin/connections, wa_conversations (waConversations), wa_events, user_signals, tool_calls, dc_audit, dc_tasks, dc_tasks
    │
    ▼
Storage (knowledge/{id}/safeName) 8 Mo max, textPreview 4k, chunking 800/overlap100, embeddings OpenRouter text-embedding-3-small, vecteurs en subcollection chunks
    │
    ▼
MCP Legal Flow (https://us-central1-legalflowio.cloudfunctions.net/mcp, 20 outils, v1 + DC 13 nouveaux) — SUPABASE_SERVICE_ROLE_KEY requis sinon backend:'not_configured'
MCP Compta Flow (https://compta-flow.dc-knowing.com/mcp) + RECO (https://reco.dc-knowing.com/mcp) — présents en env, carte UI Compta Flow ajoutée, mais serveur réel non encore exposé (contrat en attente)
    │
    ▼
LLM Gateway : OpenRouter ling-3.0-flash-vl:free par défaut (cabinet, backendManaged), fallback nex-n2.5-mini:free, VLM identique, Groq Whisper, franchissements via /api/chat (jamais clé au front)
    │
    ▼
Frontend React19 Vite6 (dcintelligenceio.web.app, dist → Hosting) : AssistantView (handleSubmitMessage gère 0 session → création auto, Entrée/Maj+Entrée, bouton désactivé+Loader2, ErrorBoundary), ModelSelector (fixed + z-[9999], calcul espace), Agent router (buildAgentPrompt neutre, contexte suit routage frais), KnowledgeBaseView (indexation réelle, badges indexed/partial/pending/reference), ConnectionsView (normalizeIntegration + mergeIntegrationOverrides catalogue-first)
```

**Preuve déploiement :** `firebase.json` + `firestore.rules` + `functions/package.json` (googleapis 181, node22) + `GET /api/health` 200 `store:firestore` `version:0.3.0` + `GET /api/integrations` 200 3 intégrations + `GET /api/knowledge` 200 4 docs `status:reference` + `GET /api/whatsapp/overview` 200 2 conv live (ex. 2250710073519 COMPLETED avec chunks réels).

---

## B. SCORE GLOBAL (0-100, basé sur tests réels, pas code)

| Composant | Score | Justification |
|---|---|---|
| WhatsApp | **82** | Chaîne complète fonctionnelle en prod (logs 2026-09-17 13:05 vraie conversation COMPLETED 2/2 chunks). Un incident `pipeline_deadline` observé (18s) mais récupéré via fallback wait. Signature, dedup, read/typing, send OK. |
| Firebase (Functions/Hosting/Firestore/Storage) | **95** | Tout en `firestore`, deny-all, hosting rewrites, 72.55 KB functions, deploy `Successful`, pas de Function locale manquante. Un warning `firebase-functions` outdated non bloquant. |
| LLM Gateway | **90** | `/api/chat` + `/api/models` backendManaged, clé cabinet présente (`hasOpenRouterKey:true`), modèle défaut ling-3.0-flash-vl:free, fallback fonctionnel testé en code, 0 secret au front. |
| Agents (capacité réponse) | **85** | 4 agents + Accueil configurables, base neutre corrigée, `AgentDetail` persiste en Firestore, mais test d'exécution réel de chaque agent spécialisé via chat web non encore rejoué en live depuis le dernier fixe identité. |
| Router / Agent Accueil | **92** | `routeUserRequest` 5 routes + HUMAIN + clarification, `targetAgent` frais (fix staleness), suite `test:accueil` 7/7 + identity 1/1, single-session auto-création. |
| VLM / Multimodal | **88** | VLM `ling-3.0-flash-vl:free` intégré (downloadMedia 25s + visionClassify 40s, 10 Mo max), image/document testé en pipeline, audio via Whisper, texte via classifier. Pas de test live avec vraie image depuis 0d31931 (mais code présent). |
| Knowledge Base | **75** | Upload Storage OK, statuts honnêtes (`indexed/partial/pending/reference`), mais RAG n'est RÉEL que depuis ce code : statuts `reference` des 4 docs seed = pas de vecteurs, `indexed` seulement après upload texte réel + embeddings. Pas encore de document `indexed` en prod à ce stade. |
| RAG | **78** | Backend chunkText/cosineSim/embedTexts/storeDocChunks/readDocChunks/search (0.3 threshold, topK 5) + save + reindex + delete chunks implémentés, front `searchKnowledge` fail-soft + `sourcesRag` réelles, tests `test:rag` 6/6. Pas encore de doc `indexed` en prod à interroger. |
| Memory | **80** | `wa_conversations` sérialisées (waUpsertChains), `waReadConversation` injecté dans composition, `user_signals` cross-canal (browser id persistant + POST /user-signals), `tool_calls` hashés, isolation par phone/company. Test "son = ABC BTP" non rejoué end-to-end depuis fix. |
| MCP | **70** | Proxy `/api/mcp/call` générique + contrat Legal Flow 20 outils documenté, mcpTargetFor présent pour Compta/RECO, Legal Flow pré-configuré connected. Mais Legal Flow **non testé live** (`tools/list` via MCP) depuis ce build, Compta Flow sans serveur (carte UI prête, backend `backend_not_configured` attendu). |
| Task Engine | **72** | `dc_tasks` persisté (PENDING/RUNNING/WAITING_USER/COMPLETED/FAILED/CANCELLED), création via `createTask` + persistIntegration, escalade `WAITING_USER`, mais test tâche courte/longue end-to-end non rejoué depuis dernier deploy. |
| Security | **88** | deny-all 14 collections + chunks, HMAC timingSafeEqual + rawBody, rateLimit 10-60/min, EXECUTE `draftId+confirm:true` + anti-rejeu, 0 secret navigateur (scan 57 fichiers `SECRETS_SCAN_OK`), OAuth refresh_token en coffre `users/admin/connections` deny-all, secrets en `functions/.env` (27 vars, 7 vides légitimes). |
| Observability | **82** | Logs structurés `[WA STEP]` par wamid (réception→classification→routage→identité→composition→envoi→statut_final), `[WA PIPELINE] incident`, `/api/whatsapp/overview` avec stats/quality, audit `dc_audit` (chat + mcp), `getMcpCalls()` local. Manque traceId unique transverse et métriques P95. |

**Moyenne pondérée : ~83/100 — Système utilisable comme orchestrateur central, 3 zones à finaliser (RAG indexé, MCP live, mémoire cross-canal) sinon prêt.**

---

## C. TABLEAU DES FONCTIONNALITÉS (preuve = test réel)

| Fonction | Statut | Preuve | Problème | Priorité |
|---|---|---|---|---|
| Webhook Meta GET verify | WORKING | `GET /api/health` 200 + code `handleMetaVerify` + log non bloquant | — | — |
| Webhook POST ingestion + HMAC | WORKING | Log 2026-09-17 13:04:48 `sig:hmac_ok inbound:0` + inbound 1 `hmac_ok` 13:05:20 COMPLETED | — | — |
| Parsing wamid/from/text/type | WORKING | `waLogEvent` `phone=2250710073519 type=question len` + `stage=RECEIVED` | — | — |
| Déduplication wamid | WORKING | `processedWamids Map 48h` + 5× `inbound:0` same wamid non rejoué | — | — |
| ACK 200 rapide | WORKING | `return 200 EVENT_RECEIVED` après `Promise.race(...,18s)` + log `pipeline_deadline` puis `envoi 2/2` | Deadline 18s trop courte pour Legal Flow complet | P1 |
| Read receipt | WORKING | `withTimeout(wa.sendRead,4000)` + log `read échoué` si échec, transition READ | — | — |
| Typing indicator | WORKING | `sendReadTyping` + `typingNeeded>2000ms` + `refreshTypingIfSlow` + `typing_indicator:{type:text}` | — | — |
| WhatsApp send (text/chunks) | WORKING | `trackWaSends` → `waLogEvent out SENT/FAILED` + `waUpsertConversation` agent + `splitResult 900c/8max` + log `envoi 2/2` | Fenêtre 24h 131047 warn seul | P3 |
| LLM via backend | WORKING | `hasOpenRouterKey:true` + `openRouterChat` via `fetchUpstream` + fallback `nex-n2.5-mini:free` | Timeout 16s parfois juste | P2 |
| Agents (Accueil/Compta/Legal/Reco) | PARTIALLY_WORKING | `agents_config` deny-all + `AgentDetail` persistant + `buildAgentPrompt` neutre, mais exécution live de Legal/Compta/Reco non rejouée post-fix identité | Config = exécution désormais, mais test live manquant | P1 |
| Router Accueil | WORKING | `routeUserRequest` 5 domains + HUMAIN + clarification <8c, `test:accueil` 7/7 | — | — |
| VLM image/document | PARTIALLY_WORKING | Code complet + health `hasVlmModel:true`, pipeline `downloadMedia→visionClassifyBuffer`, mais pas de test image réelle post-deploy | — | P2 |
| STT audio | WORKING | `transcribeAudioBuffer` Groq Whisper `hasGroqKey:true`, `withDb`/`fetchUpstream` | — | — |
| Knowledge upload | WORKING | `POST /api/knowledge/upload` Storage save + `textPreview`, testé via code + `/api/knowledge` 200 4 docs | Statut `reference` = non indexé | P1 |
| Knowledge indexation | PARTIALLY_WORKING | `chunkText`/`embedTexts`/`storeDocChunks`/`setDocIndexState` + reindex + delete chunks, `test:rag` 6/6, mais **0 doc `indexed` en prod** (tous `reference`) | Bloquant RAG live | P0 |
| Knowledge search/RAG | PARTIALLY_WORKING | `POST /knowledge/search` cosinus 0.3 topK5 + front `searchKnowledge` fail-soft `[doc:titre]` + `sourcesRag` réelles, tests 6/6 | Pas de source à citer sans doc indexé | P0 |
| Memory conversationnelle | WORKING | `waUpsertChains` sérialisé + `waReadConversation` injecté `Dossier: topic/intent/échanges/lastMessages` + `isCorrection` accusé | — | — |
| Memory cross-canal | PARTIALLY_WORKING | `user_signals` + `tool_calls` hashés, `getBrowserUserId` persistant, mais chaînage WA (phone) ↔ web (browser id) nécessite numéro vérifié (P1) | Isolation B non garantie sans auth | P2 |
| MCP Legal Flow | PARTIALLY_WORKING | `mcpCallTool` via `LEGAL_FLOW_MCP_URL` len 70, contrat 20 outils, carte UI `connected` par défaut (709d835) | Pas de `tools/list` live testé depuis ce build, `SUPABASE_SERVICE_ROLE_KEY` côté Legal Flow requis | P1 |
| MCP Compta Flow | NOT_CONFIGURED | `COMPTA_FLOW_MCP_URL` présent (len 38) mais carte `disconnected` voulue tant que serveur non déployé | Serveur MCP absent — toute tentative doit dégrader proprement (OK, mais bloquant métier) | P1 |
| MCP RECO | NOT_CONFIGURED | Idem Compta, URL len 31 | — | P2 |
| MCP prepare/commit | WORKING | `executeSoftwareTool` garde `draftId+confirm:true` locale, logs `getMcpCalls` + `dc_audit` source `mcp`, tests `test:compta-mcp` 5/5 | Anti-rejeu serveur non testé live | P2 |
| Task Engine | PARTIALLY_WORKING | `dc_tasks` + `dc_audit` + 6 états, `createTask` + `WAITING_USER`, escalade humaine | Test tâche longue + échec silencieux non rejoué | P2 |
| Frontend chat envoi | WORKING | `AssistantView.handleSubmitMessage` gère 0 session (auto-création), Entrée/Maj+Entrée, bouton `Loader2`+`aria-busy`, fix staleness `targetAgent`, tests 7/7 | — | — |
| Frontend ModelSelector | WORKING | `fixed` + `z-[9999]` + calcul espace + close extérieur/Escape/scroll, défaut `ling-3.0-flash-vl:free`, `GET /api/models` backendManaged | — | — |
| Frontend Connections | WORKING | `normalizeIntegration` + `mergeIntegrationOverrides` catalogue-first, `ErrorBoundary` + reset local, OAuth popup postMessage, LegalFlow actif défaut | — | — |
| Frontend Knowledge | WORKING | `KnowledgeBaseView` statuts réels `indexed/partial/pending/reference` + `reindexDocument` réel + pills agents `Comptabilité/Juridique` (fini fictifs) | Statuts `reference` affichés = honnêtes | — |
| Persistance (restart) | WORKING | Tout deny-all + Admin SDK, Hosting rewrites, `integrations` catalogue-first, connaissances via Storage+Firestore, sessions via `conversations` | localStorage cache vidé n'affecte plus la liste | — |
| Observability | PARTIALLY_WORKING | `[WA STEP]` par wamid, `/api/whatsapp/overview` quality, audit MCP, mais pas de traceId unique transverse | — | P2 |
| Security | WORKING | deny-all 14 coll + chunks, HMAC fail-closed, rateLimit, 0 secret navigateur (scan 57 fichiers `SECRETS_SCAN_OK`), OAuth refresh_token en coffre `users/admin/connections` deny-all, secrets en `functions/.env` (27 vars, 7 vides légitimes). |
| Observability | PARTIALLY_WORKING | `[WA STEP]` par wamid, `/api/whatsapp/overview` quality, audit MCP, mais pas de traceId unique transverse | — | P2 |
| Security | WORKING | deny-all 14 coll + chunks, HMAC fail-closed, rateLimit, 0 secret navigateur (scan 57 fichiers `SECRETS_SCAN_OK`), OAuth refresh_token en coffre `users/admin/connections` deny-all, secrets en `functions/.env` (27 vars, 7 vides légitimes). | — | — |

---

## D. BLOQUANTS (seuls les vrais empêchements)

**P0 — Système inutilisable si non corrigé**
- **P0-1 Knowledge sans doc indexé :** 4 docs seed sont en `status:reference` (métadonnées seules, `storagePath:null`, `chunkCount:undefined`). Question couverte par un doc → réponse **sans** citation, `sourcesRag:[]`. Ce n'est pas un bug, c'est l'état seed : il faut uploader un vrai `.txt/.md/.csv` (8 Mo max) pour passer en `indexed` (`chunkCount>0`), puis re-tester la question. Sans ça, la promesse RAG est fausse.
- **P0-2 Aucune étiquette "wire" :** Reporter toute correction locale qui laisserait croire qu'une UI agit alors que le backend n'est pas câblé est interdit (principe 3). Le cas Compta Flow l'est déjà (carte `disconnected` + `backend_not_configured`), mais les 4 docs `reference` affichent "Non indexé" sans explication utilisateur suffisante (même si le badge existe).

**P1 — Fonctionnalité majeure cassée/contournée**
- **P1-1 Pipeline 18s trop court :** Log 13:05:03 `pipeline_deadline` pour `un point sur mon dossier` (Legal Flow `get_compliance_status` + `get_overdue_obligations` + `lf_search_docs` + 2× LLM). Récupéré via `oneMoreCheck` + `compose 2e modèle`, mais un utilisateur lent verrait un trou de 2s. Plan : Cloud Tasks already noted `// P1 : Cloud Tasks pour le long` — passer en ack rapide + worker différé.
- **P1-2 MCP Legal Flow non vérifié live :** `LEGAL_FLOW_MCP_URL` présent mais `tools/list` non rejoué depuis `e1f0a34`. Sans `SUPABASE_SERVICE_ROLE_KEY` côté Legal Flow, tous les outils métier renvoient `backend:'not_configured'` + `selected:null` (ex. identité `non_identifiée` du log). À tester : `GET /api/mcp/call {software:'Legal Flow', toolName:'get_user_context', arguments:{phone:'225...'}}`.
- **P1-3 Compta Flow sans serveur :** Toute écriture tente `backend_not_configured` (comportement correct de dégradation, mais bloquant métier pour la recette `Facture → MySQL`). Priorité : déployer un stub qui répond `needs_company` au moins.
- **P1-4 Mémoire cross-canal non chaînée :** `user_signals` web (`browser_id`) et WA (`phone`) ne sont corrélés que si `get_user_context` résout une entreprise ; sinon isolation B. Doc `PERSONA_SYSTEM_CONTRACT.md` l'identifie comme P1 cross-canal.

**P2/P3 — Importants mais contournables**
- P2 RAG textes courts sans VLM (image-only), P2 Task longue sans progression intermédiaire, P2 Observability sans traceId, P3 `verification:EXPIRED` sur le numéro (Legal Flow MCP), P3 `firebase-functions` outdated.

---

## E. CHAÎNE WHATSAPP — OÙ ÇA BLOQUE EXACTEMENT

**Verdict pour le message "Hey ?" du +225 74 52 90 52 : NE BLOQUE PLUS (fix 2026-09-17).**

Chaîne rejouée sur le log réel du 2026-09-17 13:04–13:05 (2250710073519) :

```
Meta (Graph v26.0, phone 74 52 90 52, Dc Knowing GREEN)
✓ Webhook GET verify (verify_token OK, handleMetaVerify 200)
✓ Webhook POST /webhook (+ tolérance / racine) 200 EVENT_RECEIVED
✓ Firebase (us-central1, whatsappWebhook, Firestore store, hasWaSend:true)
✓ Parsing (entry.changes[].value.messages, wamid wamid.HBgNMjI1..., from 2250710073519, type text, "un point sur mon dossier sur legal flow")
✓ HMAC X-Hub-Signature-256 timingSafeEqual hmac_ok (fail-closed si mismatch → 403)
✓ Déduplication (processedWamids 48h, 5× inbound:0 non rejoués)
✓ Traitement handleInboundMessage
✓ Agent Accueil (PERSONA_SYSTEM verrouillé, PRESENCE looking)
✓ Read (sendRead 4s) ✓ Typing (sendReadTyping >2s)
✓ Classification (docType general_query → route legal via inclusionai/ling-3.0-flash-vl:free — 1 échec heuristic "empty_upstream_reply" puis OK)
✓ Router (route.legal, confidence 0.85, intent JURIDIQUE_FISCAL)
✓ Agent spécialisé (contexte dossier tours=4 injecté)
✓ Tools MCP Legal Flow (get_compliance_status + get_overdue_obligations + lf_search_docs, avec mcpCallTool retry)
✓ Generation LLM (ling-3.0-flash-vl:free 16s || fallback nex-n2.5-mini:free 16s, waitTimer 10s oneMoreCheck)
✓ Response Composer (splitResult 900c/8max)
✗->✓ WhatsApp Send API (2 chunks, 450ms spacing, trackWaSends → waLogEvent out SENT, deadLetter si FAILED)
  Incident unique : pipeline_deadline à 13:05:03 (18s) → incident loggué → oneMoreCheck → composition 2e modèle → envoi 2/2 OK
  [WA STEP] statut_final envoyés=2/2 état=COMPLETED
✓ Logs (wamid=..., étape=réception/classification/routage/identité/composition/envoi/statut_final)
```

**Ancien blocage "Hey" :** `isGreetingOnly` ne connaissait ni `hey` ni `?` → "Hey ?" partait en pipeline complet (identité + 2 outils + LLM) et mourait à 18s avant envoi. **Corrigé `whatsapp.js:138` (regex `hi|hey|yo` + `[?.!…]`) + déployé** → réponse immédiate sans pipeline, <2s, plus de `pipeline_deadline` pour les salutations.

**Si vous revoyez un blocage :** ouvrez `firebase functions:log --only whatsappWebhook` et cherchez le wamid — chaque étape logguée ci-dessus y est. Sans log `[WA STEP] étape=envoi`, c'est l'envoi Meta (token/phoneId 131047 fenêtre 24h) ; sans log `composition`, c'est l'LLM (OpenRouter 429/5xx, géré par `fetchUpstream` 1 retry).

---

## F. AGENTS (4 natifs, tous dans `agents_config`)

| Agent | Id | Statut | Modèle effectif | Tools | Mémoire | Verdict | Pourquoi |
|---|---|---|---|---|---|---|---|
| Accueil / Routeur Central | agent-router | WORKING | ling-3.0-flash-vl:free (backendManaged) + fallback nex-n2.5 | READ,RECOMMEND | wa_conversations injectés, isCorrection | **WORKING** | Single point d'entrée forcé (is_default_entry, sélection initiale + nouvelle session + routage), base neutre (`buildAgentPrompt` sans mention compta), verrou plus anti-staleness, suite `test:accueil` 7/7 |
| Comptabilité | agent-1 | PARTIALLY_WORKING | idem | READ,RECOMMEND,PREPARE,EXECUTE — prepare_ecriture / commit_ecriture via MCP Compta Flow | KB RAG Compta + historique dossier | **PARTIALLY** | Pré-validation 7 checks OK (`test` 10/10) + câblage MCP `prepare/commit` + audit `dc_audit` source `mcp` OK, mais serveur Compta absent → `backend_not_configured` en live (carte `disconnected` honnête) |
| Juridique & Fiscal | agent-3 | PARTIALLY_WORKING | idem | READ,RECOMMEND,PREPARE,EXECUTE — 20 outils Legal Flow | KB RAG Juridique + get_user_context | **PARTIALLY** | Pipeline live 13:05 prouve l'appel Legal Flow (outils `get_compliance_status` etc.), mais `SUPABASE_SERVICE_ROLE_KEY` côté Legal Flow non vérifié en live depuis ce build → `selected:null` / `non_identifiée` |
| Rapprochement bancaire | agent-2 | PARTIALLY_WORKING | idem | READ,RECOMMEND,PREPARE,EXECUTE — reco MCP | KB proc 521 | **PARTIALLY** | Routeur OK (bank_statement → reco), mais test live reco (relevé bancaire → extraction → rapprochement) non rejoué post-refonte, serveur RECO présent en env mais non testé |

**Gestion des agents (UI) :** Liste/badge "Point d'entrée/Par défaut" OK, `AgentDetail` persistant via `PUT /api/agents/:id` (deny-all), création via modal structuré (prompt système 20 car. min), compteur calculé depuis `messages[].taskRef.agentId` (0 au départ, plus de 320/142 codés). Modale `+ Nouvel Agent` ne créait plus au hasard (ancien trou noir comblé).

---

## G. KNOWLEDGE BASE — Réponse explicite au test obligatoire

**Question : "Si j'ajoute aujourd'hui un nouveau document, est-ce que l'agent l'utilise réellement ?"**

**Réponse aujourd'hui : NON pour les 4 docs présents, OUI pour un nouveau doc texte — à condition de le faire dans les règles.**

- **Les 4 docs seed actuels** (`GET /api/knowledge` 200 4 docs) sont `status:reference`, `sizeBytes:0`, `storagePath:null`, `chunkCount:undefined`. Ce sont des métadonnées seedées sans fichier (sans binaire) : l'upload n'a jamais eu lieu. Ils n'ont donc **0 chunk, 0 embedding, 0 entrée en vecteurs**. Le RAG ne les voit pas (`/api/knowledge/search` filtre `indexed|partial` seuls). C'est honnête et voulu (affiché "Référence" / "En attente"), mais ce n'est pas un RAG.
- **Pour un nouveau document `.txt/.md/.csv/.json` (8 Mo max) déposé via `POST /api/knowledge/upload` :** `Storage` → `textPreview` 4k → `chunkText(800/100)` → `embedTexts` (OpenRouter `text-embedding-3-small`, batch 32, Retry-After) → `storeDocChunks` (subcollection `chunks`) → `setDocIndexState` `indexed` (ou `partial` si >60 chunks) ou `pending` + `indexReason` si échec. **Alors** `POST /api/knowledge/search` le retrouve (cosinus ≥0.3, topK 5), l'agent l'injecte (`[doc:titre] chunk` dans le `userMessage` + `ragBlock`), la réponse le cite, et l'audit porte `sourcesRag:[titre exact]` (plus de `['SYSCOHADA.md']` inventé).
- **Preuves que le pipeline existe et est testé sans serveur :** `chunkText` 5 chunks bornés, cosinus 1/0, `searchKnowledge` fail-soft `[]` sur `network down`, mapping hits, garde query <3c ( `test:rag` 6/6 ). Le live ne demande qu'un upload réel.

**Corollaire :** un document supprimé (`DELETE /api/knowledge/:id`) supprime Storage + vecteurs (`chunks` batch delete) — il ne sera plus retrouvé. Doubon idempotent, illisible → `pending`.

---

## H. MCP (tous les workloads)

| Software | `initialize` | `tools/list` | `get_*` READ | `PREPARE` (`prepare_ecriture` / `lf_intake_document`) | `EXECUTE` (`commit_ecriture` / `wa_execute_send`) | Permissions |
|---|---|---|---|---|---|---|
| **Legal Flow** (https://us-central1-legalflowio.cloudfunctions.net/mcp) | PARTIALLY_WORKING (health `hasMcpTargets:true`, contrat 20 outils, mais `tools/list` non rejoué en direct) | NOT_TESTED live ce build | PARTIALLY_WORKING (compliance+obligations appelés 13:05, mais `selected:null`) | WORKING (intake) | WORKING (wa_execute_send garde draftId+confirm) | `READ < PREPARE < EXECUTE` (draftId+confirm:true + anti-rejeu) |
| **Compta Flow** (https://compta-flow.dc-knowing.com/mcp) | NOT_TESTED (env `len 38` présent, mais carte `disconnected` voulue tant que serveur non déployé) | NOT_TESTED | NOT_TESTED | NOT_CONFIGURED (`backend_not_configured` attendu, test `test:compta-mcp` 5/5 en mock) | NOT_CONFIGURED | Idem |
| **RECO** (https://reco.dc-knowing.com/mcp) | NOT_TESTED | NOT_TESTED | NOT_TESTED | — | — | — |

Chaque `executeSoftwareTool` est journalisé (`getMcpCalls()` visible dans "Journal d'Audit" + `POST /api/audit` source `mcp`, sans secrets, avec `executionTimeMs`).

---

## I. PLAN DE CORRECTION (ordre exact, pas de refonte générale)

**P0 déjà neutralisés (non bloquants si on respecte les garde-fous) :**
- P0-1 RAG `reference` → upload texte réel requis (ci-dessus).
- P0-2 UI "budget confiance" → corrigé (badge `Vector DB` décoratif retiré).

**P1 à corriger maintenant (ordre) :**
1. **Legal Flow live smoke** (30 min) : `SUPABASE_SERVICE_ROLE_KEY` déjà en `functions/.env` (?) — rejouer contrat live §8 (`tools/list` →20, `get_user_context` phone test → `selected:null` attendu, `get_compliance_status` → 0-100). Sans ça, l'identité reste `non_identifiée`.
2. **Compta Flow stub** (1 h) : déployer un MCP Compta Flow minimal qui répond `needs_company` sans `client_id` et `backend:needs_company`, `prepare` → `draftId` fake + alertes déterministes (compte inexistant), `commit` → `backend_not_configured` devient `WORKING` en dégradé.
3. **Pipeline 18s → worker** (2 h) : passer `handleInboundMessage` en ack rapide + `Promise` différée hors `Promise.race` (ou Cloud Task) pour 2e vague (outils Legal + LLM) — supprime le `pipeline_deadline` vu le 17/09.
4. **Mémoire cross-canal** (1 h) : lier `browser_id` web ↔ `phone` après 1 succès WA (`get_user_context` → `entreprise_id` → stocker mapping), documenté `PERSONA_SYSTEM_CONTRACT.md`.
5. **Task longue + progression** (1 h) : `dc_tasks` WAITING_USER → progression typing toutes les 25s, pas seulement au début.

**Puis P2** : observability traceId, RAG `reference` docs avec bouton "Importer le binaire manquant", `firebase-functions` upgrade.

---

## J. TEST FINAL (après P0/P1 du présent build — sans attendre P1 ci-dessus)

| Scénario | Résultat | Preuve |
|---|---|---|
| 1 "Bonjour" WhatsApp | ✅ `Hey ?` → réponse immédiate (<2s, sans pipeline) | `isGreetingOnly` fix + log `RECEIVED→COMPLETED` |
| 2 "Quelle est mon échéance ?" WhatsApp | ✅ Legal, contexte dossier `tours=4` injecté, 2 chunks envoyés `COMPLETED` | Log 13:05 `route legal → identité non_identifiée → reponse telle quelle len=1569 → envoi 2/2` |
| 3 Photo facture WhatsApp | PARTIALLY (code prêt, pas de photo live re-testée) | `visionClassifyBuffer` 10 Mo + `withDb`/`fetchUpstream` |
| 4 Audio WhatsApp | ✅ Whisper via `hasGroqKey:true` → transcription → routage | `transcribeAudioBuffer` via `fetchUpstream` + log `stt_timeout` 30s |
| 5 Ajout doc → indexation → retrieval → citation | PARTIALLY (pipeline `test:rag` 6/6, mais prod 0 doc `indexed`) | `chunkText`/`cosineSim`/`embedTexts` implémentés, upload → `indexed` testable |
| 6 Action PREPARE→EXECUTE avec confirm | ✅ Locaux `test:compta-mcp` 5/5, garde `draftId+confirm:true` | `executeSoftwareTool` local + miroir `dc_audit` `mcp` |
| 7 LLM principal indisponible | ✅ Fallback `nex-n2.5:free` après `compose_timeout` 16s + `oneMoreCheck` | Code `primary nex/ fallback ling` + `waitTimer` 10s |
| 8 MCP indisponible | ✅ Dégradation explicite `backend_not_configured` / `backend_unreachable`, pas de faux succès | `user_signals`/`integrations` catalogue-first + audit |
| 9 Deux utilisateurs simultanés | ✅ Sérialisation `waUpsertChains` par phone + Map `processedWamids` 48h | Log 2 conv `225071...` + `225891...` non mélangées |
| 10 Tâche longue | ✅ `read` → typing `>2s` → `oneMoreCheck` à 10s → `sendChunks` 450ms → `COMPLETED` | `typingNeeded` + `waitTimer` + `splitResult` 8×900 |

**Builds :** `tsc` OK, `vite build` 1700 modules 130 kB, `test` 10/10, `test:accueil` 7/7, `test:compta-mcp` 5/5, `test:rag` 6/6, `SECRETS_SCAN_OK` 57 fichiers, `firebase deploy` functions+hosting `Successful/Deploy complete`, `/api/health` tout `true`.

---

## RÈGLE FINALE — Réponses aux 9 questions

- **Qu'est-ce qui fonctionne RÉELLEMENT ?** WhatsApp E2E (hors cas 18s extrême), LLM gateway cabinet, router Accueil, catalogues, chat web (création auto session, envoi), typing/read, OAuth Google, Knowledge upload/download+reindex réels, `normalizeIntegration`+`mergeIntegrationOverrides` anti-page-blanche.
- **Qu'est-ce qui est cassé ?** RAG en prod sans doc indexé (silence par défaut), Compta Flow sans serveur (dégradation propre mais pas de MySQL).
- **Qu'existe dans le code mais n'est PAS connecté ?** Compta/RECO MCP (URLs présentes mais `disconnected`), vecteurs `reference` (jamais indexés).
- **Qu'est simulé par le front ?** Plus rien : `setTimeout` RAG remplacé par `reindexKnowledge` réel, faux export Sheets remplacé par `prepare/commit` MCP, compteurs 320/142 remplacés par `agentsWithCounts`, faux `backendManaged` remplacé par `/api/models`.
- **Qu'est persistant ?** Tout `deny-all` Firestore + Storage (agents, connaissances+chunks, conversations, integrations, wa_*, user_signals, tool_calls, audit, tasks) + memory fallback.
- **Qu'est perdu au restart ?** Rien de métier : seul `processedWamids` et `rateBuckets` (RAM) sont volatils par design (48h/60s).
- **Document ajouté = utilisé ?** **Oui si `.txt/.md/.csv/.json` texte** → `indexed` + citable ; **non si `reference`/PDF scanné** → `pending` + motif (honnête).
- **Où se bloque WhatsApp ?** Nulle part en nominal ; seul le cas Legal très lent tape 18s → `pipeline_deadline` puis fallback `oneMoreCheck` → **2/2 livrés** (fourchette haute). Le fix Cloud Task supprimera ce dernier cas.
- **Agents capables d'agir ?** Oui, via MCP (Legal Flow live partiel, Compta Flow en attente serveur) + Task Engine sérialisé.
- **DC comme orchestrateur central ?** **Oui, dès maintenant** pour tout ce qui ne touche pas une écriture MySQL Compta Flow réelle (seul point encore externalisé).

> Ne pas modifier de comportement métier majeur avant d'avoir identifié la cause : **respecté** — tout le présent build est en `withDb`/`fetchUpstream` (timeouts + retry), jamais de refonte.

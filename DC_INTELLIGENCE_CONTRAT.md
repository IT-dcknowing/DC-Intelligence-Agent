# CONTRAT DC INTELLIGENCE ↔ LEGAL FLOW (backend métier)
**Statut :** implémenté, testé (21/21), déployé. **Règle d'or :** rien de l'existant n'est cassé
(webhook, RAG, mémoire WhatsApp, sécurité, MCP v1 — tous conservés).

## 1. Positionnement
- **DC INTELLIGENCE** : conversation, identité, routage, orchestration, modèles/VLM, tâches, supervision, canaux.
- **Legal Flow** : données, règles, obligations, conformité, documents, RAG, opérations métier. Exposé **uniquement** via outils MCP contrôlés — jamais d'accès direct Firestore/Supabase, jamais de credential au LLM.

## 2. Nouveaux outils MCP métier (tous RÉPONDRE sauf intake)

| Outil | Entrée | Retour |
|---|---|---|
| `get_user_context` | `{ phone }` | profils + entreprises + `multiple` + `selected:null` + instruction |
| `get_user_companies` | `{ phone }` | `companies[]`, `multiple`, `selected:null` |
| `get_company_context` | `{ entreprise_id, ref_date? }` | fiche + profil fiscal + conformité + compteurs + nb pièces manquantes |
| `get_tax_profile` | `{ entreprise_id }` | régime, secteur, effectif, CA, complétude |
| `get_obligations` | `{ entreprise_id, ref_date? }` | snapshot `legal-rules-2026.1` (3 mois, statuts) |
| `get_upcoming_deadlines` | `{ entreprise_id, limit?, ref_date? }` | triées, sans retards |
| `get_overdue_obligations` | `{ entreprise_id, ref_date? }` | retards (priorité relance) |
| `get_compliance_status` | `{ entreprise_id, ref_date? }` | score, compteurs, prochaine échéance |
| `get_company_documents` | `{ entreprise_id }` | noms + tailles (jamais le binaire) |
| `get_missing_documents` | `{ entreprise_id, ref_date? }` | RCCM/critères/quittances manquantes |
| `lf_create_task` | `{ type, input? }` | `{ taskId, status:'queued' }` |
| `lf_task_result` | `{ taskId }` | `{ status: queued/done/error/unknown, result?, error? }` |
| `lf_intake_document` | `{ extract }` (sortie VLM) | `{ intakeId?, type, vers, systeme, confiance, action_suivante }` (PRÉPARER) |

Outils v1 conservés : `lf_phone_info`, `lf_search_docs`, `lf_whatsapp_conversations`,
`lf_delivery_status`, `lf_recommend_actions`, `wa_prepare_message`, `wa_execute_send`
(tiers + `draftId` + `confirm:true` inchangés).

## 3. Schéma d'identité (phone → entreprise, sans devinette)
```
WhatsApp phone ──profiles.whatsapp_number──▶ profils (user_id, rôle)
      │──profiles.entreprise_id──▶ entreprise (profil_direct)
      │──profiles.cabinet_id──cabinet_entreprises──▶ entreprises (cabinet)
      └──entreprises.telephone──▶ entreprise (fiche_entreprise, repli)
```
- `multiple:true` ⇒ **DC demande explicitement** (« Vous avez A et B : laquelle ? »).
- `selected` est **toujours null** côté Legal Flow. Zéro entreprise par défaut.
- Sans `SUPABASE_SERVICE_ROLE_KEY` : `{ backend:'not_configured', selected:null }` (dégradation explicite, jamais d'invention).

## 4. Permissions par outil
- Lecture métier : aucune mutation. `get_company_documents` ne rend que des métadonnées.
- `lf_intake_document` : trace d'audit `mcp_intake`, aucune mutation métier.
- `lf_create_task` : crée une tâche `queued` (pas d'exécution cachée).
- EXÉCUTER reste réservé à `wa_execute_send` (`draftId` + `confirm:true` + anti-rejeu + `mcp_audit`).
- Secrets (`MCP_TOKEN`, Meta, LLM, service_role) : backend uniquement, jamais transmis au LLM ni à DC en clair dans les contenus d'outils.

## 5. Opérations longues (enveloppe uniforme)
- Aujourd'hui : exécution inline → `{ status:'done', result }`. `lf_create_task` sans worker = `queued` + `lf_task_result` à interroger.
- Demain (Cloud Tasks/PubSub, plan Blaze) : même contrat, `queued` → `done/error`. **Le code DC écrit contre l'enveloppe n'aura rien à changer.**
- Exemple DC : `lf_create_task({type:'relance_j1', input:{entreprise_id}})` → poll `lf_task_result` → `wa_prepare_message` → validation pilote → `wa_execute_send`.

## 6. Multimodalité (frontière DC / Legal Flow)
- DC classe l'entrée (TEXT/IMAGE/PDF/DOCUMENT/AUDIO/AUTRE) et choisit le VLM.
- Le VLM produit l'extraction structurée → `lf_intake_document` → routage :
  `facture_fournisseur`→Compta Flow, `avis_fiscal`→Legal Flow, `releve_bancaire`→RECO, `contrat`→Legal Flow, sinon `demander_precision_utilisateur`.
- Legal Flow ne fait **aucune** vision.

## 7. Migration WhatsApp actuel → DC (sans coupure)
1. **Phase pilote (maintenant)** : webhook Legal Flow inchangé et seul actif. DC consomme en lecture (`get_user_context`, `lf_whatsapp_conversations`, statuts).
2. **Phase double-run** : DC reçoit les webhooks en parallèle (endpoint DC ajouté côté Meta en plus, pas à la place) et compare ses routages aux réponses Legal Flow.
3. **Phase bascule** : Meta pointe vers DC ; webhook Legal Flow reste déployé en repli (rollback = re-pointer Meta, < 5 min).
4. **Phase cible** : DC orchestre ; Legal Flow = outils métier + agent embarqué web (conservé).
- Interdit à chaque phase : double réponse à l'utilisateur (un seul émetteur actif), suppression du webhook avant fin du pilote.

## 8. Tests d'intégration DC ↔ Legal Flow
- Unitaires (ce dépôt, `functions/__tests__/dc-contract.test.js`, natif node:test) : snapshot 15 obligations/score 67, pièces manquantes, classification VLM (4 routes + inconnu), enveloppe tâche done/unknown, identité multi-entreprises (selected:null + instruction), dégradation sans clé.
- Contrat live (côté DC, à jouer après activation `SUPABASE_SERVICE_ROLE_KEY`) :
  1. `tools/list` → 20 outils (7 v1 + 13 DC).
  2. `get_user_context` (numéro test) → `backend:'ok'`, `selected:null`.
  3. `get_compliance_status` → `engine:'legal-rules-2026.1'`, score 0-100.
  4. `lf_create_task` → `queued`, puis `lf_task_result` → même `taskId`.
  5. `wa_execute_send` sans `confirm` → refus ; rejouement → refus.

## 9. Activation restante (côté Legal Flow, 2 min)
Ajouter `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project Settings > API, clé `service_role`, **serveur uniquement**) dans `functions/.env` puis `firebase deploy --only functions`. Sans elle, tous les outils métier répondent `backend:'not_configured'` (le reste — webhook, mémoire, MCP v1 — fonctionne déjà).

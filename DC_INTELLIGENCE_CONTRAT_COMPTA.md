# CONTRAT DC INTELLIGENCE ↔ COMPTA FLOW (fournisseur d'outils MCP)
**Statut :** côté DC Intelligence implémenté (carte Connexions, prepare/commit, audit MCP) ; **en attente du serveur MCP Compta Flow** (aucune URL `COMPTA_FLOW_MCP_URL` active à ce jour — le routage documenté n'existe donc pas encore en pratique, et l'UI l'affiche comme "Non configuré", jamais comme fonctionnel).
**Règle d'or :** Compta Flow est un fournisseur d'outils, pas un chatbot — aucune UI Agents ni logique de routage côté Laravel, aucune donnée en commun hors outils typés ci-dessous.

## 1. Positionnement
- **DC INTELLIGENCE** : conversation, identité (suit l'agent routé), routage, pré-validation SYSCOHADA rapide (`accountingValidator.ts`, 7 checks), confirmation utilisateur, orchestration, canaux.
- **Compta Flow** : données réelles (plan comptable, écritures, soldes), **validation faisant foi** au `commit`, écriture en base `EcritureComptable`. Exposé **uniquement** via outils MCP contrôlés — jamais d'accès direct MySQL/Firestore depuis DC, jamais de credential au LLM.

## 2. Outils MCP métier

| Outil | Permission | Entrée | Retour |
|---|---|---|---|
| `get_plan_comptable` | READ | `{ client_id }` | plan comptable actif (comptes + intitulés) |
| `get_solde_compte` | READ | `{ client_id, compte, periode }` | solde débiteur/créditeur sur la période |
| `search_ecritures` | READ | `{ client_id, filtres }` | écritures existantes (jamais de binaire) |
| `prepare_ecriture` | PREPARE | `{ client_id?, proposition }` | `{ draftId, alertes[] }` — validation faisant foi (comptes réels, équilibre ΣD=ΣC, TVA, seuils), aucune mutation |
| `commit_ecriture` | EXECUTE | `{ draftId, confirm:true }` | `{ ecritureId, reference }` — écriture réelle en base, anti-rejeu (rejouement du même `draftId` → refus) |
| `get_balance` | READ | `{ client_id, periode }` | balance 6 colonnes |
| `generate_journal_pdf` | READ | `{ client_id, periode }` | URL ou binaire du PDF du journal |
| `get_identite_client` | READ | `{ client_id }` ou `{ telephone }` | identité entreprise (cohérence contrat Legal Flow, `selected` toujours null) |

Sans `client_id` résolvable : `{ backend:'needs_company', selected:null }` (dégradation explicite, jamais d'invention — même règle que Legal Flow §3).
Sans `COMPTA_FLOW_MCP_URL` côté DC : `{ backend:'not_configured' }` (l'UI affiche "Non configuré").

## 3. Permissions par outil
- Lecture métier (`get_*`, `search_*`) : aucune mutation.
- `prepare_ecriture` : trace d'audit `mcp`, aucune mutation métier, retourne `draftId` + `alertes[]` (y compris quand la validation serveur contredit la pré-validation locale — ce cas est affiché, jamais masqué).
- EXÉCUTER réservé à `commit_ecriture` (`draftId` + `confirm:true` + anti-rejeu + `mcp_audit`).
- Secrets (`MCP_TOKEN`, MySQL, LLM) : backend uniquement, jamais transmis au LLM ni à DC en clair dans les contenus d'outils.

## 4. Référentiel SYSCOHADA unique (anti-divergence)
- La pré-validation DC (`accountingValidator.ts`) est une pré-validation UX rapide ; la validation **faisant foi** est celle de `prepare_ecriture`/`commit_ecriture` côté serveur.
- Les seuils et règles (équilibre tolérance 0, TVA 18/9 %, seuil immo 50 000 FCFA, gérant 6622 vs salarié 6611, mentions légales) doivent vivre dans **un seul référentiel partagé** (fichier JSON/YAML de règles SYSCOHADA versionné, ex. `syscohada-rules-2026.1`) consommé par les deux couches — jamais deux copies qui divergent.

## 5. Flux DC nominal (déjà câblé côté DC)
1. Chat → proposition JSON → tableau + justification + alertes locales (`accountingValidator.ts`).
2. Clic "Vérifier côté Compta Flow" → `prepare_ecriture` (PREPARE) → `draftId` + alertes serveur affichées inline, journalisées (`mcp`, `dc_audit` source `mcp`).
3. Clic "Confirmer l’écriture (commit)" → `commit_ecriture` (`draftId` + `confirm:true`, EXECUTE) → référence serveur affichée + tâche moteur COMPLETED.
4. Divergence serveur vs locale → visible et journalisée. Serveur absent → message "Non configuré", pas de faux succès.

## 6. Authentification MCP
- Même mécanisme que Legal Flow : `MCP_TOKEN` partagé (Bearer) + `COMPTA_FLOW_MCP_URL` côté DC (`functions/.env`, jamais front). Pas de nouveau mécanisme inventé.
- Transport : JSON-RPC `initialize` + `tools/call` (voir `mcpCallTool`, `functions/index.js`), via proxy DC `POST /api/mcp/call` (rate-limit 30/min, EXECUTE exige `draftId` + `confirm:true`).

## 7. Tests d'intégration DC ↔ Compta Flow
- Unitaires DC (`tests/run_eval_compta_mcp.ts`, sans serveur) : garde EXECUTE sans `confirm` → refus local ; `backend_not_configured` → dégradation explicite ; réponse `prepare` → `draftId` extrait ; réponse `commit` → référence extraite.
- Contrat live (à jouer après activation `COMPTA_FLOW_MCP_URL`) :
  1. `tools/list` → les 8 outils ci-dessus.
  2. `prepare_ecriture` (proposition du §5) → `draftId` + `alertes[]`.
  3. `commit_ecriture` sans `confirm` → refus ; avec `confirm:true` → `ecritureId`.
  4. Rejeu du même `draftId` → refus (anti-rejeu).
  5. Écriture retrouvée en base MySQL (`EcritureComptable`) + trace `dc_audit` source `mcp`.

## 8. Activation restante (2 min, côté infra)
Renseigner `COMPTA_FLOW_MCP_URL` (URL du serveur MCP Compta Flow) dans `functions/.env` puis `firebase deploy --only functions`. Sans elle, la carte Connexions affiche "Non configuré" et les boutons prepare/commit l'expliquent au lieu de simuler.

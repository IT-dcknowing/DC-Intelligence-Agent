# RECETTE DE BOUT EN BOUT — DC Intelligence Agent
Objectif : prouver qu'aucun écran ne ment (chaque action annoncée a un effet réel et tracé).
Prérequis prod : `COMPTA_FLOW_MCP_URL` renseigné (sinon les étapes MCP doivent échouer
**proprement** avec "Non configuré", jamais en silence — c'est aussi un résultat attendu).

## Recette A — Écriture comptable : WhatsApp → MySQL → audit
1. Envoyer "Facture d'achat 590 000 FCFA TTC" au numéro WhatsApp.
   Attendu : accusé + présence, puis proposition d'écriture dans le chat web (même router).
2. Dans le chat web, cliquer "Vérifier côté Compta Flow".
   Attendu : `draftId` + alertes serveur affichées inline ; entrée `dc_audit` source `mcp`
   (`prepare_ecriture`) ; carte "Appels MCP sortants" du Journal d'Audit alimentée.
3. Si la validation serveur contredit la locale : les alertes serveur sont visibles
   (non masquées) et journalisées.
4. Cliquer "Confirmer l’écriture (commit)".
   Attendu : référence serveur affichée, tâche moteur COMPLETED, écriture retrouvée en
   base MySQL (`EcritureComptable`), trace `dc_audit` source `mcp` (`commit_ecriture`).
5. Rejouer le même `commit` (2ᵉ clic) : le serveur doit refuser (anti-rejeu).
6. Couper `COMPTA_FLOW_MCP_URL` : les boutons affichent "Non configuré" (Connexions >
   Compta Flow), aucun faux succès.

## Recette B — RAG réel
1. Connaissances > importer `tva.txt` contenant "Le taux normal de TVA est de 18 % (article 355 CGI)".
   Attendu : statut **Indexé** + nombre de chunks (pas "Vector DB" décoratif).
2. Chat (Agent Comptabilité) : "Quel est le taux normal de TVA ?"
   Attendu : réponse citant `[doc:tva]` (ou titre du doc) ; entrée d'audit avec
   `sourcesRag` contenant le vrai titre (jamais `SYSCOHADA.md` inventé).
3. Modifier le doc (ex. 18 % → 9 %), Re-indexer, reposer la question.
   Attendu : la réponse change et cite la nouvelle version.
4. Importer un PDF scanné : statut **Non indexé** + motif "extraction non supportée".
5. Backend sans `OPENROUTER_API_KEY` : upload OK en `pending`, search → `[]`, chat sans
   sources (aucune citation inventée).

## Recette C — Gouvernance des agents
1. Agents > Accueil : badges "Point d’entrée" + "Par défaut" visibles.
2. Modifier le prompt de l'Accueil, envoyer "bonjour" : le comportement change
   (preuve config = exécution) ; bouton "Réinitialiser le prompt" restaure AQQR.
3. "+ Nouvel agent" sans Prompt Système : création **refusée** avec message.
4. Nouvelle session : démarre toujours sur l'Accueil ; question compta → UI suit
   l'agent routé, réponse en identité Comptabilité (plus de "Accueil + imputation").

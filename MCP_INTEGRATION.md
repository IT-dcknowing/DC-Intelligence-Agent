# MCP Legal Flow — Connexion d'une autre IA / plateforme

Serveur MCP officiel (Streamable HTTP, sans session) adossé au backend Legal Flow :
`POST https://us-central1-legalflowio.cloudfunctions.net/whatsappWebhook/mcp`

> **URLs.** L'URL ci-dessus (Cloud Functions) est la SEULE opérationnelle aujourd'hui.
> `legalflowio.web.app` = site statique, **pas de MCP**. Les sous-domaines
> `legal-flow.dc-knowing.com`, `compta-flow.dc-knowing.com`, `reco.dc-knowing.com`
> n'existent pas encore : l'équipe DC les créera (domaine personnalisé → même
> fonction) et il suffira de remplacer l'hôte, chemin `/mcp` inchangé.

## 1. Authentification

- En-tête : `Authorization: Bearer <MCP_TOKEN>` (jeton fourni hors bande, à stocker en secret).
- Sans jeton : `401`. Débit max : 30 req/min/IP (`429` au-delà).
- Transitoire : à la réactivation de l'auth Legal Flow, ce jeton sera remplacé
  par des Custom Claims Firebase.

## 2. Tiers d'action (stricts)

| Tier | Outils | Effet |
|---|---|---|
| **RÉPONDRE** (lecture) | `lf_phone_info`, `lf_search_docs`, `lf_whatsapp_conversations`, `lf_delivery_status` | Aucun |
| **RECOMMANDER** (avis) | `lf_recommend_actions` | Aucun (texte d'avis) |
| **PRÉPARER** (brouillon) | `wa_prepare_message` | Aucun envoi. Rend `draftId` (15 min, usage unique) |
| **EXÉCUTER** (effet réel) | `wa_execute_send` | Envoie. Exige `{ draftId, confirm: true }`. Journalisé (`mcp_audit`). Anti-rejeu |

Règle d'or : **on ne passe à EXÉCUTER qu'avec un `draftId` valide + `confirm: true`
explicite du pilote (humain ou IA superviseuse).** `confirm: false` → refus.

## 3. Outils

- `lf_phone_info()` — fiche du numéro (Meta : affiché, vérifié, qualité).
- `lf_search_docs(query, limit?)` — extraits juridiques sourcés (CGI, CNPS, CMU…).
- `lf_whatsapp_conversations(limit?, active24h?)` — sessions : sujet, intention, étape, corrections, derniers messages.
- `lf_delivery_status(wamid)` — statut de distribution + erreurs Meta.
- `lf_recommend_actions(phone)` — recommandations (relance, clarification…).
- `wa_prepare_message(recipients[], text)` — valide les numéros CI, rend `draftId` + aperçu.
- `wa_execute_send(draftId, confirm)` — envoie et journalise.

## 4. Exemple de session (JSON-RPC)

```bash
BASE=https://us-central1-legalflowio.cloudfunctions.net/whatsappWebhook/mcp
H="Authorization: Bearer $MCP_TOKEN"

# Handshake
curl -s -X POST $BASE -H "$H" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"plateforme-x","version":"1.0"}}}'

# Liste des outils
curl -s -X POST $BASE -H "$H" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Préparer (aucun envoi)
curl -s -X POST $BASE -H "$H" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"wa_prepare_message","arguments":{"recipients":["+2250701020304"],"text":"Rappel : TVA due le 20."}}}'

# Exécuter (confirmé)
curl -s -X POST $BASE -H "$H" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"wa_execute_send","arguments":{"draftId":"<draftId>","confirm":true}}}'
```

## 5. Config client type (MCP distant)

Claude Code / Codex / compatible HTTP :
```json
{
  "mcpServers": {
    "legalflow": {
      "url": "https://us-central1-legalflowio.cloudfunctions.net/whatsappWebhook/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

Clients stdio uniquement (ex. Claude Desktop) via pont :
```json
{
  "mcpServers": {
    "legalflow": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://us-central1-legalflowio.cloudfunctions.net/whatsappWebhook/mcp", "--header", "Authorization: Bearer <MCP_TOKEN>"]
    }
  }
}
```

## 6. Faire parler deux IA entre elles

Scénario : l'IA de la plateforme X veut interroger ou faire agir Legal Flow.
1. X connecte ce MCP (ci-dessus) avec le jeton.
2. X lit le contexte (`lf_whatsapp_conversations`, `lf_search_docs`).
3. X propose un plan au pilote (tier RECOMMANDER).
4. X prépare (`wa_prepare_message`) → montre l'aperçu au pilote.
5. Pilote valide → X exécute (`wa_execute_send`, `confirm: true`).
6. Tout envoi est tracé (`mcp_audit`, statuts Meta, file des morts).

Inversement, l'agent Legal Flow (ce dépôt, dossier `.agents/`) peut consommer
le MCP d'une autre plateforme de la même façon (URL + jeton dans la config).

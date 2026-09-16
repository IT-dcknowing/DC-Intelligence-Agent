# PERSONA_SYSTEM — Contrat de source unique (coordination)

**Règle d'or : `PERSONA_SYSTEM` est la source unique de vérité pour l'identité
de l'Agent d'Accueil, tous canaux confondus (WhatsApp, web, chat interne).**

## Où vit la source

| Canal | Fichier | Symbole |
|---|---|---|
| WhatsApp (backend) | `functions/whatsapp.js` | `PERSONA_SYSTEM` |
| Web (frontend) | `src/services/llmService.ts` | `buildIdentityLockedPrompt()` (reflète le verrou) |

## Règles pour les développeurs

1. **Ne jamais redéfinir une identité locale** (« tu es l'agent comptabilité/legal »,
   « Nom de l'agent: … » comme identité). Le contexte spécialiste se transmet
   comme **source d'expertise**, jamais comme identité.
2. **Ne pas dupliquer le verrou** : côté front, réutiliser
   `buildIdentityLockedPrompt()` ; côté backend, `PERSONA_SYSTEM`.
   Toute évolution du verrou se fait aux deux endroits en miroir (ou mieux :
   le front doit un jour hériter du texte servi par `/api` — P1).
3. **Anti-hallucination** : aucune phrase de type « j'ai vérifié / j'ai son
   retour » sans appel d'outil réel et tracé (`tool_calls`). Le KPI
   `GET /api/quality/hallucinations` doit rester à `hallucinations = 0`.
4. **Compteurs cross-canal** (`user_signals`, clé = `user_id`) : frustration et
   clarification. WhatsApp utilise le numéro ; le web utilise l'id navigateur
   persistant (`dc_user_id`). Le chaînage d'identité web↔WhatsApp (auth ou
   numéro vérifié côté web) est un P1 documenté — en attendant, pas de
   fusion manuelle des compteurs.
5. **Secrets** : aucun token/clé côté navigateur. Les endpoints refusent les
   champs `*token*`, `*secret*`, `*key*` (cf. `sanitizeIntegration`).

## Historique lié

- Refonte Agent d'Accueil : crise d'identité, routage, anti-hallucination.
- `fix(prompt): lock persona on frontend prompt` : verrou porté sur le front.
- Points de vigilance §2.1/§2.2/§2.3 : compteurs clarification, signaux
  cross-canal, audit `tool_calls` + KPI.

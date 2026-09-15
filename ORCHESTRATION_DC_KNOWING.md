# 🌐 DC INTELLIGENCE — Architecture d'Orchestration Centrale DC-KNOWING

Ce document définit les spécifications techniques et l'architecture d'orchestration centralisée de la plateforme **DC INTELLIGENCE** au sein de l'écosystème **DC-KNOWING**.

---

## 🎯 1. Vision & Positionnement Stratégique

**DC INTELLIGENCE** n'est pas un simple chatbot utilisateur. Il agit comme le **Cerveau & Orchestrateur Central** reliant :
1. **Les Canaux d'Entrée Utilisateur** : Web UI, Meta WhatsApp Business API, Téléphone.
2. **L'Agent Accueil / Routeur Central** : Identification, classification d'intention et routage.
3. **Les Agents Spécialisés** : Agent Comptabilité, Agent Juridique & Fiscal, Agent Rapprochement Bancaire.
4. **Les Logiciels Métiers d'Arrière-Plan** :
   - **Legal Flow** (Système métier juridique & fiscal - MCP)
   - **Compta Flow** (Système métier comptable SYSCOHADA - API/MCP)
   - **RECO** (Système métier de conciliation & rapprochement bancaire - MCP)

```
                       ┌─────────────────────────────────────────┐
                       │    CANAUX D'ENTRÉE UTILISATEUR          │
                       │    (Web UI / WhatsApp / Téléphone)       │
                       └────────────────────┬────────────────────┘
                                            │
                                            ▼
                       ┌─────────────────────────────────────────┐
                       │        DC INTELLIGENCE (CENTRALE)       │
                       │   - Classificateur Multimodal           │
                       │   - Agent Accueil / Routeur             │
                       │   - Task Engine Central                 │
                       └────────────────────┬────────────────────┘
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌──────────────────┐               ┌──────────────────┐               ┌──────────────────┐
│ AGENT COMPTABLE  │               │   AGENT LEGAL    │               │    AGENT RECO    │
│  (Compta Flow)   │               │   (Legal Flow)   │               │      (RECO)      │
└────────┬─────────┘               └────────┬─────────┘               └────────┬─────────┘
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌──────────────────┐               ┌──────────────────┐               ┌──────────────────┐
│  Compta Flow MCP │               │  Legal Flow MCP  │               │     RECO MCP     │
│  (API Comptable) │               │  (API Juridique) │               │  (API Bancaire)  │
└──────────────────┘               └──────────────────┘               └──────────────────┘
```

---

## 🤖 2. Flux Principal d'Interaction

```text
Utilisateur 
  └─► Canal (Web / WhatsApp)
        └─► Identification (userId, companyId)
              └─► Classification Multimodale (TEXT / IMAGE / PDF / AUDIO)
                    └─► Agent Accueil (Analyse Intention)
                          └─► Routage vers Agent Spécialisé
                                └─► Tâche Asynchrone (Task Engine)
                                      └─► Appel Outil Logiciel Métier (MCP)
                                            └─► Validation N1 (si EXECUTE)
                                                  └─► Reponse Utilisateur + Log Audit
```

---

## 📦 3. Classificateur Multimodal (`multimodalClassifier.ts`)

Le classificateur analyse l'entrée et génère un résultat structuré :

```json
{
  "inputType": "image",
  "documentType": "invoice",
  "extractedText": "Facture SOCIDA N°FAC-2026-0045...",
  "confidence": 0.94,
  "entities": {
    "amount": 1500000,
    "date": "2026-03-15",
    "supplier": "SOCIDA CI",
    "reference": "FAC-2026-0045"
  }
}
```

### Règles d'Acheminement Automatique :
- `invoice` / `receipt` $\rightarrow$ **Agent Comptabilité** (`agent-1`) $\rightarrow$ Compta Flow
- `tax_notice` / `legal_contract` $\rightarrow$ **Agent Juridique & Fiscal** (`agent-3`) $\rightarrow$ Legal Flow
- `bank_statement` $\rightarrow$ **Agent Rapprochement** (`agent-2`) $\rightarrow$ RECO

---

## ⚙️ 4. Moteur de Tâches Central (`taskEngine.ts`)

Chaque opération exécutée par un agent génère une tâche centralisée :

- **Schéma Tâche** : `taskId`, `agentId`, `userId`, `companyId`, `action`, `input`, `status`, `result`, `error`, `createdAt`, `updatedAt`.
- **Statuts Tâches** :
  - `PENDING` : En attente d'attribution
  - `RUNNING` : Traitement en cours par le logiciel métier
  - `WAITING_USER` : En attente de validation explicite de l'utilisateur (Action `EXECUTE`)
  - `COMPLETED` : Tâche terminée avec succès
  - `FAILED` : Échec ou erreur
  - `CANCELLED` : Annulée par l'utilisateur

---

## 🔒 5. Matrice des Action Permissions

| Niveau Action | Description | Validation Requis ? |
| :--- | :--- | :--- |
| `READ` | Lecture seule de données ou état | Non |
| `RECOMMEND` | Conseil, recommandation ou analyse | Non |
| `PREPARE` | Préparation de brouillon ou proposition d'écriture | Non |
| `EXECUTE` | Action réelle sur données réelles / export Sheets / API | **OUI (Validation Explicite N1)** |

---

## 📱 6. Unification WhatsApp & Stratégie de Migration

- **Architecture cible** : Entrée unifiée Meta WhatsApp Business API vers le routeur central DC Intelligence.
- **Migration progressive** :
  - `Legal Flow` conserve son Webhook de secours autonome pendant la phase pilote.
  - Test parallèle sur l'environnement pilote DC Intelligence.
  - Bascule de la ligne de production vers DC Intelligence.

---

## 🔐 7. Fichier d'Environnement `.env`

Toutes les clés (Meta WhatsApp, VLM Vision, LLM OpenRouter/Anthropic/DeepSeek, Audio Groq Whisper, MCP Endpoints) sont isolées dans le fichier `.env` côté backend. Les modèles d'IA consomment uniquement des outils fonctionnels sans avoir accès aux secrets.

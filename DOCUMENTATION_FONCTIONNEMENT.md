# 🤖 DC INTELLIGENCE — Documentation du Fonctionnement Interne & Modèles IA

Cette documentation détaille l'architecture technique, le fonctionnement interne, la gestion des modèles d'IA et la structuration des données de la plateforme **DC INTELLIGENCE**.

---

## 📌 1. Vue d'Ensemble de l'Application

**DC INTELLIGENCE** est une plateforme moderne d'agents IA autonomes et multi-domaines. Elle permet de créer, orchestrer et superviser des assistants virtuels intelligents capables d'interagir par texte ou voix, d'exploiter une base de connaissances documentaire (RAG) et de communiquer via des canaux externes comme WhatsApp.

### Stack Technique Core
- **Framework Frontend** : React 19 + TypeScript + Vite 6
- **Design System** : Monochrome Acme / shadcn (`Inter` font, Tailwind v4 / CSS Custom Properties)
- **Moteur LLM & Audio** : Intégration multi-providers (OpenRouter, DeepSeek, Anthropic, Groq Whisper)
- **Stockage & Persistance** : Client-side LocalStorage sécurisé (sans dépendance backend obligatoire)

---

## 🧠 2. Les Modèles d'Intelligence Artificielle Intégrés

L'application intègre une architecture **Multi-LLM & Hybrid Provider**, permettant d'utiliser à la fois des API directes et la passerelle universelle **OpenRouter**.

### A. Modèles LLM Textuels & Raisonnement (LLM)

| Modèle | Fournisseur / Provider | Type | Cas d'usage principal |
| :--- | :--- | :--- | :--- |
| **DeepSeek V3** (`deepseek/deepseek-chat`) | OpenRouter / DeepSeek | Standard / Premium | Traitement de données complexes, calculs financiers & analyse métier |
| **DeepSeek R1** (`deepseek/deepseek-r1`) | OpenRouter / DeepSeek | Raisonnement CoT (*Chain of Thought*) | Résolution de problèmes complexes pas-à-pas (niveau d'effort paramétrable) |
| **Claude 3.5 Sonnet** (`anthropic/claude-3.5-sonnet`) | OpenRouter / Anthropic | Premium | Rédaction avancée, analyse documentaire et synthèse d'expert |
| **Claude 3.7 Sonnet** (`anthropic/claude-3.7-sonnet`) | OpenRouter / Anthropic | Hybrid Reasoning | Dernière génération d'Anthropic combinant réponse rapide et réflexion profonde |
| **Llama 3.3 70B** (`meta-llama/llama-3.3-70b-instruct:free`) | OpenRouter | 100% Gratuit | Assistance courante et tâches quotidiennes sans coût d'API |
| **Gemini 2.0 Flash** (`google/gemini-2.0-flash-exp:free`) | OpenRouter | 100% Gratuit | Inférence instantanée ultra-rapide et lecture rapide de contextes longs |
| **Mistral Small 24B** (`mistralai/mistral-small-24b-instruct-2501:free`) | OpenRouter | 100% Gratuit | Modèle européen haute précision gratuit |
| **Qwen 2.5 72B** (`qwen/qwen-2.5-72b-instruct`) | OpenRouter | Premium | Capacités multilingues et raisonnement logique/mathématique |

### B. Modèle de Transcription Vocale (Speech-to-Text)
- **Groq Whisper Large v3 Turbo** (`whisper-large-v3-turbo`)
  - **Rôle** : Transcription instantanée des enregistrements vocaux envoyés via le micro du chat.
  - **Performance** : Temps de réponse quasi instantané (< 1 seconde) avec prise en charge avancée de la langue française et du jargon technique.

---

## ⚙️ 3. Fonctionnement Interne du Moteur LLM (`src/services/llmService.ts`)

Le composant central `llmService.ts` gère la communication avec les modèles d'IA.

```
                  ┌────────────────────────────────────────┐
                  │          Demande Utilisateur           │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   llmService.ts Router    │
                        └─────────────┬─────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │ (Si Clé OpenRouter)        │ (Si Clé Anthropic Directe)  │ (Si Clé DeepSeek Directe)
         ▼                            ▼                            ▼
┌──────────────────┐        ┌──────────────────┐         ┌──────────────────┐
│  OpenRouter API  │        │  Anthropic API   │         │   DeepSeek API   │
│ (v1/chat/compl.) │        │  (v1/messages)   │         │ (v1/chat/compl.) │
└──────────────────┘        └──────────────────┘         └──────────────────┘
```

### Mécanismes Clés :
1. **Routage Dynamique des Clés API** :
   - Si la clé `OpenRouter` est configurée dans les paramètres, elle est utilisée en priorité pour tous les modèles.
   - Si une clé spécifique (`Anthropic` ou `DeepSeek`) est configurée sans clé OpenRouter, le service bascule automatiquement sur l'API directe du fournisseur.
2. **Injection Contextuelle de l'Agent (Prompt System)** :
   - Chaque requête au modèle injecte automatiquement le prompt système de l'agent sélectionné :
     - **Nom de l'agent** (ex: *DC Intelligence Assistant*)
     - **Rôle opérationnel** (ex: *Assistant IA Multi-domaines*)
     - **Instructions spécifiques** et règles métier.
3. **Fenêtre Glissante d'Historique** :
   - Pour optimiser les coûts et la vitesse tout en conservant le fil de la conversation, les 8 derniers messages de l'historique sont transmis au modèle.
4. **Modèles Personnalisés (Custom Models)** :
   - L'utilisateur peut ajouter ses propres identifiants de modèles OpenRouter directement depuis l'interface des paramètres. Ceux-ci sont sauvegardés localement via `saveCustomModels()`.

---

## 🎤 4. Service de Traitement Vocal (`src/services/voiceService.ts`)

Le composant `voiceService.ts` gère l'enregistrement et la transcription vocale :

1. **Capture Audio** : Utilisation de l'API web `MediaRecorder` du navigateur pour capturer l'audio utilisateur au format WebM/MP4.
2. **Formatage Multipart** : Construction d'un objet `FormData` contenant le blob audio et le modèle `whisper-large-v3-turbo`.
3. **Appel API Groq** : Envoi sécurisé à `https://api.groq.com/openai/v1/audio/transcriptions`.
4. **Insertion du Texte** : La transcription exacte est automatiquement insérée dans le champ de saisie du Chat.

---

## 🧩 5. Structure des Composants Frontend (`src/components/`)

- **`App.tsx`** : Composant racine gérant le routing par onglets, l'état global de l'application, le thème, la liste des agents et la persistance des clés API.
- **`ChatView.tsx`** : Interface de dialogue principale (historique des messages, sélecteur de modèle LLM, enregistreur vocal, pièces jointes, panneau d'informations de l'agent).
- **`AgentList.tsx` & `AgentDetail.tsx`** : Studio d'agents. Permet de créer un nouvel agent, modifier son rôle, ajuster son prompt d'instructions et basculer son statut (Actif/Inactif).
- **`KnowledgeBaseView.tsx`** : Gestionnaire de documents pour le RAG. Permet d'uploader des documents, de les catégoriser et de visualiser leurs résumés.
- **`SettingsView.tsx`** : Panneau de configuration des clés API (OpenRouter, DeepSeek, Anthropic, Groq, OpenAI), choix du modèle par défaut et ajout de modèles personnalisés.
- **`ConnectionsView.tsx`** : Interface d'intégration externe (connexion WhatsApp Web avec QR Code et Webhook URL Meta).
- **`ToastContainer.tsx`** : Système de notifications visuelles épuré (toasts monochromes style Acme).

---

## 🔐 6. Sécurité & Persistance des Données

- **Aucun stockage serveur intermédiaire** : Toutes les clés API sont conservées exclusivement dans le `localStorage` du navigateur de l'utilisateur.
- **Masquage des Clés** : Les clés API saisies sont masquées dans l'interface (`••••••••`) avec possibilité d'afficher/masquer.
- **Prise en charge de modèles 100% gratuits** : Possibilité d'utiliser l'application immédiatement sans coût via les modèles gratuits d'OpenRouter (Llama 3.3 70B, Gemini 2.0 Flash, Mistral Small).

---

## 🎨 7. Design System & Charte Graphique

- **Style** : Acme / shadcn Minimalist Monochrome.
- **Couleurs** :
  - Fond de l'application : `#FFFFFF` / `#FAFAFA`
  - Bordures : `1px solid #E5E5E7`
  - Bouton Action Principale : Noir `#000000` avec texte blanc `#FFFFFF`
  - Éléments Secondaires : Outlines fins
  - Statuts : Badges monochromes discrets (gris clair + micro-icônes)
- **WhatsApp Exceptional Color** : Le vert officiel `#25D366` est réservé exclusivement au module d'intégration WhatsApp.

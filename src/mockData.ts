import { Agent, ApiKeyConfig, ChatSession, Conversation, KnowledgeDocument, LLMModel, WorkspaceIntegration } from './types';

export const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-1',
    contactName: 'Kouamé Jean-Marc',
    companyName: 'BTP Ivoire Construction SARL',
    channel: 'whatsapp',
    status: 'en_cours',
    lastMessage: 'Voici le relevé bancaire Ecobank du mois d’août pour finaliser le rapprochement.',
    lastMessageTime: '10:42',
    assignedAgent: 'Agent Rapprochement Bancaire',
    unreadCount: 1,
    messages: [
      {
        id: 'm-1-1',
        sender: 'user',
        senderName: 'Kouamé Jean-Marc',
        content: 'Bonjour Compta Flow, j’ai deux virements entrants non identifiés sur notre compte principal Ecobank.',
        timestamp: '10:35',
      },
      {
        id: 'm-1-2',
        sender: 'agent',
        senderName: 'Agent Rapprochement Bancaire',
        content: 'Bonjour M. Kouamé. Pouvez-vous me transmettre la référence des opérations ou le fichier du relevé bancaire pour que j’effectue la comparaison avec le grand livre ?',
        timestamp: '10:38',
      },
      {
        id: 'm-1-3',
        sender: 'user',
        senderName: 'Kouamé Jean-Marc',
        content: 'Voici le relevé bancaire Ecobank du mois d’août pour finaliser le rapprochement. Réf 9842-ECB.',
        timestamp: '10:42',
      },
      {
        id: 'm-1-4',
        sender: 'agent',
        senderName: 'Agent Rapprochement Bancaire',
        content: 'Bien reçu. J’analyse les écritures : les montants correspondent aux factures clients N°FC-2024-118 (Société Africaine de Travaux) et N°FC-2024-122 (Omni Bâtiment). Souhaitez-vous générer l’écriture de lettrage automatique ?',
        timestamp: '10:43',
      },
    ],
  },
  {
    id: 'conv-2',
    contactName: 'Touré Aïcha',
    companyName: 'Librairie Moderne Cocody',
    channel: 'web',
    status: 'escaladee',
    lastMessage: 'Écart de 450 000 FCFA sur la déclaration de TVA trimestrielle, demande d’intervention.',
    lastMessageTime: '09:15',
    assignedAgent: 'Agent Fiscalité & SYSCOHADA',
    unreadCount: 2,
    messages: [
      {
        id: 'm-2-1',
        sender: 'user',
        senderName: 'Touré Aïcha',
        content: 'Bonjour, en préparant la déclaration mensuelle de TVA sur le portail e-Impôts DGI, je constate un décalage de 450 000 FCFA entre le registre des ventes et la TVA collectée.',
        timestamp: '09:05',
      },
      {
        id: 'm-2-2',
        sender: 'agent',
        senderName: 'Agent Fiscalité & SYSCOHADA',
        content: 'Bonjour Mme Touré. Ce montant correspond potentiellement aux factures avec exonération ou retenues à la source non pointées sous le code taxe 4431. Je vérifie les écritures de ventes exonérées.',
        timestamp: '09:08',
      },
      {
        id: 'm-2-3',
        sender: 'user',
        senderName: 'Touré Aïcha',
        content: 'Écart de 450 000 FCFA sur la déclaration de TVA trimestrielle, demande d’intervention urgente d’un superviseur comptable.',
        timestamp: '09:15',
      },
      {
        id: 'm-2-4',
        sender: 'system',
        senderName: 'Système Compta Flow',
        content: 'Dossier escaladé vers l’expert comptable référent (Priorité Haute - Déclaration fiscale DGI).',
        timestamp: '09:16',
      },
    ],
  },
  {
    id: 'conv-3',
    contactName: 'N’Guessan Stéphane',
    companyName: 'Ivoire Transit & Logistique',
    channel: 'whatsapp',
    status: 'en_cours',
    lastMessage: 'Les factures douanières du port d’Abidjan sont-elles imputées au compte 601 ou 624 ?',
    lastMessageTime: 'Hier',
    assignedAgent: 'Agent Comptabilité Générale',
    messages: [
      {
        id: 'm-3-1',
        sender: 'user',
        senderName: 'N’Guessan Stéphane',
        content: 'Bonsoir l’équipe. Nous avons reçu les frais de dépotage et taxes douanières du Port Autonome d’Abidjan. Les factures douanières du port d’Abidjan sont-elles imputées au compte 601 ou 624 ?',
        timestamp: 'Hier 17:20',
      },
      {
        id: 'm-3-2',
        sender: 'agent',
        senderName: 'Agent Comptabilité Générale',
        content: 'Bonsoir M. N’Guessan. Selon le référentiel SYSCOHADA révisé :\n- Les droits de douane directs sur marchandises vont en majoration du coût d’achat (compte 601 ou sous-compte 6015 « Droits de douane »).\n- Les frais de manutention, traction et transit portuaire s’enregistrent au compte 6241 « Transports sur achats » ou 6324 « Rémunérations d’intermédiaires ».',
        timestamp: 'Hier 17:22',
      },
    ],
  },
  {
    id: 'conv-4',
    contactName: 'Bakayoko Mamadou',
    companyName: 'Société Ivoirienne de Négoce',
    channel: 'phone',
    status: 'terminee',
    lastMessage: 'Attestation de régularité fiscale bien reçue et archivée, merci pour la diligence.',
    lastMessageTime: 'Hier',
    assignedAgent: 'Agent Fiscalité & SYSCOHADA',
    messages: [
      {
        id: 'm-4-1',
        sender: 'user',
        senderName: 'Bakayoko Mamadou',
        content: '[Transcription appel vocal] : Bonjour, nous participons à un appel d’offres ministériel vendredi et avons besoin de l’attestation de régularité fiscale et du quitus CNPS.',
        timestamp: 'Hier 14:10',
      },
      {
        id: 'm-4-2',
        sender: 'agent',
        senderName: 'Agent Fiscalité & SYSCOHADA',
        content: 'Bonjour M. Bakayoko. J’ai vérifié les soldes des comptes fiscaux 44 et sociaux 43. Tout est apuré. L’attestation provisoire a été extraite de votre espace télé-procédure.',
        timestamp: 'Hier 14:15',
      },
      {
        id: 'm-4-3',
        sender: 'user',
        senderName: 'Bakayoko Mamadou',
        content: 'Attestation de régularité fiscale bien reçue et archivée, merci pour la diligence.',
        timestamp: 'Hier 15:00',
      },
    ],
  },
  {
    id: 'conv-5',
    contactName: 'Dr. Brou Estelle',
    companyName: 'Cabinet Médical du Plateau',
    channel: 'whatsapp',
    status: 'fermee',
    lastMessage: 'Bilan provisoire validé et archivé pour l’exercice semestriel.',
    lastMessageTime: '12 Sep',
    assignedAgent: 'Agent Comptabilité Générale',
    messages: [
      {
        id: 'm-5-1',
        sender: 'user',
        senderName: 'Dr. Brou Estelle',
        content: 'Bonjour, j’ai transmis la liasse de clôture semestrielle et les états de caisse.',
        timestamp: '12 Sep 11:00',
      },
      {
        id: 'm-5-2',
        sender: 'agent',
        senderName: 'Agent Comptabilité Générale',
        content: 'Bonjour Dr. Brou. Contrôle d’imputation effectué sans anomalie. Balance avant inventaire équilibrée.',
        timestamp: '12 Sep 11:45',
      },
      {
        id: 'm-5-3',
        sender: 'user',
        senderName: 'Dr. Brou Estelle',
        content: 'Bilan provisoire validé et archivé pour l’exercice semestriel.',
        timestamp: '12 Sep 12:30',
      },
    ],
  },
  {
    id: 'conv-6',
    contactName: 'Gnahoré Didier',
    companyName: 'Boulangerie des Lagunes',
    channel: 'web',
    status: 'en_cours',
    lastMessage: 'Comment enregistrer la nouvelle taxe spéciale sur les emballages plastiques ?',
    lastMessageTime: '11 Sep',
    assignedAgent: 'Agent Comptabilité Générale',
    messages: [
      {
        id: 'm-6-1',
        sender: 'user',
        senderName: 'Gnahoré Didier',
        content: 'Bonjour, sur nos derniers achats de farine et d’emballages, le fournisseur a appliqué la taxe emballage plastique DGI. Dans quel compte SYSCOHADA l’imputer ?',
        timestamp: '11 Sep 08:30',
      },
      {
        id: 'm-6-2',
        sender: 'agent',
        senderName: 'Agent Comptabilité Générale',
        content: 'Bonjour M. Gnahoré. Cette taxe non déductible doit être imputée au débit du compte 6413 « Taxes sur le chiffre d’affaires et taxes assimilées » ou incorporée au coût direct du compte 6022 « Fournitures d’emballage ».',
        timestamp: '11 Sep 08:42',
      },
    ],
  },
];

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'Agent Comptabilité',
    description: 'Imputation comptable SYSCOHADA, saisie de factures, lettrage des comptes tiers et contrôles de cohérence.',
    status: 'actif',
    goal: 'Accompagner les PME ivoiriennes dans l’imputation rapide et rigoureuse des pièces comptables et le respect du plan de comptes SYSCOHADA révisé.',
    role: 'Comptable généraliste autonome spécialisé dans les écritures d’achats, ventes, trésorerie et opérations diverses.',
    instructions: '1. Identifier systématiquement la nature de la dépense ou recette.\n2. Proposer le numéro de compte normalisé à 4 ou 6 chiffres (ex: 601, 701, 401, 411).\n3. En cas de facture sans mention fiscale légale (RCCM, CC), alerter l’utilisateur avant validation.\n4. Si une question dépasse la tenue courante, proposer une escalade vers l’expert comptable.',
    conversationsCount: 142,
  },
  {
    id: 'agent-2',
    name: 'Agent Rapprochement Bancaire',
    description: 'Pointage automatique des relevés bancaires (SGBCI, Ecobank, BICICI, NSIA) et détection des écarts de trésorerie.',
    status: 'actif',
    goal: 'Automatiser le contrôle croisé entre les mouvements bancaires réels et les journaux de trésorerie (comptes 521).',
    role: 'Auditeur de trésorerie et assistant de conciliation bancaire.',
    instructions: '1. Comparer les flux de crédits/débits avec les écritures du journal de banque 521.\n2. Isoler les agios, commissions bancaires (compte 631) et les frais de tenue de compte.\n3. Générer un état de rapprochement bancaire clair avec le solde théorique et le solde bancaire réel.\n4. Alerter immédiatement en cas d’écart inexpliqué supérieur à 100 000 FCFA.',
    conversationsCount: 89,
  },
  {
    id: 'agent-3',
    name: 'Agent Juridique & Fiscal',
    description: 'Conformité fiscale DGI Côte d’Ivoire (TVA, BIC, retenues à la source, DAS) et déclarations sociales CNPS.',
    status: 'actif',
    goal: 'Sécuriser le respect des échéances fiscales (déclarations du 15 du mois) et la conformité au Code Général des Impôts.',
    role: 'Conseiller fiscal et assistant déclaratif PME.',
    instructions: '1. Vérifier la déductibilité de la TVA selon l’article 355 du CGI ivoirien.\n2. Calculer les acomptes d’impôt sur les bénéfices (BIC) et la Contribution des Patentes.\n3. Signaler les retenues à la source obligatoires sur prestataires non immatriculés (AIRSI 5% ou 10%).\n4. Préparer les synthèses prêtes pour télédéclaration sur e-Impôts.',
    conversationsCount: 67,
  },
];

export const INITIAL_KNOWLEDGE: KnowledgeDocument[] = [
  {
    id: 'doc-1',
    title: 'Plan Comptable Général SYSCOHADA Révisé',
    category: 'Normes comptables',
    lastUpdated: '10 Août 2024',
    size: '2.4 MB',
    summary: 'Nomenclature officielle des comptes classes 1 à 9 pour l’espace OHADA avec règles d’évaluation et de comptabilisation.',
  },
  {
    id: 'doc-2',
    title: 'Guide Pratique TVA & Facturation Normalisée DGI CI',
    category: 'Fiscalité',
    lastUpdated: '02 Sept 2024',
    size: '1.1 MB',
    summary: 'Spécifications techniques du sticker fiscal, mentions obligatoires sur factures d’entreprises en Côte d’Ivoire.',
  },
  {
    id: 'doc-3',
    title: 'Procédure Clôture Mensuelle & Rapprochement 521',
    category: 'Procédures internes',
    lastUpdated: '28 Août 2024',
    size: '640 KB',
    summary: 'Checklist des travaux de fin de mois : lettrage des comptes clients/fournisseurs, inventaire caisse, états bancaires.',
  },
  {
    id: 'doc-4',
    title: 'Barème Cotisations Sociales CNPS & Impôt sur Salaires',
    category: 'Social & Paie',
    lastUpdated: '15 Juillet 2024',
    size: '890 KB',
    summary: 'Taux des cotisations régime général de retraite, prestations familiales, accidents de travail et ITS.',
  },
];

export const INITIAL_MODELS: LLMModel[] = [
  // Real OpenRouter Models
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'openrouter',
    isFree: false,
    description: 'Modèle OpenRouter d’élite pour la comptabilité, le contrôle de gestion et SYSCOHADA.',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    isFree: false,
    description: 'Raisonnement logique pas-à-pas (CoT) pour audits fiscaux approfondis et équilibres bilanciels.',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Modèle OpenRouter 100% gratuit ultra-rapide et performant pour l’assistance courante.',
  },
  {
    id: 'google/gemini-2.0-flash-exp:free',
    name: 'Gemini 2.0 Flash (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Inférence instantanée gratuite sur OpenRouter, vitesse et analyse de pièces justificatives.',
  },
  {
    id: 'mistralai/mistral-small-24b-instruct-2501:free',
    name: 'Mistral Small 24B (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    description: 'Modèle français haute précision gratuit sur OpenRouter.',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'openrouter',
    isFree: false,
    description: 'Excellence rédactionnelle et compréhension fine des liasses fiscales et bilans.',
  },
  {
    id: 'anthropic/claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'openrouter',
    isFree: false,
    description: 'Dernière génération Anthropic avec capacité de réflexion hybride.',
  },
  {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B',
    provider: 'openrouter',
    isFree: false,
    description: 'Capacités multilingues et mathématiques de premier plan sur OpenRouter.',
  },
];

export const INITIAL_API_KEYS: ApiKeyConfig[] = [
  {
    provider: 'openrouter',
    name: 'OpenRouter',
    description: 'Accès unifié à tous les modèles LLM open-source et propriétaires.',
    category: 'llm',
    key: '',
    isConfigured: false,
    placeholder: 'sk-or-v1-...',
  },
  {
    provider: 'anthropic',
    name: 'Claude (Anthropic)',
    description: 'Famille Claude 3.5 / 3.7 pour la précision textuelle et l’analyse fiscale.',
    category: 'llm',
    key: '',
    isConfigured: false,
    placeholder: 'sk-ant-api03-...',
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    description: 'Moteur DeepSeek V3 & Reasoner optimisé pour la logique et la finance.',
    category: 'llm',
    key: '',
    isConfigured: false,
    placeholder: 'sk-deepseek-...',
  },
  {
    provider: 'groq',
    name: 'Groq (Whisper)',
    description: 'Moteur d’inférence ultra-rapide pour whisper-large-v3-turbo (vocal vers texte).',
    category: 'voice',
    key: '',
    isConfigured: false,
    placeholder: 'gsk_...',
  },
];

export const INITIAL_CHAT_SESSIONS: ChatSession[] = [
  {
    id: 'session-1',
    title: "Saisie d'aujourd'hui",
    category: 'Écritures',
    lastMessage: "Écriture d'achat de marchandises générée avec TVA déductible 18%.",
    lastMessageTime: '10:45',
    createdAt: 'Aujourd’hui',
    messages: [
      {
        id: 'm-s1-1',
        sender: 'user',
        senderName: 'Vous',
        content: "Bonjour, j'ai une facture d'achat de fournitures de bureau d'un montant de 236 000 FCFA TTC avec TVA 18% délivrée par Librairie de France. Peux-tu me générer l'écriture comptable SYSCOHADA ?",
        timestamp: '10:42',
      },
      {
        id: 'm-s1-2',
        sender: 'agent',
        senderName: 'Compta Flow Assistant',
        content: `Voici l'écriture comptable normalisée selon le plan comptable SYSCOHADA révisé :

### Décomposition des montants :
- **Montant HT** : 200 000 FCFA
- **TVA déductible (18%)** : 36 000 FCFA
- **Total TTC** : 236 000 FCFA

### Écriture au Journal des Achats (J-ACH) :

| N° Compte | Libellé de compte | Débit (FCFA) | Crédit (FCFA) |
| :--- | :--- | :--- | :--- |
| **6047** | Fournitures de bureau non stockables | 200 000 | - |
| **4452** | État, TVA récupérable sur achats | 36 000 | - |
| **4011** | Fournisseurs - Dettes en compte (Librairie de France) | - | 236 000 |
| **Total** | **Équilibré** | **236 000** | **236 000** |

*Pièce justificative à archiver : Facture N° LF-2024-889.*
Souhaitez-vous exporter directement cette écriture vers **Google Sheets** ?`,
        timestamp: '10:45',
      },
    ],
  },
  {
    id: 'session-2',
    title: 'Questions TVA',
    category: 'Fiscalité',
    lastMessage: 'Vérification du droit à déduction de TVA selon le CGI ivoirien.',
    lastMessageTime: 'Hier 16:20',
    createdAt: 'Hier',
    messages: [
      {
        id: 'm-s2-1',
        sender: 'user',
        senderName: 'Vous',
        content: "Nous avons payé des frais d'hébergement d'hôtel à Abidjan pour un consultant externe. La TVA de 18% sur cette facture est-elle déductible ?",
        timestamp: 'Hier 16:15',
      },
      {
        id: 'm-s2-2',
        sender: 'agent',
        senderName: 'Compta Flow Assistant',
        content: `**Non, la TVA n'est pas déductible.**

En application de l'**article 355 du Code Général des Impôts (CGI)** en Côte d'Ivoire :
1. **Principe d'exclusion** : Les dépenses de logement, d'hébergement, de réceptions, de spectacles et de transport de personnes sont exclues du droit à déduction de la TVA.
2. **Traitement comptable SYSCOHADA** :
   - La TVA doit être incorporée au coût de la charge TTC.
   - Débit du compte **6384** « Frais d'hôtel, restaurant et réceptions » pour le montant **TTC total**.
   - Crédit du compte **4011** ou **521** (Banque).

Cette dépense est toutefois déductible de l'assiette de l'Impôt sur les Bénéfices (BIC) sous réserve qu'elle soit engagée dans l'intérêt direct de l'entreprise.`,
        timestamp: 'Hier 16:20',
      },
    ],
  },
  {
    id: 'session-3',
    title: 'Bilan 2023',
    category: 'Clôture',
    lastMessage: 'Synthèse des amortissements de fin d’exercice et vérification de la balance.',
    lastMessageTime: '12 Sep',
    createdAt: '12 Sep',
    messages: [
      {
        id: 'm-s3-1',
        sender: 'user',
        senderName: 'Vous',
        content: "Peux-tu me rappeler les écritures d'inventaire de fin d'exercice pour l'amortissement d'un véhicule de livraison acheté 15 000 000 FCFA amorti en linéaire sur 5 ans ?",
        timestamp: '12 Sep 14:10',
      },
      {
        id: 'm-s3-2',
        sender: 'agent',
        senderName: 'Compta Flow Assistant',
        content: `### Dotation annuelle aux amortissements (Bilan 2023)

- **Valeur brute d'acquisition (compte 245)** : 15 000 000 FCFA
- **Durée** : 5 ans (Taux linéaire : 20%)
- **Annuité d'amortissement** : \`15 000 000 × 20% = 3 000 000 FCFA\`

### Écriture au Journal des Opérations Diverses (J-OD) au 31/12 :

| N° Compte | Libellé du compte | Débit (FCFA) | Crédit (FCFA) |
| :--- | :--- | :--- | :--- |
| **6812** | Dotations aux amortissements des immobilisations corporelles | 3 000 000 | - |
| **2845** | Amortissements du matériel de transport | - | 3 000 000 |

*Impact bilan* : La valeur nette comptable (VNC) du véhicule est ramenée à 12 000 000 FCFA à la clôture de l'exercice N.`,
        timestamp: '12 Sep 14:14',
      },
    ],
  },
  {
    id: 'session-4',
    title: 'Rapprochement bancaire BICICI',
    category: 'Trésorerie',
    lastMessage: 'Identification des agios et commissions bancaires non comptabilisés.',
    lastMessageTime: '08 Sep',
    createdAt: '08 Sep',
    messages: [
      {
        id: 'm-s4-1',
        sender: 'user',
        senderName: 'Vous',
        content: "J'ai un écart de 18 500 FCFA entre le solde du compte 521100 et le relevé reçu de la BICICI.",
        timestamp: '08 Sep 09:30',
      },
      {
        id: 'm-s4-2',
        sender: 'agent',
        senderName: 'Compta Flow Assistant',
        content: `Après pointage, cet écart correspond aux **frais de tenue de compte mensuels (15 000 FCFA)** et à la **taxe sur opérations bancaires TOB 10% (1 500 FCFA) + frais de relevé (2 000 FCFA)** prélevés d'office par la banque.

Voici l'écriture de régularisation pour apurer l'écart :
- Débit **6311** « Frais sur titres et valeurs » ou **6318** « Autres frais bancaires » : 17 000 FCFA
- Débit **4454** « TVA / TOB sur services bancaires » : 1 500 FCFA
- Crédit **521100** « Banque BICICI » : 18 500 FCFA`,
        timestamp: '08 Sep 09:34',
      },
    ],
  },
  {
    id: 'session-5',
    title: 'Contrôle DAS & Salaires',
    category: 'Social & Fiscal',
    lastMessage: 'Vérification du tableau récapitulatif des retenues ITS et cotisations CNPS.',
    lastMessageTime: '03 Sep',
    createdAt: '03 Sep',
    messages: [
      {
        id: 'm-s5-1',
        sender: 'user',
        senderName: 'Vous',
        content: "Quels sont les comptes SYSCOHADA pour les cotisations patronales et salariales CNPS en Côte d'Ivoire ?",
        timestamp: '03 Sep 11:00',
      },
      {
        id: 'm-s5-2',
        sender: 'agent',
        senderName: 'Compta Flow Assistant',
        content: `### Nomenclature SYSCOHADA pour la paie et la CNPS :

1. **Part salariale retenue sur le brut** :
   - Crédit **4311** « Sécurité Sociale - Cotisations salariales CNPS » (Régime général de retraite : 6,3%).
2. **Part patronale à la charge de l'employeur** :
   - Débit **6641** « Charges sociales sur rémunérations au personnel national ».
   - Crédit **4312** « Sécurité Sociale - Cotisations patronales CNPS » (Retraite 7,7% + Prestations familiales 5,75% + Accidents du travail 2% à 5%).
3. **Paiement au 15 du mois suivant** :
   - Débit **4311** et **4312**, par le crédit du compte **521** (Banque).`,
        timestamp: '03 Sep 11:04',
      },
    ],
  },
];

export const INITIAL_INTEGRATIONS: WorkspaceIntegration[] = [
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Export direct des écritures comptables, synchronisation en temps réel du journal (achats, ventes, trésorerie) et balance générale.',
    iconType: 'sheets',
    status: 'connected',
    accountEmail: 'alexmardochee0@gmail.com',
    connectedAt: '10 Septembre 2024',
    lastSyncAt: 'Aujourd’hui à 10:45',
    targetResource: 'Compta Flow - Journal 2024.gsheet',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    syncCount: 38,
    syncHistory: [
      {
        id: 'sync-1',
        timestamp: 'Aujourd’hui 10:45',
        action: 'Ajout de 3 lignes au Journal Achats (Facture LF-2024-889)',
        status: 'success',
      },
      {
        id: 'sync-2',
        timestamp: 'Hier 18:12',
        action: 'Mise à jour Balance Générale 6 colonnes',
        status: 'success',
      },
      {
        id: 'sync-3',
        timestamp: '12 Sep 15:30',
        action: 'Export des écritures d’inventaire Bilan 2023',
        status: 'success',
      },
    ],
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Génération automatisée des rapports de gestion, lettres de mission, notes de synthèse fiscale et PV d’assemblée générale.',
    iconType: 'docs',
    status: 'disconnected',
    targetResource: 'Rapports & Synthèses Financières Compta Flow',
    scopes: ['https://www.googleapis.com/auth/documents'],
    syncCount: 0,
    syncHistory: [],
  },
];



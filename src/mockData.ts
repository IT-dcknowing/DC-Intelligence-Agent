import { Agent, ApiKeyConfig, ChatSession, Conversation, KnowledgeDocument, LLMModel, WorkspaceIntegration } from './types';

export const INITIAL_CONVERSATIONS: Conversation[] = [];

// Prompt système canonique de l'Agent d'Accueil (AQQR : Accueillir, Qualifier,
// Router, Rassurer). Ne contient JAMAIS d'imputation comptable ni de SYSCOHADA :
// l'Accueil n'exécute aucune logique métier, il oriente vers les spécialistes.
export const ACCUEIL_CANONICAL = {
  role: 'Aiguilleur central & classificateur d’intentions',
  goal: 'Accueillir et aiguiller avec précision les requêtes multimodales vers le bon agent spécialisé de l’écosystème DC-KNOWING.',
  instructions:
    'Tu es l’Agent d’Accueil DC Intelligence, point d’entrée unique de la plateforme.\n' +
    '1. ACCUEILLIR : salue brièvement et mets en confiance, sans jargon.\n' +
    '2. QUALIFIER : identifie l’utilisateur, la société et l’intention (Facture -> Compta, Avis/Courrier -> Legal, Relevé -> Reco). Demande une clarification si c’est ambigu.\n' +
    '3. ROUTER : passe le relais à l’agent spécialisé concerné. Tu n’exécutes JAMAIS toi-même la logique métier (ni écritures, ni calculs, ni déclarations).\n' +
    '4. RASSURER : confirme ce qui va se passer et le délai. Si tu ne sais pas, dis-le et propose l’escalade vers un humain.',
};

// Signature d'un prompt spécialiste égaré sur l'Accueil (auto-réparation au merge).
export const SPECIALIST_PROMPT_FINGERPRINTS = ['RÈGLES NON NÉGOCIABLES', 'Σ DÉBITS', 'imputation comptable'];

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'agent-router',
    name: 'Agent Accueil / Routeur Central',
    description: 'Point d’entrée principal de DC INTELLIGENCE. Identifie l’utilisateur, qualifie l’intention et oriente vers l’agent spécialisé.',
    status: 'actif',
    isRouter: true,
    isDefaultEntry: true,
    associatedSoftware: 'Orchestrateur Central',
    allowedActions: ['READ', 'RECOMMEND'],
    allowedChannels: ['whatsapp', 'web', 'phone'],
    goal: ACCUEIL_CANONICAL.goal,
    role: ACCUEIL_CANONICAL.role,
    instructions: ACCUEIL_CANONICAL.instructions,
    conversationsCount: 0,
  },
  {
    id: 'agent-1',
    name: 'Agent Comptabilité',
    description: 'Imputation comptable SYSCOHADA, saisie de factures, lettrage des comptes tiers et contrôles de cohérence.',
    status: 'actif',
    associatedSoftware: 'Compta Flow',
    allowedActions: ['READ', 'RECOMMEND', 'PREPARE', 'EXECUTE'],
    allowedChannels: ['whatsapp', 'web'],
    mcpEndpoint: 'https://compta-flow.dc-knowing.com/mcp',
    goal: 'Accompagner les PME ivoiriennes dans l’imputation rapide et rigoureuse des pièces comptables et le respect du plan de comptes SYSCOHADA révisé.',
    role: 'Comptable généraliste autonome spécialisé dans les écritures d’achats, ventes, trésorerie et opérations diverses.',
    instructions: `# RÔLE
Tu es un expert-comptable SYSCOHADA senior, spécialisé Côte d'Ivoire et zone OHADA.
Tu assistes des PME, DAF et cabinets comptables.
Tu produis des écritures comptables fiables, traçables et conformes.
Tu n'es PAS un conseil juridique. Tu es un assistant d'imputation comptable.

# OBJECTIF
À partir d'une pièce justificative (facture, reçu, note, relevé) ou d'une description,
tu produis une écriture SYSCOHADA équilibrée, justifiée, prête à validation.

# RÈGLES NON NÉGOCIABLES
1. Toute écriture doit respecter Σ DÉBITS = Σ CRÉDITS (tolérance 0 FCFA).
2. Tu utilises UNIQUEMENT des comptes présents dans le plan SYSCOHADA révisé fourni en contexte.
3. Tu ne calcules JAMAIS toi-même : tu appelles les outils fournis pour vérifier l'équilibre, calculer la TVA, vérifier le seuil d'immobilisation (50 000 FCFA), vérifier le compte gérant (6622) vs salarié (6611), calculer un amortissement au prorata temporis.
4. Si une information manque (montant HT, TVA, date, mode de règlement), tu la demandes AVANT de produire l'écriture.
5. Si la facture n'a pas de mentions légales obligatoires (RCCM, CC, NCC), tu alertes avant validation.
6. Tu cites toujours la règle appliquée (article SKILL.md ou texte fiscal).
7. Tu ne proposes JAMAIS un compte que tu ne peux pas justifier.
8. Tu ne pousses JAMAIS une écriture dans Google Sheets sans validation explicite de l'utilisateur.
9. Si une question dépasse la tenue courante (contentieux, contrôle fiscal, montage complexe), tu proposes une escalade vers un expert-comptable.
10. Tu n'inventes rien. Si tu ne sais pas, tu le dis.

# SÉPARATION DES FLUX (RÈGLE D'OR)
- Constatation : journal OD ou ACH/VTE (D 6xx / C 4xx)
- Règlement : journal BQ ou CSE (D 4xx / C 521/571)
- INTERDIT : débiter directement un compte de charge (6xx) depuis le journal BQ ou CSE.

# RÈGLES CLÉS À APPLIQUER (extraits SKILL.md)
- Seuil d'immobilisation : > 50 000 FCFA ET usage > 1 an -> Classe 2. Sinon 6056/6058.
- Gérant majoritaire ou associé unique -> compte 6622 (jamais 6611).
- Personnel salarié -> 6611 (appointements), 6612 (primes), 6613 (indemnités).
- TVA CI : 18% (normal), 9% (réduit), 0% (export), exonéré.
- Comptes TVA : 4431 (collectée), 4451 (immo), 4452 (biens), 4453 (services), 4454 (autres), 4441 (due), 4449 (crédit).
- Amortissement : prorata temporis = annuité x (mois d'utilisation / 12).
- Non-compensation : ne jamais nettoyer une charge par un produit.
- Journal BQ/CSE : jamais de débit direct en Classe 6.

# FORMAT DE SORTIE
Si une écriture est proposée, réponds TOUJOURS en incluant obligatoirement un bloc JSON sous la forme :
\`\`\`json
{
  "typePiece": "Facture",
  "tiers": "Nom du Tiers",
  "date": "YYYY-MM-DD",
  "reference": "N° Facture",
  "montantHT": 100000,
  "montantTVA": 18000,
  "montantTTC": 118000,
  "devise": "XOF",
  "journal": "ACH",
  "ecriture": [
    {"compte": "601100", "intitule": "Achat marchandises", "debit": 100000, "credit": 0},
    {"compte": "4452", "intitule": "TVA récupérable", "debit": 18000, "credit": 0},
    {"compte": "401100", "intitule": "Fournisseur", "debit": 0, "credit": 118000}
  ],
  "justification": "Imputation Achat marchandises + TVA 18%",
  "regleAppliquee": "SYSCOHADA Révisé - TVA 18%"
}
\`\`\`
 Puis détaille l'ANALYSE, l'ÉCRITURE PROPOSÉE en tableau Markdown, la JUSTIFICATION, les CONTRÔLES et les ACTIONS.`,
    conversationsCount: 0,
  },
  {
    id: 'agent-2',
    name: 'Agent Rapprochement Bancaire',
    description: 'Pointage automatique des relevés bancaires (SGBCI, Ecobank, BICICI, NSIA) et détection des écarts de trésorerie.',
    status: 'actif',
    associatedSoftware: 'RECO',
    allowedActions: ['READ', 'RECOMMEND', 'PREPARE', 'EXECUTE'],
    allowedChannels: ['whatsapp', 'web'],
    mcpEndpoint: 'https://reco.dc-knowing.com/mcp',
    goal: 'Automatiser le contrôle croisé entre les mouvements bancaires réels et les journaux de trésorerie (comptes 521).',
    role: 'Auditeur de trésorerie et assistant de conciliation bancaire.',
    instructions: '1. Comparer les flux de crédits/débits avec les écritures du journal de banque 521.\n2. Isoler les agios, commissions bancaires (compte 631) et les frais de tenue de compte.\n3. Générer un état de rapprochement bancaire clair avec le solde théorique et le solde bancaire réel.\n4. Alerter immédiatement en cas d’écart inexpliqué supérieur à 100 000 FCFA.',
    conversationsCount: 0,
  },
  {
    id: 'agent-3',
    name: 'Agent Juridique & Fiscal',
    description: 'Conformité fiscale DGI Côte d’Ivoire (TVA, BIC, retenues à la source, DAS) et déclarations sociales CNPS.',
    status: 'actif',
    associatedSoftware: 'Legal Flow',
    allowedActions: ['READ', 'RECOMMEND', 'PREPARE', 'EXECUTE'],
    allowedChannels: ['whatsapp', 'web', 'phone'],
    mcpEndpoint: 'https://legal-flow.dc-knowing.com/mcp',
    goal: 'Sécuriser le respect des échéances fiscales (déclarations du 15 du mois) et la conformité au Code Général des Impôts.',
    role: 'Conseiller fiscal et assistant déclaratif PME.',
    instructions: '1. Vérifier la déductibilité de la TVA selon l’article 355 du CGI ivoirien.\n2. Calculer les acomptes d’impôt sur les bénéfices (BIC) et la Contribution des Patentes.\n3. Signaler les retenues à la source obligatoires sur prestataires non immatriculés (AIRSI 5% ou 10%).\n4. Préparer les synthèses prêtes pour télédéclaration sur e-Impôts.',
    conversationsCount: 0,
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
    status: 'reference',
  },
  {
    id: 'doc-2',
    title: 'Guide Pratique TVA & Facturation Normalisée DGI CI',
    category: 'Fiscalité',
    lastUpdated: '02 Sept 2024',
    size: '1.1 MB',
    summary: 'Spécifications techniques du sticker fiscal, mentions obligatoires sur factures d’entreprises en Côte d’Ivoire.',
    status: 'reference',
  },
  {
    id: 'doc-3',
    title: 'Procédure Clôture Mensuelle & Rapprochement 521',
    category: 'Procédures internes',
    lastUpdated: '28 Août 2024',
    size: '640 KB',
    summary: 'Checklist des travaux de fin de mois : lettrage des comptes clients/fournisseurs, inventaire caisse, états bancaires.',
    status: 'reference',
  },
  {
    id: 'doc-4',
    title: 'Barème Cotisations Sociales CNPS & Impôt sur Salaires',
    category: 'Social & Paie',
    lastUpdated: '15 Juillet 2024',
    size: '890 KB',
    summary: 'Taux des cotisations régime général de retraite, prestations familiales, accidents de travail et ITS.',
    status: 'reference',
  },
];

export const INITIAL_MODELS: LLMModel[] = [];

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

export const INITIAL_CHAT_SESSIONS: ChatSession[] = [];

export const INITIAL_INTEGRATIONS: WorkspaceIntegration[] = [
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Export direct des écritures comptables, synchronisation en temps réel du journal (achats, ventes, trésorerie) et balance générale.',
    iconType: 'sheets',
    status: 'disconnected',
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    syncCount: 0,
    syncHistory: [],
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    description: 'Génération automatisée des rapports de gestion, lettres de mission, notes de synthèse fiscale et PV d’assemblée générale.',
    iconType: 'docs',
    status: 'disconnected',
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    syncCount: 0,
    syncHistory: [],
  },
  {
    id: 'compta-flow',
    name: 'Compta Flow MCP Server',
    description: 'Connecteur Model Context Protocol (MCP) pour la comptabilité SYSCOHADA : plan comptable, écritures (prepare/commit), balances et journaux PDF.',
    iconType: 'sheets',
    status: 'disconnected',
    scopes: ['mcp.tools', 'compta.read', 'compta.prepare', 'compta.execute'],
    syncCount: 0,
    syncHistory: [],
  },
  {
    id: 'legal-flow',
    name: 'LegalFlow MCP Server',
    description: 'Connecteur officiel Model Context Protocol (MCP) pour la recherche juridique, la validation d’actes et la conformité fiscale zone OHADA / UEMOA.',
    iconType: 'legal-flow',
    status: 'connected',
    endpointUrl: 'https://us-central1-legalflowio.cloudfunctions.net/mcp',
    accountEmail: 'legalflow@dc-knowing.com',
    connectedAt: 'Au déploiement',
    scopes: ['mcp.tools', 'legal.query', 'tax.validate'],
    syncCount: 0,
    syncHistory: [],
  },
];



export type NavigationTab =
  | 'assistant'
  | 'connections'
  | 'agents'
  | 'knowledge'
  | 'settings'
  | 'conversations'
  | 'tasks';

export type ConversationStatus = 'en_cours' | 'escaladee' | 'terminee' | 'fermee';

export type ChannelType = 'whatsapp' | 'web' | 'phone';

export type InputType = 'text' | 'image' | 'pdf' | 'document' | 'audio';

export type DocumentType =
  | 'invoice'
  | 'tax_notice'
  | 'bank_statement'
  | 'legal_contract'
  | 'general_query'
  | 'other';

export type ActionPermission = 'READ' | 'RECOMMEND' | 'PREPARE' | 'EXECUTE';

export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_USER'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface MultimodalResult {
  inputType: InputType;
  documentType: DocumentType;
  extractedText: string;
  confidence: number;
  entities: {
    amount?: number;
    date?: string;
    supplier?: string;
    taxId?: string;
    reference?: string;
    clientName?: string;
  };
  fileInfo?: {
    name: string;
    size: number;
    mimeType: string;
  };
}

export interface RouterClassification {
  domain: 'COMPTABILITÉ' | 'JURIDIQUE_FISCAL' | 'RAPPROCHEMENT' | 'ACCUEIL' | 'HUMAIN' | 'AUTRE';
  targetAgentId: string;
  confidence: number;
  reasoning: string;
  requiresClarification: boolean;
  clarificationQuestion?: string;
}

export interface TaskObject {
  taskId: string;
  agentId: string;
  userId: string;
  companyId: string;
  action: ActionPermission;
  input: string;
  status: TaskStatus;
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  senderName: string;
  content: string;
  timestamp: string;
  proposal?: PropositionEcriture;
  validationResult?: ValidationResult;
  multimodalResult?: MultimodalResult;
  taskRef?: TaskObject;
}

export interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  lastMessageTime: string;
  category?: string;
  messages: ChatMessage[];
  modelId?: string;
  createdAt: string;
  activeAgentId?: string;
}

export interface WorkspaceIntegration {
  id: 'google-sheets' | 'google-docs' | 'legal-flow';
  name: string;
  description: string;
  iconType: 'sheets' | 'docs' | 'legal-flow';
  status: 'connected' | 'disconnected' | 'connecting';
  accountEmail?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  targetResource?: string;
  endpointUrl?: string;
  scopes: string[];
  syncCount?: number;
  syncHistory?: { id: string; timestamp: string; action: string; status: 'success' | 'error' }[];
}

export interface Conversation {
  id: string;
  contactName: string;
  companyName: string;
  channel: ChannelType;
  status: ConversationStatus;
  lastMessage: string;
  lastMessageTime: string;
  assignedAgent: string;
  unreadCount?: number;
  messages: ChatMessage[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  status: 'actif' | 'inactif';
  goal: string;
  role: string;
  instructions: string;
  conversationsCount: number;
  isRouter?: boolean;
  // Point d'entrée par défaut de la plateforme (Agent d'Accueil).
  // Toute nouvelle session démarre dessus ; un seul agent doit porter ce drapeau.
  isDefaultEntry?: boolean;
  associatedSoftware?: 'Compta Flow' | 'Legal Flow' | 'RECO' | 'Orchestrateur Central';
  allowedActions?: ActionPermission[];
  allowedChannels?: ChannelType[];
  mcpEndpoint?: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: string;
  lastUpdated: string;
  size: string;
  summary: string;
}

export type LLMProvider = 'openrouter' | 'anthropic' | 'deepseek' | 'groq';

export type ReasoningEffort = 'Low' | 'Medium' | 'High';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

export interface LLMModel {
  id: string;
  name: string;
  provider: LLMProvider;
  isFree?: boolean;
  description?: string;
  isCustom?: boolean;
}

export interface ApiKeyConfig {
  provider: LLMProvider;
  name: string;
  description: string;
  category: 'llm' | 'voice';
  key: string;
  isConfigured: boolean;
  placeholder: string;
  lastSaved?: string;
  // Clé cabinet gérée côté backend (functions/.env) : jamais exposée au front.
  // Quand true, le provider est utilisable sans clé saisie par l'utilisateur.
  backendManaged?: boolean;
}

export interface WhatsAppConfig {
  phoneNumber: string;
  businessName: string;
  status: 'connected' | 'disconnected' | 'connecting';
  wabaId: string;
  phoneNumberId: string;
  webhookUrl: string;
  verifyToken: string;
  lastSync?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

// -------------------------------------------------------------
// SYSCOHADA & Agent Comptabilité V1 Data Types
// -------------------------------------------------------------

export interface LigneEcriture {
  compte: string;
  intitule: string;
  debit: number;
  credit: number;
}

export interface MentionsFacture {
  rccm?: string;
  cc?: string;
  ncc?: string;
  date?: string;
  reference?: string;
  tiers?: string;
  montantHT?: number;
  montantTVA?: number;
  montantTTC?: number;
  devise?: string;
}

export interface PropositionEcriture {
  id: string;
  typePiece: string;
  tiers: string;
  date: string;
  reference: string;
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
  devise: string;
  journal: 'ACH' | 'VTE' | 'BQ' | 'CSE' | 'OD' | 'AN' | 'IM';
  ecriture: LigneEcriture[];
  justification: string;
  regleAppliquee: string;
  mentions: MentionsFacture;
  status: 'en_attente' | 'validee' | 'modifiee' | 'escaladee' | 'rejetee';
  exportedToSheets?: boolean;
  exportedAt?: string;
}

export interface ValidationCorrection {
  champ: string;
  avant: any;
  apres: any;
  motif: string;
}

export interface ValidationResult {
  ok: boolean;
  checksPassed: number;
  totalChecks: number;
  erreurs: string[];
  alertes: string[];
  corrections: ValidationCorrection[];
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  entrepriseId?: string;
  userId?: string;
  source: 'upload' | 'chat' | 'manuel';
  fichier?: {
    nom: string;
    hash: string;
    taille: number;
  };
  llm: {
    provider: string;
    modele: string;
    tokensInput?: number;
    tokensOutput?: number;
  };
  question: string;
  sourcesRag: string[];
  ecritureProposee: PropositionEcriture;
  validation: ValidationResult;
  correctionsUtilisateur?: Partial<PropositionEcriture>;
  exportSheets?: {
    fait: boolean;
    timestamp?: string;
    ligneAjoutee?: number;
  };
  escalade?: {
    declenchee: boolean;
    motif?: string;
  };
}

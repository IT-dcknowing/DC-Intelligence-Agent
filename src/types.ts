export type NavigationTab = 'assistant' | 'connections' | 'agents' | 'knowledge' | 'settings' | 'conversations';

export type ConversationStatus = 'en_cours' | 'escaladee' | 'terminee' | 'fermee';

export type ChannelType = 'whatsapp' | 'web' | 'phone';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  senderName: string;
  content: string;
  timestamp: string;
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
}

export interface WorkspaceIntegration {
  id: 'google-sheets' | 'google-docs';
  name: string;
  description: string;
  iconType: 'sheets' | 'docs';
  status: 'connected' | 'disconnected' | 'connecting';
  accountEmail?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  targetResource?: string;
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

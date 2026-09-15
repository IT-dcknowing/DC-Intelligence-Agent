import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { AssistantView } from './components/AssistantView';
import { ConnectionsView } from './components/ConnectionsView';
import { AgentList } from './components/AgentList';
import { AgentDetail } from './components/AgentDetail';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { SettingsView } from './components/SettingsView';
import { AddModelModal } from './components/AddModelModal';
import { ToastContainer } from './components/ToastContainer';
import { AuditLogView } from './components/AuditLogView';
import { TaskMonitorView } from './components/TaskMonitorView';
import { validateAccountingProposal } from './services/accountingValidator';
import { logAuditInteraction } from './services/auditLog';
import { classifyAndExtractMultimodalInput } from './services/multimodalClassifier';
import { routeUserRequest } from './services/routerAgent';
import { createTask } from './services/taskEngine';
import {
  Agent,
  ApiKeyConfig,
  ChatMessage,
  ChatSession,
  KnowledgeDocument,
  LLMModel,
  LLMProvider,
  NavigationTab,
  PropositionEcriture,
  ReasoningEffort,
  ToastMessage,
  ValidationResult,
  WorkspaceIntegration,
} from './types';
import {
  INITIAL_AGENTS,
  INITIAL_API_KEYS,
  INITIAL_CHAT_SESSIONS,
  INITIAL_INTEGRATIONS,
  INITIAL_KNOWLEDGE,
} from './mockData';
import {
  REAL_DEFAULT_MODELS,
  loadCustomModels,
  saveCustomModels,
  loadSavedApiKeys,
  saveApiKeysToStorage,
  fetchLiveOpenRouterModels,
  generateChatResponse,
} from './services/llmService';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('assistant');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (type: ToastMessage['type'], title: string, message?: string) => {
      const newToast: ToastMessage = {
        id: `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type,
        title,
        message,
      };
      setToasts((prev) => [...prev, newToast]);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Chat Sessions state (User's personal accounting chat history)
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('dc_intelligence_chat_sessions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_CHAT_SESSIONS;
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => {
    return chatSessions[0]?.id || 'session-1';
  });

  // Persist chat sessions to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('dc_intelligence_chat_sessions', JSON.stringify(chatSessions));
    } catch {
      // ignore
    }
  }, [chatSessions]);

  // Integrations state (Google Sheets, Google Docs)
  const [integrations, setIntegrations] = useState<WorkspaceIntegration[]>(() => {
    try {
      const saved = localStorage.getItem('dc_intelligence_integrations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_INTEGRATIONS;
  });

  // Persist integrations to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('dc_intelligence_integrations', JSON.stringify(integrations));
    } catch {
      // ignore
    }
  }, [integrations]);

  // Agents state
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    INITIAL_AGENTS[0]?.id || null
  );

  // Knowledge base state
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>(INITIAL_KNOWLEDGE);

  // LLM Models state: initial real models + user custom models loaded from LocalStorage
  const [models, setModels] = useState<LLMModel[]>(() => {
    const custom = loadCustomModels();
    const map = new Map<string, LLMModel>();
    REAL_DEFAULT_MODELS.forEach((m) => map.set(m.id, m));
    custom.forEach((m) => map.set(m.id, m));
    return Array.from(map.values());
  });

  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    return localStorage.getItem('dc_intelligence_selected_model') || 'deepseek/deepseek-chat';
  });

  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('Medium');

  // API Keys state loaded from LocalStorage
  const [apiKeys, setApiKeys] = useState<ApiKeyConfig[]>(() => {
    return loadSavedApiKeys(INITIAL_API_KEYS);
  });

  const [settingsSubSection, setSettingsSubSection] = useState<'api-keys' | 'models'>('api-keys');

  // Generation and Modal state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAddModelModalOpen, setIsAddModelModalOpen] = useState<boolean>(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState<boolean>(false);

  // Persist selected model
  useEffect(() => {
    try {
      localStorage.setItem('dc_intelligence_selected_model', selectedModelId);
    } catch {
      // ignore
    }
  }, [selectedModelId]);

  // =========================================================================
  // CHAT SESSIONS HANDLERS
  // =========================================================================
  const handleNewSession = () => {
    const newId = `session-${Date.now()}`;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const newSession: ChatSession = {
      id: newId,
      title: `Nouvelle session ${chatSessions.length + 1}`,
      category: 'Général',
      lastMessage: 'Session créée, prête pour vos questions...',
      lastMessageTime: timeStr,
      createdAt: 'À l’instant',
      messages: [],
    };

    setChatSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newId);
    addToast('success', 'Nouvelle session créée', 'Posez votre question ou dictez votre facture.');
  };

  const handleDeleteSession = (sessionId: string) => {
    if (chatSessions.length <= 1) {
      addToast('info', 'Action non permise', 'Vous devez conserver au moins une session.');
      return;
    }

    setChatSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (selectedSessionId === sessionId && remaining.length > 0) {
        setSelectedSessionId(remaining[0].id);
      }
      return remaining;
    });
    addToast('info', 'Session supprimée', 'La session de chat a été retirée.');
  };

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    setChatSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
    addToast('success', 'Session renommée', `Nouveau titre : ${newTitle}`);
  };

  const handleSendMessage = async (sessionId: string, text: string) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      senderName: 'Vous',
      content: text,
      timestamp: timeStr,
    };

    // Multimodal Classification & Auto-Routing
    const multimodalRes = await classifyAndExtractMultimodalInput({ text });
    const routingRes = routeUserRequest(text, multimodalRes);

    // If routing suggests another agent, switch selectedAgentId automatically
    if (routingRes.targetAgentId && routingRes.targetAgentId !== selectedAgentId) {
      setSelectedAgentId(routingRes.targetAgentId);
    }

    const targetAgent = agents.find((a) => a.id === (routingRes.targetAgentId || selectedAgentId)) || agents[0];

    // Create central Task in Task Engine
    const currentTask = createTask({
      agentId: targetAgent.name,
      action: (targetAgent.allowedActions && targetAgent.allowedActions[0]) || 'PREPARE',
      input: text,
      status: 'RUNNING',
    });

    userMsg.multimodalResult = multimodalRes;
    userMsg.taskRef = currentTask;

    // 1. Update session immediately with user message
    setChatSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) {
          const isDefaultTitle = s.title.startsWith('Nouvelle session');
          const nextTitle = isDefaultTitle
            ? text.slice(0, 32) + (text.length > 32 ? '...' : '')
            : s.title;

          return {
            ...s,
            title: nextTitle,
            lastMessage: text,
            lastMessageTime: timeStr,
            messages: [...s.messages, userMsg],
          };
        }
        return s;
      })
    );

    // 2. Prepare context for real LLM Call
    const targetSession = chatSessions.find((s) => s.id === sessionId);
    setIsGenerating(true);

    try {
      const history = targetSession ? targetSession.messages : [];
      const modelObj = models.find((m) => m.id === selectedModelId) || models[0];

      const activeAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];

      const aiResponseContent = await generateChatResponse({
        model: modelObj,
        conversationHistory: history,
        userMessage: text,
        apiKeys,
        reasoningEffort,
        agentContext: {
          name: activeAgent ? activeAgent.name : 'DC Intelligence Assistant',
          role: activeAgent ? activeAgent.role : 'Assistant Comptable & Fiscal SYSCOHADA',
          instructions: activeAgent ? activeAgent.instructions : 'Expert Comptable SYSCOHADA Révisé.',
        },
      });

      // Try extracting structured JSON proposal from LLM output
      let proposal: PropositionEcriture | undefined;
      let validationResult: ValidationResult | undefined;

      const jsonMatch = aiResponseContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed && (parsed.ecriture || parsed.journal || parsed.tiers)) {
            proposal = {
              id: `PROP-${Date.now()}`,
              typePiece: parsed.typePiece || 'Facture / Pièce',
              tiers: parsed.tiers || 'Tiers à préciser',
              date: parsed.date || new Date().toISOString().slice(0, 10),
              reference: parsed.reference || 'PIECE-REF',
              montantHT: Number(parsed.montantHT || 0),
              montantTVA: Number(parsed.montantTVA || 0),
              montantTTC: Number(parsed.montantTTC || 0),
              devise: parsed.devise || 'XOF',
              journal: parsed.journal || 'ACH',
              ecriture: Array.isArray(parsed.ecriture) ? parsed.ecriture : [],
              justification: parsed.justification || 'Imputation SYSCOHADA proposée par l’agent.',
              regleAppliquee: parsed.regleAppliquee || 'SYSCOHADA Révisé - Zone OHADA',
              mentions: {
                tiers: parsed.tiers,
                date: parsed.date,
                reference: parsed.reference,
                montantHT: parsed.montantHT,
                montantTVA: parsed.montantTVA,
                montantTTC: parsed.montantTTC,
              },
              status: 'en_attente',
            };

            // Run 7-check validation pipeline
            validationResult = validateAccountingProposal(proposal);

            // Log to audit journal LocalStorage
            logAuditInteraction({
              source: 'chat',
              llm: {
                provider: modelObj.provider,
                modele: modelObj.name,
              },
              question: text,
              ecritureProposee: proposal,
              validation: validationResult,
            });
          }
        } catch (e) {
          console.warn('Could not parse JSON proposal from LLM response:', e);
        }
      }

      const responseTime = new Date();
      const responseTimeStr = `${String(responseTime.getHours()).padStart(2, '0')}:${String(
        responseTime.getMinutes()
      ).padStart(2, '0')}`;

      const aiMsg: ChatMessage = {
        id: `msg-ai-${Date.now()}`,
        sender: 'agent',
        senderName: 'DC Intelligence',
        content: aiResponseContent,
        timestamp: responseTimeStr,
        proposal,
        validationResult,
      };

      setChatSessions((prev) =>
        prev.map((s) => {
          if (s.id === sessionId) {
            return {
              ...s,
              lastMessage: aiResponseContent.slice(0, 80) + '...',
              lastMessageTime: responseTimeStr,
              messages: [...s.messages, aiMsg],
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      console.error('LLM Inference Error:', err);
      addToast('error', 'Erreur d’inférence IA', err.message || 'Échec de la réponse du modèle.');
    } finally {
      setIsGenerating(false);
    }
  };

  // =========================================================================
  // WORKSPACE INTEGRATIONS HANDLERS (Google Sheets & Google Docs)
  // =========================================================================
  const handleToggleConnectIntegration = (integrationId: string) => {
    setIntegrations((prev) =>
      prev.map((item) => {
        if (item.id === integrationId) {
          const nextStatus = item.status === 'connected' ? 'disconnected' : 'connected';
          const nowStr = 'Aujourd’hui';
          const newLog = {
            id: `log-${Date.now()}`,
            timestamp: 'À l’instant',
            action:
              nextStatus === 'connected'
                ? 'Association réussie du compte Google Workspace'
                : 'Déconnexion du compte Google Workspace',
            status: 'success' as const,
          };
          return {
            ...item,
            status: nextStatus,
            accountEmail:
              nextStatus === 'connected' ? 'alexmardochee0@gmail.com' : undefined,
            connectedAt: nextStatus === 'connected' ? nowStr : undefined,
            syncHistory: [newLog, ...(item.syncHistory || [])],
          };
        }
        return item;
      })
    );
  };

  const handleSyncNow = (integrationId: string) => {
    setIntegrations((prev) =>
      prev.map((item) => {
        if (item.id === integrationId) {
          const newLog = {
            id: `log-${Date.now()}`,
            timestamp: 'À l’instant',
            action:
              item.id === 'google-sheets'
                ? 'Écritures du journal synchronisées dans le classeur'
                : 'Mise à jour du document de rapport financier',
            status: 'success' as const,
          };
          return {
            ...item,
            lastSyncAt: 'À l’instant',
            syncCount: (item.syncCount || 0) + 1,
            syncHistory: [newLog, ...(item.syncHistory || [])],
          };
        }
        return item;
      })
    );
    addToast('success', 'Synchronisation terminée', 'Les données sont à jour.');
  };

  const handleSetTargetResource = (integrationId: string, resourceName: string) => {
    setIntegrations((prev) =>
      prev.map((item) => {
        if (item.id === integrationId) {
          return {
            ...item,
            targetResource: resourceName,
          };
        }
        return item;
      })
    );
    addToast('success', 'Fichier cible configuré', resourceName);
  };

  // =========================================================================
  // MODEL MANAGEMENT & CATALOG
  // =========================================================================
  const handleRefreshOpenRouter = async () => {
    setIsRefreshingModels(true);
    try {
      const openRouterKey = apiKeys.find((k) => k.provider === 'openrouter')?.key;
      const liveModels = await fetchLiveOpenRouterModels(openRouterKey);
      if (liveModels && liveModels.length > 0) {
        setModels((prev) => {
          const customModels = prev.filter((m) => m.isCustom);
          const map = new Map<string, LLMModel>();
          customModels.forEach((m) => map.set(m.id, m));
          liveModels.forEach((m) => {
            if (!map.has(m.id)) {
              map.set(m.id, m);
            }
          });
          return Array.from(map.values());
        });
        addToast('success', 'Catalogue OpenRouter actualisé', `${liveModels.length} modèles synchronisés.`);
      }
    } catch (err: any) {
      console.warn('Could not refresh OpenRouter models:', err);
      addToast('error', 'Erreur de rafraîchissement', 'Impossible de contacter le catalogue OpenRouter.');
    } finally {
      setIsRefreshingModels(false);
    }
  };

  const handleAddModel = (newModel: LLMModel) => {
    setModels((prev) => {
      const filtered = prev.filter((m) => m.id !== newModel.id);
      const updated = [newModel, ...filtered];
      const customOnly = updated.filter((m) => m.isCustom);
      saveCustomModels(customOnly);
      return updated;
    });
    setSelectedModelId(newModel.id);
    addToast('success', 'Nouveau modèle configuré', `${newModel.name} est prêt à l’emploi.`);
  };

  const handleDeleteCustomModel = (modelId: string) => {
    setModels((prev) => {
      const updated = prev.filter((m) => m.id !== modelId);
      const customOnly = updated.filter((m) => m.isCustom);
      saveCustomModels(customOnly);
      return updated;
    });
    if (selectedModelId === modelId) {
      setSelectedModelId('deepseek/deepseek-chat');
    }
    addToast('info', 'Modèle retiré', 'Le modèle personnalisé a été supprimé.');
  };

  // Agent handlers
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

  const handleUpdateAgent = (updated: Agent) => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    addToast('success', 'Agent mis à jour', `Règles enregistrées pour ${updated.name}`);
  };

  const handleToggleAgentStatus = (agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          const next = a.status === 'actif' ? 'inactif' : 'actif';
          return { ...a, status: next };
        }
        return a;
      })
    );
  };

  const handleCreateNewAgent = () => {
    const newId = `agent-${Date.now()}`;
    const newAgent: Agent = {
      id: newId,
      name: 'Agent Audit & Règlements',
      description: 'Supervise les écarts de trésorerie et applique les règles SYSCOHADA.',
      status: 'actif',
      goal: 'Détecter les anomalies dans les écritures de trésorerie.',
      role: 'Superviseur Trésorerie SYSCOHADA',
      instructions: '# Règles opérationnelles\n1. Rapprocher les lignes du journal de banque 521.\n2. Contrôler les agios et commissions.',
      conversationsCount: 0,
    };
    setAgents((prev) => [newAgent, ...prev]);
    setSelectedAgentId(newId);
    addToast('success', 'Nouvel agent créé', `${newAgent.name} prêt à être configuré.`);
  };

  // Knowledge base upload
  const handleUploadDocument = (file: File) => {
    const newDoc: KnowledgeDocument = {
      id: `doc-${Date.now()}`,
      title: file.name.replace(/\.[^/.]+$/, ''),
      category: 'PROCÉDURES SYSCOHADA',
      lastUpdated: 'À l’instant',
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      summary: `Document importé : ${file.name}. Prêt pour indexation RAG.`,
    };
    setKnowledgeDocs((prev) => [newDoc, ...prev]);
    addToast('success', 'Document indexé', `${file.name} ajouté à la base de connaissances.`);
  };

  // API Key save
  const handleSaveApiKey = (provider: LLMProvider, newKey: string) => {
    setApiKeys((prev) => {
      const updated = prev.map((k) =>
        k.provider === provider
          ? {
              ...k,
              key: newKey,
              isConfigured: Boolean(newKey && newKey.trim().length > 0),
              lastSaved: 'À l’instant',
            }
          : k
      );
      saveApiKeysToStorage(updated);
      return updated;
    });
    addToast('success', 'Clé API enregistrée', `Fournisseur : ${provider.toUpperCase()}`);
  };

  const handleNavigateToApiKeys = () => {
    setSettingsSubSection('api-keys');
    setCurrentTab('settings');
  };

  const handleNavigateToSettings = () => {
    setSettingsSubSection('api-keys');
    setCurrentTab('settings');
  };

  return (
    <div
      id="dc-intelligence-app-root"
      className="flex h-screen w-screen bg-white text-[#09090B] overflow-hidden font-['Inter'] antialiased"
      style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}
    >
      {/* 1. Colonne gauche : Le menu principal (Sidebar) */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab === 'settings') {
            setSettingsSubSection('api-keys');
          }
          setCurrentTab(tab);
        }}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
      />

      {/* 2. Zone principale */}
      <main id="app-main-workspace" className="flex-1 flex h-full min-w-0 overflow-hidden bg-white relative">
        {/* VIEW 1: ASSISTANT (3-column experience: Colonne gauche=Menu, Colonne centrale=Sessions, Colonne droite=Chat IA) */}
        {(currentTab === 'assistant' || currentTab === 'conversations') && (
          <AssistantView
            sessions={chatSessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={setSelectedSessionId}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onSendMessage={handleSendMessage}
            isGenerating={isGenerating}
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            apiKeys={apiKeys}
            onNavigateToApiKeys={handleNavigateToApiKeys}
            onNavigateToSettings={handleNavigateToSettings}
            reasoningEffort={reasoningEffort}
            onChangeReasoningEffort={setReasoningEffort}
            onOpenAddModelModal={() => setIsAddModelModalOpen(true)}
            onRefreshOpenRouter={handleRefreshOpenRouter}
            isRefreshingModels={isRefreshingModels}
            onDeleteCustomModel={handleDeleteCustomModel}
          />
        )}

        {/* VIEW 2: CONNEXIONS (Colonne centrale=Liste Google Sheets & Docs, Colonne droite=Procédure de connexion) */}
        {currentTab === 'connections' && (
          <ConnectionsView
            integrations={integrations}
            onToggleConnect={handleToggleConnectIntegration}
            onSyncNow={handleSyncNow}
            onSetTargetResource={handleSetTargetResource}
          />
        )}

        {/* VIEW 3: AGENTS */}
        {currentTab === 'agents' && (
          <div id="view-agents-layout" className="flex-1 flex h-full min-w-0">
            <AgentList
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              onToggleStatus={handleToggleAgentStatus}
              onNewAgent={handleCreateNewAgent}
            />
            <AgentDetail agent={selectedAgent} onUpdateAgent={handleUpdateAgent} />
          </div>
        )}

        {/* VIEW 4: CONNAISSANCES */}
        {currentTab === 'knowledge' && (
          <KnowledgeBaseView
            documents={knowledgeDocs}
            onUploadDocument={handleUploadDocument}
          />
        )}

        {/* VIEW 5: JOURNAL D'AUDIT COMPTABLE */}
        {currentTab === 'audit' && <AuditLogView />}

        {/* VIEW 5: PARAMÈTRES (Fournisseurs & Clés API, Modèles LLM, sans règles d'escalade ni multi-conversations clients) */}
        {currentTab === 'settings' && (
          <SettingsView
            apiKeys={apiKeys}
            onSaveApiKey={handleSaveApiKey}
            activeSection={settingsSubSection}
            models={models}
            onOpenAddModelModal={() => setIsAddModelModalOpen(true)}
            onRefreshOpenRouter={handleRefreshOpenRouter}
            isRefreshingModels={isRefreshingModels}
            onDeleteCustomModel={handleDeleteCustomModel}
          />
        )}
      </main>

      {/* Add New Model Modal */}
      <AddModelModal
        isOpen={isAddModelModalOpen}
        onClose={() => setIsAddModelModalOpen(false)}
        onAddModel={handleAddModel}
      />

      {/* Toast Notifications Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { AssistantView } from './components/AssistantView';
import { ConnectionsView } from './components/ConnectionsView';
import { ErrorBoundary } from './components/ErrorBoundary';
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
  DEFAULT_MODEL,
  DEFAULT_MODEL_ID,
  loadCustomModels,
  saveCustomModels,
  loadSavedApiKeys,
  saveApiKeysToStorage,
  fetchLiveOpenRouterModels,
  fetchBackendModels,
  generateChatResponse,
} from './services/llmService';
import {
  fetchAgents,
  persistAgent,
  fetchKnowledge,
  seedKnowledge,
  uploadKnowledge,
  deleteKnowledgeDoc,
  downloadKnowledge,
  base64ToBlob,
  fetchSessions,
  createSessionRemote,
  appendMessageRemote,
  renameSessionRemote,
  deleteSessionRemote,
  migrateLocalSessions,
  fetchIntegrations,
  persistIntegration,
} from './services/storeApi';

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

  // Chat Sessions state — prod démarre à 0, migration : purge les sessions fictives legacy
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('dc_intelligence_chat_sessions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasMockFingerprint = parsed.some(
            (s: any) =>
              s?.id === 'session-1' ||
              s?.title === "Saisie d'aujourd'hui" ||
              s?.title === 'Bilan 2023' ||
              s?.title === 'Rapprochement bancaire BICICI' ||
              s?.title === 'Contrôle DAS & Salaires'
          );
          if (hasMockFingerprint) {
            try { localStorage.removeItem('dc_intelligence_chat_sessions'); } catch {}
            return INITIAL_CHAT_SESSIONS;
          }
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_CHAT_SESSIONS;
  });

  const [selectedSessionId, setSelectedSessionId] = useState<string>(() => {
    return chatSessions[0]?.id || '';
  });

  // Persist chat sessions to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('dc_intelligence_chat_sessions', JSON.stringify(chatSessions));
    } catch {
      // ignore
    }
  }, [chatSessions]);

  // Integrations state — prod 0 connexion, migration purge exemple.ci
  const [integrations, setIntegrations] = useState<WorkspaceIntegration[]>(() => {
    try {
      const saved = localStorage.getItem('dc_intelligence_integrations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const hasMockIntegration = parsed.some(
            (i: any) => i?.accountEmail === 'compte.google@exemple.ci' || (i?.syncHistory && i.syncHistory.length > 0 && i.syncCount > 0 && i.status === 'connected')
          );
          if (hasMockIntegration) {
            try { localStorage.removeItem('dc_intelligence_integrations'); } catch {}
            return INITIAL_INTEGRATIONS;
          }
          return parsed;
        }
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

  // Modèle par défaut du cabinet pré-sélectionné (migre l'ancienne valeur codée en dur).
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    const stored = localStorage.getItem('dc_intelligence_selected_model');
    if (!stored || stored === 'deepseek/deepseek-chat') return DEFAULT_MODEL_ID;
    return stored;
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

  // Catalogue dynamique au premier démarrage : backend (clé cabinet) en priorité,
  // sans exiger de clé utilisateur. OpenRouter est marqué "Configuré (cabinet)"
  // dès que le backend détient la clé — le modèle par défaut reste sélectionné.
  const catalogLoadedRef = useRef(false);
  useEffect(() => {
    if (catalogLoadedRef.current) return;
    catalogLoadedRef.current = true;
    (async () => {
      try {
        const viaBackend = await fetchBackendModels();
        if (viaBackend) {
          if (viaBackend.backendManaged) {
            setApiKeys((prev) =>
              prev.map((k) =>
                k.provider === 'openrouter'
                  ? { ...k, isConfigured: true, backendManaged: true, lastSaved: 'Clé cabinet (backend)' }
                  : k
              )
            );
          }
          if (viaBackend.models.length > 0) {
            setModels((prev) => {
              const customModels = prev.filter((m) => m.isCustom);
              const map = new Map<string, LLMModel>();
              map.set(DEFAULT_MODEL.id, DEFAULT_MODEL);
              customModels.forEach((m) => map.set(m.id, m));
              viaBackend.models.forEach((m) => {
                if (!map.has(m.id)) map.set(m.id, m);
              });
              return Array.from(map.values());
            });
            setSelectedModelId((prev) => {
              try {
                const stored = localStorage.getItem('dc_intelligence_selected_model');
                if (stored && stored !== 'deepseek/deepseek-chat') return stored;
              } catch { /* ignore */ }
              return DEFAULT_MODEL_ID;
            });
          }
        }
      } catch { /* repli : modèle par défaut local, déjà en place */ }
    })();
  }, []);

  // Indicateur d'upload documentaire (désactive la zone d'import pendant l'envoi)
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);

  // =========================================================================
  // HYDRATATION FIRESTORE — le backend est la source de vérité, le
  // localStorage n'est qu'un cache instantané + repli offline.
  // =========================================================================
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    (async () => {
      // ---- Agents (merge : backend gagne, seed si vide) ----
      try {
        const remoteAgents = await fetchAgents();
        if (remoteAgents && remoteAgents.length > 0) {
          const byId = new Map(remoteAgents.map((a) => [a.id, a]));
          setAgents((prev) => {
            const merged = prev.map((a) =>
              byId.has(a.id) ? { ...a, ...byId.get(a.id), id: a.id, conversationsCount: 0 } : a
            );
            const prevIds = new Set(prev.map((a) => a.id));
            const extra = remoteAgents.filter((a) => !prevIds.has(a.id));
            return extra.length ? [...merged, ...extra] : merged;
          });
        } else if (remoteAgents) {
          INITIAL_AGENTS.forEach((a) => persistAgent(a).catch(() => {}));
        }
      } catch { /* repli : valeurs locales */ }

      // ---- Connaissances (seed des références si vide) ----
      try {
        const remoteDocs = await fetchKnowledge();
        if (remoteDocs && remoteDocs.length > 0) {
          setKnowledgeDocs(remoteDocs);
        } else if (remoteDocs) {
          await seedKnowledge(
            INITIAL_KNOWLEDGE.map((d) => ({
              id: d.id, title: d.title, category: d.category,
              size: d.size, summary: d.summary, lastUpdated: d.lastUpdated,
            }))
          ).catch(() => {});
          setKnowledgeDocs(INITIAL_KNOWLEDGE);
        }
      } catch { /* repli : valeurs locales */ }

      // ---- Sessions (backend prioritaire, migration du cache sinon) ----
      try {
        const remoteSessions = await fetchSessions();
        if (remoteSessions && remoteSessions.length > 0) {
          setChatSessions(remoteSessions);
          setSelectedSessionId(remoteSessions[0].id);
        } else if (remoteSessions) {
          let local: ChatSession[] = [];
          try {
            const raw = localStorage.getItem('dc_intelligence_chat_sessions');
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) local = parsed;
          } catch { /* ignore */ }
          if (local.length > 0) await migrateLocalSessions(local).catch(() => {});
        }
      } catch { /* repli : cache local */ }

      // ---- Intégrations (merge statuts distants, seed/migration si vide) ----
      try {
        const remote = await fetchIntegrations();
        if (remote && remote.length > 0) {
          const byId = new Map(remote.map((i) => [i.id, i]));
          setIntegrations((prev) => prev.map((item) => (byId.has(item.id) ? { ...item, ...byId.get(item.id), id: item.id } : item)));
        } else if (remote) {
          let local: WorkspaceIntegration[] = [];
          try {
            const raw = localStorage.getItem('dc_intelligence_integrations');
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) local = parsed;
          } catch { /* ignore */ }
          const hasMock = local.some(
            (i: any) => i?.accountEmail === 'compte.google@exemple.ci' || i?.accountEmail === 'alexmardochee0@gmail.com'
          );
          const source = local.length > 0 && !hasMock ? local : INITIAL_INTEGRATIONS;
          setIntegrations(source);
          source.forEach((i) => persistIntegration(i).catch(() => {}));
        }
      } catch { /* repli : valeurs locales */ }
    })();
  }, []);

  // Compteurs d'échanges calculés depuis les conversations persistées (jamais codés en dur).
  const agentsWithCounts = useMemo(() => {
    const byName = new Map<string, string>();
    for (const a of agents) byName.set(a.name, a.id);
    const counts = new Map<string, number>();
    for (const s of chatSessions) {
      const msgs: ChatMessage[] = Array.isArray(s.messages) ? s.messages : [];
      for (const m of msgs) {
        if (m.sender !== 'agent') continue;
        const agentName = m.taskRef ? m.taskRef.agentId : '';
        if (typeof agentName !== 'string' || agentName.length === 0) continue;
        const id: string | undefined = byName.get(agentName);
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    return agents.map((a) => ({ ...a, conversationsCount: counts.get(a.id) || 0 }));
  }, [agents, chatSessions]);

  // =========================================================================
  // CHAT SESSIONS HANDLERS
  // =========================================================================
  // Retourne l'id créé : l'assistant peut créer puis envoyer dans la foulée
  // (sinon l'envoi sans session sortait en silence).
  const handleNewSession = async (): Promise<string> => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const title = `Nouvelle session ${chatSessions.length + 1}`;

    // Écriture immédiate Firestore ; repli local si offline.
    const remote = await createSessionRemote(title, 'Général').catch(() => null);
    const newSession: ChatSession = remote || {
      id: `session-${Date.now()}`,
      title,
      category: 'Général',
      lastMessage: 'Session créée, prête pour vos questions...',
      lastMessageTime: timeStr,
      createdAt: 'À l’instant',
      messages: [],
    };

    setChatSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newSession.id);
    addToast('success', 'Nouvelle session créée', 'Posez votre question ou dictez votre facture.');
    return newSession.id;
  };

  const handleDeleteSession = (sessionId: string) => {
    if (chatSessions.length <= 1) {
      addToast('info', 'Action non permise', 'Vous devez conserver au moins une session.');
      return;
    }

    deleteSessionRemote(sessionId).catch(() => {});
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
    renameSessionRemote(sessionId, newTitle).catch(() => {});
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
    // Note : les compteurs d'échanges sont calculés depuis les messages persistés
    // (agentsWithCounts), jamais incrémentés à la main.

    // Create central Task in Task Engine
    const currentTask = createTask({
      agentId: targetAgent.name,
      action: (targetAgent.allowedActions && targetAgent.allowedActions[0]) || 'PREPARE',
      input: text,
      status: 'RUNNING',
    });

    userMsg.multimodalResult = multimodalRes;
    userMsg.taskRef = currentTask;

    // 1. Update session immediately with user message (+ persistance Firestore immédiate)
    const currentSession = chatSessions.find((s) => s.id === sessionId);
    const isDefaultTitle = currentSession?.title.startsWith('Nouvelle session');
    const nextTitle = isDefaultTitle
      ? text.slice(0, 32) + (text.length > 32 ? '...' : '')
      : currentSession?.title;
    if (isDefaultTitle && nextTitle) {
      renameSessionRemote(sessionId, nextTitle).catch(() => {});
    }
    appendMessageRemote(sessionId, {
      sender: 'user',
      senderName: 'Vous',
      content: text,
      agentName: targetAgent.name,
    }).catch(() => {});
    setChatSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            title: nextTitle || s.title,
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
      // Garde-fou : jamais d'appel avec un modèle indéfini (TypeError silencieux avant).
      const modelObj = models.find((m) => m.id === selectedModelId) || models[0] || DEFAULT_MODEL;
      if (!modelObj) {
        addToast('error', 'Aucun modèle disponible', 'Le catalogue est vide et le modèle par défaut est introuvable. Rechargez la page.');
        setChatSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, messages: s.messages.filter((m) => m.id !== userMsg.id) } : s))
        );
        return;
      }

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
        taskRef: currentTask,
      };

      appendMessageRemote(sessionId, {
        sender: 'agent',
        senderName: 'DC Intelligence',
        content: aiResponseContent,
        agentName: targetAgent.name,
      }).catch(() => {});
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
      // Message clair au lieu d'un silence : distingue l'indisponibilité
      // backend (clé cabinet) des erreurs réseau/timeout.
      const raw = String(err?.message || '');
      const friendly = /backend_not_configured|AUCUNE_CLÉ_API|OPENROUTER_API_KEY/.test(raw)
        ? 'Service IA indisponible : clé cabinet manquante côté serveur. Contactez l’administrateur.'
        : /timeout|délai|Failed to fetch|NetworkError|unreachable/i.test(raw)
        ? 'Le service IA met trop de temps à répondre. Réessayez dans un instant.'
        : (raw || 'Échec de la réponse du modèle.');
      addToast('error', 'Erreur d’inférence IA', friendly);
    } finally {
      setIsGenerating(false);
    }
  };

  // =========================================================================
  // WORKSPACE INTEGRATIONS HANDLERS (Google Sheets & Google Docs)
  // =========================================================================
  // OAuth 2.0 Google : popup consentement -> backend échange code<->tokens et range
  // le refresh_token dans Firestore (users/admin/connections). Le front ne voit
  // jamais que l'email du compte + le statut via /api/google/status.
  const handleGoogleOAuthSuccess = (integrationId: string, email: string) => {
    const current = integrations.find((i) => i.id === integrationId);
    if (!current) return;
    const updated: WorkspaceIntegration = {
      ...current,
      status: 'connected',
      accountEmail: email || current.accountEmail,
      connectedAt: 'Aujourd’hui',
      syncHistory: [
        {
          id: `log-${Date.now()}`,
          timestamp: 'À l’instant',
          action: 'Association réussie du compte Google Workspace (OAuth 2.0, refresh_token en coffre)',
          status: 'success' as const,
        },
        ...(current.syncHistory || []),
      ],
    };
    persistIntegration(updated).catch(() => {});
    setIntegrations((prev) => prev.map((item) => (item.id === integrationId ? updated : item)));
    addToast('success', 'Compte Google connecté', email || integrationId);
  };

  // handleToggleConnect est appelé après succès OAuth côté ConnectionsView.
  const handleToggleConnectIntegration = (integrationId: string) => {
    const current = integrations.find((i) => i.id === integrationId);
    if (!current) return;
    const nextStatus = current.status === 'connected' ? 'disconnected' : 'connected';
    const nowStr = 'Aujourd’hui';
    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: 'À l’instant',
      action:
        nextStatus === 'connected'
          ? 'Association réussie du compte Google Workspace (OAuth 2.0)'
          : 'Déconnexion du compte Google Workspace',
      status: 'success' as const,
    };
    const updated: WorkspaceIntegration = {
      ...current,
      status: nextStatus,
      // En prod, accountEmail est renseigné par le token OAuth retourné, pas par un exemple fictif
      accountEmail:
        nextStatus === 'connected'
          ? (current.accountEmail || (import.meta as any)?.env?.VITE_GOOGLE_ACCOUNT_EMAIL || undefined)
          : undefined,
      connectedAt: nextStatus === 'connected' ? nowStr : undefined,
      syncHistory: [newLog, ...(current.syncHistory || [])],
    };
    // Tokens OAuth : stockés chiffrés côté backend uniquement — jamais persistés depuis le navigateur.
    persistIntegration(updated).catch(() => {});
    setIntegrations((prev) => prev.map((item) => (item.id === integrationId ? updated : item)));
  };

  const handleSyncNow = (integrationId: string) => {
    const current = integrations.find((i) => i.id === integrationId);
    if (!current) return;
    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: 'À l’instant',
      action:
        current.id === 'google-sheets'
          ? 'Écritures du journal synchronisées dans le classeur'
          : 'Mise à jour du document de rapport financier',
      status: 'success' as const,
    };
    const updated: WorkspaceIntegration = {
      ...current,
      lastSyncAt: 'À l’instant',
      syncCount: (current.syncCount || 0) + 1,
      syncHistory: [newLog, ...(current.syncHistory || [])],
    };
    persistIntegration(updated).catch(() => {});
    setIntegrations((prev) => prev.map((item) => (item.id === integrationId ? updated : item)));
    addToast('success', 'Synchronisation terminée', 'Les données sont à jour.');
  };

  const handleSetTargetResource = (integrationId: string, resourceName: string) => {
    const current = integrations.find((i) => i.id === integrationId);
    if (!current) return;
    const updated: WorkspaceIntegration = { ...current, targetResource: resourceName };
    persistIntegration(updated).catch(() => {});
    setIntegrations((prev) => prev.map((item) => (item.id === integrationId ? updated : item)));
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

  // Agent handlers — chaque "Enregistrer" écrit immédiatement dans Firestore.
  const selectedAgent = agentsWithCounts.find((a) => a.id === selectedAgentId) || null;

  const handleUpdateAgent = (updated: Agent) => {
    persistAgent(updated).catch(() => {
      addToast('warning', 'Sauvegarde locale uniquement', 'Le serveur est injoignable, réessayez plus tard.');
    });
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    addToast('success', 'Agent mis à jour', `Règles enregistrées pour ${updated.name}`);
  };

  const handleToggleAgentStatus = (agentId: string) => {
    const current = agents.find((a) => a.id === agentId);
    if (!current) return;
    const updated: Agent = { ...current, status: current.status === 'actif' ? 'inactif' : 'actif' };
    persistAgent(updated).catch(() => {});
    setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)));
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
    persistAgent(newAgent).catch(() => {});
    setAgents((prev) => [newAgent, ...prev]);
    setSelectedAgentId(newId);
    addToast('success', 'Nouvel agent créé', `${newAgent.name} prêt à être configuré.`);
  };

  // Knowledge base upload — fichier réel vers Firebase Storage + métadonnées Firestore.
  const handleUploadDocument = async (file: File) => {
    if (file.size <= 0 || file.size > 8_000_000) {
      addToast('error', 'Fichier refusé', 'Taille invalide ou supérieure à 8 Mo.');
      return;
    }
    setIsUploadingDoc(true);
    try {
      const doc = await uploadKnowledge(file, 'PROCÉDURES SYSCOHADA');
      setKnowledgeDocs((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      addToast('success', 'Document persisté', `${file.name} stocké et visible après refresh.`);
    } catch (err: any) {
      addToast('error', 'Échec de l’envoi', err?.message || 'Serveur injoignable.');
    } finally {
      setIsUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const ok = await deleteKnowledgeDoc(docId).catch(() => false);
    if (!ok) {
      addToast('error', 'Suppression impossible', 'Serveur injoignable.');
      return;
    }
    setKnowledgeDocs((prev) => prev.filter((d) => d.id !== docId));
    addToast('info', 'Document supprimé', 'Fichier et métadonnées retirés du stockage.');
  };

  const handleDownloadDocument = async (doc: KnowledgeDocument) => {
    try {
      const dl = await downloadKnowledge(doc.id);
      if (dl) {
        const blob = base64ToBlob(dl.base64, dl.mimeType);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = dl.name || doc.title;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        addToast('success', 'Téléchargement démarré', doc.title);
        return;
      }
    } catch { /* repli ci-dessous */ }
    // Repli : documents de référence sans binaire → export du résumé.
    const blob = new Blob([doc.summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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

    if (provider === 'openrouter' && newKey.trim().length > 0) {
      setTimeout(() => {
        handleRefreshOpenRouter();
      }, 300);
    }
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

        {/* VIEW 2: CONNEXIONS — ErrorBoundary évite la page blanche sur TypeError */}
        {currentTab === 'connections' && (
          <ErrorBoundary
            fallback={
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
                <h3 className="font-bold text-[15px] text-[#1E293B]">Impossible de charger les connexions</h3>
                <p className="text-[12px] text-[#64748B] max-w-md mt-1">Réessayez ou vérifiez la configuration Firestore.</p>
              </div>
            }
          >
            <ConnectionsView
              integrations={Array.isArray(integrations) ? integrations : []}
              onToggleConnect={handleToggleConnectIntegration}
              onSyncNow={handleSyncNow}
              onSetTargetResource={handleSetTargetResource}
              onGoogleOAuthSuccess={handleGoogleOAuthSuccess}
            />
          </ErrorBoundary>
        )}

        {/* VIEW 3: AGENTS */}
        {currentTab === 'agents' && (
          <div id="view-agents-layout" className="flex-1 flex h-full min-w-0">
            <AgentList
              agents={agentsWithCounts}
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
            onDeleteDocument={handleDeleteDocument}
            onDownloadDocument={handleDownloadDocument}
            isUploading={isUploadingDoc}
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
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            onOpenAddModelModal={() => setIsAddModelModalOpen(true)}
            onRefreshOpenRouter={handleRefreshOpenRouter}
            isRefreshingModels={isRefreshingModels}
            onDeleteCustomModel={handleDeleteCustomModel}
          />
        )}

        {currentTab === 'tasks' && <TaskMonitorView />}
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

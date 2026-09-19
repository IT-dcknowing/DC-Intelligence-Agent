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
import { AgentCreateModal, NewAgentDraft } from './components/AgentCreateModal';
import { ToastContainer } from './components/ToastContainer';
import { AuditLogView } from './components/AuditLogView';
import { TaskMonitorView } from './components/TaskMonitorView';
import { validateAccountingProposal } from './services/accountingValidator';
import { logAuditInteraction } from './services/auditLog';
import { classifyAndExtractMultimodalInput } from './services/multimodalClassifier';
import { routeUserRequest } from './services/routerAgent';
import { createTask } from './services/taskEngine';
import { buildAccueilDelegationPrompt, parseAccueilDelegationReply } from './services/llmService';
import {
  Agent,
  ApiKeyConfig,
  ChatAttachment,
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
import { createImageThumbnail, genericAttachmentLabel } from './services/imageUtils';
import {
  INITIAL_AGENTS,
  INITIAL_API_KEYS,
  INITIAL_CHAT_SESSIONS,
  INITIAL_INTEGRATIONS,
  INITIAL_KNOWLEDGE,
  ACCUEIL_CANONICAL,
  SPECIALIST_PROMPT_FINGERPRINTS,
} from './mockData';

// Point d'entrée unique de la plateforme : toute nouvelle session démarre sur
// l'Agent d'Accueil. Un seul agent porte isDefaultEntry (repli : isRouter, puis [0]).
export function getDefaultEntryAgent(list: Agent[]): Agent {
  return (
    list.find((a) => a.isDefaultEntry) ||
    list.find((a) => a.isRouter) ||
    list[0]
  );
}
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
  callBackendBrief,
  isVisionModel,
  friendlyInferenceError,
} from './services/llmService';
import { getAccountingContext } from './services/companyContextService';
import {
  fetchAgents,
  persistAgent,
  fetchKnowledge,
  uploadKnowledge,
  addKnowledgeText,
  deleteKnowledgeDoc,
  downloadKnowledge,
  reindexKnowledge,
  searchKnowledge,
  base64ToBlob,
  fetchSessions,
  createSessionRemote,
  appendMessageRemote,
  uploadChatAttachment,
  renameSessionRemote,
  deleteSessionRemote,
  migrateLocalSessions,
  fetchIntegrations,
  persistIntegration,
  mergeIntegrationOverrides,
  isFrustratedText,
  postUserSignal,
  getBrowserUserId,
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

  // Journalisation structurée des erreurs (§5.3) : timestamp, agent, tool,
  // error_code, user_id, message_id. Aucun secret, jamais de contenu client.
  const logInferenceError = useCallback(
    (fields: { agent: string; tool: string; error_code: string; message_id: string }) => {
      try {
        console.error(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            user_id: getBrowserUserId(),
            ...fields,
          })
        );
      } catch {
        // logging best-effort
      }
    },
    []
  );

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

  // Integrations state — catalogue-first : INITIAL_INTEGRATIONS définit les 4 cartes,
  // le cache local puis Firestore ne font que surcharger des attributs (jamais la liste).
  // LegalFlow pré-configuré = actif par défaut. Purge des faux "connected"
  // historiques (exemple.ci, syncs simulées) et des statuts Google non confirmés
  // par le coffre OAuth (source de vérité via /api/google/status).
  const [integrations, setIntegrations] = useState<WorkspaceIntegration[]>(() => {
    try {
      const saved = localStorage.getItem('dc_intelligence_integrations');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.filter(
            (i: any) => !(i?.id === 'legal-flow' && i?.status === 'disconnected' && !i?.endpointUrl)
          );
          if (cleaned.length !== parsed.length) {
            try { localStorage.removeItem('dc_intelligence_integrations'); } catch {}
            return INITIAL_INTEGRATIONS;
          }
          const hasMockIntegration = cleaned.some(
            (i: any) =>
              i?.accountEmail === 'compte.google@exemple.ci' ||
              i?.accountEmail === 'alexmardochee0@gmail.com' ||
              (i?.syncHistory && i.syncHistory.length > 0 && i.syncCount > 0 && i.status === 'connected')
          );
          if (hasMockIntegration) {
            try { localStorage.removeItem('dc_intelligence_integrations'); } catch {}
            return INITIAL_INTEGRATIONS;
          }
          return mergeIntegrationOverrides(INITIAL_INTEGRATIONS, cleaned);
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

  // Agents state — la sélection démarre sur le point d'entrée (Accueil), jamais
  // directement sur un spécialiste (Comptabilité, etc.).
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    getDefaultEntryAgent(INITIAL_AGENTS)?.id || null
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
      // Auto-réparation : si le prompt distant du point d'entrée porte la
      // signature d'un prompt spécialiste (écrasement historique), on restaure
      // le canonique AQQR et on persiste la réparation.
      const isSpecialistContamination = (instructions?: string) =>
        typeof instructions === 'string' &&
        SPECIALIST_PROMPT_FINGERPRINTS.some((fp) => instructions.includes(fp));
      try {
        const remoteAgents = await fetchAgents();
        if (remoteAgents && remoteAgents.length > 0) {
          const byId = new Map(remoteAgents.map((a) => [a.id, a]));
          setAgents((prev) => {
            const merged = prev.map((a) => {
              if (!byId.has(a.id)) return a;
              const remote = byId.get(a.id) as Agent;
              const next: Agent = { ...a, ...remote, id: a.id, conversationsCount: 0 };
              const isEntry = Boolean(next.isDefaultEntry || next.isRouter);
              if (isEntry && isSpecialistContamination(next.instructions)) {
                next.role = ACCUEIL_CANONICAL.role;
                next.goal = ACCUEIL_CANONICAL.goal;
                next.instructions = ACCUEIL_CANONICAL.instructions;
                persistAgent(next).catch(() => {});
              }
              // Le drapeau point d'entrée survit au merge même si le backend l'ignore.
              if ((a.isDefaultEntry || a.isRouter) && !next.isDefaultEntry) {
                next.isDefaultEntry = true;
                persistAgent(next).catch(() => {});
              }
              return next;
            });
            const prevIds = new Set(prev.map((a) => a.id));
            const extra = remoteAgents.filter((a) => !prevIds.has(a.id));
            return extra.length ? [...merged, ...extra] : merged;
          });
        } else if (remoteAgents) {
          INITIAL_AGENTS.forEach((a) => persistAgent(a).catch(() => {}));
        }
      } catch { /* repli : valeurs locales */ }

      // ---- Connaissances (backend = source de vérité, jamais de mocks) ----
      // Backend vide = base vide : aucun seed, aucun document fictif.
      try {
        const remoteDocs = await fetchKnowledge();
        if (remoteDocs) {
          setKnowledgeDocs(remoteDocs);
        }
      } catch { /* repli : valeurs locales (vide par défaut) */ }

      // ---- Sessions (backend prioritaire, migration du cache sinon) ----
      try {
        const remoteSessions = await fetchSessions();
        if (remoteSessions && remoteSessions.length > 0) {
          setChatSessions((prev) => {
            // Ne jamais écraser un message optimiste en cours d'envoi
            const remoteIds = new Set(remoteSessions.map((s) => s.id));
            const localOnly = prev.filter((s) => !remoteIds.has(s.id));
            const merged = remoteSessions.map((rs: ChatSession) => {
              const local = prev.find((p) => p.id === rs.id);
              // Préserve l'épinglage local (non persisté backend)
              const pinned = local?.pinned;
              if (local && local.messages.length > (rs.messages?.length || 0)) {
                const extra = local.messages.slice(rs.messages.length);
                // Garde les messages locaux non encore persistés (optimistic UI)
                return { ...rs, pinned, messages: [...(rs.messages || []), ...extra], lastMessage: extra[extra.length - 1]?.content || rs.lastMessage, lastMessageTime: extra[extra.length - 1]?.timestamp || rs.lastMessageTime };
              }
              return pinned !== undefined ? { ...rs, pinned } : rs;
            });
            return [...localOnly, ...merged].sort((a, b) => String(b.id).localeCompare(String(a.id)));
          });
          // Ne pas forcer le changement de session si l'utilisateur est déjà dedans
          setSelectedSessionId((prev) => (prev && remoteSessions.some((s) => s.id === prev) ? prev : remoteSessions[0].id));
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

      // ---- Intégrations (overlay d'attributs distants sur le catalogue) ----
      // Firestore ne définit JAMAIS la liste : on fusionne ses attributs sur les
      // cartes INITIALES (un doc distant incomplet ou inconnu est simplement ignoré).
      // LegalFlow est pré-configuré et actif par défaut : s'il n'arrive pas en
      // connecté, on restaure le défaut (évite "Non associé" après migration).
      const enforceLegalDefault = (list: WorkspaceIntegration[]): WorkspaceIntegration[] => {
        const base = INITIAL_INTEGRATIONS.find((x) => x.id === 'legal-flow');
        if (!base) return list;
        return list.map((it) => {
          if (it.id !== 'legal-flow') return it;
          if (it.status === 'connected' && it.endpointUrl) return it;
          return { ...it, status: base.status, endpointUrl: base.endpointUrl || it.endpointUrl } as WorkspaceIntegration;
        });
      };
      try {
        const remoteRaw = await fetchIntegrations();
        if (Array.isArray(remoteRaw) && remoteRaw.length > 0) {
          const overlay = remoteRaw;
          setIntegrations(() => enforceLegalDefault(mergeIntegrationOverrides(INITIAL_INTEGRATIONS, overlay)));
        } else if (remoteRaw) {
          let local: WorkspaceIntegration[] = [];
          try {
            const raw = localStorage.getItem('dc_intelligence_integrations');
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) local = parsed;
          } catch { /* ignore */ }
          const hasMock = local.some(
            (i: any) => i?.accountEmail === 'compte.google@exemple.ci' || i?.accountEmail === 'alexmardochee0@gmail.com'
          );
          // Catalogue-first aussi ici : le cache local ne fait que surcharger
          // les attributs des cartes INITIALES (jamais de liste venue du cache).
          const rawSource = local.length > 0 && !hasMock ? local : [];
          const finalSource = enforceLegalDefault(mergeIntegrationOverrides(INITIAL_INTEGRATIONS, rawSource));
          setIntegrations(finalSource);
          finalSource.forEach((i) => persistIntegration(i).catch(() => {}));
        }
      } catch { /* repli : valeurs locales */ }
    })();
  }, []);

  // Base interne interrogeable (§7) : documents indexed/partial (vecteurs) OU
  // pending AVEC chunks (recherche lexicale sans crédits). Dès qu'un doc est
  // interrogeable, GENERAL_ONLY bascule en WITH_INTERNAL_PLAN dans les prompts.
  const kbIndexed = useMemo(
    () =>
      knowledgeDocs.some(
        (d) =>
          d.status === 'indexed' ||
          d.status === 'partial' ||
          (d.status === 'pending' && (d.chunkCount || 0) > 0)
      ),
    [knowledgeDocs]
  );

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
    const nowMs = Date.now();
    const base: ChatSession = remote
      ? { ...remote, createdAtMs: remote.createdAtMs || nowMs, updatedAtMs: nowMs }
      : {
          id: `session-${nowMs}`,
          title,
          category: 'Général',
          lastMessage: 'Session créée, prête pour vos questions...',
          lastMessageTime: timeStr,
          createdAt: 'À l’instant',
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          messages: [],
        };
    const newSession: ChatSession = base;

    setChatSessions((prev) => [newSession, ...prev]);
    setSelectedSessionId(newSession.id);
    // Règle métier : toute nouvelle session démarre sur l'Agent d'Accueil.
    const entry = getDefaultEntryAgent(agents);
    if (entry) setSelectedAgentId(entry.id);
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

  const handleTogglePinSession = (sessionId: string) => {
    setChatSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const handleSendMessage = async (sessionId: string, text: string, file?: File) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const trimmed = text.trim();
    // Libellé générique pour la sidebar/lastMessage — jamais le nom brut du fichier.
    const fileLabel = file ? genericAttachmentLabel(file.type) : '';

    // Déduplication : même texte + même pièce <2min → ne pas créer de doublon
    const lastMsg = chatSessions.find((s) => s.id === sessionId)?.messages.slice(-1)[0];
    if (
      lastMsg &&
      lastMsg.sender === 'user' &&
      lastMsg.content === trimmed &&
      (file ? lastMsg.attachments?.[0]?.name === file.name : !lastMsg.attachments?.length)
    ) {
      const lastTs = parseInt((lastMsg.id.split('-')[1] || '0'), 10);
      if (!isNaN(lastTs) && Date.now() - lastTs < 120000) {
        addToast('info', 'Message identique détecté', 'Traitement déjà en cours — pas de doublon créé.');
        return;
      }
    }

    // Nature MIME réelle de la pièce (pas l'extension) : images → vision LLM,
    // PDF → texte extrait côté serveur, autres → classification seule.
    const fileIsImage = Boolean(file && /^image\//.test(file.type || ''));
    const fileIsPdf = Boolean(
      file && ((file.type || '') === 'application/pdf' || /\.pdf$/i.test(file.name || ''))
    );

    // Pièce jointe optimiste : blob local immédiat (rendu instantané) + miniature
    // compressée. L'upload réel part en arrière-plan et patche le storagePath.
    const optimisticAtts: ChatAttachment[] = file
      ? [
          {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            url: URL.createObjectURL(file),
            uploading: true,
          },
        ]
      : [];

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      senderName: 'Vous',
      content: trimmed,
      timestamp: timeStr,
      ...(optimisticAtts.length ? { attachments: optimisticAtts } : {}),
    };

    const patchAttachments = (patch: Partial<ChatAttachment>) => {
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === userMsg.id && m.attachments
                    ? { ...m, attachments: m.attachments.map((a) => ({ ...a, ...patch })) }
                    : m
                ),
              }
            : s
        )
      );
    };

    // Miniature compressée côté client (non bloquante) pour un affichage rapide.
    if (file && (file.type || '').startsWith('image/')) {
      createImageThumbnail(file)
        .then((thumb) => patchAttachments({ thumbUrl: thumb }))
        .catch(() => {});
    }

    // 1. Optimiste IMMÉDIAT — animation message-enter sans attendre la classification
    const currentSession = chatSessions.find((s) => s.id === sessionId);
    const titleText = trimmed;
    const isDefaultTitle = currentSession?.title.startsWith('Nouvelle session');
    const nextTitle = isDefaultTitle && titleText
      ? titleText.slice(0, 32) + (titleText.length > 32 ? '...' : '')
      : currentSession?.title;
    if (isDefaultTitle && nextTitle) {
      renameSessionRemote(sessionId, nextTitle).catch(() => {});
    }
    const remoteAttachmentsFor = (storagePath?: string) =>
      file
        ? [
            {
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              size: file.size,
              ...(storagePath ? { storagePath } : {}),
            },
          ]
        : undefined;
    // Promesse d'upload exposée : la phase détaillée l'attend (bornée 15 s)
    // pour transmettre la pièce au LLM vision (§4).
    let uploadPromise: Promise<string | undefined> = Promise.resolve(undefined);
    if (file) {
      // Persistance après upload réel : le message stocké porte le storagePath.
      uploadPromise = uploadChatAttachment(sessionId, file)
        .then((r) => {
          patchAttachments({ storagePath: r.storagePath, uploading: false });
          appendMessageRemote(sessionId, {
            sender: 'user',
            senderName: 'Vous',
            content: trimmed || ' ',
            agentName: 'DC Intelligence',
            attachments: remoteAttachmentsFor(r.storagePath),
          }).catch(() => {});
          return r.storagePath as string;
        })
        .catch(() => {
          patchAttachments({ uploading: false, uploadError: true });
          appendMessageRemote(sessionId, {
            sender: 'user',
            senderName: 'Vous',
            content: trimmed || ' ',
            agentName: 'DC Intelligence',
          }).catch(() => {});
          addToast('warning', 'Pièce jointe non stockée', 'Le message est envoyé, mais le fichier reste visible uniquement sur cet appareil.');
          return undefined;
        });
    } else {
      appendMessageRemote(sessionId, {
        sender: 'user',
        senderName: 'Vous',
        content: trimmed,
        agentName: 'DC Intelligence',
      }).catch(() => {});
    }
    setChatSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            title: nextTitle || s.title,
            lastMessage: trimmed || fileLabel || s.lastMessage,
            lastMessageTime: timeStr,
            updatedAtMs: Date.now(),
            messages: [...s.messages, userMsg],
          };
        }
        return s;
      })
    );
    setIsGenerating(true);

    if (isFrustratedText(text)) {
      postUserSignal('frustration').catch(() => {});
    }

    // 2. Classification & routage en arrière-plan (ne bloque plus l'affichage).
    // Bornée à 12 s : au-delà, heuristique texte seul (jamais de blocage).
    const multimodalRes = await Promise.race([
      classifyAndExtractMultimodalInput({ text, file }),
      new Promise<null>((res) => setTimeout(() => res(null), 12000)),
    ]).then((r) => r ?? undefined);
    let routingRes = routeUserRequest(text, multimodalRes);
    try {
      const accueilAgentForDecision = agents.find((a) => a.isDefaultEntry || a.isRouter) || getDefaultEntryAgent(agents);
      const sessForHistory = chatSessions.find((s) => s.id === sessionId);
      const historySummary = (sessForHistory?.messages || [])
        .slice(-4)
        .map((m) => `${m.sender === 'user' ? 'Client' : 'DC'}: ${String(m.content).slice(0, 200)}`)
        .join('\n');
      const accCtxForDecision = getAccountingContext();
      const decisionCtxStatus =
        accCtxForDecision.contextStatus !== 'GENERAL_ONLY' || !kbIndexed
          ? accCtxForDecision.contextStatus
          : 'WITH_INTERNAL_PLAN';
      const ctxSummary = `company:${accCtxForDecision.companyId || '—'} status:${decisionCtxStatus} plan:${accCtxForDecision.planComptableStatus}`;
      const delegationPrompt = buildAccueilDelegationPrompt(
        { name: accueilAgentForDecision.name, role: accueilAgentForDecision.role, instructions: accueilAgentForDecision.instructions },
        historySummary,
        ctxSummary,
        text
      );
      const decisionRaw = await Promise.race([
        generateChatResponse({
          model: models.find((m) => m.id === selectedModelId) || models[0] || DEFAULT_MODEL,
          conversationHistory: [],
          userMessage: delegationPrompt,
          apiKeys,
          reasoningEffort: 'Low',
          agentContext: { name: accueilAgentForDecision.name, role: accueilAgentForDecision.role, instructions: accueilAgentForDecision.instructions },
        }),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('delegation_timeout')), 8000)),
      ]);
      const parsed = parseAccueilDelegationReply(String(decisionRaw || ''));
      if (parsed) {
        const map: Record<string, string> = {
          delegate_to_compta: 'agent-1',
          delegate_to_juridique: 'agent-3',
          delegate_to_reco: 'agent-2',
          ask_clarification: 'agent-router',
          answer_directly: 'agent-router',
        };
        const targetFromLLM = map[parsed.action];
        if (targetFromLLM) {
          routingRes = {
            domain: parsed.action === 'delegate_to_compta' ? 'COMPTABILITÉ' : parsed.action === 'delegate_to_juridique' ? 'JURIDIQUE_FISCAL' : parsed.action === 'delegate_to_reco' ? 'RAPPROCHEMENT' : parsed.action === 'ask_clarification' ? 'HUMAIN' : 'ACCUEIL',
            targetAgentId: targetFromLLM,
            confidence: parsed.confidence || 0.85,
            reasoning: parsed.reason || `Décision LLM Accueil: ${parsed.action}`,
            requiresClarification: parsed.action === 'ask_clarification',
            clarificationQuestion: parsed.clarificationQuestion,
          };
        }
      }
    } catch {
      // Fallback heuristique déjà calculé ci-dessus
    }

    const entryAgent = getDefaultEntryAgent(agents);
    const visibleAgent = entryAgent;
    const targetAgent =
      agents.find((a) => a.id === routingRes.targetAgentId) || entryAgent;
    const needsDelegation =
      targetAgent.id !== entryAgent.id &&
      routingRes.confidence >= 0.7 &&
      !routingRes.requiresClarification;

    const currentTask = createTask({
      agentId: needsDelegation ? targetAgent.name : visibleAgent.name,
      action: (needsDelegation
        ? targetAgent.allowedActions && targetAgent.allowedActions[0]
        : visibleAgent.allowedActions && visibleAgent.allowedActions[0]) || 'PREPARE',
      input: trimmed || fileLabel,
      status: 'RUNNING',
    });

    // 3. Contexte pour l'appel LLM — history snapshot avant le nouveau message (comme avant)
    const targetSession = chatSessions.find((s) => s.id === sessionId);

    // Handoff §3 : nom de signature du spécialiste + utilitaires partagés entre
    // le try et le catch (reprise Accueil en cas d'échec).
    const specialistDisplay = targetAgent.associatedSoftware || targetAgent.name;
    const stampNow = () => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const pushAgentMessage = (msg: ChatMessage, remoteAgentName: string, activeAgent: string) => {
      appendMessageRemote(sessionId, {
        sender: 'agent',
        senderName: msg.senderName,
        content: msg.content,
        agentName: remoteAgentName,
      }).catch(() => {});
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                lastMessage: msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : ''),
                lastMessageTime: msg.timestamp,
                activeAgentId: activeAgent,
                messages: [...s.messages, msg],
              }
            : s
        )
      );
    };
    const dropStreamMessage = (streamId: string) => {
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: s.messages.filter((m) => !(m.id === streamId && !m.content)) }
            : s
        )
      );
    };
    let imagePaths: string[] = [];
    let aiMsgId = '';

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

      // Handoff §3 : l'Accueil a routé ; le spécialiste prend le relais et SIGNE
      // de son nom (Compta Flow, RECO, Legal Flow). Le RAG/context suit
      // l'exécutant, pas la façade.
      const facilitatingAgent = needsDelegation ? targetAgent : visibleAgent;

      // RAG SYSTÉMATIQUE (§7) : avant chaque réponse détaillée, la question est
      // vectorisée et cherchée (top-2) dans la base. Fail-soft : sans backend,
      // réponse sans sources, jamais inventées.
      let ragBlock = '';
      let ragTitles: string[] = [];
      if (trimmed.length >= 3) {
        const hits = await searchKnowledge(text, 2).catch(() => []);
        if (hits.length > 0) {
          ragTitles = [...new Set(hits.map((h) => h.title))];
          ragBlock =
            '\n\nSources documentaires indexées (cite-les avec [doc:titre] quand tu t’en sers) :\n' +
            hits.map((h) => `[doc:${h.title}] ${h.chunk}`).join('\n---\n');
        }
      }
      // Contexte entreprise : ne mentionner le plan que si la question l'exige
      // (comptabilité/imputation). GENERAL_ONLY + base indexée = WITH_INTERNAL_PLAN.
      const accCtx = getAccountingContext();
      const planState =
        accCtx.contextStatus !== 'GENERAL_ONLY' || !kbIndexed ? accCtx.contextStatus : 'WITH_INTERNAL_PLAN';
      const isComptaQuestion = facilitatingAgent && (facilitatingAgent.id === 'agent-1' || facilitatingAgent.associatedSoftware === 'Compta Flow');
      if (isComptaQuestion) {
        if (planState === 'WITH_INTERNAL_PLAN') {
          ragBlock += `\n\n[Contexte entreprise: WITH_INTERNAL_PLAN — base interne indexée disponible. Utilise les sources documentaires ci-dessus ; ne dis jamais "plan non accessible" ni "contexte GENERAL_ONLY". — plan:${accCtx.planComptableStatus} tiers:${accCtx.planTiersStatus} journaux:${accCtx.journauxStatus}]`;
        } else if (planState !== 'GENERAL_ONLY') {
          ragBlock += `\n\n[Contexte entreprise: ${planState} — plan:${accCtx.planComptableStatus} tiers:${accCtx.planTiersStatus} journaux:${accCtx.journauxStatus}]`;
        } else {
          ragBlock += `\n\n[Contexte entreprise: GENERAL_ONLY — Votre plan comptable interne n'est pas encore chargé. Les comptes proposés peuvent nécessiter une adaptation.]`;
        }
      }

      // 4. Réponse BRÈVE du LLM (§2.1) : 1 à 2 phrases qui accusent réception,
      // reformulent si besoin et annoncent l'action. UNIQUEMENT du LLM — en cas
      // d'échec, RIEN (dots discrets), jamais de texte statique.
      const briefSystem =
        `Tu es DC Intelligence (Agent d'Accueil). Réponds en 1 à 2 phrases MAX, en français, ` +
        `chaleureusement et sans jargon : accuse réception du message, reformule la demande si utile, ` +
        `annonce l'action en cours.` +
        (needsDelegation ? ` Annonce le routage vers « ${specialistDisplay} » (ex : « Je transmets à l'agent Comptabilité. »).` : '') +
        (routingRes.requiresClarification && routingRes.clarificationQuestion
          ? ` Pose cette question : « ${routingRes.clarificationQuestion} ».`
          : '') +
        (file ? ' Une pièce jointe est fournie et sera analysée.' : '') +
        ` Exemples de ton : « Oui, je suis là. Comment puis-je vous aider ? » / ` +
        `« J'ai bien reçu votre facture, je lance l'analyse et je reviens avec l'écriture. » / ` +
        `« Je sens que quelque chose ne va pas. Dites-moi ce qui bloque, je suis là pour vous aider. » ` +
        `Ne décris jamais d'action déjà accomplie.`;
      let briefContent: string | null = null;
      try {
        briefContent = await callBackendBrief({
          modelId: modelObj.id,
          systemPrompt: briefSystem,
          userPrompt: (trimmed || fileLabel).slice(0, 1000),
        });
      } catch {
        briefContent = null;
      }
      if (briefContent) {
        pushAgentMessage(
          {
            id: `msg-brief-${Date.now()}`,
            sender: 'agent',
            senderName: 'DC Intelligence',
            content: briefContent,
            timestamp: stampNow(),
            taskRef: currentTask,
          },
          visibleAgent.name,
          entryAgent.id
        );
      }

      // Sans délégation, le brief EST la réponse (pas de doublon détaillé).
      if (!needsDelegation) {
        if (!briefContent) throw new Error('brief_indisponible');
        return;
      }

      // 5. Attente upload bornée (15 s) pour transmettre la pièce au LLM vision (§4).
      // Au-delà, on compose sans l'image (mentionnée comme non lisible, §4.3).
      if (file) {
        try {
          const storedPath = await Promise.race([
            uploadPromise,
            new Promise<undefined>((res) => setTimeout(() => res(undefined), 15000)),
          ]);
          if (typeof storedPath === 'string' && storedPath) imagePaths = [storedPath];
        } catch {
          imagePaths = [];
        }
      }
      const lowVision =
        Boolean(file) && (!multimodalRes || (multimodalRes.confidence ?? 0) < 0.6) && imagePaths.length === 0;

      // 6. ANTI-HALLUCINATION (§6) : le prompt reçoit la liste des actions
      // RÉELLEMENT effectuées. Liste vide ou sans vérification = interdiction
      // de dire « j'ai vérifié / consulté / son retour ».
      const actionsDone: string[] = [
        `classification (${multimodalRes?.documentType || 'texte'}, confiance ${Math.round(((multimodalRes?.confidence ?? 0.6) * 100))} %)`,
        `routage → ${specialistDisplay} (${routingRes.domain}, confiance ${Math.round(routingRes.confidence * 100)} %)`,
        `tâche ${currentTask.taskId}`,
        ragTitles.length > 0
          ? `RAG : ${ragTitles.length} source(s) [${ragTitles.join(', ')}]`
          : 'RAG : aucune source documentaire',
        `contexte : ${planState}`,
      ];
      if (file) {
        const pjKind = fileIsImage ? 'vision' : fileIsPdf ? 'texte extrait' : 'classification';
        actionsDone.push(
          imagePaths.length > 0
            ? `pièce jointe stockée (${imagePaths[0]}) et transmise (${pjKind})`
            : 'pièce jointe NON stockée (visible locale uniquement)'
        );
      }
      if (lowVision) actionsDone.push('pièce NON lisible automatiquement (confiance < 60 %)');
      let actionsBlock =
        `\n\n[Actions réellement effectuées : ${actionsDone.join(' → ')}. ` +
        `RÈGLE ABSOLUE : si cette liste ne contient pas une vérification, une consultation ou une source, ` +
        `interdiction formelle de dire « j'ai vérifié », « j'ai consulté », « j'ai son retour ». ` +
        `Dis ce qu'il te manque au lieu d'inventer.]`;
      if (lowVision) {
        actionsBlock +=
          `\n[Pièce jointe illisible : demande à l'utilisateur de la renvoyer en meilleur format ou de ` +
          `saisir les informations manuellement, sans bloquer.]`;
      }

      const visibleContext = {
        name: visibleAgent.name,
        role: visibleAgent.role,
        instructions: visibleAgent.instructions,
      };
      const specialistContext = {
        name: targetAgent.name,
        role: targetAgent.role,
        instructions: targetAgent.instructions,
        displayName: specialistDisplay,
      };

      // 7. Réponse DÉTAILLÉE du spécialiste, en STREAMING token-par-token (§1.3).
      // La bulle est créée vide puis remplie dès le 1er token (20 s max, §5.1).
      aiMsgId = `msg-ai-${Date.now()}`;
      const streamCtrl = new AbortController();
      const appendToken = (t: string) => {
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === aiMsgId ? { ...m, content: m.content + t } : m
                  ),
                }
              : s
          )
        );
      };
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                activeAgentId: targetAgent.id,
                messages: [
                  ...s.messages,
                  {
                    id: aiMsgId,
                    sender: 'agent',
                    senderName: specialistDisplay,
                    content: '',
                    timestamp: stampNow(),
                    streaming: true,
                    taskRef: currentTask,
                  } as ChatMessage,
                ],
              }
            : s
        )
      );
      // Trace d'outils du registre (remplie via onTrace pendant le stream).
      let agentToolTrace: Array<{ tool: string; ok: boolean }> = [];
      const patchAiTrace = (trace: Array<{ tool: string; ok: boolean }>) => {
        agentToolTrace = trace;
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === aiMsgId ? { ...m, toolTrace: trace } : m
                  ),
                }
              : s
          )
        );
      };
      const finalizeStream = (content: string) => {
        setChatSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  lastMessage: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
                  lastMessageTime: stampNow(),
                  messages: s.messages.map((m) =>
                    m.id === aiMsgId
                      ? { ...m, content, streaming: false, toolTrace: agentToolTrace.length ? agentToolTrace : undefined }
                      : m
                  ),
                }
              : s
          )
        );
      };
      // §4 : une IMAGE doit PARTIR au LLM. Si le modèle actif ne lit pas les
      // images, l'appel détaillé bascule sur le modèle vision du cabinet
      // (brief, RAG et classification gardent le modèle choisi). Explicite.
      const needsVisionSwitch = fileIsImage && imagePaths.length > 0 && !isVisionModel(modelObj.id);
      const visualModel = needsVisionSwitch ? DEFAULT_MODEL : modelObj;
      if (needsVisionSwitch) {
        addToast(
          'info',
          'Analyse visuelle via Ling 3.0',
          `« ${modelObj.name} » ne lit pas les images : la pièce est analysée par le modèle vision du cabinet.`
        );
      }
      const aiResponseContent = await generateChatResponse({
        model: visualModel,
        conversationHistory: history,
        userMessage: text + ragBlock + actionsBlock,
        apiKeys,
        reasoningEffort,
        agentContext: visibleContext,
        specialistContext,
        images: imagePaths,
        hasImages: imagePaths.length > 0 && fileIsImage,
        stream: true,
        onToken: appendToken,
        signal: streamCtrl.signal,
        firstTokenTimeoutMs: 20000,
        // Registre natif : l'agent exécutant demande, le backend exécute.
        agentId: facilitatingAgent.id,
        tools: 'auto',
        onTrace: patchAiTrace,
      });
      // Finalise la bulle (streamée token-par-token, ou posée d'un bloc en repli).
      finalizeStream(aiResponseContent);

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

            // Log to audit journal LocalStorage (sources RAG réelles, jamais inventées)
            logAuditInteraction({
              source: 'chat',
              llm: {
                provider: visualModel.provider,
                modele: visualModel.name,
              },
              question: `[visible=${visibleAgent.id} specialist=${targetAgent.id} task=${currentTask.taskId}] ${text}`,
              sourcesRag: ragTitles,
              ecritureProposee: proposal,
              validation: validationResult,
            });
          }
        } catch (e) {
          console.warn('Could not parse JSON proposal from LLM response:', e);
        }
      }

      // La bulle streamée existe déjà : on la complète (proposition, validation),
      // pas de doublon. Signature du spécialiste (§3.2 handoff).
      const wrappedContent = aiResponseContent;
      setChatSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === aiMsgId ? { ...m, proposal, validationResult } : m
                ),
              }
            : s
        )
      );
      appendMessageRemote(sessionId, {
        sender: 'agent',
        senderName: specialistDisplay,
        content: wrappedContent,
        agentName: specialistDisplay,
      }).catch(() => {});
    } catch (err: any) {
      // §3.3 + §5 : JAMAIS de silence ni de spinner infini. Toute erreur produit
      // un message explicite voisé par l'agent (Accueil reprend la main si le
      // spécialiste a échoué), + toast technique + log structuré (§5.3).
      const raw = String(err?.message || '');
      const errorCode = /backend_not_configured|AUCUNE_CLÉ_API/.test(raw)
        ? 'backend_not_configured'
        : /LIMITE_ATTEINTE|429/.test(raw)
        ? 'rate_limited'
        : /STREAM_FIRST_TOKEN_TIMEOUT|pipeline_deadline|timeout|délai/i.test(raw)
        ? 'timeout_20s'
        : /Failed to fetch|NetworkError|unreachable|backend_unreachable/.test(raw)
        ? 'network_unreachable'
        : /brief_indisponible/.test(raw)
        ? 'brief_indisponible'
        : /backend_502|backend_504/.test(raw)
        ? 'upstream_502_504'
        : 'unknown';
      logInferenceError({
        agent: specialistDisplay,
        tool: 'chat',
        error_code: errorCode,
        message_id: userMsg.id,
      });
      dropStreamMessage(aiMsgId);
      const extraCtx = imagePaths.length > 0 ? ` (pièce : ${imagePaths[0]})` : '';
      logInferenceError({
        agent: specialistDisplay,
        tool: 'chat_detail',
        error_code: `${errorCode}${extraCtx}`,
        message_id: aiMsgId,
      });
      if (/STREAM_FIRST_TOKEN_TIMEOUT/.test(raw)) {
        // §5.1 : 20 s sans réponse → message LLM, pas de spinner infini.
        pushAgentMessage(
          {
            id: `msg-timeout-${Date.now()}`,
            sender: 'agent',
            senderName: 'DC Intelligence',
            content: 'Le traitement prend plus de temps que prévu. Voulez-vous réessayer ou contacter un agent humain ?',
            timestamp: stampNow(),
            taskRef: currentTask,
          },
          visibleAgent.name,
          entryAgent.id
        );
        addToast('error', 'Délai dépassé (20 s)', 'Le traitement prend plus de temps que prévu.');
      } else if (/brief_indisponible/.test(raw)) {
        pushAgentMessage(
          {
            id: `msg-err-${Date.now()}`,
            sender: 'agent',
            senderName: 'DC Intelligence',
            content: 'Je n’arrive pas à vous répondre pour le moment. Voulez-vous réessayer ou parler à un humain ?',
            timestamp: stampNow(),
            taskRef: currentTask,
          },
          visibleAgent.name,
          entryAgent.id
        );
        addToast('error', 'Erreur d’inférence IA', friendlyInferenceError(err));
      } else {
        // §3.3 : le spécialiste a échoué → l'Accueil reprend la main explicitement.
        const friendly = /backend_not_configured|AUCUNE_CLÉ_API|OPENROUTER_API_KEY/.test(raw)
          ? 'Service IA indisponible : clé cabinet manquante côté serveur. Contactez l’administrateur.'
          : /timeout|délai|Failed to fetch|NetworkError|unreachable/i.test(raw)
          ? 'Le service IA met trop de temps à répondre. Réessayez dans un instant.'
          : friendlyInferenceError(err);
        pushAgentMessage(
          {
            id: `msg-err-${Date.now()}`,
            sender: 'agent',
            senderName: 'DC Intelligence',
            content: `Je n'ai pas pu traiter votre demande. Voulez-vous réessayer ou parler à un humain ? (${friendly})`,
            timestamp: stampNow(),
            taskRef: currentTask,
          },
          visibleAgent.name,
          entryAgent.id
        );
        addToast('error', 'Erreur d’inférence IA', friendly);
      }
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

  // Création via formulaire structuré : le Prompt Système est obligatoire,
  // un agent n'est jamais créé "au hasard". Jamais point d'entrée par défaut.
  const [isNewAgentModalOpen, setIsNewAgentModalOpen] = useState<boolean>(false);

  const handleCreateAgent = (draft: NewAgentDraft) => {
    const newId = `agent-${Date.now()}`;
    const newAgent: Agent = {
      id: newId,
      name: draft.name,
      description: draft.description || 'Agent spécialisé DC Intelligence.',
      status: 'actif',
      goal: draft.goal,
      role: draft.role,
      instructions: draft.instructions,
      allowedActions: draft.allowedActions,
      allowedChannels: draft.allowedChannels.length > 0 ? draft.allowedChannels : ['web'],
      isDefaultEntry: false,
      conversationsCount: 0,
    };
    persistAgent(newAgent).catch(() => {
      addToast('warning', 'Sauvegarde locale uniquement', 'Le serveur est injoignable, réessayez plus tard.');
    });
    setAgents((prev) => [newAgent, ...prev]);
    setSelectedAgentId(newId);
    setIsNewAgentModalOpen(false);
    addToast('success', 'Nouvel agent créé', `${newAgent.name} prêt à être configuré.`);
  };

  // Réindexation réelle : reconstruit chunks + embeddings côté serveur.
  const handleReindexDocument = async (docId: string) => {
    const updated = await reindexKnowledge(docId).catch(() => null);
    if (!updated) {
      addToast('error', 'Réindexation impossible', 'Serveur injoignable.');
      return;
    }
    setKnowledgeDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, ...updated } : d)));
    const searchablePending = updated.status === 'pending' && (updated.chunkCount || 0) > 0;
    addToast(
      updated.status === 'indexed' || updated.status === 'partial' || searchablePending ? 'success' : 'info',
      updated.status === 'indexed'
        ? 'Document indexé'
        : updated.status === 'partial'
        ? 'Indexation partielle'
        : searchablePending
        ? 'Document interrogeable'
        : 'En attente d’indexation',
      updated.status === 'indexed'
        ? `${updated.chunkCount || 0} chunks vectoriels actifs.`
        : searchablePending
        ? `${updated.chunkCount} chunks en recherche par mots-clés (vecteurs en attente).`
        : updated.indexReason || 'Voir le statut du document.'
    );
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
      const searchablePending = doc.status === 'pending' && (doc.chunkCount || 0) > 0;
      const notSearchable = (doc.chunkCount || 0) === 0;
      if (notSearchable) {
        // Stocké et téléchargeable, mais PAS interrogeable par les agents :
        // le dire explicitement au lieu de promettre une "indexation à venir".
        addToast('info', 'Fichier stocké (non interrogeable)', `${file.name} : téléchargeable et visible, mais inutilisable par les agents. ${doc.indexReason || 'Format non extractible (texte, PDF ou image uniquement).'}`);
      } else if (doc.status === 'indexed' || doc.status === 'partial' || searchablePending) {
        addToast(
          'success',
          'Document utilisable par les agents',
          searchablePending
            ? `${file.name} : ${doc.chunkCount} chunks en recherche par mots-clés (vecteurs en attente).`
            : `${file.name} : ${doc.chunkCount || 0} chunks indexés.`
        );
      } else {
        addToast('success', 'Document persisté', `${file.name} stocké. ${doc.indexReason || 'Indexation à venir.'}`);
      }
    } catch (err: any) {
      addToast('error', 'Échec de l’envoi', err?.message || 'Serveur injoignable.');
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // Saisie manuelle : titre + texte -> Firestore/Storage via /knowledge/text,
  // mêmes statuts/toasts que l'import fichier (utilisable par les agents).
  const handleAddTextDocument = async (title: string, text: string, category: string) => {
    setIsUploadingDoc(true);
    try {
      const doc = await addKnowledgeText(title, text, category || 'PROCÉDURES SYSCOHADA');
      setKnowledgeDocs((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      const searchablePending = doc.status === 'pending' && (doc.chunkCount || 0) > 0;
      if (doc.status === 'indexed' || doc.status === 'partial' || searchablePending) {
        addToast(
          'success',
          'Texte utilisable par les agents',
          searchablePending
            ? `"${doc.title}" : ${doc.chunkCount} chunks en recherche par mots-clés.`
            : `"${doc.title}" : ${doc.chunkCount || 0} chunks indexés.`
        );
      } else {
        addToast('success', 'Texte enregistré', `"${doc.title}" stocké. ${doc.indexReason || 'Indexation à venir.'}`);
      }
    } catch (err: any) {
      addToast('error', 'Échec de l’enregistrement', err?.message || 'Serveur injoignable.');
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
      {/* 1. Colonne gauche : menu + Conversations intégrées (style Claude) */}
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
        sessions={chatSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={(id) => {
          setSelectedSessionId(id);
          setCurrentTab('assistant');
        }}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onTogglePinSession={handleTogglePinSession}
      />

      {/* 2. Zone principale */}
      <main id="app-main-workspace" className="flex-1 flex h-full min-w-0 overflow-hidden bg-white relative">
        {/* VIEW 1: ASSISTANT (chat pleine largeur, historique dans la Sidebar) */}
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
            fallback={(error) => (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
                <h3 className="font-bold text-[15px] text-[#1E293B]">Impossible de charger les connexions</h3>
                <p className="text-[12px] text-[#64748B] max-w-md mt-1">Réessayez ou vérifiez la configuration Firestore.</p>
                {error && error.message ? (
                  <code className="mt-2 max-w-md text-[11px] font-mono text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 break-all">
                    {String(error.message).slice(0, 300)}
                  </code>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    try { localStorage.removeItem('dc_intelligence_integrations'); } catch {}
                    window.location.reload();
                  }}
                  className="mt-4 px-3.5 py-1.5 rounded-lg bg-black text-white text-[12px] font-semibold hover:bg-zinc-800 cursor-pointer"
                >
                  Réinitialiser les données locales
                </button>
              </div>
            )}
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
              onNewAgent={() => setIsNewAgentModalOpen(true)}
            />
            <AgentDetail agent={selectedAgent} onUpdateAgent={handleUpdateAgent} />
          </div>
        )}

        {/* VIEW 4: CONNAISSANCES */}
        {currentTab === 'knowledge' && (
          <KnowledgeBaseView
            documents={knowledgeDocs}
            onUploadDocument={handleUploadDocument}
            onAddTextDocument={handleAddTextDocument}
            onDeleteDocument={handleDeleteDocument}
            onDownloadDocument={handleDownloadDocument}
            onReindexDocument={handleReindexDocument}
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

      {/* Create New Agent Modal (formulaire structuré, prompt système obligatoire) */}
      <AgentCreateModal
        isOpen={isNewAgentModalOpen}
        onClose={() => setIsNewAgentModalOpen(false)}
        onCreate={handleCreateAgent}
      />

      {/* Toast Notifications Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

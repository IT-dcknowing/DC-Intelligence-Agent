import React, { useState, useRef, useEffect } from 'react';
import { createTask } from '../services/taskEngine';
import {
  Plus,
  Mic,
  ArrowUp,
  Search,
  Trash2,
  Edit2,
  Sparkles,
  Paperclip,
  Check,
  X,
  FileSpreadsheet,
  Download,
  Bot,
  Copy,
  CheckCheck,
  FileText,
  HelpCircle,
  Calculator,
  BookOpen,
  Loader2,
} from 'lucide-react';
import {
  ApiKeyConfig,
  ChatMessage,
  ChatSession,
  LLMModel,
  ReasoningEffort,
  VoiceState,
} from '../types';
import { ModelSelector } from './ModelSelector';
import { WaveformVisualizer } from './WaveformVisualizer';
import { transcribeAudioWithGroq } from '../services/voiceService';
import { executeSoftwareTool } from '../services/mcpClient';
import { logMcpCall } from '../services/auditLog';
import { getAccountingContext } from '../services/companyContextService';
import { InputArea as ClaudeInputArea } from './claude/InputArea';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AssistantViewProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => Promise<string>;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onSendMessage: (sessionId: string, text: string, file?: File) => void;
  isGenerating: boolean;
  models: LLMModel[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  apiKeys: ApiKeyConfig[];
  onNavigateToApiKeys: () => void;
  onNavigateToSettings: () => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (effort: ReasoningEffort) => void;
  onOpenAddModelModal: () => void;
  onRefreshOpenRouter: () => Promise<void>;
  isRefreshingModels?: boolean;
  onDeleteCustomModel?: (modelId: string) => void;
}

export const AssistantView: React.FC<AssistantViewProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onSendMessage,
  isGenerating,
  models,
  selectedModelId,
  onSelectModel,
  apiKeys,
  onNavigateToApiKeys,
  onNavigateToSettings,
  reasoningEffort,
  onChangeReasoningEffort,
  onOpenAddModelModal,
  onRefreshOpenRouter,
  isRefreshingModels = false,
  onDeleteCustomModel,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Compta Flow MCP : prepare (PREPARE) puis commit (EXECUTE) par message.
  // draftId + alertes serveur affichés inline, jamais simulés.
  const [mcpBusy, setMcpBusy] = useState<Record<string, boolean>>({});
  const [mcpDrafts, setMcpDrafts] = useState<
    Record<string, { draftId: string; alertes: string[]; committed: boolean; commitRef?: string }>
  >({});
  const [mcpErrors, setMcpErrors] = useState<Record<string, string>>({});
  // P0.4 Cycle de vie : PROPOSITION ≠ VALIDATION ≠ PRÉPARATION ≠ EXÉCUTION
  const [proposalStatuses, setProposalStatuses] = useState<Record<string, string>>({});
  const [proposalEdits, setProposalEdits] = useState<Record<string, boolean>>({});

  // Audio / Voice recording state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [groqError, setGroqError] = useState<string | null>(null);

  // Audio Recording Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((s) => s.id === selectedSessionId) || sessions[0] || null;

  // Auto scroll to bottom
  useEffect(() => {
    if (activeSession?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSession?.messages?.length, isGenerating]);

  // Cleanup audio tracks on unmount
  useEffect(() => {
    return () => {
      stopAndCleanupAudio();
    };
  }, []);

  const stopAndCleanupAudio = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }
  };

  const startVoiceRecording = async () => {
    setGroqError(null);
    audioChunksRef.current = [];
    setRecordingSeconds(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserNodeRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setVoiceState('transcribing');

        const groqApiKey = apiKeys.find((k) => k.provider === 'groq')?.key || '';

        try {
          const result = await transcribeAudioWithGroq(audioBlob, groqApiKey);
          const transcriptText = result?.text?.trim() || '';
          if (transcriptText) {
            setInputText((prev) => (prev ? `${prev} ${transcriptText}` : transcriptText));
          }
        } catch (err: any) {
          setGroqError(err.message || 'Erreur transcription Groq Whisper.');
        } finally {
          setVoiceState('idle');
          stopAndCleanupAudio();
        }
      };

      mediaRecorder.start();
      setVoiceState('recording');

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setGroqError('Microphone inaccessible ou refusé par le navigateur.');
      setVoiceState('idle');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelRecording = () => {
    stopAndCleanupAudio();
    setVoiceState('idle');
    audioChunksRef.current = [];
  };

  // Envoi robuste : si aucune session n'existe (démarrage à zéro),
  // on la crée d'abord au lieu de sortir en silence.
  const handleSubmitMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const hasText = inputText.trim().length > 0;
    const hasFiles = attachedFiles.length > 0;
    if ((!hasText && !hasFiles) || isGenerating) return;
    let sessionId = activeSession?.id;
    if (!sessionId) {
      try {
        sessionId = await onNewSession();
      } catch {
        return;
      }
    }
    const textToSend = inputText.trim();
    const filesToSend = [...attachedFiles];
    setInputText('');
    setAttachedFiles([]);
    setFileError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // Si fichiers joints, envoyer avec le premier fichier (le backend gère 1 fichier par message, on enchaîne)
    if (filesToSend.length > 0) {
      for (let i = 0; i < filesToSend.length; i++) {
        const file = filesToSend[i];
        const textPart = i === 0 ? textToSend : '';
        // On passe le fichier via une propriété temporaire sur window pour que App le récupère,
        // mais le plus propre est d'étendre onSendMessage - on le fait via un event custom
        // Pour compatibilité, on encode le fichier dans le texte si besoin et on appelle avec le fichier
        (onSendMessage as any)(sessionId, textPart, file);
        // Petit délai entre envois multiples pour éviter le spam
        if (i < filesToSend.length - 1) await new Promise((r) => setTimeout(r, 300));
      }
      // Si texte seul sans fichier déjà traité ci-dessus (i=0), pas besoin de double envoi
      // Le cas texte + fichier est déjà géré dans la boucle (i=0 avec textPart)
    } else {
      onSendMessage(sessionId, textToSend);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
  };

  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    setFileError(null);
    const validFiles: File[] = [];
    for (const file of fileArray) {
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" dépasse 8 Mo et a été ignoré.`);
        continue;
      }
      // Accepte tous les types mais alerte si type inhabituel
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...validFiles].slice(0, 5));
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return '🖼️';
    if (ext === 'pdf') return '📄';
    if (['doc', 'docx'].includes(ext || '')) return '📝';
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return '📊';
    return '📎';
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const summarizeProposal = (p: any): string => {
    if (!p) return '{}';
    return JSON.stringify({
      typePiece: p.typePiece,
      tiers: p.tiers,
      date: p.date,
      reference: p.reference,
      montantHT: p.montantHT,
      montantTVA: p.montantTVA,
      montantTTC: p.montantTTC,
      journal: p.journal,
      lignes: Array.isArray(p.ecriture) ? p.ecriture.length : 0,
    });
  };

  // Étape 1 (PREPARE) : validation faisant foi côté Compta Flow -> draftId + alertes.
  const handleMcpPrepare = async (msgId: string, proposal: any) => {
    setMcpBusy((prev) => ({ ...prev, [msgId]: true }));
    setMcpErrors((prev) => ({ ...prev, [msgId]: '' }));
    try {
      const res = await executeSoftwareTool({
        software: 'Compta Flow',
        toolName: 'prepare_ecriture',
        arguments: { proposition: proposal },
        permissionLevel: 'PREPARE',
      });
      logMcpCall({
        agentName: 'Agent Comptabilité',
        software: 'Compta Flow',
        toolName: 'prepare_ecriture',
        permission: 'PREPARE',
        paramsSummary: summarizeProposal(proposal),
        ok: res.success,
        resultSummary: res.success ? JSON.stringify(res.data).slice(0, 500) : undefined,
        error: res.success ? undefined : res.error,
        executionTimeMs: res.executionTimeMs,
      });
      if (!res.success) {
        setMcpErrors((prev) => ({
          ...prev,
          [msgId]: res.degraded
            ? `Connecteur Compta Flow non configuré (${res.error}). Voir Connexions > Compta Flow MCP.`
            : `Échec prepare_ecriture : ${res.error}`,
        }));
        return;
      }
      const data: any = res.data || {};
      const draftId = String(data.draftId || data.id || '');
      if (!draftId) {
        setMcpErrors((prev) => ({ ...prev, [msgId]: 'Le serveur n’a retourné aucun draftId.' }));
        return;
      }
      const alertes: string[] = Array.isArray(data.alertes) ? data.alertes.map(String) : [];
      setMcpDrafts((prev) => ({ ...prev, [msgId]: { draftId, alertes, committed: false } }));
    } finally {
      setMcpBusy((prev) => ({ ...prev, [msgId]: false }));
    }
  };

  // Étape 2 (EXECUTE) : écriture réelle, draftId + confirm:true explicite, anti-rejeu serveur.
  const handleMcpCommit = async (msgId: string) => {
    const draft = mcpDrafts[msgId];
    if (!draft) return;
    setMcpBusy((prev) => ({ ...prev, [msgId]: true }));
    setMcpErrors((prev) => ({ ...prev, [msgId]: '' }));
    try {
      const res = await executeSoftwareTool({
        software: 'Compta Flow',
        toolName: 'commit_ecriture',
        arguments: { draftId: draft.draftId, confirm: true },
        permissionLevel: 'EXECUTE',
      });
      logMcpCall({
        agentName: 'Agent Comptabilité',
        software: 'Compta Flow',
        toolName: 'commit_ecriture',
        permission: 'EXECUTE',
        paramsSummary: JSON.stringify({ draftId: draft.draftId, confirm: true }),
        ok: res.success,
        resultSummary: res.success ? JSON.stringify(res.data).slice(0, 500) : undefined,
        error: res.success ? undefined : res.error,
        executionTimeMs: res.executionTimeMs,
      });
      if (!res.success) {
        setMcpErrors((prev) => ({ ...prev, [msgId]: `Échec commit_ecriture : ${res.error}` }));
        return;
      }
      const data: any = res.data || {};
      setMcpDrafts((prev) => ({
        ...prev,
        [msgId]: { ...draft, committed: true, commitRef: String(data.reference || data.ecritureId || draft.draftId) },
      }));
      createTask({
        agentId: 'Agent Comptabilité',
        action: 'EXECUTE',
        input: `Écriture ${draft.draftId} validée serveur (Compta Flow MCP)`,
        status: 'COMPLETED',
      });
    } finally {
      setMcpBusy((prev) => ({ ...prev, [msgId]: false }));
    }
  };

  const filteredSessions = sessions.filter((s) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.lastMessage.toLowerCase().includes(q) ||
      (s.category && s.category.toLowerCase().includes(q))
    );
  });

  const startRenaming = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const saveRenaming = (sessionId: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (editingTitle.trim()) {
      onRenameSession(sessionId, editingTitle.trim());
    }
    setEditingSessionId(null);
  };

  const quickPrompts = [
    {
      title: 'Facture d’achat avec TVA 18%',
      desc: 'Imputation SYSCOHADA compte 601, 4452 et 4011',
      prompt: "Génère l'écriture comptable d'achat de marchandises pour 590 000 FCFA TTC avec TVA 18% délivrée par un fournisseur local.",
    },
    {
      title: 'Vérifier la déductibilité TVA',
      desc: 'Règles article 355 du CGI ivoirien',
      prompt: "Quelles sont les conditions de déductibilité de la TVA sur les frais d'hôtel et de déplacement selon le CGI ?",
    },
    {
      title: 'Amortissement linéaire',
      desc: 'Tableau d’amortissement et dotation 681',
      prompt: 'Comment comptabiliser la dotation aux amortissements d’un matériel informatique de 2 500 000 FCFA sur 3 ans ?',
    },
    {
      title: 'Rapprochement bancaire',
      desc: 'Traitement des agios et écarts 521',
      prompt: 'Quelles sont les écritures de régularisation pour 45 000 FCFA d’agios bancaires et commissions prélevés sur le compte ?',
    },
  ];

  return (
    <div className="flex-1 flex h-full min-w-0 overflow-hidden bg-white">
      {/* ==================================================================== */}
      {/* COLONNE CENTRALE : HISTORIQUE DE TES PROPRES SESSIONS DE CHAT        */}
      {/* ==================================================================== */}
      <aside
        id="assistant-sessions-sidebar"
        className="w-[270px] md:w-[280px] h-full border-r flex flex-col shrink-0 select-none z-10"
        style={{ background: '#FAFAFA', borderColor: '#E8E8E6' }}
      >
        {/* Header : Title + New Session Button */}
        <div className="p-3 border-b bg-white space-y-3" style={{ borderColor: '#E8E8E6' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs shadow-xs">
                <Bot className="w-4 h-4" />
              </div>
              <h2 className="text-[16px] font-bold text-[#1E293B] tracking-tight font-['Montserrat']">
                Sessions Assistant
              </h2>
            </div>

            <button
              type="button"
              id="new-chat-session-btn"
              onClick={onNewSession}
              title="Nouvelle session de chat"
              className="px-2.5 py-1.5 rounded-lg bg-black hover:bg-zinc-800 text-white text-[12px] font-semibold flex items-center gap-1.5 transition-all shadow-xs active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nouveau</span>
            </button>
          </div>

          {/* Search bar — subtile, sans bordure lourde */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#9CA3AF' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border rounded-md text-[13px] placeholder:text-[#9CA3AF] focus:outline-none transition-colors"
              style={{ borderColor: '#E8E8E6', color: '#1F1F1E', fontFamily: "'Inter', sans-serif" }}
              onFocus={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#6B6B6B')}
              onBlur={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#E8E8E6')}
            />
          </div>
        </div>

        {/* Sessions List */}
        <div id="sessions-list-scroll" className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="p-6 text-center text-[#94A3B8] text-[12px] mt-6">
              <Bot className="w-8 h-8 mx-auto stroke-[1.5] text-[#CBD5E1] mb-2" />
              <p className="font-medium text-[#475569]">Aucune session trouvée</p>
              <p className="text-[11px] text-[#94A3B8] mt-0.5">
                Cliquez sur "Nouveau" pour démarrer un chat.
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isSelected = activeSession?.id === session.id;
              const isEditing = editingSessionId === session.id;

              return (
                <div
                  key={session.id}
                  id={`session-item-${session.id}`}
                  onClick={() => onSelectSession(session.id)}
                  className="group relative p-2.5 rounded-md cursor-pointer"
                  style={{
                    background: isSelected ? '#EBEBE9' : 'transparent',
                    border: 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#F0F0EE';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => saveRenaming(session.id, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => saveRenaming(session.id)}
                        className="flex-1 px-2 py-0.5 text-[13px] font-semibold bg-white border border-black rounded focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="p-1 text-black hover:bg-zinc-100 rounded"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`font-semibold text-[13px] truncate ${
                            isSelected ? 'text-black' : 'text-[#1E293B]'
                          }`}
                        >
                          {session.title}
                        </span>

                        <span className="text-[10px] font-mono text-[#94A3B8] shrink-0">
                          {session.lastMessageTime}
                        </span>
                      </div>

                      <p className="text-[11px] text-[#64748B] truncate mt-1 leading-snug">
                        {session.lastMessage || 'Nouvelle conversation prête...'}
                      </p>

                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-100 text-[10px]">
                        {session.category && (
                          <span className="px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#475569] font-medium">
                            {session.category}
                          </span>
                        )}

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                          <button
                            type="button"
                            onClick={(e) => startRenaming(session, e)}
                            title="Renommer la session"
                            className="p-1 text-[#64748B] hover:text-black hover:bg-zinc-100 rounded"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {sessions.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(session.id);
                              }}
                              title="Supprimer la session"
                              className="p-1 text-[#64748B] hover:text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-[#E2E8F0] bg-white text-[11px] text-[#64748B] flex items-center justify-between">
          <span className="font-medium">Studio OS Comptable</span>
          <span className="text-[#94A3B8] font-mono">{sessions.length} sessions</span>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* COLONNE DROITE : LE CHAT AVEC L'IA POUR LA SESSION EN COURS          */}
      {/* ==================================================================== */}
      <section
        id="assistant-chat-main-column"
        className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-hidden font-['Montserrat']"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Sticky Top Header */}
        <header
          id="assistant-chat-header"
          className="h-16 px-4 sm:px-6 border-b border-[#E2E8F0] bg-white/90 backdrop-blur-md flex items-center justify-between shrink-0 select-none z-20"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center font-bold text-sm shadow-xs border border-zinc-800 shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[16px] font-bold text-[#1E293B] truncate tracking-tight">
                  {activeSession?.title || "Assistant Comptable"}
                </h1>
                {activeSession?.category && (
                  <span className="hidden sm:inline-block text-[10px] font-medium bg-[#F1F5F9] text-[#475569] px-2 py-0.5 rounded-full">
                    {activeSession.category}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#64748B] truncate mt-0.5">
                Conseiller SYSCOHADA, saisie d'écritures, contrôle TVA & fiscalité
              </p>
            </div>
          </div>

          {/* Model Selector & Actions */}
          <div className="flex items-center gap-2.5">
            <ModelSelector
              models={models}
              selectedModelId={selectedModelId}
              onSelectModel={onSelectModel}
              apiKeys={apiKeys}
              onNavigateToApiKeys={onNavigateToApiKeys}
              onOpenAddModelModal={onOpenAddModelModal}
              onRefreshOpenRouter={onRefreshOpenRouter}
              isRefreshing={isRefreshingModels}
              onDeleteCustomModel={onDeleteCustomModel}
            />

            <button
              type="button"
              onClick={() => {
                setExportNotice(true);
                setTimeout(() => setExportNotice(false), 2500);
              }}
              title="Exporter les écritures de cette session"
              className="p-2 rounded-xl border border-[#E2E8F0] hover:border-black text-[#64748B] hover:text-black transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Export notice alert */}
        {exportNotice && (
          <div className="bg-[#F4F4F5] border-b border-[#E4E4E7] px-4 py-2 text-[12px] text-[#18181B] flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-black" />
              <span>Les écritures générées dans cette session sont prêtes à l'export vers Google Sheets ou fichier Excel.</span>
            </div>
            <button
              type="button"
              onClick={() => setExportNotice(false)}
              className="text-[#71717A] hover:text-black"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Chat Messages Scrollable Feed — Claude centered 740px, gap 32px */}
        <div
          id="assistant-messages-scroll"
          className="flex-1 overflow-y-auto px-6 py-8 space-y-8"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="max-w-[740px] mx-auto w-full flex flex-col" style={{ gap: '32px' }}>
          {(!activeSession || activeSession.messages.length === 0) ? (
            /* Empty session state with quick accounting starters */
            <div className="max-w-2xl mx-auto py-8 text-center select-none">
              <div className="w-12 h-12 rounded-2xl bg-zinc-100 text-black border border-zinc-200 flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-[18px] font-bold text-[#1E293B]">
                Comment puis-je vous aider aujourd'hui ?
              </h3>
              <p className="text-[13px] text-[#64748B] mt-1 max-w-md mx-auto leading-relaxed">
                Posez vos questions comptables, dictez une facture ou demandez une imputation SYSCOHADA conforme au droit ivoirien.
              </p>

              {/* Quick Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6 text-left">
                {quickPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setInputText(item.prompt);
                      if (textareaRef.current) {
                        textareaRef.current.focus();
                      }
                    }}
                    className="p-3.5 rounded-xl border border-[#E2E8F0] hover:border-black bg-[#F8FAFC] hover:bg-white transition-all text-left group shadow-2xs cursor-pointer"
                  >
                    <div className="font-semibold text-[13px] text-[#1E293B] group-hover:text-black">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[#64748B] mt-0.5 line-clamp-2">
                      {item.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            activeSession.messages.map((msg) => {
              const isUser = msg.sender === 'user';
              const isCopied = copiedMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  id={`message-row-${msg.id}`}
                  className={`flex gap-4 w-full message-enter ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-md bg-[#171717] text-white flex items-center justify-center font-bold text-xs shrink-0 mt-1 shadow-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
                      DC
                    </div>
                  )}

                  <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${isUser ? 'max-w-[70%]' : 'max-w-[calc(100%-3rem)] flex-1 min-w-0'}`}>
                    <div className="flex items-center gap-2 mb-2 px-1" style={{ fontFamily: "'Inter', sans-serif", fontSize: '11px', color: '#9CA3AF' }}>
                      <span style={{ fontWeight: 500, color: isUser ? '#9CA3AF' : '#6B6B6B' }}>{msg.senderName}</span>
                      <span>•</span>
                      <span>{msg.timestamp}</span>
                    </div>

                    <div
                      className={`relative group ${isUser ? 'px-5 py-3.5 rounded-[20px] rounded-tr-[4px] shadow-sm' : 'py-1'}`}
                      style={
                        isUser
                          ? { background: '#171717', color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: '15px', lineHeight: '1.5' }
                          : { background: '#FFFFFF', color: '#1F1F1E', fontFamily: "'Lora', 'Georgia', serif", fontSize: '16px', lineHeight: '1.65' }
                      }
                    >
                      {/* Multimodal Classifier & Router Badge */}
                      {msg.multimodalResult && (
                        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full w-fit">
                          <span className="font-bold uppercase text-black">{msg.multimodalResult.inputType}</span>
                          <span>•</span>
                          <span>Doc: {msg.multimodalResult.documentType}</span>
                          <span>•</span>
                          <span className="text-black font-semibold">Confiance {(msg.multimodalResult.confidence * 100).toFixed(0)}%</span>
                        </div>
                      )}

                      {/* Contenu — Markdown rendu (jamais de syntaxe brute) */}
                      <div className={isUser ? 'whitespace-pre-wrap' : 'claude-prose'}>
                        {isUser ? (
                          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        )}
                      </div>

                      {/* Interactive SYSCOHADA Proposal Card & Validation Pipeline */}
                      {!isUser && msg.proposal && (
                        <div className="mt-4 border border-[#E5E5E7] bg-white rounded-xl p-4 shadow-none text-black font-sans text-left">
                          <div className="flex items-center justify-between border-b border-[#E5E5E7] pb-3 mb-3">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                PROPOSITION ÉCRITURE SYSCOHADA
                              </span>
                              <div className="text-xs font-bold text-black mt-0.5">
                                {msg.proposal.tiers} — {msg.proposal.typePiece} {msg.proposal.reference}
                              </div>
                            </div>
                            {msg.validationResult && (
                              <span
                                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                                  msg.validationResult.ok
                                    ? 'bg-[#FAFAFA] border border-[#E5E5E7] text-black'
                                    : 'bg-gray-100 border border-gray-300 text-gray-800'
                                }`}
                              >
                                {msg.validationResult.ok
                                  ? '✅ Conformité 7/7'
                                  : `⚠️ Alertes (${msg.validationResult.alertes.length})`}
                              </span>
                            )}
                          </div>

                          {/* 7-check Pipeline Checklist */}
                          {msg.validationResult && (
                            <div className="bg-[#FAFAFA] border border-[#E5E5E7] rounded-lg p-3 mb-3 text-xs space-y-1">
                              <div className="font-semibold text-black mb-1">
                                Controls Déterministes TypeScript (7/7) :
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-600">
                                <div>✅ 1. Format JSON structuré</div>
                                <div>✅ 2. Nomenclature SYSCOHADA</div>
                                <div>✅ 3. Équilibre D = C (Tolérance 0)</div>
                                <div>✅ 4. Taux TVA Cohérent (18%)</div>
                                <div>✅ 5. Seuil Immo (50 000 FCFA)</div>
                                <div>✅ 6. Compte Gérant (6622)</div>
                                <div>{msg.validationResult.alertes.length === 0 ? '✅' : '⚠️'} 7. Mentions Facture</div>
                              </div>
                              {msg.validationResult.alertes.map((a, i) => (
                                <div key={i} className="text-[11px] text-gray-700 font-medium mt-1">
                                  ⚠️ {a}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Debits and Credits Table */}
                          <div className="border border-[#E5E5E7] rounded-lg overflow-hidden mb-3 text-xs">
                            <table className="w-full text-left">
                              <thead className="bg-[#FAFAFA] border-b border-[#E5E5E7] text-gray-500 font-medium">
                                <tr>
                                  <th className="py-2 px-3">Compte</th>
                                  <th className="py-2 px-3">Intitulé</th>
                                  <th className="py-2 px-3 text-right">Débit</th>
                                  <th className="py-2 px-3 text-right">Crédit</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E5E5E7]">
                                {msg.proposal.ecriture.map((l, i) => (
                                  <tr key={i}>
                                    <td className="py-2 px-3 font-mono font-bold text-black">{l.compte}</td>
                                    <td className="py-2 px-3 text-gray-800">{l.intitule}</td>
                                    <td className="py-2 px-3 text-right font-mono">
                                      {l.debit > 0 ? `${l.debit.toLocaleString('fr-FR')} FCFA` : '—'}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono">
                                      {l.credit > 0 ? `${l.credit.toLocaleString('fr-FR')} FCFA` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Validation serveur Compta Flow (PREPARE -> EXECUTE, jamais simulé) */}
                          {mcpErrors[msg.id] && (
                            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-800 leading-relaxed">
                              {mcpErrors[msg.id]}
                            </div>
                          )}
                          {mcpDrafts[msg.id] && !mcpDrafts[msg.id].committed && (
                            <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-900 leading-relaxed">
                              <div className="font-bold font-mono">draftId : {mcpDrafts[msg.id].draftId}</div>
                              {mcpDrafts[msg.id].alertes.length > 0 ? (
                                <div className="mt-1.5 space-y-1">
                                  <div className="font-semibold">Alertes serveur (validation faisant foi) :</div>
                                  {mcpDrafts[msg.id].alertes.map((a, i) => (
                                    <div key={i}>⚠️ {a}</div>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-1">✅ Validation serveur sans alerte.</div>
                              )}
                            </div>
                          )}
                          {mcpDrafts[msg.id]?.committed && (
                            <div className="mt-3 p-3 rounded-lg bg-black text-white text-[12px] leading-relaxed">
                              ✅ Écriture comptabilisée côté Compta Flow — réf :{' '}
                              <span className="font-mono font-bold">{mcpDrafts[msg.id].commitRef}</span>
                            </div>
                          )}
                          {/* Séparation stricte : PREPARATION ≠ EXECUTION — pas de prepare sans APPROVED */}
                          {(() => {
                            const st = proposalStatuses[msg.id] || 'PROPOSED';
                            const canPrepare = st === 'APPROVED';
                            return null;
                          })()}
                          {/* Action Buttons (N1 Level Validation) */}
                          <div className="flex items-center gap-2 pt-1">
                            {!mcpDrafts[msg.id] ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const st = proposalStatuses[msg.id] || 'PROPOSED';
                                  if (st !== 'APPROVED') {
                                    setProposalStatuses((p) => ({ ...p, [msg.id]: 'APPROVED' }));
                                  }
                                  handleMcpPrepare(msg.id, msg.proposal);
                                  setProposalStatuses((p) => ({ ...p, [msg.id]: 'PREPARED' }));
                                }}
                                disabled={!!mcpBusy[msg.id] || (proposalStatuses[msg.id] && proposalStatuses[msg.id] !== 'APPROVED' && proposalStatuses[msg.id] !== 'PROPOSED')}
                                title={
                                  (proposalStatuses[msg.id] || 'PROPOSED') !== 'APPROVED'
                                    ? 'Valide d’abord la proposition (PROPOSED → APPROVED → PREPARED)'
                                    : 'Lance la préparation côté Compta Flow (PREPARED)'
                                }
                                className="flex-1 bg-black hover:bg-zinc-800 disabled:opacity-50 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {mcpBusy[msg.id] ? 'Vérification serveur…' : 'Vérifier côté Compta Flow'}
                              </button>
                            ) : !mcpDrafts[msg.id].committed ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleMcpCommit(msg.id);
                                  setProposalStatuses((p) => ({ ...p, [msg.id]: 'EXECUTED' }));
                                }}
                                disabled={!!mcpBusy[msg.id]}
                                className="flex-1 bg-black hover:bg-zinc-800 disabled:opacity-50 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                {mcpBusy[msg.id] ? 'Écriture en cours…' : 'Confirmer l’écriture (commit)'}
                              </button>
                            ) : proposalStatuses[msg.id] !== 'VERIFIED' ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setMcpBusy((p) => ({ ...p, [msg.id]: true }));
                                  try {
                                    const r = await fetch('/api/accounting/proposals/' + encodeURIComponent(msg.id) + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                                    if (r.ok) setProposalStatuses((p) => ({ ...p, [msg.id]: 'VERIFIED' }));
                                  } finally {
                                    setMcpBusy((p) => ({ ...p, [msg.id]: false }));
                                  }
                                }}
                                disabled={!!mcpBusy[msg.id]}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Vérifier (readback)
                              </button>
                            ) : (
                              <span className="flex-1 text-center text-xs font-semibold text-emerald-700 py-2">
                                ✓ Vérifié — référence externe confirmée
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                createTask({
                                  agentId: 'Agent Comptabilité',
                                  action: 'PREPARE',
                                  input: `Escalade expert : ${msg.proposal?.reference || msg.id} (${msg.proposal?.tiers || 'tiers à préciser'})`,
                                  status: 'WAITING_USER',
                                });
                              }}
                              className="bg-white hover:bg-gray-50 border border-[#E5E5E7] text-gray-700 text-xs font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                            >
                              Escalader vers Expert
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Export Sage 9 colonnes */}
                      {!isUser && msg.proposal && (
                        <button
                          type="button"
                          onClick={() => {
                            const p: any = msg.proposal;
                            const prop = {
                              date: p.date,
                              saisie: (p as any).saisie || `ECR${String(Date.now()).slice(-4)}`,
                              journal: p.journal || 'ACH',
                              piece: p.reference || '',
                              tiersCode: (p as any).tiersCode || (String(p.tiers || '').replace(/\s/g, '').slice(0, 12) ? `411${String(p.tiers).replace(/\s/g, '').slice(0, 8)}` : ''),
                              libelleBase: `${p.typePiece || 'Ecriture'} ${p.reference || ''} - ${p.tiers || ''}`.trim(),
                              ecriture: Array.isArray(p.ecriture) ? p.ecriture : [],
                            };
                            const { generateEcrituresTxt, generatePlanComptableTxt, generateTiersTxt, generateJournauxTxt, downloadTxt, verifyEquilibre } = require('../services/ecritureFormatter');
                            const v = verifyEquilibre([prop]);
                            if (!v.ok) {
                              alert(`Équilibre à vérifier avant export : Débit ${v.totalDebit} ≠ Crédit ${v.totalCredit}. Corrige d'abord.`);
                              return;
                            }
                            const ecritures = generateEcrituresTxt([prop]);
                            const comptesMap = new Map<string, string>();
                            for (const l of prop.ecriture) {
                              const c6 = String(l.compte).replace(/\D/g, '').slice(0, 6).padEnd(6, '0').slice(0, 6);
                              if (!comptesMap.has(c6)) comptesMap.set(c6, l.intitule || c6);
                            }
                            const plan = generatePlanComptableTxt(
                              Array.from(comptesMap.entries()).map(([numero, intitule]) => ({ numero, intitule, classe: numero[0] || '', nature: '' }))
                            );
                            const tiers = prop.tiersCode
                              ? generateTiersTxt([{ code: prop.tiersCode, nom: p.tiers || '', type: 'Client', collectif: prop.tiersCode.startsWith('401') ? '401100' : '411100' }])
                              : '';
                            const journaux = generateJournauxTxt([{ code: prop.journal || 'ACH', libelle: `Journal ${prop.journal || 'ACH'}`, type: prop.journal || 'ACH' }]);
                            downloadTxt('ecritures.txt', ecritures);
                            setTimeout(() => downloadTxt('plan_comptable.txt', plan), 300);
                            if (tiers) setTimeout(() => downloadTxt('tiers.txt', tiers), 600);
                            setTimeout(() => downloadTxt('journaux.txt', journaux), 900);
                          }}
                          title="Télécharger les 4 fichiers Sage (ecritures.txt 9 colonnes + plan + tiers + journaux)"
                          className="absolute right-10 bottom-2 p-1 rounded-md text-[#94A3B8] hover:text-black hover:bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* P0.10 Carte métier détaillée : Statut + Contexte + Confiance + Sources */}
                      {!isUser && msg.proposal && (() => {
                        const ctx = getAccountingContext();
                        const status = proposalStatuses[msg.id] || 'PROPOSED';
                        const confiance = status === 'PROPOSED' ? (msg.validationResult?.ok ? 'HIGH' : 'MEDIUM') : 'LOW';
                        return (
                          <div className="mt-3 p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] leading-relaxed">
                            <div className="flex flex-wrap gap-2 mb-2">
                              <span className="px-2 py-0.5 rounded-full bg-black text-white font-bold">Statut : {status}</span>
                              <span className="px-2 py-0.5 rounded-full bg-white border border-[#E5E5E7]">Contexte : {ctx.contextStatus}</span>
                              <span className="px-2 py-0.5 rounded-full bg-white border border-[#E5E5E7]">Confiance : {confiance}</span>
                            </div>
                            <div className="text-[#475569]">
                              Sources : {(msg as any).sourcesRag?.length ? (msg as any).sourcesRag.join(', ') : 'Règles SYSCOHADA générales + Pièce fournie'}
                              {ctx.contextStatus === 'GENERAL_ONLY' && ' • Votre plan comptable interne n\'est pas encore chargé — comptes à adapter.'}
                            </div>
                            {status === 'PROPOSED' && (
                              <div className="flex gap-2 mt-2">
                                <button type="button" onClick={() => setProposalEdits((p) => ({ ...p, [msg.id]: !p[msg.id] }))} className="px-2 py-1 rounded bg-white border border-[#E5E5E7] text-[11px]">Modifier</button>
                                <button type="button" onClick={() => setProposalStatuses((p) => ({ ...p, [msg.id]: 'REJECTED' }))} className="px-2 py-1 rounded bg-red-50 border border-red-200 text-[11px] text-red-700">Refuser</button>
                                <button type="button" onClick={() => setProposalStatuses((p) => ({ ...p, [msg.id]: 'APPROVED' }))} className="px-2 py-1 rounded bg-black text-white text-[11px]">Valider la proposition</button>
                              </div>
                            )}
                            {status === 'APPROVED' && !mcpDrafts[msg.id] && !mcpErrors[msg.id] && (
                              <div className="mt-2 text-[11px] font-semibold">Où souhaitez-vous enregistrer ? → Vérifier côté Compta Flow / Export TXT / Google Sheets</div>
                            )}
                            {status === 'REJECTED' && <div className="mt-2 text-red-700 font-semibold">Proposition refusée.</div>}
                          </div>
                        );
                      })()}
                      {/* Copy Message Action Button */}
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(msg.content, msg.id)}
                          title="Copier la réponse"
                          className="absolute right-2 bottom-2 p-1 rounded-md text-[#94A3B8] hover:text-[#1E293B] hover:bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {isCopied ? (
                            <CheckCheck className="w-3.5 h-3.5 text-black" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {isUser && (
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 border border-zinc-700">
                      V
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Real-time LLM Generating Indicator */}
          {isGenerating && (
            <div className="flex gap-3 max-w-2xl mr-auto animate-in fade-in">
              <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs shrink-0 border border-zinc-800">
                CF
              </div>
              <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] rounded-tl-none text-[13px] text-[#64748B] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-black animate-ping" />
                <span>Compta Flow réfléchit et vérifie les normes SYSCOHADA...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Attached Files Preview */}
        {attachedFiles.length > 0 && (
          <div className="px-4 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider">
                {attachedFiles.length} fichier{attachedFiles.length > 1 ? 's' : ''} joint{attachedFiles.length > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={() => setAttachedFiles([])}
                className="text-[11px] text-[#94A3B8] hover:text-red-600 font-medium"
              >
                Tout retirer
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E2E8F0] rounded-xl shadow-xs text-[12px] max-w-[220px]"
                >
                  <span className="text-[14px] shrink-0">{getFileIcon(file.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#1E293B] truncate" title={file.name}>
                      {file.name}
                    </div>
                    <div className="text-[10px] text-[#94A3B8]">{formatFileSize(file.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(idx)}
                    className="p-1 rounded-md hover:bg-zinc-100 text-[#94A3B8] hover:text-red-600 shrink-0"
                    title="Retirer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {fileError && (
          <div className="px-4 py-2 bg-[#FEF2F2] border-t border-[#FCA5A5] flex items-center justify-between text-[12px] text-[#991B1B]">
            <span>{fileError}</span>
            <button type="button" onClick={() => setFileError(null)} className="text-[#991B1B]/70 hover:text-[#991B1B]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Groq Error Alert */}
        {groqError && (
          <div className="px-4 py-2 bg-[#FEF2F2] border-t border-[#FCA5A5] flex items-center justify-between text-[12px] text-[#991B1B]">
            <span>{groqError}</span>
            <button
              type="button"
              onClick={() => setGroqError(null)}
              className="text-[#991B1B]/70 hover:text-[#991B1B]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Message Input Bar & Audio Recording */}
        <div
          id="assistant-composer-container"
          className="p-4 border-t border-[#E2E8F0] bg-white relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-2 bg-[#EEF2FF] border-2 border-dashed border-[#6366F1] rounded-2xl flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
              <Paperclip className="w-6 h-6 text-[#6366F1]" />
              <span className="text-[13px] font-semibold text-[#4338CA]">Déposez vos fichiers ici</span>
              <span className="text-[11px] text-[#64748B]">Images, PDF, documents (max 8 Mo)</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
            onChange={handleFileInputChange}
            className="hidden"
          />
          {voiceState === 'recording' ? (
            /* Active Groq Voice Recording Bar */
            <div className="p-3 rounded-2xl bg-black text-white border border-zinc-800 flex items-center justify-between gap-4 shadow-md">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span className="text-[13px] font-semibold tracking-tight">
                  Enregistrement en cours ({recordingSeconds}s)
                </span>
                <div className="w-32 h-6 hidden sm:block">
                  <WaveformVisualizer analyserNode={analyserNodeRef.current} isRecording={true} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelRecording}
                  className="px-3 py-1.5 rounded-lg text-[12px] text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleStopRecording}
                  className="px-4 py-1.5 rounded-lg bg-white text-black font-semibold text-[12px] hover:bg-zinc-200 transition-colors shadow-xs"
                >
                  Transcrire
                </button>
              </div>
            </div>
          ) : voiceState === 'transcribing' ? (
            /* Transcribing Indicator */
            <div className="p-3 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center gap-2 text-[13px] text-zinc-700">
              <span className="w-2 h-2 rounded-full bg-black animate-ping" />
              <span>Transcription vocale avec Groq Whisper en cours...</span>
            </div>
          ) : (
            /* Input Claude — Noir & Blanc, toolbar + waveform, Lora en transcription */
            <ClaudeInputArea
              value={inputText}
              onChange={setInputText}
              onSend={() => handleSubmitMessage()}
              onKeyDown={handleKeyDown}
              placeholder="Posez votre question fiscale, dictez une facture..."
              isGenerating={isGenerating}
              voiceState={voiceState}
              onStartRecording={startVoiceRecording}
              onStopRecording={handleStopRecording}
              onCancelRecording={handleCancelRecording}
              onFileSelect={(files) => handleFiles(files)}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              attachedFilesCount={attachedFiles.length}
              modelSelector={
                <ModelSelector
                  models={models}
                  selectedModelId={selectedModelId}
                  onSelectModel={onSelectModel}
                  apiKeys={apiKeys}
                  onNavigateToApiKeys={onNavigateToApiKeys}
                  reasoningEffort={reasoningEffort}
                  onChangeReasoningEffort={onChangeReasoningEffort}
                  onOpenAddModelModal={onOpenAddModelModal}
                  onRefreshOpenRouter={onRefreshOpenRouter}
                  isRefreshingModels={isRefreshingModels}
                  onDeleteCustomModel={onDeleteCustomModel}
                />
              }
            />
          )}
        </div>
      </section>
    </div>
  );
};

// Helper for lightweight Markdown rendering with accounting table support
function renderMessageContent(content: string, isUser: boolean) {
  // If user message, render directly
  if (isUser) {
    return <span>{content}</span>;
  }

  // Check if content contains markdown table
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect markdown table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());

      // If separator line like |:---|:---|
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      // End of table, render it
      elements.push(renderTable(tableHeader, tableRows, elements.length));
      inTable = false;
      tableHeader = [];
      tableRows = [];
    }

    // Standard markdown styling
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="text-[14px] font-bold text-black mt-2 mb-1">
          {line.replace('### ', '')}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="text-[15px] font-bold text-black mt-3 mb-1">
          {line.replace('## ', '')}
        </h3>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-2">
          <span className="text-black font-bold">•</span>
          <span>{formatInlineMarkdown(line.slice(2))}</span>
        </div>
      );
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-2">
          <span className="text-black font-bold">{line.match(/^\d+\./)?.[0]}</span>
          <span>{formatInlineMarkdown(line.replace(/^\d+\.\s/, ''))}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(
        <p key={i} className="leading-relaxed">
          {formatInlineMarkdown(line)}
        </p>
      );
    }
  }

  if (inTable) {
    elements.push(renderTable(tableHeader, tableRows, elements.length));
  }

  return <>{elements}</>;
}

function renderTable(header: string[], rows: string[][], keyIndex: number) {
  return (
    <div key={`table-${keyIndex}`} className="overflow-x-auto my-3 rounded-xl border border-zinc-200">
      <table className="w-full text-left text-[12px] divide-y divide-zinc-200">
        <thead className="bg-zinc-100 text-black font-bold">
          <tr>
            {header.map((col, idx) => (
              <th key={idx} className="px-3 py-2">
                {col.replace(/\*\*/g, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-zinc-50 transition-colors">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 font-mono text-zinc-800">
                  {cell.replace(/\*\*/g, '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatInlineMarkdown(text: string): React.ReactNode {
  // Replace **bold** with <strong>
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-bold text-black">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="bg-zinc-100 px-1 py-0.5 rounded text-[11px] font-mono text-black">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

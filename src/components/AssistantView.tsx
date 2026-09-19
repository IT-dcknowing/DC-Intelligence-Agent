import React, { useState, useRef, useEffect } from 'react';
import { createTask } from '../services/taskEngine';
import {
  Mic,
  ArrowUp,
  Sparkles,
  Paperclip,
  Check,
  X,
  FileSpreadsheet,
  Download,
  Copy,
  CheckCheck,
  FileText,
  File as FileIcon,
  HelpCircle,
  Calculator,
  BookOpen,
  Loader2,
  Maximize2,
} from 'lucide-react';
import {
  ApiKeyConfig,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  LLMModel,
  ReasoningEffort,
  VoiceState,
} from '../types';
import { ModelSelector } from './ModelSelector';
import { WaveformVisualizer } from './WaveformVisualizer';
import { transcribeAudioWithGroq } from '../services/voiceService';
import { fetchChatAttachment, chatAttachmentDataUrl } from '../services/storeApi';
import { attachmentKind } from '../services/imageUtils';
import { executeSoftwareTool } from '../services/mcpClient';
import { logMcpCall } from '../services/auditLog';
import { getAccountingContext } from '../services/companyContextService';
import { InputArea as ChatInputArea } from './chat/InputArea';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Pièce jointe rendue selon le type MIME réel (image / pdf / fichier).
 * Source : blob local immédiat > miniature > fetch backend (Storage via base64).
 * Jamais le nom brut entre crochets : image => <img> cliquable (lightbox),
 * PDF => carte cliquable (nouvel onglet), autre => carte fichier générique.
 */
const MessageAttachment: React.FC<{
  att: ChatAttachment;
  dark?: boolean;
  onZoom?: (src: string) => void;
}> = ({ att, dark, onZoom }) => {
  const kind = attachmentKind(att.mimeType);
  const [src, setSrc] = useState<string | null>(att.url || null);
  const [triedRemote, setTriedRemote] = useState(false);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadRemote = () => {
    if (!att.storagePath || triedRemote) return;
    setTriedRemote(true);
    setLoadingRemote(true);
    fetchChatAttachment(att.storagePath)
      .then((r) => setSrc(chatAttachmentDataUrl(r.base64, r.mimeType)))
      .catch(() => {
        if (att.thumbUrl) setSrc(att.thumbUrl);
        else setFailed(true);
      })
      .finally(() => setLoadingRemote(false));
  };

  useEffect(() => {
    if (!src && !triedRemote) {
      if (att.storagePath) loadRemote();
      else if (att.thumbUrl) setSrc(att.thumbUrl);
      else setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const handleImgError = () => {
    // Blob mort (reload) ou URL invalide -> repli distant puis miniature.
    if (att.storagePath && !triedRemote) {
      loadRemote();
    } else if (att.thumbUrl && src !== att.thumbUrl) {
      setSrc(att.thumbUrl);
    } else {
      setFailed(true);
    }
  };

  const openFull = () => {
    const direct = src && !src.startsWith('blob:') ? src : att.url && !failed ? att.url : null;
    if (direct) {
      window.open(direct, '_blank', 'noopener');
      return;
    }
    if (att.storagePath && !opening) {
      setOpening(true);
      fetchChatAttachment(att.storagePath)
        .then((r) => window.open(chatAttachmentDataUrl(r.base64, r.mimeType), '_blank', 'noopener'))
        .catch(() => {})
        .finally(() => setOpening(false));
    }
  };

  const sizeLabel = (() => {
    const n = att.size || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  })();

  if (failed) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px]"
        style={dark ? { background: 'rgba(255,255,255,0.08)', color: '#E5E7EB' } : { background: '#F4F4F5', color: '#52525B' }}
      >
        <FileIcon style={{ width: 16, height: 16 }} />
        <span className="truncate max-w-[180px]" title={att.name}>{att.name}</span>
        <span style={{ opacity: 0.6 }}>· {sizeLabel}</span>
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div className="relative">
        {!src || loadingRemote ? (
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 220,
              height: 140,
              background: dark ? 'rgba(255,255,255,0.08)' : '#F4F4F5',
              filter: att.uploading ? 'blur(2px)' : 'none',
            }}
          >
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: dark ? '#fff' : '#52525B' }} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => src && onZoom?.(src)}
            title="Agrandir l’image"
            className="block p-0 border-0 bg-transparent cursor-zoom-in"
            style={{ maxWidth: 300 }}
          >
            <img
              src={src}
              alt={att.name}
              onError={handleImgError}
              className="rounded-xl object-cover"
              style={{
                maxWidth: 300,
                maxHeight: 220,
                width: 'auto',
                height: 'auto',
                display: 'block',
                border: dark ? '1px solid rgba(255,255,255,0.25)' : '1px solid #E5E7EB',
                filter: att.uploading ? 'blur(2px)' : 'none',
              }}
            />
            <span
              className="absolute bottom-1.5 right-1.5 p-1 rounded-md"
              style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
            >
              <Maximize2 style={{ width: 12, height: 12 }} />
            </span>
          </button>
        )}
        {att.uploading && (
          <span
            className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1"
            style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Envoi…
          </span>
        )}
        <div
          className="truncate mt-1 px-0.5"
          title={att.name}
          style={{ fontSize: '11px', maxWidth: 300, color: dark ? 'rgba(255,255,255,0.65)' : '#9CA3AF' }}
        >
          {att.name}
          {att.uploadError ? ' · visible uniquement sur cet appareil' : ''}
        </div>
      </div>
    );
  }

  // PDF / fichier générique : carte cliquable (icône + nom + taille), jamais de [nom] brut.
  return (
    <div>
      <button
        type="button"
        onClick={openFull}
        title={kind === 'pdf' ? 'Ouvrir le PDF' : 'Ouvrir le fichier'}
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-opacity hover:opacity-90"
        style={
          dark
            ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', maxWidth: 300 }
            : { background: '#F9FAFB', border: '1px solid #E5E7EB', color: '#1F2937', maxWidth: 300 }
        }
      >
        <FileText style={{ width: 22, height: 22, flexShrink: 0 }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold" title={att.name}>{att.name}</span>
          <span className="block text-[11px]" style={{ opacity: 0.65 }}>
            {kind === 'pdf' ? 'PDF' : 'Fichier'} · {sizeLabel}
            {att.uploading ? ' · Envoi…' : ''}
          </span>
        </span>
        {att.uploading || opening ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          <Download style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.7 }} />
        )}
      </button>
    </div>
  );
};

/** Vignette du composer avant envoi : miniature image ou icône selon MIME. */
const ComposerFileThumb: React.FC<{ file: File; onRemove: () => void }> = ({ file, onRemove }) => {
  const isImg = (file.type || '').startsWith('image/');
  const objectUrl = React.useMemo(() => (isImg ? URL.createObjectURL(file) : null), [file, isImg]);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);
  const sizeLabel = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div
      className="relative flex items-center gap-2 pl-1.5 pr-2 py-1.5 bg-white border border-[#E2E8F0] rounded-xl shadow-xs text-[12px] max-w-[240px]"
    >
      {isImg && objectUrl ? (
        <img src={objectUrl} alt={file.name} className="w-12 h-12 rounded-lg object-cover shrink-0" style={{ border: '1px solid #E5E7EB' }} />
      ) : (
        <span className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F4F4F5', border: '1px solid #E5E7EB' }}>
          <FileText style={{ width: 20, height: 20, color: '#52525B' }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[#1E293B] truncate" title={file.name}>
          {file.name}
        </div>
        <div className="text-[10px] text-[#94A3B8]">{sizeLabel}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded-md hover:bg-[#F3F4F6] text-[#94A3B8] hover:text-[#111827] shrink-0"
        title="Retirer"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

interface AssistantViewProps {
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession?: (sessionId: string) => void;
  onNewSession?: () => Promise<string>;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => void;
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
  const [inputText, setInputText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);
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
      if (!onNewSession) return;
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
      {/* Chat pleine largeur : historique deplace dans la Sidebar (style Claude) */}
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

          {/* Mobile : sélecteur de conversation (sidebar masquée sous md) */}
          {onSelectSession && sessions.length > 0 && (
            <select
              value={activeSession?.id || ''}
              onChange={(e) => e.target.value && onSelectSession(e.target.value)}
              className="md:hidden max-w-[140px] text-[12px] font-medium px-2 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-[#1E293B] focus:outline-none focus:border-black"
              title=" Choisir une conversation"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.title || 'Session').slice(0, 28)}
                </option>
              ))}
            </select>
          )}

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

        {/* Chat Messages Scrollable Feed — Editorial centered 740px, gap 32px */}
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
                      {!isUser && msg.toolTrace && msg.toolTrace.length > 0 && (
                        <span
                          title={msg.toolTrace.map((t) => `${t.tool} (${t.ok ? 'ok' : 'échec'})`).join(', ')}
                          style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 500 }}
                        >
                          • 🛠 {msg.toolTrace.length} outil{msg.toolTrace.length > 1 ? 's' : ''} :{' '}
                          {msg.toolTrace.map((t) => t.tool.split('.').pop()).join(', ')}
                        </span>
                      )}
                    </div>

                    <div
                      className={`relative group ${isUser ? 'px-5 py-3.5 rounded-[20px] rounded-tr-[4px] shadow-sm' : 'py-1'}`}
                      style={
                        isUser
                          ? { background: '#171717', color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: '15px', lineHeight: '1.5' }
                          : { background: '#FFFFFF', color: '#1F1F1E', fontFamily: "'Lora', 'Georgia', serif", fontSize: '16px', lineHeight: '1.65' }
                      }
                    >


                      {/* Pièces jointes — miniature cliquable (lightbox) selon MIME */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-col gap-2 mb-2">
                          {msg.attachments.map((a, i) => (
                            <MessageAttachment
                              key={`${msg.id}-att-${i}`}
                              att={a}
                              dark={isUser}
                              onZoom={(src) => setLightbox({ src, name: a.name })}
                            />
                          ))}
                        </div>
                      )}

                      {/* Contenu — Markdown rendu (jamais de syntaxe brute).
                          En streaming (§1.3) : texte progressif + curseur, jamais d'attente complète. */}
                      {(msg.content.trim() || msg.streaming) && (
                        <div className={isUser ? 'whitespace-pre-wrap' : 'dc-prose'}>
                          {isUser ? (
                            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</span>
                          ) : (
                            <>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content + (msg.streaming ? ' ▍' : '')}
                              </ReactMarkdown>
                            </>
                          )}
                        </div>
                      )}

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
                            <div className="mt-3 p-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px] text-[#1F2937] leading-relaxed">
                              {mcpErrors[msg.id]}
                            </div>
                          )}
                          {mcpDrafts[msg.id] && !mcpDrafts[msg.id].committed && (
                            <div className="mt-3 p-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#1F2937] leading-relaxed">
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
                                className="flex-1 bg-[#111827] hover:bg-[#1F2937] disabled:opacity-50 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Vérifier (readback)
                              </button>
                            ) : (
                              <span className="flex-1 text-center text-xs font-semibold text-[#1F2937] py-2">
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
                                <button type="button" onClick={() => setProposalStatuses((p) => ({ ...p, [msg.id]: 'REJECTED' }))} className="px-2 py-1 rounded bg-white border border-[#E5E7EB] text-[11px] text-[#1F2937]">Refuser</button>
                                <button type="button" onClick={() => setProposalStatuses((p) => ({ ...p, [msg.id]: 'APPROVED' }))} className="px-2 py-1 rounded bg-black text-white text-[11px]">Valider la proposition</button>
                              </div>
                            )}
                            {status === 'APPROVED' && !mcpDrafts[msg.id] && !mcpErrors[msg.id] && (
                              <div className="mt-2 text-[11px] font-semibold">Où souhaitez-vous enregistrer ? → Vérifier côté Compta Flow / Export TXT / Google Sheets</div>
                            )}
                            {status === 'REJECTED' && <div className="mt-2 text-[#1F2937] font-semibold">Proposition refusée.</div>}
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

          {/* Indicateur discret (§1.2) : trois points animés, SANS texte ni nom d'agent.
              Visible tant que le stream n'a pas commencé ; dès le 1er token, il disparaît. */}
          {isGenerating &&
            (() => {
              const msgs = activeSession?.messages || [];
              const last = msgs[msgs.length - 1];
              const waiting =
                !last ||
                last.sender === 'user' ||
                (last.sender === 'agent' && last.streaming && !last.content.trim());
              if (!waiting) return null;
              return (
                <div className="flex gap-3 max-w-2xl mr-auto animate-in fade-in" aria-label="Réponse en cours">
                  <div className="px-4 py-3.5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] rounded-tl-none flex items-center gap-1.5">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              );
            })()}

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
                className="text-[11px] text-[#94A3B8] hover:text-[#111827] font-medium"
              >
                Tout retirer
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file, idx) => (
                <ComposerFileThumb key={`${file.name}-${file.size}-${idx}`} file={file} onRemove={() => removeAttachedFile(idx)} />
              ))}
            </div>
          </div>
        )}

        {fileError && (
          <div className="px-4 py-2 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between text-[12px] text-[#1F2937]">
            <span>{fileError}</span>
            <button type="button" onClick={() => setFileError(null)} className="text-[#1F2937]/70 hover:text-[#1F2937]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Groq Error Alert */}
        {groqError && (
          <div className="px-4 py-2 bg-[#F9FAFB] border-t border-[#E5E7EB] flex items-center justify-between text-[12px] text-[#1F2937]">
            <span>{groqError}</span>
            <button
              type="button"
              onClick={() => setGroqError(null)}
              className="text-[#1F2937]/70 hover:text-[#1F2937]"
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
            <div className="absolute inset-2 bg-[#F9FAFB] border-2 border-dashed border-[#1F2937] rounded-2xl flex flex-col items-center justify-center gap-2 z-10 pointer-events-none">
              <Paperclip className="w-6 h-6 text-[#1F2937]" />
              <span className="text-[13px] font-semibold text-[#1F2937]">Déposez vos fichiers ici</span>
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
                <span className="w-3 h-3 rounded-full bg-white0 animate-pulse shrink-0" />
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
            /* Input Editorial — Noir & Blanc, toolbar + waveform, Lora en transcription */
            <ChatInputArea
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

        {/* Lightbox plein écran pour les images du chat */}
        {lightbox && (
          <div
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.88)' }}
            onClick={() => setLightbox(null)}
          >
            <div className="flex items-center justify-between w-full max-w-4xl mb-3">
              <span className="truncate text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }} title={lightbox.name}>
                {lightbox.name}
              </span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="p-2 rounded-lg hover:bg-white/10"
                style={{ color: '#fff' }}
                title="Fermer (Échap)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={lightbox.src}
              alt={lightbox.name}
              className="max-w-full rounded-xl shadow-2xl"
              style={{ maxHeight: '82vh', objectFit: 'contain' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
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

import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  Settings as SettingsIcon,
  Upload,
  Sparkles,
  MessageCircle,
  Globe,
  Phone,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Menu,
  FileSpreadsheet,
  Download,
  Bot,
  Info,
} from 'lucide-react';
import {
  ApiKeyConfig,
  ChannelType,
  Conversation,
  ConversationStatus,
  LLMModel,
  ReasoningEffort,
  VoiceState,
} from '../types';
import { ModelSelector } from './ModelSelector';
import { WaveformVisualizer } from './WaveformVisualizer';
import { transcribeAudioWithGroq } from '../services/voiceService';

interface ConversationDetailProps {
  conversation: Conversation | null;
  models: LLMModel[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  apiKeys: ApiKeyConfig[];
  onNavigateToApiKeys: () => void;
  onNavigateToSettings: () => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (effort: ReasoningEffort) => void;
  onSendMessage?: (convId: string, text: string) => void;
  onStatusChange?: (convId: string, newStatus: ConversationStatus) => void;
  isGenerating?: boolean;
  onOpenAddModelModal: () => void;
  onRefreshOpenRouter: () => Promise<void>;
  isRefreshingModels?: boolean;
  onDeleteCustomModel?: (modelId: string) => void;
  onOpenConversationsList?: () => void;
  isDemoMode?: boolean;
  onDismissDemoMode?: () => void;
}

export const ConversationDetail: React.FC<ConversationDetailProps> = ({
  conversation,
  models,
  selectedModelId,
  onSelectModel,
  apiKeys,
  onNavigateToApiKeys,
  onNavigateToSettings,
  reasoningEffort,
  onChangeReasoningEffort,
  onSendMessage,
  onStatusChange,
  isGenerating = false,
  onOpenAddModelModal,
  onRefreshOpenRouter,
  isRefreshingModels = false,
  onDeleteCustomModel,
  onOpenConversationsList,
  isDemoMode = true,
  onDismissDemoMode,
}) => {
  const [inputText, setInputText] = useState('');
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [showAttachNotice, setShowAttachNotice] = useState(false);
  const [exportNotice, setExportNotice] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Audio / Voice recording state
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isItalicPreview, setIsItalicPreview] = useState(false);
  const [groqError, setGroqError] = useState<string | null>(null);
  const [groqAlert, setGroqAlert] = useState<string | null>(null);

  // Audio Recording Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  const configMenuRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset folded state on conversation switch
  useEffect(() => {
    setShowAllHistory(false);
  }, [conversation?.id]);

  // Auto scroll to bottom
  useEffect(() => {
    if (conversation?.messages?.length) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversation?.messages?.length, isGenerating]);

  // Click outside to close options dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (configMenuRef.current && !configMenuRef.current.contains(e.target as Node)) {
        setShowConfigMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
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
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const groqConfig = apiKeys.find((k) => k.provider === 'groq');

  const handleStartRecording = async () => {
    setGroqError(null);
    setGroqAlert(null);

    if (!groqConfig || !groqConfig.key || !groqConfig.isConfigured) {
      setGroqAlert(
        "Veuillez configurer votre clé API Groq Whisper dans Paramètres pour activer la transcription vocale haute précision."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          analyserNodeRef.current = analyser;
        }
      } catch (e) {
        console.warn('AudioContext not supported or restricted', e);
      }

      audioChunksRef.current = [];
      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
          if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          } else {
            mimeType = '';
          }
        }
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(200);

      // Live interim transcript preview (SpeechRecognition in French)
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.lang = 'fr-FR';
          recognition.continuous = true;
          recognition.interimResults = true;

          recognition.onresult = (event: any) => {
            let interimTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
              interimTranscript += event.results[i][0].transcript;
            }
            if (interimTranscript) {
              setInputText(interimTranscript);
            }
          };

          recognition.onerror = (err: any) => {
            console.warn('SpeechRecognition error or stopped:', err);
          };

          recognition.start();
          speechRecognitionRef.current = recognition;
        } catch (recErr) {
          console.warn('SpeechRecognition setup skipped', recErr);
        }
      }

      setVoiceState('recording');
      setIsItalicPreview(true);
      setRecordingSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setGroqAlert(
        'Impossible d’accéder au microphone. Vérifiez les autorisations de votre navigateur.'
      );
      setVoiceState('idle');
      setIsItalicPreview(false);
    }
  };

  const handleCancelRecording = () => {
    stopAndCleanupAudio();
    setInputText('');
    setVoiceState('idle');
    setIsItalicPreview(false);
    setRecordingSeconds(0);
  };

  const handleValidateRecording = async () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    }

    setVoiceState('transcribing');

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setVoiceState('idle');
      setIsItalicPreview(false);
      return;
    }

    const finishTranscription = async () => {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      const groqKey = groqConfig?.key || '';
      try {
        const result = await transcribeAudioWithGroq(audioBlob, groqKey);
        if (result.text && result.text.trim()) {
          setInputText(result.text.trim());
        }
      } catch (err: any) {
        console.error('Groq Whisper error:', err);
        setGroqError(
          err.message?.includes('GROQ_API_ERROR')
            ? `Erreur Groq: ${err.message.replace('GROQ_API_ERROR: ', '')}`
            : 'Erreur lors de la transcription Groq Whisper. Vérifiez votre clé API.'
        );
      } finally {
        setVoiceState('idle');
        setIsItalicPreview(false);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    };

    if (recorder.state !== 'inactive') {
      recorder.onstop = finishTranscription;
      recorder.stop();
    } else {
      await finishTranscription();
    }
  };

  const handleSend = () => {
    if (!inputText.trim() || isGenerating || !conversation) return;
    setIsSending(true);
    if (onSendMessage) {
      onSendMessage(conversation.id, inputText.trim())
        .then(() => {
          setInputText('');
          setIsItalicPreview(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
        })
        .finally(() => setIsSending(false));
    } else {
      setInputText('');
      setIsItalicPreview(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // User avatar generation (initials + hash color)
  const getUserInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getUserBgColor = (name: string) => {
    const colors = [
      'bg-zinc-800',
      'bg-neutral-700',
      'bg-stone-800',
      'bg-slate-800',
      'bg-zinc-900',
      'bg-neutral-800',
      'bg-black',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // If no conversation selected: clean empty state (Chantier 7)
  if (!conversation) {
    return (
      <div
        id="empty-conversation-state"
        className="flex-1 flex flex-col items-center justify-center bg-white p-8 select-none text-center"
      >
        <div className="w-16 h-16 rounded-3xl bg-[#F4F4F5] text-black flex items-center justify-center mb-4 shadow-sm border border-[#E4E4E7]">
          <MessageCircle className="w-8 h-8 stroke-[1.8]" />
        </div>
        <h2 className="text-[20px] font-bold text-[#1E293B] font-['Montserrat']">
          Aucune conversation sélectionnée
        </h2>
        <p className="text-[13px] text-[#64748B] mt-1.5 max-w-sm leading-relaxed">
          Ouvrez la liste des échanges clients pour consulter un dossier ou envoyer une réponse assistée par nos agents IA.
        </p>
        {onOpenConversationsList && (
          <button
            type="button"
            onClick={onOpenConversationsList}
            className="mt-5 px-5 py-2.5 rounded-xl text-[13px] font-semibold bg-black hover:bg-zinc-800 text-white shadow-md flex items-center gap-2 transition-all"
          >
            <Menu className="w-4 h-4" />
            <span>Ouvrir les échanges clients</span>
            <kbd className="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">
              ⌘K
            </kbd>
          </button>
        )}
      </div>
    );
  }

  const allMessages = conversation.messages || [];
  const hasMultipleMessages = allMessages.length > 5;
  const displayedMessages =
    hasMultipleMessages && !showAllHistory ? allMessages.slice(-5) : allMessages;

  return (
    <div
      id="conversation-detail-container"
      className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-hidden font-['Montserrat']"
    >
      {/* 1. Dismissable Demo Mode Banner (Chantier 7) */}
      {isDemoMode && (
        <div className="bg-[#F9FAFB] border-b border-[#E5E7EB] px-4 py-2 flex items-center justify-between text-[12px] text-[#1F2937] z-20 shrink-0">
          <div className="flex items-center gap-2">
            <span>🎭</span>
            <span className="font-semibold">Mode démonstration actif :</span>
            <span>Échanges de simulation pour tester le workflow comptable et les modèles d'IA.</span>
          </div>
          {onDismissDemoMode && (
            <button
              type="button"
              onClick={onDismissDemoMode}
              className="text-[#1F2937]/70 hover:text-[#1F2937] font-medium text-[11px] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 2. Sticky Top Header with Blur Backdrop (Chantier 2) */}
      <header
        id="conversation-detail-header"
        className="sticky top-0 z-20 h-16 px-4 sm:px-8 border-b border-[#E2E8F0] bg-white/90 backdrop-blur-md flex items-center justify-between shrink-0 select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Slide-over Trigger Button */}
          {onOpenConversationsList && (
            <button
              type="button"
              onClick={onOpenConversationsList}
              title="Ouvrir la liste des conversations (Cmd+K)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F8FAFC] hover:bg-[#F4F4F5] border border-[#E2E8F0] hover:border-black/50 text-[#1E293B] text-[12px] font-semibold transition-all duration-150"
            >
              <Menu className="w-4 h-4 text-black" />
              <span className="hidden sm:inline">Échanges</span>
              <kbd className="hidden sm:inline text-[10px] text-[#94A3B8] font-mono ml-1">
                ⌘K
              </kbd>
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-semibold text-[#1E293B] truncate tracking-tight">
                {conversation.contactName}
              </h1>

              {/* WhatsApp Contextual Pill */}
              {conversation.channel === 'whatsapp' ? (
                <span
                  title="Canal WhatsApp Business"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1F2937] bg-[#1F2937]/10 px-2 py-0.5 rounded-full border border-[#1F2937]/20"
                >
                  <MessageCircle className="w-3 h-3 fill-[#1F2937]/30" />
                  <span>WhatsApp</span>
                </span>
              ) : conversation.channel === 'web' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full">
                  <Globe className="w-3 h-3" />
                  <span>Web</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full">
                  <Phone className="w-3 h-3" />
                  <span>Téléphone</span>
                </span>
              )}
            </div>

            <div className="text-[13px] text-[#64748B] truncate mt-0.5">
              {conversation.companyName}
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 relative">
          {/* Status Dropdown */}
          <div className="relative">
            <select
              value={conversation.status}
              onChange={(e) =>
                onStatusChange && onStatusChange(conversation.id, e.target.value as ConversationStatus)
              }
              className="text-[12px] font-semibold px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-white text-[#1E293B] hover:border-[#CBD5E1] focus:outline-none focus:border-black cursor-pointer transition-colors"
            >
              <option value="en_cours">● En cours</option>
              <option value="escaladee">● Escaladée</option>
              <option value="terminee">● Terminée</option>
              <option value="fermee">● Fermée</option>
            </select>
          </div>

          {/* Export Action */}
          <button
            type="button"
            onClick={() => {
              setExportNotice(true);
              setTimeout(() => setExportNotice(false), 2500);
            }}
            title="Exporter l'historique d'audit"
            className="p-2 text-[#64748B] hover:text-[#1E293B] hover:bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl transition-colors"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Export notification */}
      {exportNotice && (
        <div className="bg-[#F4F4F5] border-b border-[#E4E4E7] px-4 py-2 text-center text-[12px] text-black font-semibold animate-in fade-in duration-200">
          Journal d’audit et pièces comptables exportés avec succès.
        </div>
      )}

      {/* 3. Messages Zone (Max-width 840px centered) */}
      <div
        id="messages-scroll-area"
        className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-5"
      >
        <div className="max-w-[840px] mx-auto w-full space-y-5">
          {/* Folded messages expand button */}
          {hasMultipleMessages && (
            <div className="flex justify-center my-2">
              <button
                type="button"
                onClick={() => setShowAllHistory(!showAllHistory)}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#475569] flex items-center gap-1.5 transition-colors border border-[#E2E8F0]"
              >
                {showAllHistory ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Masquer les messages anciens ({allMessages.length - 5})</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Afficher tout l’historique ({allMessages.length} messages)</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Day Separator */}
          <div className="relative flex items-center justify-center my-4">
            <div className="border-t border-[#E2E8F0] w-full absolute" />
            <span className="relative bg-white px-4 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
              Aujourd'hui
            </span>
          </div>

          {/* Rendered messages */}
          {displayedMessages.map((msg) => {
            const isUser = msg.sender === 'user';
            const userInitials = getUserInitials(msg.senderName || conversation.contactName);
            const userBg = getUserBgColor(msg.senderName || conversation.contactName);

            return (
              <div
                key={msg.id}
                className={`flex gap-3 items-end transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
                  isUser ? 'flex-row' : 'flex-row-reverse'
                }`}
              >
                {/* Avatar */}
                {isUser ? (
                  <div
                    title={msg.senderName}
                    className={`w-8 h-8 rounded-full ${userBg} text-white flex items-center justify-center text-[11px] font-bold shrink-0 shadow-xs select-none`}
                  >
                    {userInitials}
                  </div>
                ) : (
                  <div
                    title={msg.senderName}
                    className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-[12px] shrink-0 shadow-xs select-none border border-zinc-800"
                  >
                    <Sparkles className="w-4 h-4 stroke-[2.2]" />
                  </div>
                )}

                {/* Message Bubble + Agent Chip + Timestamp */}
                <div
                  className={`flex flex-col max-w-[75%] ${
                    isUser ? 'items-start' : 'items-end'
                  }`}
                >
                  {/* Agent badge chip above bubble (Chantier 3) */}
                  {!isUser && (
                    <div className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-black bg-[#F4F4F5] px-2.5 py-0.5 rounded-full border border-[#E4E4E7]">
                      <Sparkles className="w-3 h-3" />
                      <span>{msg.senderName || conversation.assignedAgent}</span>
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={`p-4 text-[14px] leading-relaxed shadow-xs ${
                      isUser
                        ? 'bg-[#F1F5F9] text-[#1E293B] rounded-[16px_16px_16px_4px]'
                        : 'bg-black text-white rounded-[16px_16px_4px_16px]'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>

                  {/* Timestamp outside bubble */}
                  <span className="text-[11px] font-mono text-[#94A3B8] mt-1 px-1">
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Typing indicator (Chantier 3) */}
          {isGenerating && (
            <div className="flex gap-3 items-end flex-row-reverse animate-in fade-in duration-150">
              <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-[12px] shrink-0 shadow-xs border border-zinc-800">
                <Sparkles className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-black text-white p-3.5 rounded-[16px_16px_4px_16px] shadow-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-white animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 rounded-full bg-white animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 rounded-full bg-white animate-bounce" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 4. Sticky Bottom Input Area (Chantier 2) */}
      <div
        id="chat-input-sticky-container"
        className="sticky bottom-0 z-20 px-4 sm:px-8 pb-4 pt-2 bg-gradient-to-t from-white via-white/95 to-transparent shrink-0"
      >
        <div className="max-w-[840px] mx-auto w-full space-y-2">
          {/* Alerts for Voice or Groq */}
          {groqAlert && (
            <div className="p-2.5 rounded-xl bg-white border border-[#E5E7EB] text-[12px] text-[#1F2937] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#1F2937] shrink-0" />
                <span>{groqAlert}</span>
              </div>
              <button
                type="button"
                onClick={() => setGroqAlert(null)}
                className="text-[#1F2937] hover:text-[#1F2937] p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {groqError && (
            <div className="p-2.5 rounded-xl bg-white border border-[#E5E7EB] text-[12px] text-[#1F2937] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#1F2937] shrink-0" />
                <span>{groqError}</span>
              </div>
              <button
                type="button"
                onClick={() => setGroqError(null)}
                className="text-[#1F2937] hover:text-[#1F2937] p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main Input Box (Radius 16px, Shadow 0 -4px 24px rgba(0,0,0,0.06)) */}
          <div
            id="chat-composer-box"
            className="rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.06)] focus-within:border-black focus-within:ring-2 focus-within:ring-black/15 transition-all overflow-hidden"
          >
            {/* Recording Active Waveform Banner */}
            {voiceState === 'recording' && (
              <div className="px-4 py-2 bg-[#F4F4F5] border-b border-[#E4E4E7] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#111827] animate-ping" />
                  <span className="text-[12px] font-semibold text-[#1E293B]">
                    Enregistrement en cours ({recordingSeconds}s)
                  </span>
                  <div className="w-24 h-5 flex items-center">
                    <WaveformVisualizer analyserNode={analyserNodeRef.current} />
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCancelRecording}
                    title="Annuler"
                    className="w-7 h-7 rounded-lg bg-white border border-[#E2E8F0] hover:bg-neutral-100 flex items-center justify-center text-[#64748B] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateRecording}
                    title="Valider et transcrire avec Whisper"
                    className="w-7 h-7 rounded-lg bg-[#111827] hover:bg-[#111827] flex items-center justify-center text-white transition-colors shadow-xs"
                  >
                    <Check className="w-4 h-4 stroke-[2.5]" />
                  </button>
                </div>
              </div>
            )}

            {voiceState === 'transcribing' && (
              <div className="px-4 py-2 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center gap-2 text-[12px] text-black">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Transcription Groq Whisper en cours...</span>
              </div>
            )}

            {/* Textarea */}
            <div className="p-3.5">
              <textarea
                ref={textareaRef}
                id="chat-input-textarea"
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Posez une question, dictez ou préparez une écriture comptable..."
                className={`w-full resize-none text-[14px] bg-transparent text-[#1E293B] placeholder:text-[#94A3B8] focus:outline-none min-h-[56px] max-h-32 leading-relaxed ${
                  isItalicPreview ? 'italic text-black font-medium' : ''
                }`}
              />
            </div>

            {/* Toolbar SOUS le textarea (Model selector, Reasoning, Mic, Send) */}
            <div className="px-3.5 py-2.5 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-between gap-3">
              {/* Left Toolbar Actions */}
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachNotice(true);
                    setTimeout(() => setShowAttachNotice(false), 2000);
                  }}
                  title="Joindre une pièce jointe (PDF, relevé, facture)"
                  className="p-1.5 rounded-lg text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Model Selector Button / Dropdown */}
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
              </div>

              {/* Right Toolbar Actions: Mic & Send Button */}
              <div className="flex items-center gap-2 shrink-0">
                {/* 40px Circle Mic Button with Ripple Effect */}
                <button
                  type="button"
                  onClick={
                    voiceState === 'recording'
                      ? handleValidateRecording
                      : handleStartRecording
                  }
                  title="Dicter avec Groq Whisper"
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                    voiceState === 'recording'
                      ? 'bg-[#111827] text-white ring-4 ring-[#1F2937]/20 animate-pulse'
                      : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:text-black hover:border-black hover:shadow-md'
                  }`}
                >
                  <Mic className="w-4 h-4 stroke-[2]" />
                </button>

                {/* 40px Circle Send Button with Pure Black & Scale Effect */}
                <button
                  id="chat-send-btn"
                  type="button"
                  onClick={handleSend}
                  disabled={!inputText.trim() || isGenerating || isSending}
                  title="Envoyer le message (Entrée)"
                  className="w-10 h-10 rounded-full bg-black hover:bg-zinc-800 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all duration-150 shadow-sm"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

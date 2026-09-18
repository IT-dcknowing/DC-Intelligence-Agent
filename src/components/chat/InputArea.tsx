import React, { useRef, useEffect } from 'react';
import { Paperclip, Mic, Plus } from 'lucide-react';

/**
 * InputArea — Editorial style, Noir & Blanc
 * - Floating card : rounded 16-24, border #E8E8E6, shadow 0_2px_15px rgba(0,0,0,0.04), focus #9CA3AF
 * - Toolbar bas : gauche + , droite modèle + micro + envoyer
 * - Textarea auto-extensible 52→200px, Placeholder court, Inter 15px
 * - Mode Enregistrement : waveform (8 barres, animation sound), italique gris, ❌/✓
 * Micro-interactions : scale 0.98 au clic, transitions 0.15s, focus outline 2px #171717
 */

interface InputAreaProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  isGenerating?: boolean;
  disabled?: boolean;
  // Fichiers
  onFileSelect?: (files: FileList) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  // Voice
  voiceState: 'idle' | 'recording' | 'transcribing';
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  recordingSeconds?: number;
  // Modèle & divers
  modelName?: string;
  modelSelector?: React.ReactNode;
  attachedFilesCount?: number;
  onAttachClick?: () => void;
}

export const InputArea: React.FC<InputAreaProps> = ({
  value,
  onChange,
  onSend,
  onKeyDown,
  placeholder = 'Posez votre question fiscale...',
  isGenerating,
  disabled,
  onFileSelect,
  onDrop,
  onDragOver,
  onDragLeave,
  voiceState,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  modelName = 'Ling 3.0',
  modelSelector,
  attachedFilesCount = 0,
  onAttachClick,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize 52→200
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);

  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';
  const canSend = (value.trim().length > 0 || attachedFilesCount > 0) && !isGenerating && !isRecording;

  // Enregistrement : onStop = transcrire, onCancel = vider
  // Le parent gère le switch d'UI ; ici on reflète l'état isRecording

  return (
    <div
      className="w-full"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Carte flottante — arrondie, ombrée, focus subtil */}
      <div
        className="flex flex-col bg-white border rounded-2xl overflow-hidden transition-all"
        style={{
          borderColor: isRecording ? '#E8E8E6' : '#E8E8E6',
          boxShadow: '0 2px 15px rgba(0,0,0,0.04)',
          borderRadius: '16px',
        }}
        onFocusCapture={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = '#9CA3AF';
          el.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';
        }}
        onBlurCapture={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          el.style.borderColor = '#E8E8E6';
          el.style.boxShadow = '0 2px 15px rgba(0,0,0,0.04)';
        }}
      >
        {/* Input caché pour + */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
          onChange={(e) => e.target.files && onFileSelect?.(e.target.files)}
          className="hidden"
          aria-hidden
        />

        {/* Textarea — Lora quand transcription, Inter sinon */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={isRecording ? 'Écoute en cours...' : isTranscribing ? 'Transcription...' : placeholder}
          disabled={isTranscribing}
          aria-label="Message à l'assistant"
          className={`w-full bg-transparent pt-3.5 pb-2 px-4 resize-none max-h-[200px] leading-relaxed focus:outline-none ${
            isRecording || isTranscribing ? 'is-transcribing' : ''
          }`}
          style={{
            fontFamily: isRecording || isTranscribing ? "'Lora', serif" : "'Inter', sans-serif",
            fontSize: '15px',
            lineHeight: '1.5',
            color: isRecording || isTranscribing ? '#6B6B6B' : '#1F1F1E',
            minHeight: '52px',
          }}
        />

        {/* Barre d'outils — gauche +, droite modèle + micro + envoyer */}
        <div className="flex justify-between items-center px-2 pb-2 pt-1">
          {/* Gauche */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Joindre un fichier"
              className="p-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: '#9CA3AF', transition: 'all 0.15s ease' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#171717'; (e.currentTarget as HTMLButtonElement).style.background = '#F0F0EE'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9CA3AF'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <Plus style={{ width: 18, height: 18, strokeWidth: 1.75 }} />
            </button>
            {onAttachClick && (
              <button
                type="button"
                onClick={onAttachClick}
                aria-label="Pièce jointe"
                className="p-1.5 rounded-lg hidden sm:flex"
                style={{ color: '#9CA3AF' }}
              >
                <Paperclip style={{ width: 16, height: 16 }} />
              </button>
            )}

          </div>

          {/* Droite — deux modes : normal vs enregistrement */}
          {!isRecording ? (
            <div className="flex items-center gap-1.5">
              {modelSelector ? (
                <span className="hidden sm:block">{modelSelector}</span>
              ) : (
                <span className="hidden sm:block text-xs font-medium px-2" style={{ color: '#9CA3AF', fontSize: '12px' }}>
                  {modelName}
                </span>
              )}
              <button
                type="button"
                onClick={onStartRecording}
                aria-label="Dicter (transcription vocale)"
                className="p-2 rounded-lg transition-colors cursor-pointer"
                style={{ color: '#6B6B6B', transition: 'all 0.15s ease' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#F0F0EE'; (e.currentTarget as HTMLButtonElement).style.color = '#171717'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#6B6B6B'; }}
              >
                <Mic style={{ width: 16, height: 16 }} />
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="Envoyer le message"
                className="p-2 rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
                style={{
                  background: canSend ? '#171717' : '#E8E8E6',
                  color: canSend ? '#FFFFFF' : '#9CA3AF',
                  transform: canSend ? 'scale(1)' : 'scale(1)',
                  transition: 'all 0.15s ease',
                }}
                onMouseDown={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)'; }}
                onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
              >
                <ArrowUp style={{ width: 16, height: 16, strokeWidth: 2.2 }} />
              </button>
            </div>
          ) : (
            /* Mode enregistrement : waveform + Annuler / Valider */
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-[3px] h-6 px-3" aria-hidden>
                <div className="waveform-bar" style={{ animationDuration: '474ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '433ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '407ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '458ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '400ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '427ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '441ms' }} />
                <div className="waveform-bar" style={{ animationDuration: '419ms' }} />
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={onCancelRecording}
                  aria-label="Annuler l'enregistrement"
                  className="p-1.5 border rounded-lg transition-colors bg-white"
                  style={{ borderColor: '#E8E8E6', color: '#6B6B6B' }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
                <button
                  type="button"
                  onClick={onStopRecording}
                  aria-label="Valider et envoyer"
                  className="p-1.5 border rounded-lg bg-white shadow-sm transition-colors"
                  style={{ borderColor: '#E8E8E6', color: '#171717' }}
                >
                  <Check style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Légende discrète */}
      <p className="text-center mt-2" style={{ fontSize: '11px', color: '#9CA3AF', fontFamily: "'Inter', sans-serif" }}>
        L'IA peut faire des erreurs. Vérifiez toujours avec votre expert-comptable.
      </p>
    </div>
  );
};

// ArrowUp icon local pour éviter dépendance circulaire si lucide non chargé
function ArrowUp(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function Check(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 12l5 5l10 -10" />
    </svg>
  );
}
function X(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

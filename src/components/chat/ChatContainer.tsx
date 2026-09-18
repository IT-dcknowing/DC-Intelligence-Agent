import React, { useRef, useEffect } from 'react';
import { Message } from './Message';
import { TypingIndicator } from './TypingIndicator';
import type { ChatMessage } from '../../types';

/**
 * ChatContainer — Editorial centered, 740px, 32px gap, editorial
 * - Welcome screen "Salut, Kouassi" (Playfair, disparaît au 1er message)
 * - Messages : IA full-width no bubble, User 70% right #171717
 * - Smooth scroll, generous whitespace, no heavy borders
 */

interface QuickPrompt {
  title: string;
  desc: string;
  prompt: string;
}

interface ChatContainerProps {
  messages: ChatMessage[];
  isGenerating?: boolean;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
  // Pour conserver les cartes métier existantes (SYSCOHADA, validation) sous le prose
  renderExtra?: (msg: ChatMessage) => React.ReactNode;
  renderMeta?: (msg: ChatMessage) => React.ReactNode;
  quickPrompts?: QuickPrompt[];
  onPromptClick?: (prompt: string) => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  isGenerating,
  copiedId,
  onCopy,
  renderExtra,
  renderMeta,
  quickPrompts,
  onPromptClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  const isEmpty = messages.length === 0;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto w-full relative scroll-smooth bg-white"
      style={{ background: '#FFFFFF' }}
    >
      {/* Welcome — comme Editorial, editorial, disparaît avec opacity */}
      {isEmpty && !isGenerating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
          {/* Icône soleil tournante très lente */}
          <div
            className="w-10 h-10 mb-4 flex items-center justify-center rounded-full pointer-events-none"
            style={{ color: '#1F1F1E', opacity: 0.9 }}
            aria-hidden
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="animate-[spin_10s_linear_infinite]">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          </div>
          <h1
            className="text-4xl pointer-events-none"
            style={{ fontFamily: "'Playfair Display', serif", fontWeight: 500, color: '#1F1F1E', letterSpacing: '-0.02em' }}
          >
            Salut, Kouassi
          </h1>
          <p className="mt-2 text-[14px] pointer-events-none" style={{ color: '#6B6B6B', fontFamily: "'Inter', sans-serif" }}>
            Comment puis-je vous aider aujourd'hui ?
          </p>

          {/* Quick prompts — éditorial, 2 colonnes, comme Editorial */}
          {quickPrompts && quickPrompts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 max-w-[560px] w-full text-left">
              {quickPrompts.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onPromptClick?.(item.prompt)}
                  className="p-4 rounded-xl border text-left transition-all cursor-pointer hover:shadow-sm"
                  style={{
                    background: '#FFFFFF',
                    borderColor: '#E8E8E6',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#D4D4D8';
                    (e.currentTarget as HTMLElement).style.background = '#FAFAFA';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#E8E8E6';
                    (e.currentTarget as HTMLElement).style.background = '#FFFFFF';
                  }}
                >
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: '13px', fontWeight: 600, color: '#1F1F1E' }}>
                    {item.title}
                  </div>
                  <div
                    className="line-clamp-2"
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: '12px', color: '#6B6B6B', marginTop: '4px', lineHeight: '1.4' }}
                  >
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages — max-w 740, px-6, gap 32 */}
      <div className="max-w-[740px] mx-auto px-6 py-8 flex flex-col pb-40" style={{ gap: '32px' }}>
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <Message
              key={msg.id}
              role={isUser ? 'user' : 'ai'}
              content={msg.content}
              timestamp={msg.timestamp}
              senderName={isUser ? undefined : msg.senderName || 'DC Intelligence'}
              isCopied={copiedId === msg.id}
              onCopy={!isUser ? () => onCopy(msg.content, msg.id) : undefined}
              meta={!isUser ? renderMeta?.(msg) : undefined}
              extra={!isUser ? renderExtra?.(msg) : undefined}
            />
          );
        })}

        {isGenerating && <TypingIndicator />}

        <div ref={bottomRef} aria-hidden style={{ height: 1 }} />
      </div>
    </div>
  );
};

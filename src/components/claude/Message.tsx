import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, CheckCheck } from 'lucide-react';

/**
 * Message — Claude.ai editorial style, Noir & Blanc
 * - IA : pleine largeur, pas de bulle, avatar DC + texte Lora sur blanc
 * - User : bulle #171717 alignée à droite, max 70%, Inter 15px
 * - Markdown rendu via react-markdown + remark-gfm (jamais de syntaxe brute)
 * Design decision : Lora pour la lecture longue (comptabilité), Inter pour l'UI.
 * Tout le Markdown est sémantique (h1/h2/h3/strong/em/hr) avec hiérarchie 24/20/18px.
 */

interface MessageProps {
  role: 'user' | 'ai';
  content: string;
  timestamp?: string;
  senderName?: string;
  isCopied?: boolean;
  onCopy?: () => void;
  // Pour conserver les badges métier existants (SYSCOHADA, validation) sans casser le style éditorial
  meta?: React.ReactNode;
  extra?: React.ReactNode; // ProposalCard, tables, actions — rendu sous le texte IA
}

export const Message: React.FC<MessageProps> = ({ role, content, timestamp, senderName, isCopied, onCopy, meta, extra }) => {
  const [isHovered, setIsHovered] = useState(false);

  if (role === 'user') {
    return (
      <div
        className="flex justify-end w-full message-enter"
        style={{ animation: 'fadeInUp 0.4s cubic-bezier(0.16,1,0.3,1) forwards' }}
      >
        {/* Bulle utilisateur : #171717 jamais #000 pur, Inter, 15px, 1.5 */}
        <div
          className="px-5 py-3.5 rounded-[20px] rounded-tr-[4px] max-w-[70%] shadow-sm"
          style={{
            background: '#171717',
            color: '#FFFFFF',
            fontFamily: "'Inter', sans-serif",
            fontSize: '15px',
            lineHeight: '1.5',
            fontWeight: 400,
            transition: 'all 0.15s ease',
          }}
        >
          {/* Respect des sauts de ligne pour les messages courts utilisateur */}
          <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</span>
        </div>
      </div>
    );
  }

  // IA — pas de bulle, avatar + texte éditorial Lora sur blanc
  return (
    <div
      className="flex gap-4 w-full group message-enter relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ gap: '16px' }}
    >
      {/* Avatar DC — 32px, noir, typo Inter bold */}
      <div
        className="w-8 h-8 rounded-md flex-shrink-0 flex items-center justify-center font-bold text-xs mt-1 shadow-sm select-none"
        style={{ background: '#171717', color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
        aria-hidden
      >
        DC
      </div>

      <div className="flex-1 min-w-0 max-w-[calc(100%-3rem)]">
        {/* En-tête discret : nom + heure */}
        {(senderName || timestamp) && (
          <div className="flex items-center gap-2 mb-2">
            {senderName && (
              <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '13px', fontWeight: 600, color: '#1F1F1E' }}>
                {senderName}
              </span>
            )}
            {timestamp && <span style={{ fontSize: '12px', color: '#9CA3AF' }}>• {timestamp}</span>}
          </div>
        )}

        {/* Badge métier existant (ex. SYSCOHADA, confiance) — rendu au-dessus du texte, style discret */}
        {meta && <div className="mb-3">{meta}</div>}

        {/* Corps Markdown — Lora 16px / 1.65, jamais de syntaxe brute */}
        <div className="claude-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Titres sémantiques avec tailles spec
              h1: ({ children }) => <h1>{children}</h1>,
              h2: ({ children }) => <h2>{children}</h2>,
              h3: ({ children }) => <h3>{children}</h3>,
              // Gras = 600, jamais 700
              strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
              em: ({ children }) => <em style={{ color: '#4A4A4A' }}>{children}</em>,
              hr: () => <hr />,
              // Liens discrets
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
              // Code inline & blocs
              code: ({ inline, children, ...props }: any) =>
                inline ? (
                  <code {...props}>{children}</code>
                ) : (
                  <code {...props}>{children}</code>
                ),
              pre: ({ children }) => <pre>{children}</pre>,
              // Emojis : 1.1em via span parent .emoji déjà géré en CSS
              p: ({ children }) => <p>{children}</p>,
              ul: ({ children }) => <ul>{children}</ul>,
              ol: ({ children }) => <ol>{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              table: ({ children }) => <table>{children}</table>,
              thead: ({ children }) => <thead>{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              th: ({ children }) => <th>{children}</th>,
              td: ({ children }) => <td>{children}</td>,
              blockquote: ({ children }) => <blockquote>{children}</blockquote>,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>

        {/* Contenu métier supplémentaire (ProposalCard, table écriture, actions) — sous le prose, pleine largeur */}
        {extra && <div className="mt-6">{extra}</div>}

        {/* Bouton Copier — apparaît au hover, top-right */}
        {onCopy && (
          <button
            onClick={onCopy}
            aria-label="Copier la réponse"
            className="absolute top-0 right-0 p-1.5 rounded-md transition-all"
            style={{
              opacity: isHovered ? 1 : 0,
              background: isHovered ? '#FFFFFF' : 'transparent',
              border: isHovered ? '1px solid #E8E8E6' : '1px solid transparent',
              color: '#6B6B6B',
              transition: 'all 0.15s ease',
              transform: isHovered ? 'translateY(0)' : 'translateY(4px)',
            }}
          >
            {isCopied ? <CheckCheck style={{ width: 14, height: 14, color: '#171717' }} /> : <Copy style={{ width: 14, height: 14 }} />}
          </button>
        )}
      </div>
    </div>
  );
};

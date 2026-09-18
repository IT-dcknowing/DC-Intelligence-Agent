import React from 'react';

/**
 * TypingIndicator — Editorial 3 points rebondissants + pulse
 * Réutilisable pour "IA en train d'écrire"
 * Design : 3 dots #9CA3AF, 6px, bounce 1.4s, delays -0.32 / -0.16
 */
export const TypingIndicator: React.FC<{ label?: string }> = ({ label = 'DC Intelligence réfléchit...' }) => {
  return (
    <div className="flex gap-4 w-full message-enter">
      <div
        className="w-8 h-8 rounded-md flex-shrink-0 flex items-center justify-center font-bold text-xs mt-1"
        style={{ background: '#171717', color: '#fff' }}
      >
        DC
      </div>
      <div className="flex-1 flex items-center gap-3 h-10 px-2">
        <div className="flex items-center gap-1.5" aria-live="polite" aria-label={label}>
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
        {label && (
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '13px', color: '#6B6B6B' }}>{label}</span>
        )}
      </div>
    </div>
  );
};

/** Version compacte pour header / inline */
export const TypingDots: React.FC = () => (
  <span className="inline-flex items-center gap-1" aria-label="en cours">
    <span className="typing-dot" />
    <span className="typing-dot" />
    <span className="typing-dot" />
  </span>
);

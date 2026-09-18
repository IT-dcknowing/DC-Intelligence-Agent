import React from 'react';
import { ChatContainer } from './ChatContainer';
import { InputArea } from './InputArea';
import { Message } from './Message';
import { TypingIndicator } from './TypingIndicator';
import { Sidebar } from './Sidebar';
import type { ChatMessage, ChatSession } from '../../types';

/**
 * ChatView — Assemblage complet Editorial.ai + Noir & Blanc
 * Compose Sidebar + ChatContainer + InputArea + TypingIndicator
 * Design decision : ce fichier est le seul point d'assemblage —
 * chaque sous-composant reste réutilisable et testable isolément.
 */
export const ChatView = () => {
  return null;
};

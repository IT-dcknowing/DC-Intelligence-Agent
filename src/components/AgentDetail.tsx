import React, { useState, useEffect, useRef } from 'react';
import { Bot, Save, Check, RotateCcw } from 'lucide-react';
import { Agent } from '../types';
import { ACCUEIL_CANONICAL } from '../mockData';

interface AgentDetailProps {
  agent: Agent | null;
  onUpdateAgent: (updated: Agent) => void;
}

export const AgentDetail: React.FC<AgentDetailProps> = ({ agent, onUpdateAgent }) => {
  const [goal, setGoal] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [status, setStatus] = useState<'actif' | 'inactif'>('actif');
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Recharge le formulaire UNIQUEMENT quand on change d'agent (id), jamais sur
  // les re-rendus : sinon la saisie en cours est écrasée dès qu'une autre
  // partie de l'app met à jour l'état (hydratation, compteur, toast…).
  const loadedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (agent && agent.id !== loadedIdRef.current) {
      loadedIdRef.current = agent.id;
      setGoal(agent.goal);
      setRole(agent.role);
      setInstructions(agent.instructions);
      setStatus(agent.status);
      setSavedFeedback(false);
    }
  }, [agent]);

  if (!agent) {
    return (
      <div
        id="empty-agent-detail"
        className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none"
        style={{ background: '#FAFAFA' }}
      >
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
          style={{ background: '#F4F4F5', border: '1px solid #E5E5E7' }}
        >
          <Bot style={{ width: 24, height: 24, strokeWidth: 1.5, color: '#A1A1AA' }} />
        </div>
        <p className="font-semibold" style={{ fontSize: '15px', color: '#09090B' }}>
          Sélectionnez un agent
        </p>
        <p style={{ fontSize: '13px', color: '#71717A', marginTop: '6px', maxWidth: 280, lineHeight: 1.6 }}>
          Choisissez un agent dans la liste pour configurer ses paramètres d'exécution.
        </p>
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateAgent({ ...agent, goal, role, instructions, status });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const handleToggleStatus = () => {
    const nextStatus = status === 'actif' ? 'inactif' : 'actif';
    setStatus(nextStatus);
    onUpdateAgent({ ...agent, status: nextStatus });
  };

  const isActive = status === 'actif';
  const isEntry = Boolean(agent?.isDefaultEntry || agent?.isRouter);

  // Action urgente D : réinitialise le Prompt Système du point d'entrée au
  // canonique AQQR (jamais de SYSCOHADA / imputation comptable sur l'Accueil).
  const handleResetAccueil = () => {
    if (!agent) return;
    onUpdateAgent({
      ...agent,
      role: ACCUEIL_CANONICAL.role,
      goal: ACCUEIL_CANONICAL.goal,
      instructions: ACCUEIL_CANONICAL.instructions,
    });
    setRole(ACCUEIL_CANONICAL.role);
    setGoal(ACCUEIL_CANONICAL.goal);
    setInstructions(ACCUEIL_CANONICAL.instructions);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  return (
    <div
      id="agent-detail-panel"
      className="flex-1 flex flex-col h-full overflow-y-auto"
      style={{ background: '#fff', fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header
        id="agent-detail-header"
        className="px-8 py-5 flex items-center justify-between shrink-0 select-none"
        style={{ borderBottom: '1px solid #E5E5E7', background: '#fff' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: '#09090B', border: '1px solid #09090B' }}
          >
            <Bot style={{ width: 18, height: 18, strokeWidth: 2, color: '#fff' }} />
          </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-bold tracking-tight" style={{ fontSize: '18px', color: '#09090B' }}>
                  {agent.name}
                </h1>
                {isEntry && (
                  <>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 9px', background: '#09090B', color: '#fff', borderRadius: '99px' }}>
                      Point d’entrée
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 9px', background: '#fff', color: '#09090B', border: '1px solid #09090B', borderRadius: '99px' }}>
                      Par défaut
                    </span>
                  </>
                )}
                <span
                  className="font-mono"
                  title="Nombre d'échanges réels traités par cet agent"
                  style={{ fontSize: '11px', fontWeight: 700, padding: '2px 9px', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', color: '#52525B' }}
                >
                  {agent.conversationsCount || 0} échange{(agent.conversationsCount || 0) > 1 ? 's' : ''} réel{(agent.conversationsCount || 0) > 1 ? 's' : ''}
                </span>
              {/* Monochrome status badge — no color */}
              <span
                className="inline-flex items-center gap-1.5"
                style={{
                  padding: '2px 8px',
                  background: '#F4F4F5',
                  border: '1px solid #E5E5E7',
                  borderRadius: '99px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: '#52525B',
                }}
              >
                <span
                  className="rounded-full"
                  style={{
                    width: 5, height: 5, display: 'inline-block',
                    background: isActive ? '#71717A' : '#D4D4D8',
                  }}
                />
                {isActive ? 'Actif' : 'Inactif'}
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#71717A', marginTop: '2px' }}>
              Configuration des paramètres d'exécution
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleStatus}
          className="cursor-pointer transition-all"
          style={{
            padding: '7px 13px',
            background: 'transparent',
            border: '1px solid #E5E5E7',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#52525B',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F4F4F5'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {isActive ? 'Désactiver' : 'Activer'}
        </button>
      </header>

      {/* Form */}
      <form onSubmit={handleSave} className="p-8 max-w-3xl space-y-6">
        {/* Info callout */}
        <div
          className="flex items-start gap-3 p-4 rounded-xl"
          style={{ background: '#F4F4F5', border: '1px solid #E5E5E7' }}
        >
          <div style={{ width: 16, height: 16, marginTop: 2, color: '#71717A', flexShrink: 0 }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <circle cx="8" cy="8" r="7"/>
              <line x1="8" y1="7" x2="8" y2="11"/>
              <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <p style={{ fontSize: '13px', color: '#52525B', lineHeight: 1.6 }}>
            Les modifications sont appliquées immédiatement pour les prochaines interactions sur tous les canaux.
          </p>
        </div>

        <div className="space-y-5">
          {/* Role */}
          <div>
            <label
              className="block"
              style={{ fontSize: '11px', fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}
            >
              Rôle Opérationnel
            </label>
            <input
              id="agent-role-input"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Ex: Expert-comptable superviseur"
              style={{
                width: '100%', padding: '10px 12px',
                border: '1px solid #E5E5E7', borderRadius: '8px',
                fontSize: '14px', color: '#09090B', background: '#fff',
                outline: 'none', transition: 'border-color 150ms',
                fontFamily: "'Inter', sans-serif",
              }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#000'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(0,0,0,0.07)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
            />
          </div>

          {/* Goal */}
          <div>
            <label
              className="block"
              style={{ fontSize: '11px', fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}
            >
              Objectif Principal
            </label>
            <input
              id="agent-goal-input"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ex: Analyser et synthétiser les données"
              style={{
                width: '100%', padding: '10px 12px',
                border: '1px solid #E5E5E7', borderRadius: '8px',
                fontSize: '14px', color: '#09090B', background: '#fff',
                outline: 'none', transition: 'border-color 150ms',
                fontFamily: "'Inter', sans-serif",
              }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#000'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(0,0,0,0.07)'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
            />
          </div>

          {/* Instructions */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                className="block"
                style={{ fontSize: '11px', fontWeight: 600, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                Consignes & Instructions (Prompt Système)
              </label>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#A1A1AA' }}>
                {instructions.length} car.
              </span>
            </div>
            <textarea
              id="agent-instructions-input"
              rows={10}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="# Consignes opérationnelles&#10;1. ..."
              style={{
                width: '100%', minHeight: 200, padding: '12px',
                border: '1px solid #E5E5E7', borderRadius: '8px',
                fontSize: '13px', color: '#09090B', background: '#FAFAFA',
                outline: 'none', transition: 'all 150ms',
                lineHeight: 1.7, fontFamily: 'monospace', resize: 'vertical',
              }}
              onFocus={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = '#000';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(0,0,0,0.07)';
                (e.currentTarget as HTMLElement).style.background = '#fff';
              }}
              onBlur={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                (e.currentTarget as HTMLElement).style.background = '#FAFAFA';
              }}
            />
          </div>
        </div>

        {/* Reset point d'entrée (visible uniquement sur l'Accueil) */}
        {isEntry && (
          <div
            className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
          >
            <div className="flex-1">
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E' }}>
                Protège l’identité de l’Accueil
              </p>
              <p style={{ fontSize: '12px', color: '#A16207', marginTop: '2px', lineHeight: 1.6 }}>
                Restaure le Prompt Système canonique (Accueillir, Qualifier, Router, Rassurer). L’Accueil ne doit jamais contenir d’imputation comptable ni de SYSCOHADA.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetAccueil}
              className="flex items-center gap-1.5 cursor-pointer shrink-0"
              style={{ padding: '7px 13px', background: '#fff', border: '1px solid #F59E0B', borderRadius: '8px', fontSize: '12px', fontWeight: 600, color: '#92400E' }}
            >
              <RotateCcw style={{ width: 13, height: 13 }} />
              <span>Réinitialiser le prompt</span>
            </button>
          </div>
        )}

        {/* Save */}
        <div className="pt-1 flex items-center gap-4">
          <button
            id="btn-save-agent"
            type="submit"
            className="flex items-center gap-2 cursor-pointer transition-all active:scale-95"
            style={{
              padding: '10px 20px',
              background: '#000',
              color: '#fff',
              border: '1px solid #000',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#18181B')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#000')}
          >
            {savedFeedback ? (
              <>
                <Check style={{ width: 14, height: 14, strokeWidth: 2.5 }} />
                <span>Enregistré !</span>
              </>
            ) : (
              <>
                <Save style={{ width: 14, height: 14 }} />
                <span>Enregistrer la configuration</span>
              </>
            )}
          </button>

          {savedFeedback && (
            <span className="animate-in fade-in" style={{ fontSize: '13px', color: '#52525B', fontWeight: 500 }}>
              ✓ Configuration synchronisée
            </span>
          )}
        </div>
      </form>
    </div>
  );
};

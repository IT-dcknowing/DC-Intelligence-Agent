import React, { useState, useEffect } from 'react';
import { Bot, Save, Check, Info } from 'lucide-react';
import { Agent } from '../types';

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

  useEffect(() => {
    if (agent) {
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
        className="flex-1 flex flex-col items-center justify-center bg-white p-8 text-[#64748B] select-none text-center"
      >
        <div className="w-16 h-16 rounded-3xl bg-[#F8FAFC] text-[#94A3B8] flex items-center justify-center mb-3">
          <Bot className="w-8 h-8 stroke-[1.5]" />
        </div>
        <p className="text-[16px] font-semibold text-[#1E293B] font-['Montserrat']">
          Sélectionnez un agent
        </p>
        <p className="text-[13px] text-[#64748B] mt-1 max-w-xs">
          Choisissez un agent autonome dans la liste de gauche pour configurer son prompt et ses règles de gestion.
        </p>
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateAgent({
      ...agent,
      goal,
      role,
      instructions,
      status,
    });
    setSavedFeedback(true);
    setTimeout(() => {
      setSavedFeedback(false);
    }, 2000);
  };

  const handleToggleStatus = () => {
    const nextStatus = status === 'actif' ? 'inactif' : 'actif';
    setStatus(nextStatus);
    onUpdateAgent({
      ...agent,
      status: nextStatus,
    });
  };

  const isActive = status === 'actif';

  return (
    <div
      id="agent-detail-panel"
      className="flex-1 flex flex-col h-full bg-white overflow-y-auto font-['Montserrat']"
    >
      {/* 1. Header (Chantier 4) */}
      <header
        id="agent-detail-header"
        className="px-8 py-6 border-b border-[#E2E8F0] bg-white flex items-center justify-between shrink-0 select-none"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-sm border border-zinc-800">
            <Bot className="w-6 h-6 stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[22px] font-bold text-[#1E293B] tracking-tight">
                {agent.name}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                  isActive
                    ? 'bg-[#ECFDF5] text-[#10B981] border border-[#A7F3D0]'
                    : 'bg-[#F1F5F9] text-[#94A3B8] border border-[#E2E8F0]'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${isActive ? 'bg-[#10B981]' : 'bg-[#94A3B8]'}`}
                />
                <span>{isActive ? '● Agent Actif' : '● Agent Inactif'}</span>
              </span>
            </div>
            <p className="text-[14px] text-[#64748B] mt-0.5">
              Configuration des paramètres d'exécution
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleStatus}
          className={`px-3.5 py-1.5 rounded-xl text-[12px] font-semibold border transition-all ${
            isActive
              ? 'border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC]'
              : 'border-[#10B981] text-[#10B981] bg-[#ECFDF5]'
          }`}
        >
          {isActive ? 'Désactiver cet agent' : 'Activer cet agent'}
        </button>
      </header>

      {/* 2. Main Config Form */}
      <form onSubmit={handleSave} className="p-8 max-w-4xl space-y-6">
        {/* Info Alert (Bandeau monochrome) */}
        <div className="bg-[#F4F4F5] border-l-4 border-l-black rounded-r-lg p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-black shrink-0 mt-0.5" />
          <p className="text-[13px] text-[#1E293B] leading-relaxed">
            Les modifications apportées au prompt système et au rôle sont appliquées immédiatement
            pour toutes les prochaines interactions clients sur le canal WhatsApp et Web.
          </p>
        </div>

        {/* Form Fields */}
        <div className="space-y-5">
          {/* Role */}
          <div>
            <label className="block text-[13px] font-semibold uppercase tracking-[0.05em] text-[#475569]">
              Rôle Opérationnel
            </label>
            <p className="text-[12px] italic text-[#94A3B8] mb-2 mt-0.5">
              Définit le domaine de compétence et le niveau d'autorité de l'agent.
            </p>
            <input
              id="agent-role-input"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-3.5 text-[14px] font-normal border-[1.5px] border-[#E2E8F0] rounded-[10px] text-[#1E293B] bg-white focus:outline-none focus:border-black focus:ring-3 focus:ring-black/15 transition-all"
              placeholder="Ex: Expert-comptable superviseur SYSCOHADA"
            />
          </div>

          {/* Goal */}
          <div>
            <label className="block text-[13px] font-semibold uppercase tracking-[0.05em] text-[#475569]">
              Objectif Principal
            </label>
            <p className="text-[12px] italic text-[#94A3B8] mb-2 mt-0.5">
              Le résultat attendu à atteindre lors des échanges avec le client ou collaborateur.
            </p>
            <input
              id="agent-goal-input"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full px-4 py-3.5 text-[14px] font-normal border-[1.5px] border-[#E2E8F0] rounded-[10px] text-[#1E293B] bg-white focus:outline-none focus:border-black focus:ring-3 focus:ring-black/15 transition-all"
              placeholder="Ex: Rapprocher les relevés bancaires avec les pièces justificatives"
            />
          </div>

          {/* Instructions (Prompt System) */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-[13px] font-semibold uppercase tracking-[0.05em] text-[#475569]">
                Consignes & Règles SYSCOHADA (Prompt Système)
              </label>
              <span className="text-[11px] font-mono text-[#94A3B8]">
                {instructions.length} caractères
              </span>
            </div>
            <p className="text-[12px] italic text-[#94A3B8] mb-2 mt-0.5">
              Règles strictes de classification, taux de TVA 18%, comptes 512/401/411 et seuils de tolérance.
            </p>
            <div className="relative">
              <textarea
                id="agent-instructions-input"
                rows={10}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="w-full min-h-[200px] p-4 text-[13px] font-mono border-[1.5px] border-[#E2E8F0] rounded-[10px] text-[#1E293B] bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-black focus:ring-3 focus:ring-black/15 transition-all leading-relaxed"
                placeholder="# Consignes opérationnelles&#10;1. Vérifier la conformité du relevé bancaire.&#10;2. Associer chaque écriture au compte SYSCOHADA correspondant."
              />
            </div>
          </div>
        </div>

        {/* Save Button (Chantier 4) */}
        <div className="pt-2 flex items-center gap-4">
          <button
            id="btn-save-agent"
            type="submit"
            className="px-8 py-3 rounded-[10px] bg-black hover:bg-zinc-800 text-white font-semibold text-[14px] shadow-md hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 flex items-center gap-2"
          >
            {savedFeedback ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Configuration enregistrée !</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Enregistrer la configuration</span>
              </>
            )}
          </button>

          {savedFeedback && (
            <span className="text-[13px] text-[#10B981] font-semibold animate-in fade-in">
              ✓ Synchronisé avec le moteur d'inférence
            </span>
          )}
        </div>
      </form>
    </div>
  );
};

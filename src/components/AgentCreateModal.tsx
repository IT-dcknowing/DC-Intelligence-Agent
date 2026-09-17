import React, { useState, useEffect } from 'react';
import { Bot, X } from 'lucide-react';
import { ActionPermission, ChannelType } from '../types';

export interface NewAgentDraft {
  name: string;
  description: string;
  role: string;
  goal: string;
  instructions: string;
  allowedActions: ActionPermission[];
  allowedChannels: ChannelType[];
}

interface AgentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (draft: NewAgentDraft) => void;
}

const ACTION_OPTIONS: { id: ActionPermission; label: string; hint: string }[] = [
  { id: 'READ', label: 'READ', hint: 'Lecture seule' },
  { id: 'RECOMMEND', label: 'RECOMMEND', hint: 'Recommander sans exécuter' },
  { id: 'PREPARE', label: 'PREPARE', hint: 'Préparer des brouillons' },
  { id: 'EXECUTE', label: 'EXECUTE', hint: 'Exécuter (validation requise)' },
];

const CHANNEL_OPTIONS: { id: ChannelType; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'web', label: 'Web' },
  { id: 'phone', label: 'Téléphone' },
];

const MIN_PROMPT_LENGTH = 20;

export const AgentCreateModal: React.FC<AgentCreateModalProps> = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [allowedActions, setAllowedActions] = useState<ActionPermission[]>(['READ', 'RECOMMEND']);
  const [allowedChannels, setAllowedChannels] = useState<ChannelType[]>(['web']);
  const [triedSubmit, setTriedSubmit] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setRole('');
      setGoal('');
      setInstructions('');
      setAllowedActions(['READ', 'RECOMMEND']);
      setAllowedChannels(['web']);
      setTriedSubmit(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleAction = (id: ActionPermission) =>
    setAllowedActions((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  const toggleChannel = (id: ChannelType) =>
    setAllowedChannels((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = 'Le nom est obligatoire.';
  if (!role.trim()) errors.role = 'Le rôle opérationnel est obligatoire.';
  if (!goal.trim()) errors.goal = 'L’objectif principal est obligatoire.';
  if (instructions.trim().length < MIN_PROMPT_LENGTH)
    errors.instructions = `Le Prompt Système est obligatoire (${MIN_PROMPT_LENGTH} caractères minimum) : sans lui, l’agent hallucine.`;
  if (allowedActions.length === 0) errors.actions = 'Sélectionnez au moins un outil autorisé.';
  const isValid = Object.keys(errors).length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTriedSubmit(true);
    if (!isValid) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      role: role.trim(),
      goal: goal.trim(),
      instructions: instructions.trim(),
      allowedActions,
      allowedChannels,
    });
  };

  const inputStyle = (invalid: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '9px 12px',
    border: `1px solid ${invalid ? '#DC2626' : '#E5E5E7'}`,
    borderRadius: '8px',
    fontSize: '13px',
    color: '#09090B',
    background: '#fff',
    outline: 'none',
    fontFamily: "'Inter', sans-serif",
  });
  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#71717A',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: '6px',
    display: 'block',
  };
  const errStyle: React.CSSProperties = { fontSize: '11px', color: '#DC2626', marginTop: '4px' };

  return (
    <div
      id="agent-create-modal-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="agent-create-modal"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        style={{ border: '1px solid #E5E5E7' }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between sticky top-0 bg-white" style={{ borderBottom: '1px solid #E5E5E7' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#09090B' }}>
              <Bot style={{ width: 17, height: 17, color: '#fff' }} />
            </div>
            <div>
              <h2 className="font-bold" style={{ fontSize: '16px', color: '#09090B' }}>Nouvel agent</h2>
              <p style={{ fontSize: '12px', color: '#71717A' }}>Un agent sans Prompt Système hallucine : tous les champs marqués * sont requis.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Fermer"
            className="p-2 rounded-lg hover:bg-zinc-100 text-[#71717A] hover:text-black cursor-pointer"
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Nom */}
          <div>
            <label style={labelStyle} htmlFor="new-agent-name">Nom de l’agent *</label>
            <input
              id="new-agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Ex : Agent Juridique & Fiscal'
              style={inputStyle(triedSubmit && !!errors.name)}
            />
            {triedSubmit && errors.name && <p style={errStyle}>{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle} htmlFor="new-agent-desc">Description courte (liste)</label>
            <input
              id="new-agent-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex : Conformité fiscale DGI et déclarations sociales."
              style={inputStyle(false)}
            />
          </div>

          {/* Rôle */}
          <div>
            <label style={labelStyle} htmlFor="new-agent-role">Rôle opérationnel *</label>
            <input
              id="new-agent-role"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Ex : Conseiller fiscal"
              style={inputStyle(triedSubmit && !!errors.role)}
            />
            {triedSubmit && errors.role && <p style={errStyle}>{errors.role}</p>}
          </div>

          {/* Objectif */}
          <div>
            <label style={labelStyle} htmlFor="new-agent-goal">Objectif principal *</label>
            <input
              id="new-agent-goal"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ex : Sécuriser les échéances fiscales du 15 du mois."
              style={inputStyle(triedSubmit && !!errors.goal)}
            />
            {triedSubmit && errors.goal && <p style={errStyle}>{errors.goal}</p>}
          </div>

          {/* Prompt Système */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="new-agent-prompt">Prompt Système *</label>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#A1A1AA' }}>
                {instructions.trim().length}/{MIN_PROMPT_LENGTH} min.
              </span>
            </div>
            <textarea
              id="new-agent-prompt"
              rows={7}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"# Rôle\nTu es...\n\n# Règles\n1. ...\n2. ..."}
              style={{ ...inputStyle(triedSubmit && !!errors.instructions), minHeight: 150, lineHeight: 1.6, fontFamily: 'monospace', resize: 'vertical' }}
            />
            {triedSubmit && errors.instructions && <p style={errStyle}>{errors.instructions}</p>}
          </div>

          {/* Outils autorisés */}
          <div>
            <span style={labelStyle}>Outils autorisés *</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ACTION_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-start gap-2.5 p-3 rounded-lg cursor-pointer hover:bg-zinc-50"
                  style={{ border: '1px solid #E5E5E7' }}
                >
                  <input
                    type="checkbox"
                    checked={allowedActions.includes(opt.id)}
                    onChange={() => toggleAction(opt.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-mono font-bold" style={{ fontSize: '12px', color: '#09090B' }}>{opt.label}</span>
                    <span className="block" style={{ fontSize: '11px', color: '#71717A' }}>{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {triedSubmit && errors.actions && <p style={errStyle}>{errors.actions}</p>}
          </div>

          {/* Canaux */}
          <div>
            <span style={labelStyle}>Canaux</span>
            <div className="flex items-center gap-2 flex-wrap">
              {CHANNEL_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer"
                  style={{
                    border: '1px solid #E5E5E7',
                    background: allowedChannels.includes(opt.id) ? '#09090B' : '#fff',
                    color: allowedChannels.includes(opt.id) ? '#fff' : '#52525B',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allowedChannels.includes(opt.id)}
                    onChange={() => toggleChannel(opt.id)}
                    className="hidden"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer"
              style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid #E5E5E7', fontSize: '13px', fontWeight: 500, color: '#52525B', background: '#fff' }}
            >
              Annuler
            </button>
            <button
              type="submit"
              id="btn-create-agent-submit"
              className="cursor-pointer transition-all active:scale-95"
              style={{ padding: '9px 20px', borderRadius: '8px', background: '#000', color: '#fff', border: '1px solid #000', fontSize: '13px', fontWeight: 600 }}
            >
              Créer l’agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { X, Plus, Sparkles, Check, Info } from 'lucide-react';
import { LLMModel, LLMProvider } from '../types';

interface AddModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddModel: (newModel: LLMModel) => void;
}

const POPULAR_SUGGESTIONS: { id: string; name: string; provider: LLMProvider; isFree: boolean; desc: string }[] = [
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openrouter',
    isFree: false,
    desc: 'Modèle OpenAI compact, rapide et économique sur OpenRouter',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    isFree: false,
    desc: 'Modèle multimodal haut de gamme OpenAI',
  },
  {
    id: 'deepseek/deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill Llama 70B',
    provider: 'openrouter',
    isFree: false,
    desc: 'Raisonnement R1 distillé sur architecture Llama 70B',
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B (Gratuit)',
    provider: 'openrouter',
    isFree: true,
    desc: 'Modèle ultra-léger et gratuit pour requêtes courtes',
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'openrouter',
    isFree: false,
    desc: 'Spécialisé en calculs automatisés et logique SQL',
  },
];

export const AddModelModal: React.FC<AddModelModalProps> = ({
  isOpen,
  onClose,
  onAddModel,
}) => {
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');
  const [provider, setProvider] = useState<LLMProvider>('openrouter');
  const [isFree, setIsFree] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = modelId.trim();
    const cleanName = modelName.trim();

    if (!cleanId) {
      setError('L’identifiant du modèle (ID) est obligatoire.');
      return;
    }
    if (!cleanName) {
      setError('Le nom d’affichage est obligatoire.');
      return;
    }

    const newModel: LLMModel = {
      id: cleanId,
      name: cleanName,
      provider,
      isFree,
      description: description.trim() || `Modèle ajouté manuellement (${cleanId})`,
      isCustom: true,
    };

    onAddModel(newModel);
    onClose();
  };

  const applySuggestion = (s: (typeof POPULAR_SUGGESTIONS)[0]) => {
    setModelId(s.id);
    setModelName(s.name);
    setProvider(s.provider);
    setIsFree(s.isFree);
    setDescription(s.desc);
    setError(null);
  };

  return (
    <div
      id="modal-add-model-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[4px] p-4 font-['Montserrat'] animate-in fade-in duration-200"
    >
      <div
        id="modal-add-model-content"
        className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center shadow-xs border border-zinc-800">
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-[#1E293B]">
                Ajouter un modèle LLM
              </h3>
              <p className="text-[12px] text-[#64748B]">
                Connectez n'importe quel modèle disponible sur OpenRouter
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[#94A3B8] hover:text-[#1E293B] hover:bg-[#E2E8F0] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick suggestions */}
        <div className="px-6 py-3.5 bg-[#F8FAFC]/80 border-b border-[#E2E8F0]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] block mb-2">
            Suggestions rapides :
          </span>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SUGGESTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => applySuggestion(s)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-white border border-[#E2E8F0] text-[#1E293B] hover:border-black hover:text-black transition-colors shadow-2xs font-medium"
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-[12px] rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#EF4444]">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#475569] mb-1">
              ID du modèle (Slug OpenRouter exact) *
            </label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setError(null);
              }}
              placeholder="ex: anthropic/claude-3.5-sonnet ou mistralai/mistral-large"
              className="w-full px-4 py-2.5 text-[13px] font-mono bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:bg-white focus:outline-none focus:border-black focus:ring-2 focus:ring-black/15"
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#475569] mb-1">
              Nom d'affichage *
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => {
                setModelName(e.target.value);
                setError(null);
              }}
              placeholder="ex: Claude 3.5 Sonnet (Expert)"
              className="w-full px-4 py-2.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:bg-white focus:outline-none focus:border-black focus:ring-2 focus:ring-black/15"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#475569] mb-1">
                Fournisseur
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as LLMProvider)}
                className="w-full px-3 py-2.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:bg-white focus:outline-none focus:border-black"
              >
                <option value="openrouter">OpenRouter API</option>
                <option value="anthropic">Anthropic Direct</option>
                <option value="deepseek">DeepSeek Direct</option>
                <option value="groq">Groq Direct</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#475569] mb-1">
                Tarification
              </label>
              <div className="flex items-center gap-2 h-[42px] px-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                <input
                  type="checkbox"
                  id="chk-is-free"
                  checked={isFree}
                  onChange={(e) => setIsFree(e.target.checked)}
                  className="rounded text-black focus:ring-black"
                />
                <label htmlFor="chk-is-free" className="text-[12px] text-[#1E293B] cursor-pointer">
                  Modèle gratuit (:free)
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-semibold uppercase tracking-wider text-[#475569] mb-1">
              Description / Notes
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ex: Recommandé pour l'analyse des écritures complexes"
              className="w-full px-4 py-2.5 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:bg-white focus:outline-none focus:border-black"
            />
          </div>

          {/* Footer buttons */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[13px] font-semibold text-[#64748B] hover:text-[#1E293B] transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white text-[13px] font-semibold shadow-sm active:scale-95 transition-all"
            >
              Ajouter au Studio
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

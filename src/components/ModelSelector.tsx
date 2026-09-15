import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  Check,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { ApiKeyConfig, LLMModel, LLMProvider, ReasoningEffort } from '../types';

interface ModelSelectorProps {
  models: LLMModel[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  apiKeys: ApiKeyConfig[];
  onNavigateToApiKeys: () => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (effort: ReasoningEffort) => void;
  onOpenAddModelModal: () => void;
  onRefreshOpenRouter: () => Promise<void>;
  isRefreshingModels?: boolean;
  onDeleteCustomModel?: (modelId: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModelId,
  onSelectModel,
  apiKeys,
  onNavigateToApiKeys,
  reasoningEffort,
  onChangeReasoningEffort,
  onOpenAddModelModal,
  onRefreshOpenRouter,
  isRefreshingModels = false,
  onDeleteCustomModel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showReasoningDropdown, setShowReasoningDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);

  const selectedModel =
    models.find((m) => m.id === selectedModelId) || models[0];

  const providers: { id: LLMProvider; label: string }[] = [
    { id: 'openrouter', label: 'OpenRouter (Catalogue direct)' },
    { id: 'anthropic', label: 'Claude (Anthropic)' },
    { id: 'deepseek', label: 'DeepSeek' },
  ];

  const filteredModels = models.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
      if (
        reasoningRef.current &&
        !reasoningRef.current.contains(event.target as Node)
      ) {
        setShowReasoningDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isProviderConfigured = (provider: LLMProvider) => {
    const orKey = apiKeys.find((k) => k.provider === 'openrouter');
    if (orKey && orKey.isConfigured && orKey.key.length > 0) return true;

    const config = apiKeys.find((k) => k.provider === provider);
    return Boolean(config && config.isConfigured && config.key.length > 0);
  };

  return (
    <div id="model-reasoning-controls-group" className="flex items-center gap-1.5">
      {/* 1. Model Selector Trigger + Upward Dropdown */}
      <div ref={dropdownRef} className="relative inline-block">
        <button
          id="btn-model-selector-trigger"
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            setShowReasoningDropdown(false);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-lg transition-colors select-none ${
            isOpen
              ? 'bg-[#F7F7F8] text-[#111113] border border-[#111113]'
              : 'bg-white hover:bg-[#F7F7F8] text-[#111113] border border-[#E5E5E7]'
          }`}
          title="Changer de modèle LLM"
        >
          <ArrowLeftRight className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
          <span className="truncate max-w-[160px]">
            {selectedModel?.name || 'Sélectionner un modèle'}
          </span>
          {selectedModel?.isFree && (
            <span className="text-[10px] bg-[#F7F7F8] text-[#6B7280] px-1.5 py-0.2 rounded font-medium border border-[#E5E5E7]">
              Gratuit
            </span>
          )}
          <ChevronDown
            className={`w-3 h-3 text-[#6B7280] transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Upward Dropdown: 12px radius, floating shadow (0 4px 12px rgba(0,0,0,0.08)) */}
        {isOpen && (
          <div
            id="llm-models-dropdown-panel"
            className="absolute bottom-full mb-2 left-0 w-[320px] bg-white border border-[#E5E5E7] rounded-[12px] shadow-floating z-50 overflow-hidden flex flex-col"
          >
            {/* Dropdown Header */}
            <div className="px-3 py-2 border-b border-[#E5E5E7] bg-[#F7F7F8] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-semibold text-[#111113]">
                  Modèles IA
                </span>
                <span className="text-[11px] text-[#6B7280] font-mono">
                  ({models.length})
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Sync OpenRouter */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshOpenRouter();
                  }}
                  disabled={isRefreshingModels}
                  className="px-2 py-0.5 rounded text-[11px] text-[#6B7280] hover:text-[#111113] hover:bg-[#E5E5E7]/50 flex items-center gap-1 transition-colors"
                  title="Synchroniser avec OpenRouter"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin text-[#111113]' : ''}`}
                  />
                  <span>Sync</span>
                </button>
                {/* Add model */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsOpen(false);
                    onOpenAddModelModal();
                  }}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#111113] hover:bg-neutral-800 text-white flex items-center gap-1 transition-colors"
                  title="Ajouter un modèle"
                >
                  <Plus className="w-3 h-3" />
                  <span>Ajouter</span>
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="p-2 border-b border-[#E5E5E7] bg-white">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#6B7280] absolute left-2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher un modèle..."
                  className="w-full pl-7 pr-2 py-1 text-[12px] rounded-lg bg-[#F7F7F8] border border-[#E5E5E7] focus:outline-none focus:bg-white focus:border-black text-[#111113] placeholder:text-[#6B7280]"
                />
              </div>
            </div>

            {/* Models list: Single neutral styling, black check mark */}
            <div className="max-h-[280px] overflow-y-auto py-1 divide-y divide-[#E5E5E7]/50">
              {filteredModels.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-[#6B7280]">
                  <p>Aucun modèle trouvé pour "{searchQuery}"</p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenAddModelModal();
                    }}
                    className="mt-2 text-[12px] font-medium text-black hover:underline"
                  >
                    + Ajouter ce modèle
                  </button>
                </div>
              ) : (
                providers.map((prov) => {
                  const provModels = filteredModels.filter((m) => m.provider === prov.id);
                  if (provModels.length === 0) return null;

                  const hasKey = isProviderConfigured(prov.id);

                  return (
                    <div key={prov.id} className="py-1">
                      {/* Provider Group Title */}
                      <div className="px-3 py-1 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[#111113] truncate pr-2">
                          {prov.label}
                        </span>
                        {hasKey ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#22C55E] shrink-0 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
                            Prêt
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] shrink-0 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"></span>
                            Clé requise
                          </span>
                        )}
                      </div>

                      {/* Models list */}
                      <div className="space-y-0.5 px-1">
                        {provModels.map((model) => {
                          const isSelected = model.id === selectedModelId;
                          return (
                            <div
                              key={model.id}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12px] transition-colors group ${
                                isSelected
                                  ? 'bg-[#F7F7F8] text-[#111113] font-medium'
                                  : 'text-[#111113] hover:bg-[#F7F7F8]'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectModel(model.id);
                                  setIsOpen(false);
                                }}
                                className="flex-1 flex flex-col min-w-0 pr-2 text-left"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{model.name}</span>
                                  {model.isFree && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-[#F7F7F8] border border-[#E5E5E7] text-[#6B7280] font-normal shrink-0">
                                      Gratuit
                                    </span>
                                  )}
                                  {model.isCustom && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-neutral-100 text-[#111113] font-normal shrink-0">
                                      Perso
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] font-mono text-[#6B7280] truncate mt-0.5">
                                  {model.id}
                                </span>
                              </button>

                              <div className="flex items-center gap-1 shrink-0">
                                {model.isCustom && onDeleteCustomModel && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteCustomModel(model.id);
                                    }}
                                    title="Supprimer ce modèle personnalisé"
                                    className="opacity-0 group-hover:opacity-100 p-1 text-[#6B7280] hover:text-red-600 rounded transition-opacity"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                                <div className="w-4 h-4 flex items-center justify-center">
                                  {isSelected && (
                                    <Check className="w-3.5 h-3.5 text-black stroke-[2.5]" />
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Actions */}
            <div className="p-1.5 border-t border-[#E5E5E7] bg-[#F7F7F8] flex items-center justify-between gap-1 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenAddModelModal();
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg font-medium text-[#111113] hover:bg-[#E5E5E7]/60 transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[#6B7280]" />
                <span>Nouveau modèle</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToApiKeys();
                }}
                className="px-2.5 py-1 rounded-lg font-medium text-[#6B7280] hover:text-[#111113] hover:bg-[#E5E5E7]/60 transition-colors"
              >
                Gérer clés
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Reasoning Effort Selector */}
      <div ref={reasoningRef} className="relative inline-block">
        <button
          id="btn-reasoning-effort-trigger"
          type="button"
          onClick={() => {
            setShowReasoningDropdown(!showReasoningDropdown);
            setIsOpen(false);
          }}
          className={`flex items-center gap-1 px-2 py-1 text-[12px] font-medium rounded-lg transition-colors select-none ${
            showReasoningDropdown
              ? 'bg-[#F7F7F8] text-[#111113] border border-[#111113]'
              : 'bg-white hover:bg-[#F7F7F8] text-[#6B7280] border border-[#E5E5E7]'
          }`}
          title="Niveau de réflexion de l'agent"
        >
          <span>{reasoningEffort}</span>
          <ChevronDown className="w-3 h-3 text-[#6B7280]" />
        </button>

        {showReasoningDropdown && (
          <div
            id="reasoning-effort-dropdown-panel"
            className="absolute bottom-full mb-2 left-0 w-44 bg-white border border-[#E5E5E7] rounded-[12px] shadow-floating z-50 p-1 space-y-0.5 text-[12px]"
          >
            <div className="px-2 py-1 text-[11px] font-semibold text-[#6B7280] border-b border-[#E5E5E7] mb-1">
              Réflexion IA
            </div>
            {(['Low', 'Medium', 'High'] as ReasoningEffort[]).map((effort) => (
              <button
                key={effort}
                type="button"
                onClick={() => {
                  onChangeReasoningEffort(effort);
                  setShowReasoningDropdown(false);
                }}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors ${
                  reasoningEffort === effort
                    ? 'bg-[#F7F7F8] text-[#111113] font-medium'
                    : 'text-[#111113] hover:bg-[#F7F7F8]'
                }`}
              >
                <span>{effort}</span>
                {reasoningEffort === effort && (
                  <Check className="w-3.5 h-3.5 text-black stroke-[2.5]" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

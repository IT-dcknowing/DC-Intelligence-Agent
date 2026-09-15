import React, { useState, useEffect } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Check,
  Server,
  Cpu,
  Plus,
  RefreshCw,
  Trash2,
  Save,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Sliders,
} from 'lucide-react';
import { ApiKeyConfig, LLMModel, LLMProvider } from '../types';

interface SettingsViewProps {
  apiKeys: ApiKeyConfig[];
  onSaveApiKey: (provider: LLMProvider, newKey: string) => void;
  activeSection?: 'api-keys' | 'models';
  models: LLMModel[];
  onOpenAddModelModal: () => void;
  onRefreshOpenRouter: () => Promise<void>;
  isRefreshingModels?: boolean;
  onDeleteCustomModel?: (modelId: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  apiKeys,
  onSaveApiKey,
  activeSection = 'api-keys',
  models,
  onOpenAddModelModal,
  onRefreshOpenRouter,
  isRefreshingModels = false,
  onDeleteCustomModel,
}) => {
  const [selectedSubTab, setSelectedSubTab] = useState<'api-keys' | 'models'>(
    activeSection === 'models' ? 'models' : 'api-keys'
  );

  // Sync draft states when apiKeys change
  const [keyDrafts, setKeyDrafts] = useState<Record<LLMProvider, string>>({
    openrouter: apiKeys.find((k) => k.provider === 'openrouter')?.key || '',
    anthropic: apiKeys.find((k) => k.provider === 'anthropic')?.key || '',
    deepseek: apiKeys.find((k) => k.provider === 'deepseek')?.key || '',
    groq: apiKeys.find((k) => k.provider === 'groq')?.key || '',
  });

  useEffect(() => {
    setKeyDrafts({
      openrouter: apiKeys.find((k) => k.provider === 'openrouter')?.key || '',
      anthropic: apiKeys.find((k) => k.provider === 'anthropic')?.key || '',
      deepseek: apiKeys.find((k) => k.provider === 'deepseek')?.key || '',
      groq: apiKeys.find((k) => k.provider === 'groq')?.key || '',
    });
  }, [apiKeys]);

  // Masking state
  const [showKey, setShowKey] = useState<Record<LLMProvider, boolean>>({
    openrouter: false,
    anthropic: false,
    deepseek: false,
    groq: false,
  });

  const [savedFeedback, setSavedFeedback] = useState<Record<LLMProvider, boolean>>({
    openrouter: false,
    anthropic: false,
    deepseek: false,
    groq: false,
  });

  const providerDocs: Record<LLMProvider, { url: string; label: string }> = {
    openrouter: {
      url: 'https://openrouter.ai/keys',
      label: 'Obtenir une clé OpenRouter →',
    },
    anthropic: {
      url: 'https://console.anthropic.com/settings/keys',
      label: 'Obtenir une clé Anthropic →',
    },
    deepseek: {
      url: 'https://platform.deepseek.com/api_keys',
      label: 'Obtenir une clé DeepSeek →',
    },
    groq: {
      url: 'https://console.groq.com/keys',
      label: 'Obtenir une clé Groq Whisper →',
    },
  };

  const handleKeySave = (provider: LLMProvider) => {
    onSaveApiKey(provider, keyDrafts[provider].trim());
    setSavedFeedback((prev) => ({ ...prev, [provider]: true }));
    setTimeout(() => {
      setSavedFeedback((prev) => ({ ...prev, [provider]: false }));
    }, 2000);
  };

  const maskKey = (rawKey: string) => {
    if (!rawKey) return '';
    if (rawKey.length <= 8) return '••••••••';
    const prefix = rawKey.slice(0, 4);
    const suffix = rawKey.slice(-4);
    return `${prefix}-****-****-${suffix}`;
  };

  return (
    <div
      id="settings-container"
      className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-y-auto font-['Montserrat']"
    >
      {/* Top Header */}
      <div className="px-6 sm:px-8 py-5 border-b border-[#E2E8F0] bg-white sticky top-0 z-10 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-bold text-[#1E293B] tracking-tight">
            Paramètres du Studio
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Gestion des clés API des modèles de langage et réglages de l'Assistant
          </p>
        </div>

        {/* Sub-Tabs: Clés API / Modèles LLM */}
        <div className="flex p-1 bg-[#F1F5F9] rounded-xl border border-[#E2E8F0] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSelectedSubTab('api-keys')}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              selectedSubTab === 'api-keys'
                ? 'bg-white text-[#1E293B] shadow-xs'
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            Fournisseurs & Clés API
          </button>
          <button
            type="button"
            onClick={() => setSelectedSubTab('models')}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
              selectedSubTab === 'models'
                ? 'bg-white text-[#1E293B] shadow-xs'
                : 'text-[#64748B] hover:text-[#1E293B]'
            }`}
          >
            Modèles LLM du Studio ({models.length})
          </button>
        </div>
      </div>

      <div className="p-6 sm:px-8 max-w-5xl space-y-8">
        {/* ================================================================ */}
        {/* SECTION 1: API KEYS                                              */}
        {/* ================================================================ */}
        {selectedSubTab === 'api-keys' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-bold text-[#1E293B]">
                  Fournisseurs d'Intelligence Artificielle
                </h2>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  Vos clés sont stockées localement dans votre navigateur et utilisées pour alimenter l'Assistant.
                </p>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Chiffrement local</span>
              </div>
            </div>

            {/* Providers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {apiKeys.map((config) => {
                const provider = config.provider;
                const isSaved = savedFeedback[provider];
                const isConfigured = Boolean(config.key && config.key.trim().length > 0);
                const currentDraft = keyDrafts[provider];
                const isRevealed = showKey[provider];

                return (
                  <div
                    key={provider}
                    id={`api-card-${provider}`}
                    className="p-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] flex flex-col justify-between space-y-4 hover:border-[#CBD5E1] transition-all"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-white border border-[#E2E8F0] flex items-center justify-center text-[#1E293B] shadow-2xs font-bold text-xs">
                            {provider === 'openrouter' ? 'OR' : provider === 'anthropic' ? 'CL' : provider === 'deepseek' ? 'DS' : 'GQ'}
                          </div>
                          <div>
                            <h3 className="font-bold text-[14px] text-[#1E293B]">
                              {config.name}
                            </h3>
                            <span className="text-[11px] font-mono text-[#64748B]">
                              {config.category === 'voice' ? 'Transcription Vocale' : 'Moteur LLM'}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            isConfigured
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-zinc-200 text-zinc-600'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isConfigured ? 'bg-emerald-600' : 'bg-zinc-400'
                            }`}
                          />
                          <span>{isConfigured ? 'Prêt' : 'Non renseigné'}</span>
                        </span>
                      </div>

                      <p className="text-[12px] text-[#64748B] mt-2.5 leading-relaxed">
                        {config.description}
                      </p>
                    </div>

                    {/* Input field + Save action */}
                    <div className="space-y-2 pt-2 border-t border-[#E2E8F0]/70">
                      <div className="relative flex items-center">
                        <input
                          type={isRevealed ? 'text' : 'password'}
                          value={currentDraft}
                          onChange={(e) =>
                            setKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))
                          }
                          placeholder={config.placeholder || 'Entrez votre clé secrète...'}
                          className="w-full pl-3 pr-10 py-2 text-[12px] font-mono bg-white border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:outline-none focus:border-black placeholder:text-[#94A3B8]"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))
                          }
                          className="absolute right-2.5 text-[#94A3B8] hover:text-[#1E293B]"
                        >
                          {isRevealed ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <a
                          href={providerDocs[provider]?.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-[#64748B] hover:text-black hover:underline flex items-center gap-1 font-medium"
                        >
                          <span>{providerDocs[provider]?.label}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>

                        <button
                          type="button"
                          onClick={() => handleKeySave(provider)}
                          className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            isSaved
                              ? 'bg-emerald-600 text-white'
                              : 'bg-black hover:bg-zinc-800 text-white shadow-2xs'
                          }`}
                        >
                          {isSaved ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Enregistré</span>
                            </>
                          ) : (
                            <span>Enregistrer</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* SECTION 2: LLM MODELS CATALOG                                    */}
        {/* ================================================================ */}
        {selectedSubTab === 'models' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-bold text-[#1E293B]">
                  Catalogue des modèles LLM disponibles
                </h2>
                <p className="text-[12px] text-[#64748B] mt-0.5">
                  Modèles compatibles avec l'Assistant pour l'imputation SYSCOHADA et le calcul fiscal.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefreshOpenRouter}
                  disabled={isRefreshingModels}
                  className="px-3 py-1.5 rounded-xl border border-[#E2E8F0] hover:border-black text-[12px] font-semibold text-[#1E293B] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`}
                  />
                  <span>Actualiser catalogue</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenAddModelModal}
                  className="px-3.5 py-1.5 rounded-xl bg-black hover:bg-zinc-800 text-white text-[12px] font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ajouter un modèle</span>
                </button>
              </div>
            </div>

            {/* Models Table */}
            <div className="border border-[#E2E8F0] rounded-2xl overflow-hidden bg-white shadow-2xs">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B] font-semibold">
                  <tr>
                    <th className="px-4 py-3">Modèle</th>
                    <th className="px-4 py-3">ID Technique</th>
                    <th className="px-4 py-3">Fournisseur</th>
                    <th className="px-4 py-3">Raisonnement</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {models.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F8FAFC]/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#1E293B] flex items-center gap-1.5">
                          <span>{m.name}</span>
                          {m.isCustom && (
                            <span className="text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded font-mono">
                              Personnalisé
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#64748B] line-clamp-1">{m.description}</div>
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] text-[#475569]">
                        {m.id}
                      </td>

                      <td className="px-4 py-3 capitalize font-medium text-[#1E293B]">
                        {m.provider}
                      </td>

                      <td className="px-4 py-3">
                        {m.supportsReasoning ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <Sparkles className="w-3 h-3" />
                            <span>Effort configurable</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#94A3B8]">Standard</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {m.isCustom && onDeleteCustomModel ? (
                          <button
                            type="button"
                            onClick={() => onDeleteCustomModel(m.id)}
                            title="Supprimer ce modèle personnalisé"
                            className="p-1 rounded text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#94A3B8] font-mono">Système</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

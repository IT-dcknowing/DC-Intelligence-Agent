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
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
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
  selectedModelId,
  onSelectModel,
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
      className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-y-auto"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Top Header */}
      <div
        className="px-6 sm:px-8 py-5 bg-white sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{ borderBottom: '1px solid #E5E5E7' }}
      >
        <div>
          <h1 className="font-bold tracking-tight" style={{ fontSize: '22px', color: '#09090B' }}>
            Paramètres
          </h1>
          <p style={{ fontSize: '12px', color: '#71717A', marginTop: '2px' }}>
            Clés API et catalogue de modèles LLM
          </p>
        </div>

        {/* Sub-Tabs: capsule Acme style */}
        <div className="flex items-center gap-1 self-start sm:self-auto" style={{ padding: '3px', background: '#F4F4F5', borderRadius: '8px', border: '1px solid #E5E5E7' }}>
          <button
            type="button"
            onClick={() => setSelectedSubTab('api-keys')}
            className="cursor-pointer transition-all"
            style={{
              padding: '5px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              background: selectedSubTab === 'api-keys' ? '#000' : 'transparent',
              color: selectedSubTab === 'api-keys' ? '#fff' : '#71717A',
              border: 'none',
            }}
          >
            Clés API
          </button>
          <button
            type="button"
            onClick={() => setSelectedSubTab('models')}
            className="cursor-pointer transition-all"
            style={{
              padding: '5px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              background: selectedSubTab === 'models' ? '#000' : 'transparent',
              color: selectedSubTab === 'models' ? '#fff' : '#71717A',
              border: 'none',
            }}
          >
            Modèles ({models.length})
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

              <div className="flex items-center gap-1.5" style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', padding: '3px 10px' }}>
                <ShieldCheck style={{ width: 12, height: 12, strokeWidth: 1.75 }} />
                <span>Stockage local</span>
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
                    className="flex flex-col justify-between space-y-4"
                    style={{ padding: '18px', borderRadius: '12px', border: '1px solid #E5E5E7', background: '#fff', transition: 'border-color 150ms' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#D4D4D8'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; }}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center font-bold" style={{ width: 30, height: 30, borderRadius: '8px', background: '#09090B', color: '#fff', fontSize: '11px', flexShrink: 0 }}>
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

                        {/* Status Badge — monochrome */}
                        <span
                          className="inline-flex items-center gap-1"
                          style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', color: '#52525B' }}
                        >
                          <span
                            style={{ width: 5, height: 5, borderRadius: '50%', background: isConfigured ? '#71717A' : '#D4D4D8', display: 'inline-block' }}
                          />
                          <span>{isConfigured ? 'Configuré' : 'Vide'}</span>
                        </span>
                      </div>

                      <p className="text-[12px] text-[#64748B] mt-2.5 leading-relaxed">
                        {config.description}
                      </p>
                    </div>

                    {/* Input field + Save action */}
                    <div className="space-y-2 pt-3" style={{ borderTop: '1px solid #F4F4F5' }}>
                      <div className="relative flex items-center">
                        <input
                          type={isRevealed ? 'text' : 'password'}
                          value={currentDraft}
                          onChange={(e) =>
                            setKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))
                          }
                          placeholder={config.placeholder || 'sk-...'}
                          style={{ width: '100%', paddingLeft: 10, paddingRight: 36, paddingTop: 8, paddingBottom: 8, fontSize: '12px', fontFamily: 'monospace', background: '#FAFAFA', border: '1px solid #E5E5E7', borderRadius: '8px', color: '#09090B', outline: 'none' }}
                          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#000'; (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; (e.currentTarget as HTMLElement).style.background = '#FAFAFA'; }}
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
                          className="flex items-center gap-1.5 cursor-pointer transition-all"
                          style={{ padding: '6px 13px', background: '#000', color: '#fff', border: '1px solid #000', borderRadius: '7px', fontSize: '12px', fontWeight: 600 }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#18181B'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#000'; }}
                        >
                          {isSaved ? (
                            <>
                              <Check style={{ width: 12, height: 12, strokeWidth: 2.5 }} />
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

            {/* Models Table or Empty State */}
            {models.length === 0 ? (
              <div className="p-8 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#09090B] text-white flex items-center justify-center mx-auto shadow-sm">
                  <Cpu className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-[15px] text-[#1E293B]">
                    Aucune clé API enregistrée pour le catalogue dynamique
                  </h4>
                  <p className="text-[12px] text-[#64748B] max-w-md mx-auto mt-1 leading-relaxed">
                    Pour afficher la liste dynamique des modèles disponibles sur OpenRouter ou un autre fournisseur, veuillez ajouter et enregistrer votre clé API dans l'onglet <strong>"Clés API"</strong>.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ border: '1px solid #E5E5E7', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
                <table className="w-full text-left" style={{ fontSize: '12px' }}>
                  <thead style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E5E7' }}>
                    <tr>
                      <th className="px-4 py-3" style={{ color: '#71717A', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Modèle</th>
                      <th className="px-4 py-3" style={{ color: '#71717A', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</th>
                      <th className="px-4 py-3" style={{ color: '#71717A', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fournisseur</th>
                      <th className="px-4 py-3" style={{ color: '#71717A', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Statut / Actif</th>
                      <th className="px-4 py-3" style={{ color: '#71717A', fontWeight: 500, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m, i) => {
                      const isSelected = selectedModelId === m.id;

                      return (
                        <tr
                          key={m.id}
                          style={{ borderTop: i === 0 ? 'none' : '1px solid #F4F4F5' }}
                          className={isSelected ? 'bg-zinc-50/80' : ''}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#FAFAFA'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected ? '#FAF9F6' : 'transparent'; }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[13px] text-[#09090B]">{m.name}</span>
                              {isSelected && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#09090B] text-white shadow-xs">
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Sélectionné</span>
                                </span>
                              )}
                              {m.isCustom && (
                                <span style={{ fontSize: '10px', background: '#F4F4F5', color: '#52525B', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace', border: '1px solid #E5E5E7' }}>
                                  Custom
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: '#71717A' }} className="line-clamp-1">{m.description}</div>
                          </td>

                          <td className="px-4 py-3" style={{ fontFamily: 'monospace', fontSize: '11px', color: '#A1A1AA' }}>
                            {m.id}
                          </td>

                          <td className="px-4 py-3" style={{ fontWeight: 500, fontSize: '12px', color: '#52525B', textTransform: 'capitalize' }}>
                            {m.provider}
                          </td>

                          <td className="px-4 py-3">
                            {isSelected ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                <span>Actif en session</span>
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#A1A1AA' }}>Disponible</span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {!isSelected && onSelectModel && (
                                <button
                                  type="button"
                                  onClick={() => onSelectModel(m.id)}
                                  className="px-2.5 py-1 rounded-md border border-[#E2E8F0] hover:border-black text-[11px] font-semibold text-[#1E293B] hover:bg-black hover:text-white transition-all cursor-pointer"
                                >
                                  Activer
                                </button>
                              )}

                              {m.isCustom && onDeleteCustomModel && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteCustomModel(m.id)}
                                  title="Supprimer ce modèle"
                                  style={{ padding: '4px', borderRadius: '6px', color: '#71717A', background: 'none', border: 'none', cursor: 'pointer' }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#09090B'; (e.currentTarget as HTMLElement).style.background = '#F4F4F5'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#71717A'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
                                >
                                  <Trash2 style={{ width: 13, height: 13 }} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

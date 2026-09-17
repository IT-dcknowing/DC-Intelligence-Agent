import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../config/env';
import { normalizeIntegration } from '../services/storeApi';
import {
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Plus,
  Trash2,
  Layers,
  ArrowRight,
  ShieldCheck,
  Zap,
  Clock,
  Send,
  Database,
  Unlink,
  Scale,
  Calculator,
  Server,
} from 'lucide-react';
import { WorkspaceIntegration } from '../types';

interface ConnectionsViewProps {
  integrations: WorkspaceIntegration[];
  onToggleConnect: (integrationId: string) => void;
  onSyncNow: (integrationId: string) => void;
  onSetTargetResource: (integrationId: string, resourceName: string) => void;
  // Appelé quand le flux OAuth backend réussit (email réel issu du compte Google).
  onGoogleOAuthSuccess?: (integrationId: string, email: string) => void;
}

const isGoogleIntegration = (id: string) => id === 'google-sheets' || id === 'google-docs';

export const ConnectionsView: React.FC<ConnectionsViewProps> = ({
  integrations: integrationsProp,
  onToggleConnect,
  onSyncNow,
  onSetTargetResource,
  onGoogleOAuthSuccess,
}) => {
  // Normalisation défensive : chaque objet est garanti complet (scopes, syncHistory…).
  // Un objet empoisonné (null, id inconnu, scopes manquant) est écarté ici plutôt
  // que de faire planter le rendu en permanence.
  const integrations: WorkspaceIntegration[] = (Array.isArray(integrationsProp) ? integrationsProp : [])
    .map(normalizeIntegration)
    .filter((x): x is WorkspaceIntegration => x !== null);
  const [selectedId, setSelectedId] = useState<string>(integrations[0]?.id || 'google-sheets');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [customResourceDraft, setCustomResourceDraft] = useState<string>('');
  const [isEditingResource, setIsEditingResource] = useState<boolean>(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Garde-fou : si la liste est vide ou l'id sélectionné n'existe plus, retombe proprement.
  // Objet de repli typé pour que tous les hooks/handlers restent inconditionnels (règles React).
  const EMPTY_INTEGRATION: WorkspaceIntegration = {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: '',
    iconType: 'sheets',
    status: 'disconnected',
    scopes: [],
    syncCount: 0,
    syncHistory: [],
  };
  const selectedIntegration: WorkspaceIntegration =
    integrations.find((i) => i.id === selectedId) || integrations[0] || EMPTY_INTEGRATION;
  const isEmpty = integrations.length === 0;

  // Réconciliation avec le coffre backend : l'état local (cache) peut mentir
  // (tokens présents mais carte "Non associé", ou l'inverse après révocation).
  // Le vault Firestore via /api/google/status fait foi, sans jamais exposer de secret.
  const reconciledRef = useRef(false);
  const lastFocusCheckRef = useRef(0);
  const reconcileGoogleStatus = useCallback(
    async (announce: boolean) => {
      for (const item of integrations.filter((i) => isGoogleIntegration(i.id))) {
        try {
          const res = await fetch(apiUrl(`/google/status?integration=${item.id}`));
          const json = await res.json().catch(() => ({}));
          const connected = res.ok && Boolean((json as any)?.connected);
          if (connected && item.status !== 'connected' && onGoogleOAuthSuccess) {
            onGoogleOAuthSuccess(item.id, String((json as any)?.email || ''));
            if (announce) {
              setFeedbackNotice(`${item.name} : session Google retrouvée (${String((json as any)?.email || 'compte actif')}).`);
              setTimeout(() => setFeedbackNotice(null), 4000);
            }
          } else if (!connected && item.status === 'connected') {
            onToggleConnect(item.id);
            if (announce) {
              setFeedbackNotice(`${item.name} : jeton invalide côté Google, reconnectez le compte.`);
              setTimeout(() => setFeedbackNotice(null), 5000);
            }
          }
        } catch {
          // Backend injoignable : on ne touche à rien (repli local).
        }
      }
    },
    [integrations, onToggleConnect, onGoogleOAuthSuccess]
  );

  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    reconcileGoogleStatus(false);
  }, [reconcileGoogleStatus]);

  // L'utilisateur peut consentir puis fermer la popup à la main : au retour du
  // focus on revérifie (débouncé 5 s) pour afficher l'état réel sans refresh.
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusCheckRef.current < 5000) return;
      lastFocusCheckRef.current = now;
      reconcileGoogleStatus(false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reconcileGoogleStatus]);

  const isLegalFlow = selectedIntegration.id === 'legal-flow';
  const isComptaFlow = selectedIntegration.id === 'compta-flow';
  const isMcp = isLegalFlow || isComptaFlow;
  const mcpMeta = isComptaFlow
    ? {
        title: 'Serveur MCP Compta Flow',
        desc: 'Connecteur Model Context Protocol pour la comptabilité SYSCOHADA : plan comptable, écritures (prepare/commit), balances et journaux. Pas de compte Google ici : l’association se fait directement.',
        initials: 'CF',
        notAssociated: 'Le serveur MCP Compta Flow n’est actuellement pas associé.',
      }
    : {
        title: 'Serveur MCP LegalFlow',
        desc: 'Connecteur Model Context Protocol pour la recherche juridique et la conformité fiscale zone OHADA / UEMOA. Pas de compte Google ici : l’association se fait directement.',
        initials: 'LF',
        notAssociated: 'Le serveur MCP LegalFlow n’est actuellement pas associé.',
      };

  // Écoute le retour de la popup OAuth (postMessage du backend après échange code<->tokens).
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as any;
      if (!data || data.type !== 'google-oauth' || typeof data.ok !== 'boolean') return;
      if (data.ok) {
        try {
          const res = await fetch(apiUrl(`/google/status?integration=${selectedIntegration.id}`));
          const json = await res.json().catch(() => ({}));
          if (onGoogleOAuthSuccess) {
            onGoogleOAuthSuccess(selectedIntegration.id, String((json as any)?.email || ''));
          } else {
            onToggleConnect(selectedIntegration.id);
          }
          setFeedbackNotice(`${selectedIntegration.name} est maintenant connecté (OAuth 2.0).`);
        } catch {
          onToggleConnect(selectedIntegration.id);
          setFeedbackNotice(`${selectedIntegration.name} est maintenant connecté.`);
        }
      } else {
        setFeedbackNotice(`Connexion Google refusée ou échouée (${String(data.label || 'erreur').slice(0, 80)}).`);
      }
      setTimeout(() => setFeedbackNotice(null), 5000);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectedIntegration.id, selectedIntegration.name, onToggleConnect, onGoogleOAuthSuccess]);

  const handleConnectClick = async () => {
    // Déconnexion : révocation Google côté backend + suppression du coffre Firestore.
    if (selectedIntegration.status === 'connected' && isGoogleIntegration(selectedIntegration.id)) {
      try {
        await fetch(apiUrl('/google/disconnect'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integration: selectedIntegration.id }),
        });
      } catch { /* repli : bascule locale quand même */ }
      onToggleConnect(selectedIntegration.id);
      setFeedbackNotice(`${selectedIntegration.name} est maintenant déconnecté (jeton révoqué).`);
      setTimeout(() => setFeedbackNotice(null), 3000);
      return;
    }
    // Connexion Google : le flux passe par le backend (generateAuthUrl), jamais en implicite.
    // LegalFlow MCP garde son toggle direct (pas de Google).
    if (selectedIntegration.status !== 'connected' && isGoogleIntegration(selectedIntegration.id)) {
      try {
        // Origine transmise au backend : le callback y renvoie le postMessage (allowlist côté serveur).
        const res = await fetch(
          apiUrl(`/google/auth-url?integration=${selectedIntegration.id}&origin=${encodeURIComponent(window.location.origin)}`)
        );
        const json = await res.json().catch(() => ({}));
        const url = String((json as any)?.url || '');
        if (!res.ok || !url) {
          const detail = String((json as any)?.detail || (json as any)?.error || 'serveur injoignable').slice(0, 160);
          setFeedbackNotice(`OAuth indisponible : ${detail} — vérifiez GOOGLE_OAUTH_CLIENT_ID/SECRET côté backend.`);
          setTimeout(() => setFeedbackNotice(null), 6000);
          return;
        }
        window.open(url, '_blank', 'width=520,height=640');
        setFeedbackNotice(`Fenêtre Google ouverte — autorisez l'accès ${selectedIntegration.name} puis revenez.`);
        setTimeout(() => setFeedbackNotice(null), 8000);
        return;
      } catch {
        setFeedbackNotice('OAuth indisponible : serveur injoignable.');
        setTimeout(() => setFeedbackNotice(null), 5000);
        return;
      }
    }
    onToggleConnect(selectedIntegration.id);
    const nextStatus = selectedIntegration.status === 'connected' ? 'déconnecté' : 'connecté';
    setFeedbackNotice(`${selectedIntegration.name} est maintenant ${nextStatus}.`);
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  const handleTriggerSync = async () => {
    // Pré-contrôle réel : inutile de déclarer un succès si le jeton est mort côté Google.
    if (isGoogleIntegration(selectedIntegration.id)) {
      try {
        const res = await fetch(apiUrl(`/google/status?integration=${selectedIntegration.id}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !(json as any)?.connected) {
          if (selectedIntegration.status === 'connected') onToggleConnect(selectedIntegration.id);
          setFeedbackNotice(`Synchronisation impossible : compte Google non connecté pour ${selectedIntegration.name}. Reconnectez-le d'abord.`);
          setTimeout(() => setFeedbackNotice(null), 5000);
          return;
        }
      } catch {
        // Backend injoignable : on continue en mode local (repli dev).
      }
    }
    setIsSyncing(true);
    setTimeout(() => {
      onSyncNow(selectedIntegration.id);
      setIsSyncing(false);
      setFeedbackNotice(`Synchronisation réussie avec ${selectedIntegration.name} !`);
      setTimeout(() => setFeedbackNotice(null), 3000);
    }, 1200);
  };

  const handleSaveResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (customResourceDraft.trim()) {
      onSetTargetResource(selectedIntegration.id, customResourceDraft.trim());
      setIsEditingResource(false);
      setFeedbackNotice(`Fichier cible mis à jour : ${customResourceDraft.trim()}`);
      setTimeout(() => setFeedbackNotice(null), 3000);
    }
  };

  const handleCreateDefaultResource = () => {
    const defaultName =
      selectedIntegration.id === 'google-sheets'
        ? `DC Intelligence - Journal Général ${new Date().getFullYear()}.gsheet`
        : `DC Intelligence - Rapport Financier ${new Date().getFullYear()}.gdoc`;
    onSetTargetResource(selectedIntegration.id, defaultName);
    setFeedbackNotice(`Nouveau fichier configuré : ${defaultName}`);
    setTimeout(() => setFeedbackNotice(null), 3000);
  };

  // État vide géré (après tous les hooks) au lieu de crasher avec TypeError.
  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white" style={{ fontFamily: "'Inter', sans-serif" }}>
        <div className="w-12 h-12 rounded-xl bg-[#F4F4F5] border border-[#E5E5E7] flex items-center justify-center mb-3">
          <Layers className="w-6 h-6 text-[#71717A]" />
        </div>
        <h3 className="font-bold text-[15px] text-[#1E293B]">Impossible de charger les connexions</h3>
        <p className="text-[12px] text-[#64748B] max-w-md mt-1">Aucune intégration disponible. Vérifiez la configuration Firestore ou rechargez la page.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full min-w-0 overflow-hidden bg-white" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ==================================================================== */}
      {/* COLONNE CENTRALE : LISTE DES INTÉGRATIONS DISPONIBLES                */}
      {/* ==================================================================== */}
      <aside
        id="connections-list-sidebar"
        className="w-[290px] md:w-[320px] h-full flex flex-col shrink-0 select-none z-10"
        style={{ borderRight: '1px solid #E5E5E7', background: '#FAFAFA' }}
      >
        {/* Header */}
        <div className="p-4 space-y-1" style={{ borderBottom: '1px solid #E5E5E7', background: '#fff' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center font-bold text-xs shadow-xs">
              <Layers className="w-4 h-4" />
            </div>
            <h2 className="text-[16px] font-bold text-[#1E293B] tracking-tight">
              Connexions
            </h2>
          </div>
          <p className="text-[12px] text-[#64748B]">
            Intégrations bureautiques & comptables
          </p>
        </div>

        {/* Clickable Integrations list */}
        <div id="connections-items-list" className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {integrations.map((item) => {
            if (!item || !item.id) return null;
            const isSelected = selectedId === item.id;
            const isConnected = item.status === 'connected';

            return (
              <div
                key={item.id}
                id={`integration-card-${item.id}`}
                onClick={() => {
                  setSelectedId(item.id);
                  setIsEditingResource(false);
                }}
                className={`p-3.5 rounded-xl cursor-pointer transition-all duration-150 border ${
                  isSelected
                    ? 'bg-white border-black text-[#09090B] shadow-xs'
                    : 'bg-transparent border-[#E2E8F0] hover:bg-white/80 hover:border-[#CBD5E1] text-[#475569]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        item.id === 'google-sheets'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : item.id === 'legal-flow'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : item.id === 'compta-flow'
                          ? 'bg-teal-50 text-teal-700 border-teal-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      {item.id === 'google-sheets' ? (
                        <FileSpreadsheet className="w-5 h-5" />
                      ) : item.id === 'legal-flow' ? (
                        <Scale className="w-5 h-5" />
                      ) : item.id === 'compta-flow' ? (
                        <Calculator className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[13px] text-[#1E293B] truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-[#64748B] truncate">
                        {item.id === 'legal-flow' || item.id === 'compta-flow' ? 'Protocole MCP Server' : 'Google Workspace'}
                      </div>
                    </div>
                  </div>

                  {/* Status Pill */}
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      isConnected
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isConnected ? 'bg-emerald-600' : 'bg-zinc-400'
                      }`}
                    />
                    <span>{isConnected ? 'Connecté' : 'Inactif'}</span>
                  </span>
                </div>

                <p className="text-[11px] text-[#64748B] line-clamp-2 mt-2 leading-relaxed">
                  {item.description}
                </p>

                <div className="mt-2 pt-2 border-t border-zinc-100 flex items-center justify-between text-[10px] text-[#94A3B8]">
                  <span>
                    {isConnected ? item.accountEmail || 'Compte actif' : 'Cliquez pour configurer'}
                  </span>
                  <ArrowRight className="w-3 h-3 text-[#94A3B8]" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Security badge at bottom */}
        <div className="p-3 border-t border-[#E2E8F0] bg-white text-[11px] text-[#64748B] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Authentification sécurisée OAuth 2.0 Google</span>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* COLONNE DROITE : PROCÉDURE DE CONNEXION AVEC LA PLATEFORME CHOISIE   */}
      {/* ==================================================================== */}
      <section
        id="connections-detail-panel"
        className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-y-auto"
      >
        {/* Top Header */}
        <header className="px-6 py-5 border-b border-[#E2E8F0] bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                selectedIntegration.id === 'google-sheets'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : selectedIntegration.id === 'legal-flow'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : selectedIntegration.id === 'compta-flow'
                  ? 'bg-teal-50 text-teal-700 border-teal-200'
                  : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {selectedIntegration.id === 'google-sheets' ? (
                <FileSpreadsheet className="w-6 h-6" />
              ) : selectedIntegration.id === 'legal-flow' ? (
                <Scale className="w-6 h-6" />
              ) : selectedIntegration.id === 'compta-flow' ? (
                <Calculator className="w-6 h-6" />
              ) : (
                <FileText className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[18px] font-bold text-[#1E293B]">
                  Procédure de connexion : {selectedIntegration.name}
                </h1>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    selectedIntegration.status === 'connected'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {selectedIntegration.status === 'connected' ? 'Connecté' : 'Non associé'}
                </span>
              </div>
              <p className="text-[12px] text-[#64748B] mt-0.5">
                {selectedIntegration.description}
              </p>
            </div>
          </div>

          {selectedIntegration.status === 'connected' && (
            <button
              type="button"
              onClick={handleTriggerSync}
              disabled={isSyncing}
              className="px-3.5 py-2 rounded-xl border border-black bg-black text-white hover:bg-zinc-800 font-semibold text-[12px] flex items-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Synchronisation...' : 'Synchroniser'}</span>
            </button>
          )}
        </header>

        {/* Feedback Alert Toast Bar */}
        {feedbackNotice && (
          <div className="bg-[#F4F4F5] border-b border-[#E4E4E7] px-6 py-2.5 text-[12px] text-[#18181B] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold">{feedbackNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackNotice(null)}
              className="text-[#71717A] hover:text-black"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 max-w-4xl space-y-6">
          {/* ================================================================ */}
          {/* ================================================================ */}
          {/* ÉTAPE 1 : COMPTE / SERVEUR (Google OAuth vs MCP Legal/Compta)      */}
          {/* ================================================================ */}
          {isMcp ? (
          <div className="p-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="font-bold text-[15px] text-[#1E293B]">
                  {mcpMeta.title}
                </h3>
              </div>

              <span className="text-[11px] text-[#64748B] font-mono">
                Protocole MCP
              </span>
            </div>

            <p className="text-[13px] text-[#64748B] leading-relaxed">
              {mcpMeta.desc}
            </p>

            {selectedIntegration.status === 'connected' ? (
              <div className="p-4 rounded-xl bg-white border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-800 font-bold flex items-center justify-center text-sm border border-purple-300">
                    {mcpMeta.initials}
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-[#1E293B] font-mono">
                      {selectedIntegration.endpointUrl || 'Endpoint MCP non configuré'}
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Associé • Protocole MCP actif
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConnectClick}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 font-semibold text-[12px] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Dissocier</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] space-y-3">
                <p className="text-[12px] text-[#475569]">
                  {mcpMeta.notAssociated}
                </p>

                <button
                  type="button"
                  onClick={handleConnectClick}
                  className="px-4 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-semibold text-[13px] flex items-center gap-2 transition-all shadow-xs cursor-pointer active:scale-95"
                >
                  <Scale className="w-4 h-4" />
                  <span>Associer le serveur MCP</span>
                </button>
              </div>
            )}

            {/* Scopes description */}
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1.5">
              <span>Outils exposés :</span>
              <code className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded font-mono">
                {selectedIntegration.scopes.join(', ')}
              </code>
            </div>
          </div>
          ) : (
          <div className="p-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="font-bold text-[15px] text-[#1E293B]">
                  Compte Google Workspace
                </h3>
              </div>

              <span className="text-[11px] text-[#64748B] font-mono">
                Protocole OAuth 2.0
              </span>
            </div>

            <p className="text-[13px] text-[#64748B] leading-relaxed">
              Associez votre compte Google professionnel pour autoriser l'Assistant Compta Flow à écrire directement dans vos classeurs ou documents sans quitter l'application.
            </p>

            {selectedIntegration.status === 'connected' ? (
              <div className="p-4 rounded-xl bg-white border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-sm border border-emerald-300">
                    {(selectedIntegration.accountEmail?.[0] || 'G').toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[13px] font-bold text-[#1E293B]">
                      {selectedIntegration.accountEmail || 'Compte Google connecté'}
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      Connecté le {selectedIntegration.connectedAt || 'À l’instant'} • Jeton OAuth 2.0 actif
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConnectClick}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 font-semibold text-[12px] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Déconnecter</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] space-y-3">
                <p className="text-[12px] text-[#475569]">
                  Aucun compte Google Workspace n'est actuellement relié pour {selectedIntegration.name}.
                </p>

                <button
                  type="button"
                  id="connect-google-btn"
                  onClick={handleConnectClick}
                  className="px-4 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-semibold text-[13px] flex items-center gap-2 transition-all shadow-xs cursor-pointer active:scale-95"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5.1 3.7-8.9z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.8s.7 5.1 1.9 7.5l3.7-2.9z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.4C3.7 20.1 7.5 23 12 23z"
                    />
                  </svg>
                  <span>Connecter avec Google Workspace</span>
                </button>
              </div>
            )}

            {/* Scopes description */}
            <div className="text-[11px] text-[#94A3B8] flex items-center gap-1.5">
              <span>Autorisation demandée :</span>
              <code className="bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded font-mono">
                {(selectedIntegration.scopes || []).join(', ') || '—'}
              </code>
            </div>
          </div>
          )}

          {/* ================================================================ */}
          {/* ÉTAPE 2 : CLASSEUR OU DOCUMENT CIBLE                             */}
          {/* ================================================================ */}
          <div className="p-5 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold flex items-center justify-center">
                  2
                </span>
                <h3 className="font-bold text-[15px] text-[#1E293B]">
                  {selectedIntegration.id === 'google-sheets'
                    ? 'Classeur cible & Feuilles comptables'
                    : isMcp
                    ? 'Ressource cible MCP'
                    : 'Modèle de document cible'}
                </h3>
              </div>

              <span className="text-[11px] font-semibold text-[#64748B]">
                SYSCOHADA Standard
              </span>
            </div>

            <p className="text-[13px] text-[#64748B]">
              {selectedIntegration.id === 'google-sheets'
                ? 'Sélectionnez le fichier Google Sheets dans lequel les écritures comptables générées par l’Assistant seront automatiquement insérées.'
                : isComptaFlow
                ? 'Nom logique de la ressource Compta Flow interrogée par les agents (plan comptable, écritures, balances).'
                : isLegalFlow
                ? 'Nom logique de la ressource LegalFlow interrogée par les agents (recherche juridique, conformité fiscale).'
                : 'Sélectionnez le document Google Docs qui recevra vos lettres de mission, rapports d’audit ou synthèses de bilan.'}
            </p>

            <div className="p-4 rounded-xl bg-white border border-[#E2E8F0] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="w-4 h-4 text-black shrink-0" />
                  <span className="text-[13px] font-semibold text-[#1E293B] truncate">
                    {selectedIntegration.targetResource || 'Aucun fichier sélectionné'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomResourceDraft(selectedIntegration.targetResource || '');
                      setIsEditingResource((prev) => !prev);
                    }}
                    className="px-3 py-1 text-[12px] font-semibold rounded-lg border border-[#E2E8F0] hover:border-black text-[#1E293B] transition-colors"
                  >
                    {isEditingResource ? 'Annuler' : 'Changer'}
                  </button>

                  {!isMcp && (
                    <button
                      type="button"
                      onClick={handleCreateDefaultResource}
                      className="px-3 py-1 text-[12px] font-semibold rounded-lg bg-zinc-100 hover:bg-zinc-200 text-black transition-colors"
                    >
                      + Créer fichier type
                    </button>
                  )}
                </div>
              </div>

              {isEditingResource && (
                <form onSubmit={handleSaveResource} className="pt-2 flex gap-2">
                  <input
                    type="text"
                    value={customResourceDraft}
                    onChange={(e) => setCustomResourceDraft(e.target.value)}
                    placeholder="Nom du fichier ou lien Google Drive..."
                    className="flex-1 px-3 py-1.5 text-[12px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-black"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-black text-white text-[12px] font-semibold rounded-lg hover:bg-zinc-800"
                  >
                    Enregistrer
                  </button>
                </form>
              )}

              {/* Format Preview */}
              {isMcp ? (
                <div className="mt-3 pt-3 border-t border-zinc-100 text-[11px] text-[#64748B]">
                  <span className="font-semibold text-[#1E293B] block mb-1">
                    Endpoint interrogé :
                  </span>
                  <code className="font-mono text-[10px] bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded">
                    {selectedIntegration.endpointUrl || 'non configuré'}
                  </code>
                </div>
              ) : selectedIntegration.id === 'google-sheets' ? (
                <div className="mt-3 pt-3 border-t border-zinc-100 text-[11px] text-[#64748B]">
                  <span className="font-semibold text-[#1E293B] block mb-1.5">
                    Colonnes synchronisées dans le classeur :
                  </span>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Date</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Journal (ACH/VTE/BQ/OD)</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">N° Pièce</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Compte Débit</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Compte Crédit</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Libellé d'écriture</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Montant HT</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">TVA 18%</span>
                    <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800">Montant TTC</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-zinc-100 text-[11px] text-[#64748B]">
                  <span className="font-semibold text-[#1E293B] block mb-1">
                    Structure du document généré :
                  </span>
                  <p>
                    En-tête cabinet, informations légales client (RCCM, CC), synthèse d'audit comptable, tableau des comptes et conclusions fiscales signées.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ================================================================ */}
          {/* ÉTAPE 3 : HISTORIQUE DE SYNCHRONISATION                          */}
          {/* ================================================================ */}
          <div className="p-5 rounded-2xl border border-[#E2E8F0] bg-white space-y-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Clock className="w-5 h-5 text-black" />
                <h3 className="font-bold text-[15px] text-[#1E293B]">
                  Journal des synchronisations
                </h3>
              </div>

              <span className="text-[12px] font-mono text-[#64748B]">
                {selectedIntegration.syncCount || 0} transferts effectués
              </span>
            </div>

            {Array.isArray(selectedIntegration.syncHistory) && selectedIntegration.syncHistory.length > 0 ? (
              <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl overflow-hidden">
                {selectedIntegration.syncHistory.filter((log) => log && typeof log === 'object').map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-zinc-50/50 hover:bg-zinc-50 flex items-center justify-between text-[12px] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-medium text-[#1E293B]">{log.action}</span>
                    </div>
                    <span className="text-[11px] font-mono text-[#94A3B8] shrink-0">
                      {log.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-[12px] text-[#94A3B8] bg-zinc-50 rounded-xl">
                Aucune synchronisation enregistrée pour l'instant.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

import React, { useState } from 'react';
import {
  BookOpen,
  Scale,
  Settings as WorkflowIcon,
  Users,
  Search,
  Download,
  RefreshCw,
  Sparkles,
  FileText,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';
import { KnowledgeDocument } from '../types';

interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onUploadDocument?: (file: File) => void;
}

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  documents,
  onUploadDocument,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [search, setSearch] = useState('');
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexSuccess, setReindexSuccess] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const getCategoryConfig = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes('norme') || cat.includes('syscohada') || cat.includes('comptable')) {
      return {
        label: 'NORMES COMPTABLES',
        icon: BookOpen,
        color: '#000000',
        bgPill: 'bg-[#F4F4F5]',
        textPill: 'text-black',
        borderPill: 'border-[#E4E4E7]',
        borderLeft: 'border-l-black',
      };
    }
    if (cat.includes('fiscal') || cat.includes('tva') || cat.includes('impôt')) {
      return {
        label: 'FISCALITÉ',
        icon: Scale,
        color: '#71717A',
        bgPill: 'bg-[#F4F4F5]',
        textPill: 'text-zinc-800',
        borderPill: 'border-[#E4E4E7]',
        borderLeft: 'border-l-zinc-700',
      };
    }
    if (cat.includes('procédure') || cat.includes('interne') || cat.includes('process')) {
      return {
        label: 'PROCÉDURES INTERNES',
        icon: WorkflowIcon,
        color: '#52525B',
        bgPill: 'bg-[#F4F4F5]',
        textPill: 'text-zinc-800',
        borderPill: 'border-[#E4E4E7]',
        borderLeft: 'border-l-zinc-600',
      };
    }
    return {
      label: 'SOCIAL & PAIE',
      icon: Users,
      color: '#27272A',
      bgPill: 'bg-[#F4F4F5]',
      textPill: 'text-zinc-900',
      borderPill: 'border-[#E4E4E7]',
      borderLeft: 'border-l-zinc-900',
    };
  };

  const filteredDocs = documents.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.category.toLowerCase().includes(search.toLowerCase()) ||
      d.summary.toLowerCase().includes(search.toLowerCase())
  );

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0];

  const handleReindex = () => {
    setIsReindexing(true);
    setTimeout(() => {
      setIsReindexing(false);
      setReindexSuccess(true);
      setTimeout(() => setReindexSuccess(false), 2500);
    }, 1200);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (onUploadDocument) {
        onUploadDocument(e.dataTransfer.files[0]);
      }
    }
  };

  return (
    <div
      id="knowledge-base-shell"
      className="flex-1 flex h-full min-w-0 select-none font-['Montserrat']"
    >
      {/* Column 1: Document list */}
      <div
        id="knowledge-list-panel"
        className="w-[360px] xl:w-[400px] shrink-0 border-r border-[#E2E8F0] bg-white flex flex-col h-full"
      >
        <div className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <h1 className="text-[22px] font-bold text-[#1E293B] tracking-tight">
            Base de connaissances
          </h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Référentiels & Documentation comptable
          </p>
          <div className="relative mt-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="knowledge-search-input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher norme, compte, procédure..."
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-white border border-[#E2E8F0] rounded-xl placeholder:text-[#94A3B8] focus:outline-none focus:border-black focus:ring-2 focus:ring-black/15 text-[#1E293B] transition-all"
            />
          </div>
        </div>

        <div id="knowledge-docs-list" className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {filteredDocs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[#64748B]">
              <FileText className="w-12 h-12 text-[#94A3B8] mb-2 stroke-[1.5]" />
              <p className="text-[14px] font-semibold text-[#1E293B]">Aucun document trouvé</p>
              <p className="text-[12px] text-[#64748B] mt-1">
                Ajustez vos termes de recherche ou déposez un nouveau document.
              </p>
            </div>
          ) : (
            filteredDocs.map((doc) => {
              const isSelected = selectedDoc?.id === doc.id;
              const config = getCategoryConfig(doc.category);
              const CategoryIcon = config.icon;

              return (
                <div
                  key={doc.id}
                  id={`knowledge-doc-${doc.id}`}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`p-3.5 rounded-xl cursor-pointer transition-all duration-200 border border-l-4 ${
                    config.borderLeft
                  } ${
                    isSelected
                      ? 'bg-[#F8FAFC] border-t-black border-r-black border-b-black shadow-md -translate-y-0.5'
                      : 'bg-white border-[#E2E8F0] hover:shadow-lg hover:-translate-y-0.5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs"
                      style={{ backgroundColor: `${config.color}15`, color: config.color }}
                    >
                      <CategoryIcon className="w-5 h-5 stroke-[2]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full border ${config.bgPill} ${config.textPill} ${config.borderPill}`}
                        >
                          {config.label}
                        </span>
                      </div>

                      <h3 className="text-[13px] font-semibold text-[#1E293B] leading-snug line-clamp-2 mt-1">
                        {doc.title}
                      </h3>

                      <div className="flex items-center gap-2 mt-2 text-[12px] text-[#94A3B8] font-mono">
                        <span>{doc.lastUpdated}</span>
                        <span>·</span>
                        <span>{doc.size}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Column 2: Document Detail Panel */}
      {selectedDoc ? (
        <div
          id="knowledge-detail-panel"
          className="flex-1 flex flex-col h-full bg-white overflow-y-auto"
        >
          {/* Header with 56px category icon + title (Montserrat 700 20px) */}
          <header className="p-8 border-b border-[#E2E8F0] bg-white flex items-start justify-between gap-6 shrink-0">
            <div className="flex items-start gap-4 min-w-0">
              {(() => {
                const config = getCategoryConfig(selectedDoc.category);
                const Icon = config.icon;
                return (
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                    style={{ backgroundColor: `${config.color}20`, color: config.color }}
                  >
                    <Icon className="w-7 h-7 stroke-[2]" />
                  </div>
                );
              })()}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  {(() => {
                    const config = getCategoryConfig(selectedDoc.category);
                    return (
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${config.bgPill} ${config.textPill} ${config.borderPill}`}
                      >
                        {config.label}
                      </span>
                    );
                  })()}
                  <span className="text-[12px] text-[#64748B] bg-[#F1F5F9] px-2.5 py-0.5 rounded-full font-mono">
                    {selectedDoc.size}
                  </span>
                  <span className="text-[12px] text-[#64748B] bg-[#F1F5F9] px-2.5 py-0.5 rounded-full font-mono">
                    Mise à jour : {selectedDoc.lastUpdated}
                  </span>
                </div>

                <h2 className="text-[20px] font-bold text-[#1E293B] tracking-tight leading-snug">
                  {selectedDoc.title}
                </h2>
              </div>
            </div>

            {/* Action Buttons: Télécharger & Re-indexer */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleReindex}
                disabled={isReindexing}
                className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569] text-[13px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isReindexing ? 'animate-spin text-black' : ''}`} />
                <span>{isReindexing ? 'Indexation...' : 'Re-indexer'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([selectedDoc.summary], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${selectedDoc.title}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-5 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white text-[13px] font-semibold flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger</span>
              </button>
            </div>
          </header>

          {/* Body Content */}
          <div className="p-8 max-w-4xl space-y-6">
            {reindexSuccess && (
              <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[#10B981] text-[13px] font-medium flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Vectorisation et indexation RAG mises à jour pour tous les agents.</span>
              </div>
            )}

            {/* Section Description */}
            <div className="p-5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
              <h3 className="text-[14px] font-bold text-[#1E293B] uppercase tracking-wide">
                Description & Portée Normative
              </h3>
              <p className="text-[14px] text-[#475569] leading-relaxed whitespace-pre-line">
                {selectedDoc.summary}
              </p>
            </div>

            {/* Section Indexation pour les agents IA */}
            <div className="p-6 rounded-2xl border border-[#E4E4E7] bg-[#F4F4F5]/70 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center shadow-xs">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-[#1E293B]">
                      Indexation pour les agents IA (RAG)
                    </h3>
                    <p className="text-[12px] text-[#64748B]">
                      Chunks sémantiques actifs dans la mémoire vectorielle de l'espace comptable
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[12px] font-semibold text-black bg-white px-3 py-1.5 rounded-full border border-[#E4E4E7] shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-black animate-ping" />
                  <span>Indexé (Vector DB)</span>
                </div>
              </div>

              {/* Linked agents pills */}
              <div>
                <span className="text-[12px] font-semibold text-[#475569] block mb-2">
                  Agents connectés à ce document :
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Agent Rapprochement Bancaire',
                    'Agent Déclaration Fiscale & TVA',
                    'Agent Facturation & Relance Client',
                  ].map((agentName) => (
                    <span
                      key={agentName}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[#E4E4E7] text-[12px] font-semibold text-[#1E293B] hover:border-black hover:shadow-xs transition-all cursor-pointer"
                    >
                      ✨ {agentName}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Drag & Drop Upload Zone (Chantier 7) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center transition-all ${
                isDragOver
                  ? 'border-black bg-[#F4F4F5]'
                  : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#94A3B8]'
              }`}
            >
              <UploadCloud className="w-9 h-9 text-[#64748B] mb-2 stroke-[1.75]" />
              <p className="text-[14px] font-semibold text-[#1E293B]">
                Importez un nouveau document de référence
              </p>
              <p className="text-[12px] text-[#64748B] mt-1 max-w-sm">
                Glissez-déposez vos fichiers PDF, relevés SYSCOHADA ou barèmes fiscaux ici pour indexation automatique.
              </p>
              <label className="mt-3.5 px-4 py-2 rounded-xl text-[12px] font-semibold bg-white border border-[#E2E8F0] hover:bg-neutral-50 text-[#1E293B] cursor-pointer shadow-xs transition-colors">
                <span>Parcourir mes fichiers</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0] && onUploadDocument) {
                      onUploadDocument(e.target.files[0]);
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#64748B]">
          <BookOpen className="w-12 h-12 text-[#94A3B8] mb-2" />
          <h3 className="text-[16px] font-bold text-[#1E293B]">
            Importez votre premier document
          </h3>
          <p className="text-[13px] text-[#64748B] mt-1 max-w-xs">
            Ajoutez le plan comptable SYSCOHADA ou des procédures internes pour guider vos agents IA.
          </p>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
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
  Trash2,
  X,
  Eye,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { KnowledgeDocument } from '../types';
import { downloadKnowledge, base64ToBlob } from '../services/storeApi';

interface KnowledgeBaseViewProps {
  documents: KnowledgeDocument[];
  onUploadDocument?: (file: File) => void;
  onAddTextDocument?: (title: string, text: string, category: string) => void;
  onDeleteDocument?: (id: string) => void;
  onDownloadDocument?: (doc: KnowledgeDocument) => void;
  onReindexDocument?: (id: string) => Promise<void>;
  isUploading?: boolean;
}

const TEXT_CATEGORIES = [
  'PROCÉDURES SYSCOHADA',
  'Normes comptables',
  'Fiscalité',
  'Procédures internes',
  'Social & Paie',
  'RÉFÉRENCES',
];

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({
  documents,
  onUploadDocument,
  onAddTextDocument,
  onDeleteDocument,
  onDownloadDocument,
  onReindexDocument,
  isUploading = false,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(documents[0]?.id || '');
  const [search, setSearch] = useState('');
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexSuccess, setReindexSuccess] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Aperçu du contenu (revoir le document en session ultérieure, sans retélécharger
  // à chaque fois : l'URL blob est révoquée au changement de document).
  type PreviewState =
    | { kind: 'image'; url: string }
    | { kind: 'text'; text: string }
    | { kind: 'pdf-text'; text: string };
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  // Changement de document => aperçu précédent invalide.
  useEffect(() => {
    clearPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocId]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handlePreview = async () => {
    if (!selectedDoc || previewLoading) return;
    clearPreview();
    const mime = (selectedDoc.mimeType || '').toLowerCase();
    const name = (selectedDoc.title || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isTextLike =
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('csv') ||
      /\.(txt|md|csv|json)$/i.test(name);
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    // PDF : l'extrait indexé stocké suffit (pas de lecteur PDF embarqué).
    if (isPdf && !isImage && !isTextLike) {
      if (selectedDoc.textPreview && selectedDoc.textPreview.trim()) {
        setPreview({ kind: 'pdf-text', text: selectedDoc.textPreview });
      } else {
        setPreviewError('Aucun extrait de texte pour ce PDF — utilisez Télécharger pour voir l’original.');
      }
      return;
    }
    if (!isImage && !isTextLike) {
      setPreviewError('Aperçu non disponible pour ce type de fichier — utilisez Télécharger.');
      return;
    }
    setPreviewLoading(true);
    try {
      const dl = await downloadKnowledge(selectedDoc.id);
      if (!dl || !dl.base64) throw new Error('vide');
      if (isImage) {
        const blob = base64ToBlob(dl.base64, dl.mimeType);
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreview({ kind: 'image', url });
      } else {
        const bin = atob(dl.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const text = new TextDecoder('utf-8').decode(bytes);
        setPreview({ kind: 'text', text });
      }
    } catch {
      setPreviewError('Impossible de charger l’aperçu (serveur injoignable ou fichier absent).');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Modale "Ajouter un texte" (2e option d'alimentation avec l'import fichier).
  const [showTextModal, setShowTextModal] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textBody, setTextBody] = useState('');
  const [textCategory, setTextCategory] = useState(TEXT_CATEGORIES[0]);
  const [textError, setTextError] = useState<string | null>(null);

  const handleTextImport = () => {
    setTextError(null);
    if (!textTitle.trim()) {
      setTextError('Donnez un titre à votre texte.');
      return;
    }
    if (textBody.trim().length < 20) {
      setTextError('Le texte doit contenir au moins 20 caractères.');
      return;
    }
    if (onAddTextDocument) {
      onAddTextDocument(textTitle.trim(), textBody, textCategory);
      setShowTextModal(false);
      setTextTitle('');
      setTextBody('');
      setTextCategory(TEXT_CATEGORIES[0]);
    }
  };

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
    // Pièces archivées automatiquement depuis WhatsApp (Storage whatsapp/ +
    // doc lié phone+wamid). Pastille dédiée, même palette monochrome.
    if (cat.includes('whatsapp')) {
      return {
        label: 'WHATSAPP',
        icon: MessageCircle,
        color: '#3F3F46',
        bgPill: 'bg-[#F4F4F5]',
        textPill: 'text-zinc-800',
        borderPill: 'border-[#E4E4E7]',
        borderLeft: 'border-l-zinc-700',
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

  // Réindexation RÉELLE côté serveur (chunks + embeddings reconstruits).
  // Sans handler parent, le bouton est désactivé plutôt que de simuler.
  const handleReindex = async () => {
    if (!onReindexDocument || !selectedDoc) return;
    setIsReindexing(true);
    try {
      await onReindexDocument(selectedDoc.id);
      setReindexSuccess(true);
      setTimeout(() => setReindexSuccess(false), 2500);
    } finally {
      setIsReindexing(false);
    }
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
      className="flex-1 flex h-full min-w-0 select-none"
      style={{ fontFamily: "'Inter', sans-serif" }}
      // Garde-fou : un dépôt hors zone ne doit JAMAIS faire naviguer le
      // navigateur vers le fichier (page perdue). Seules les zones dédiées
      // traitent le drop (handleDrop).
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Column 1: Document list */}
      <div
        id="knowledge-list-panel"
        className="w-[360px] xl:w-[400px] shrink-0 flex flex-col h-full"
        style={{ borderRight: '1px solid #E5E5E7', background: '#fff' }}
      >
        <div className="p-5" style={{ borderBottom: '1px solid #E5E5E7' }}>
          <h1 className="font-bold tracking-tight" style={{ fontSize: '22px', color: '#09090B' }}>
            Connaissances
          </h1>
          <p style={{ fontSize: '12px', color: '#71717A', marginTop: '2px' }}>
            Référentiels & Documentation
          </p>
          <div className="relative mt-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#A1A1AA' }} />
            <input
              id="knowledge-search-input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un document..."
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-white rounded-lg"
              style={{ border: '1px solid #E5E5E7', outline: 'none', color: '#09090B' }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#000'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; }}
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
                  className="p-3.5 rounded-xl cursor-pointer transition-all duration-150"
                  style={{
                    background: isSelected ? '#F4F4F5' : '#fff',
                    border: `1px solid ${isSelected ? '#D4D4D8' : '#E5E5E7'}`,
                    borderRadius: '12px',
                  }}
                  onMouseEnter={(e) => { if (!isSelected) { (e.currentTarget as HTMLElement).style.borderColor = '#D4D4D8'; (e.currentTarget as HTMLElement).style.background = '#FAFAFA'; } }}
                  onMouseLeave={(e) => { if (!isSelected) { (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7'; (e.currentTarget as HTMLElement).style.background = '#fff'; } }}
                >
                  <div className="flex items-start gap-3">
                    {/* Monochrome icon: no color bg */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: '#F4F4F5', border: '1px solid #E5E5E7' }}
                    >
                      <CategoryIcon style={{ width: 16, height: 16, strokeWidth: 1.75, color: '#52525B' }} />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Monochrome pill — no color variants */}
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '1px 7px',
                          background: '#F4F4F5',
                          border: '1px solid #E5E5E7',
                          borderRadius: '99px',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: '#52525B',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {config.label}
                      </span>

                      <h3 className="line-clamp-2" style={{ fontSize: '13px', fontWeight: 600, color: '#09090B', marginTop: '4px', lineHeight: 1.4 }}>
                        {doc.title}
                      </h3>

                      <div className="flex items-center gap-2 mt-1.5" style={{ fontSize: '11px', color: '#A1A1AA', fontFamily: 'monospace' }}>
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
          <header className="p-8 flex items-start justify-between gap-6 shrink-0" style={{ borderBottom: '1px solid #E5E5E7', background: '#fff' }}>
            <div className="flex items-start gap-4 min-w-0">
              {(() => {
                const config = getCategoryConfig(selectedDoc.category);
                const Icon = config.icon;
                return (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: '#F4F4F5', border: '1px solid #E5E5E7' }}
                  >
                    <Icon style={{ width: 20, height: 20, strokeWidth: 1.75, color: '#52525B' }} />
                  </div>
                );
              })()}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {(() => {
                    const config = getCategoryConfig(selectedDoc.category);
                    return (
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {config.label}
                      </span>
                    );
                  })()}
                  <span style={{ fontSize: '11px', color: '#71717A', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', padding: '2px 8px', fontFamily: 'monospace' }}>
                    {selectedDoc.size}
                  </span>
                  <span style={{ fontSize: '11px', color: '#71717A', background: '#F4F4F5', border: '1px solid #E5E5E7', borderRadius: '99px', padding: '2px 8px', fontFamily: 'monospace' }}>
                    {selectedDoc.lastUpdated}
                  </span>
                </div>

                <h2 className="font-bold tracking-tight leading-snug" style={{ fontSize: '20px', color: '#09090B' }}>
                  {selectedDoc.title}
                </h2>
              </div>
            </div>

            {/* Action Buttons: Télécharger & Re-indexer */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleReindex}
                disabled={isReindexing || !onReindexDocument}
                title={onReindexDocument ? 'Reconstruire chunks + embeddings côté serveur' : 'Réindexation indisponible'}
                className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569] text-[13px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isReindexing ? 'animate-spin text-black' : ''}`} />
                <span>{isReindexing ? 'Indexation...' : 'Re-indexer'}</span>
              </button>

              {onDeleteDocument && (
                <button
                  type="button"
                  onClick={() => onDeleteDocument(selectedDoc.id)}
                  title="Supprimer ce document (fichier + métadonnées)"
                  className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] hover:border-[#111827] hover:text-[#111827] text-[#475569] text-[13px] font-semibold flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Supprimer</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (onDownloadDocument) {
                    onDownloadDocument(selectedDoc);
                    return;
                  }
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
              <div className="animate-in fade-in flex items-center gap-2 p-3.5 rounded-xl" style={{ background: '#F4F4F5', border: '1px solid #E5E5E7', fontSize: '13px', color: '#52525B', fontWeight: 500 }}>
                <CheckCircle2 style={{ width: 14, height: 14, color: '#52525B', flexShrink: 0 }} />
                <span>Indexation RAG mise à jour pour tous les agents.</span>
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

            {/* Section Contenu : revoir le document en session ultérieure.
                Images/textes via le fichier stocké, PDF via l'extrait indexé. */}
            <div className="p-5 rounded-2xl bg-white border border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-bold text-[#1E293B] uppercase tracking-wide">
                  Contenu du document
                </h3>
                {!preview && !previewLoading && (
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold bg-white border border-[#E2E8F0] text-[#1E293B] hover:border-black flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Afficher l’aperçu</span>
                  </button>
                )}
              </div>

              {previewLoading && (
                <div className="flex items-center gap-2 text-[13px] text-[#64748B] py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Chargement de l’aperçu depuis Firebase…</span>
                </div>
              )}

              {previewError && (
                <div className="px-3 py-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#1F2937]">
                  {previewError}
                </div>
              )}

              {preview?.kind === 'image' && (
                <div className="rounded-xl overflow-hidden border border-[#E5E7EB] bg-[#F8FAFC] flex justify-center">
                  <img
                    src={preview.url}
                    alt={selectedDoc.title}
                    className="max-h-[480px] w-auto object-contain"
                  />
                </div>
              )}

              {(preview?.kind === 'text' || preview?.kind === 'pdf-text') && (
                <div>
                  {preview.kind === 'pdf-text' && (
                    <p className="text-[11px] text-[#94A3B8] mb-1.5">
                      Extrait indexé (mise en page d’origine dans le PDF téléchargé).
                    </p>
                  )}
                  <pre className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] text-[12.5px] text-[#1E293B] leading-relaxed whitespace-pre-wrap break-words max-h-[480px] overflow-y-auto font-sans">
                    {preview.text}
                  </pre>
                </div>
              )}

              {!preview && !previewLoading && !previewError && (
                <p className="text-[12px] text-[#94A3B8]">
                  L’aperçu charge le fichier stocké sur Firebase (image, texte) ou l’extrait indexé (PDF).
                </p>
              )}
            </div>

            {/* Section Indexation pour les agents IA — état RÉEL du serveur */}
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
                      {selectedDoc.status === 'indexed'
                        ? `${selectedDoc.chunkCount || 0} chunks vectoriels actifs — interrogeables par les agents`
                        : selectedDoc.status === 'partial'
                        ? `${selectedDoc.chunkCount || 0} chunks indexés (texte tronqué au plafond)`
                        : selectedDoc.status === 'reference'
                        ? 'Référence sans fichier : aucune indexation possible'
                        : (selectedDoc.chunkCount || 0) > 0
                        ? `${selectedDoc.chunkCount} chunks interrogeables par mots-clés — utilisés par les agents${selectedDoc.indexReason ? ` (${selectedDoc.indexReason})` : ''}`
                        : selectedDoc.indexReason || 'En attente d’indexation'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[12px] font-semibold text-black bg-white px-3 py-1.5 rounded-full border border-[#E4E4E7] shadow-xs">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: (selectedDoc.status === 'indexed' || selectedDoc.status === 'partial' || ((selectedDoc.chunkCount || 0) > 0 && selectedDoc.status === 'pending')) ? '#000' : '#A1A1AA' }}
                  />
                  <span>
                    {selectedDoc.status === 'indexed'
                      ? 'Indexé'
                      : selectedDoc.status === 'partial'
                      ? 'Partiel'
                      : selectedDoc.status === 'reference'
                      ? 'Référence'
                      : (selectedDoc.chunkCount || 0) > 0
                      ? 'Mots-clés'
                      : 'Non indexé'}
                  </span>
                </div>
              </div>

              {/* Linked agents pills — seuls les agents réellement alimentés par la recherche */}
              <div>
                <span className="text-[12px] font-semibold text-[#475569] block mb-2">
                  Agents alimentés par la recherche :
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Agent Comptabilité',
                    'Agent Juridique & Fiscal',
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
                  : 'border-[#E5E7EB] bg-[#F8FAFC] hover:border-[#94A3B8]'
              }`}
            >
              <UploadCloud className="w-9 h-9 text-[#64748B] mb-2 stroke-[1.75]" />
              <p className="text-[14px] font-semibold text-[#1E293B]">
                {isUploading ? 'Envoi vers le stockage sécurisé…' : 'Importez un nouveau document de référence'}
              </p>
              <p className="text-[12px] text-[#64748B] mt-1 max-w-sm">
                Glissez-déposez vos fichiers PDF, relevés SYSCOHADA ou barèmes fiscaux ici — persistés dans Firebase Storage, visibles après refresh. Ou ajoutez directement un texte.
              </p>
              <div className="mt-3.5 flex items-center justify-center gap-2 flex-wrap">
                <label className={`px-4 py-2 rounded-xl text-[12px] font-semibold bg-white border border-[#E2E8F0] text-[#1E293B] shadow-xs transition-colors ${isUploading ? 'opacity-50 pointer-events-none' : 'hover:bg-neutral-50 cursor-pointer'}`}>
                  <span>{isUploading ? 'Envoi en cours…' : 'Parcourir mes fichiers'}</span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={isUploading}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0] && onUploadDocument) {
                        onUploadDocument(e.target.files[0]);
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
                {onAddTextDocument && (
                  <button
                    type="button"
                    onClick={() => { setTextError(null); setShowTextModal(true); }}
                    disabled={isUploading}
                    className="px-4 py-2 rounded-xl text-[12px] font-semibold bg-black text-white shadow-xs transition-colors hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                  >
                    Ajouter un texte
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`flex-1 flex flex-col items-center justify-center p-8 text-center transition-all rounded-2xl m-4 border-2 border-dashed ${isDragOver ? 'border-black bg-[#F4F4F5] text-[#1E293B]' : 'border-transparent text-[#64748B]'}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <BookOpen className="w-12 h-12 text-[#94A3B8] mb-2" />
          <h3 className="text-[16px] font-bold text-[#1E293B]">
            Importez votre premier document
          </h3>
          <p className="text-[13px] text-[#64748B] mt-1 max-w-xs">
            Glissez-déposez un fichier ici (PDF, relevés SYSCOHADA, barèmes fiscaux),
            importez-le via le bouton, ou ajoutez un texte manuellement — tout est
            stocké sur Firebase et utilisable par vos agents IA.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            {onUploadDocument && (
              <label className={`px-4 py-2 rounded-xl text-[12px] font-semibold bg-white border border-[#E2E8F0] text-[#1E293B] shadow-xs transition-colors ${isUploading ? 'opacity-50 pointer-events-none' : 'hover:bg-neutral-50 cursor-pointer'}`}>
                <span>{isUploading ? 'Envoi en cours…' : 'Importer un fichier'}</span>
                <input
                  type="file"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0] && onUploadDocument) {
                      onUploadDocument(e.target.files[0]);
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {onAddTextDocument && (
              <button
                type="button"
                onClick={() => { setTextError(null); setShowTextModal(true); }}
                disabled={isUploading}
                className="px-4 py-2 rounded-xl text-[12px] font-semibold bg-black text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
              >
                Ou ajouter un texte manuellement
              </button>
            )}
          </div>
        </div>
      )}

            {/* Modale "Ajouter un texte" : titre + catégorie + texte -> Importer */}
            {showTextModal && (
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4"
                style={{ background: 'rgba(0,0,0,0.45)' }}
                onClick={() => setShowTextModal(false)}
              >
                <div
                  className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
                  style={{ border: '1px solid #E5E7EB' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <div>
                      <h3 className="text-[15px] font-bold text-[#1E293B]">Ajouter un texte</h3>
                      <p className="text-[12px] text-[#64748B] mt-0.5">
                        Stocké dans Firebase et utilisable par les agents, comme un fichier importé.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTextModal(false)}
                      className="p-1.5 rounded-lg text-[#64748B] hover:text-[#1E293B] hover:bg-[#F4F4F5]"
                      title="Fermer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="p-5 space-y-3.5">
                    <div>
                      <label className="block text-[12px] font-semibold text-[#475569] mb-1">Titre *</label>
                      <input
                        type="text"
                        value={textTitle}
                        onChange={(e) => setTextTitle(e.target.value)}
                        placeholder="Ex : Procédure validation des avoirs"
                        maxLength={120}
                        className="w-full px-3 py-2 text-[13px] bg-white border border-[#E2E8F0] rounded-xl text-[#1E293B] placeholder:text-[#94A3B8] focus:outline-none focus:border-black"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-semibold text-[#475569] mb-1">Catégorie</label>
                      <select
                        value={textCategory}
                        onChange={(e) => setTextCategory(e.target.value)}
                        className="w-full px-3 py-2 text-[13px] bg-white border border-[#E2E8F0] rounded-xl text-[#1E293B] focus:outline-none focus:border-black cursor-pointer"
                      >
                        {TEXT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[12px] font-semibold text-[#475569]">Texte * (20 caractères min)</label>
                        <span className="text-[11px] font-mono text-[#94A3B8]">{textBody.trim().length} car.</span>
                      </div>
                      <textarea
                        value={textBody}
                        onChange={(e) => setTextBody(e.target.value)}
                        placeholder="Collez ou tapez ici tous les textes que vous voulez : procédures internes, barèmes, règles de gestion…"
                        rows={8}
                        className="w-full px-3 py-2 text-[13px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#1E293B] placeholder:text-[#94A3B8] focus:outline-none focus:border-black focus:bg-white resize-y leading-relaxed"
                      />
                    </div>
                    {textError && (
                      <div className="px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#1F2937]">
                        {textError}
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowTextModal(false)}
                        className="px-4 py-2 rounded-xl text-[12px] font-semibold bg-white border border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC] cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleTextImport}
                        disabled={isUploading}
                        className="px-5 py-2 rounded-xl text-[12px] font-semibold bg-black text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                      >
                        {isUploading ? 'Import en cours…' : 'Importer'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
    </div>
  );
};

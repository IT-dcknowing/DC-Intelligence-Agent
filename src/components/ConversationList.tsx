import React, { useMemo, useEffect } from 'react';
import {
  Search,
  Globe,
  Phone,
  MessageCircle,
  Plus,
  X,
  Inbox,
  Sparkles,
} from 'lucide-react';
import { ChannelType, Conversation, ConversationStatus } from '../types';

interface ConversationListProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: 'all' | ConversationStatus;
  onStatusFilterChange: (status: 'all' | ConversationStatus) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewConversation?: () => void;
  isLoading?: boolean;
  onOpenWhatsAppConnect?: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  isOpen,
  onClose,
  conversations,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  onNewConversation,
  isLoading = false,
  onOpenWhatsAppConnect,
}) => {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filterTabs: { id: string; label: string; value: 'all' | ConversationStatus }[] = [
    { id: 'filter-tab-all', label: 'Tous', value: 'all' },
    { id: 'filter-tab-en_cours', label: 'En cours', value: 'en_cours' },
    { id: 'filter-tab-escaladee', label: 'Escaladées', value: 'escaladee' },
    { id: 'filter-tab-terminee', label: 'Terminées', value: 'terminee' },
    { id: 'filter-tab-fermee', label: 'Fermées', value: 'fermee' },
  ];

  const filteredConversations = useMemo(() => {
    return conversations.filter((conv) => {
      const matchesFilter = statusFilter === 'all' || conv.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        conv.contactName.toLowerCase().includes(q) ||
        conv.companyName.toLowerCase().includes(q) ||
        conv.lastMessage.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [conversations, statusFilter, searchQuery]);

  const renderChannelIcon = (channel: ChannelType) => {
    switch (channel) {
      case 'whatsapp':
        return (
          <span
            title="Canal WhatsApp Business"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1F2937]"
          >
            <MessageCircle className="w-3.5 h-3.5 stroke-[2.2] fill-[#1F2937]/10" />
          </span>
        );
      case 'web':
        return (
          <span title="Widget Web Chat" className="inline-flex items-center text-[#64748B]">
            <Globe className="w-3.5 h-3.5 stroke-[2]" />
          </span>
        );
      case 'phone':
        return (
          <span title="Canal Téléphonique" className="inline-flex items-center text-[#64748B]">
            <Phone className="w-3.5 h-3.5 stroke-[2]" />
          </span>
        );
    }
  };

  const getStatusColor = (status: ConversationStatus) => {
    switch (status) {
      case 'en_cours':
        return 'bg-[#111827]';
      case 'escaladee':
        return 'bg-[#6B7280]';
      case 'terminee':
        return 'bg-[#D1D5DB]';
      case 'fermee':
        return 'bg-[#D1D5DB]';
    }
  };

  const getStatusLabel = (status: ConversationStatus) => {
    switch (status) {
      case 'en_cours':
        return 'En cours';
      case 'escaladee':
        return 'Escaladée';
      case 'terminee':
        return 'Terminée';
      case 'fermee':
        return 'Fermée';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Semi-transparent backdrop overlay with blur(4px) */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[4px] transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel (380px fixed width, shadow-xl) */}
      <div
        id="conversations-slide-over-panel"
        className="relative z-50 w-full max-w-[380px] bg-white h-full shadow-2xl border-r border-[#E2E8F0] flex flex-col transform transition-transform duration-300 ease-out translate-x-0"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-bold text-[#1E293B] tracking-tight font-['Montserrat']">
                Échanges clients
              </h2>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#E2E8F0] text-[#475569] font-semibold">
                {conversations.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {onNewConversation && (
                <button
                  type="button"
                  onClick={onNewConversation}
                  className="p-1.5 text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/80 rounded-lg transition-colors"
                  title="Nouvelle conversation"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/80 rounded-lg transition-colors"
                title="Fermer (Échap)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              id="search-conversations-input"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Rechercher client, dossier, message..."
              className="w-full pl-9 pr-3.5 py-2 text-[13px] bg-white border border-[#E2E8F0] rounded-xl placeholder:text-[#94A3B8] text-[#1E293B] focus:outline-none focus:border-black focus:ring-2 focus:ring-black/15 transition-all"
            />
          </div>

          {/* Filter Status Horizontal Scroll */}
          <div className="flex items-center gap-1.5 overflow-x-auto mt-3 pt-1 pb-0.5 scrollbar-none">
            {filterTabs.map((tab) => {
              const active = statusFilter === tab.value;
              return (
                <button
                  key={tab.id}
                  id={tab.id}
                  type="button"
                  onClick={() => onStatusFilterChange(tab.value)}
                  className={`px-3 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-all duration-150 ${
                    active
                      ? 'bg-[#1E293B] text-white shadow-xs'
                      : 'text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation Items List / Skeletons / Empty State */}
        <div id="conversations-items-scroll" className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
          {isLoading ? (
            /* Skeleton shimmer loading */
            <div className="space-y-2 p-1">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="p-3.5 rounded-xl border border-[#E2E8F0] bg-white space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-28 h-3.5 rounded animate-shimmer" />
                    <div className="w-12 h-3 rounded animate-shimmer" />
                  </div>
                  <div className="w-36 h-3 rounded animate-shimmer" />
                  <div className="w-48 h-3 rounded animate-shimmer" />
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            /* Empty State (Chantier 7) */
            <div className="h-full flex flex-col items-center justify-center p-6 text-center select-none my-auto">
              <div className="w-14 h-14 rounded-2xl bg-[#F4F4F5] text-black border border-[#E4E4E7] flex items-center justify-center mb-4">
                <Inbox className="w-7 h-7 stroke-[1.75]" />
              </div>
              <h3 className="text-[16px] font-bold text-[#1E293B]">
                Aucune conversation
              </h3>
              <p className="text-[13px] text-[#64748B] mt-1.5 max-w-[260px] leading-relaxed">
                Les échanges avec vos clients apparaîtront ici dès leur réception par WhatsApp ou Web.
              </p>
              {onOpenWhatsAppConnect && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenWhatsAppConnect();
                  }}
                  className="mt-4 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#1F2937] hover:bg-[#1F2937] text-white flex items-center gap-2 transition-all shadow-sm"
                >
                  <MessageCircle className="w-4 h-4 fill-white/20" />
                  <span>Connecter WhatsApp</span>
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedId === conv.id;
              const statusColor = getStatusColor(conv.status);
              const statusLabel = getStatusLabel(conv.status);

              return (
                <div
                  key={conv.id}
                  id={`conversation-item-${conv.id}`}
                  onClick={() => {
                    onSelect(conv.id);
                    onClose();
                  }}
                  className={`p-3.5 rounded-xl cursor-pointer transition-all duration-150 border ${
                    isSelected
                      ? 'bg-[#F4F4F5] border-black shadow-xs'
                      : 'bg-white border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {/* Row 1: Contact Name + Channel + Timestamp */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-[14px] text-[#1E293B] truncate">
                        {conv.contactName}
                      </span>
                      {renderChannelIcon(conv.channel)}
                    </div>
                    <span className="text-[11px] font-mono text-[#94A3B8] shrink-0">
                      {conv.lastMessageTime}
                    </span>
                  </div>

                  {/* Row 2: Company Name */}
                  <div className="text-[12px] text-[#64748B] font-medium truncate mt-0.5">
                    {conv.companyName}
                  </div>

                  {/* Row 3: Last Message snippet */}
                  <p className="text-[13px] text-[#475569] truncate mt-1 leading-snug">
                    {conv.lastMessage}
                  </p>

                  {/* Row 4: Status + Assigned Agent */}
                  <div className="mt-2.5 pt-2 border-t border-[#E2E8F0]/70 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                      <span className="text-[#64748B] font-medium">{statusLabel}</span>
                    </div>

                    <span className="text-[#94A3B8] truncate max-w-[140px] text-[11px]">
                      {conv.assignedAgent.replace('Agent ', '')}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcut tip */}
        <div className="p-3 border-t border-[#E2E8F0] bg-[#F8FAFC] text-[11px] text-[#94A3B8] flex items-center justify-between">
          <span>Navigation rapide</span>
          <kbd className="px-2 py-0.5 rounded bg-white border border-[#E2E8F0] font-mono text-[10px] text-[#475569]">
            Échap pour fermer
          </kbd>
        </div>
      </div>
    </div>
  );
};

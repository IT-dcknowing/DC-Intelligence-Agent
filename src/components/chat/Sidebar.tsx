import React, { useState } from 'react';
import { Search, Plus, MessageSquare, Trash2, Edit2, Settings, ChevronLeft } from 'lucide-react';
import type { ChatSession } from '../../types';

/**
 * Sidebar — Editorial style, Noir & Blanc
 * 260-280px, #FAFAFA, hover #F0F0EE, active #EBEBE9 SANS bordure
 * Inter 14px, transitions 0.15s, header DC + Nouvelle analyse
 * Design decision : sidebar très épurée, pas de lourdeur, focus sur la liste
 */

interface SidebarProps {
  sessions: ChatSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  searchQuery,
  onSearchChange,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const filtered = sessions.filter((s) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return s.title.toLowerCase().includes(q) || s.lastMessage.toLowerCase().includes(q);
  });

  return (
    <aside
      className="w-[270px] bg-[#FAFAFA] border-r flex flex-col h-full shrink-0 relative z-20 select-none"
      style={{ borderColor: '#E8E8E6', fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header — logo + Nouvelle analyse */}
      <div className="p-3 space-y-3">
        <div
          className="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer"
          style={{ transition: 'all 0.15s ease' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#F0F0EE')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
        >
          <div className="w-8 h-8 bg-black text-white rounded-md flex items-center justify-center font-bold text-xs tracking-wider shadow-sm shrink-0">
            DC
          </div>
          <div className="min-w-0">
            <div className="font-bold text-[13px] leading-tight" style={{ color: '#1F1F1E' }}>
              DC INTELLIGENCE
            </div>
            <div className="text-[11px] font-medium" style={{ color: '#6B6B6B' }}>
              Agent Studio
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 ml-auto" style={{ color: '#9CA3AF' }} />
        </div>

        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium bg-white border rounded-md shadow-sm hover:shadow transition-all cursor-pointer"
          style={{ borderColor: '#E8E8E6', color: '#1F1F1E', transition: 'all 0.15s ease' }}
          onMouseDown={(e) => ((e.currentTarget as HTMLElement).style.transform = 'scale(0.98)')}
          onMouseUp={(e) => ((e.currentTarget as HTMLElement).style.transform = 'scale(1)')}
        >
          <Plus style={{ width: 16, height: 16 }} />
          Nouvelle analyse
        </button>

        {/* Search — subtil, sans bordure lourde */}
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ width: 14, height: 14, color: '#9CA3AF' }}
          />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Rechercher..."
            className="w-full pl-8 pr-3 py-1.5 bg-white border rounded-md text-[13px] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#6B6B6B] transition-colors"
            style={{ borderColor: '#E8E8E6', fontSize: '13px', color: '#1F1F1E' }}
            aria-label="Rechercher une conversation"
          />
        </div>
      </div>

      {/* Liste — Récent */}
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>
        Récent
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-center text-[12px] py-6" style={{ color: '#9CA3AF' }}>
            Aucune conversation
          </p>
        ) : (
          filtered.map((s) => {
            const isActive = s.id === selectedId;
            const isEditing = editingId === s.id;
            return (
              <div
                key={s.id}
                onClick={() => !isEditing && onSelect(s.id)}
                className="group relative flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-[13px]"
                style={{
                  background: isActive ? '#EBEBE9' : 'transparent',
                  color: isActive ? '#1F1F1E' : '#6B6B6B',
                  fontWeight: isActive ? 500 : 400,
                  border: 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F0F0EE';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <MessageSquare style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.7 }} />
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => {
                      if (editingTitle.trim()) onRename(s.id, editingTitle.trim());
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingTitle.trim()) onRename(s.id, editingTitle.trim());
                        setEditingId(null);
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-white border border-[#E8E8E6] rounded px-1.5 py-0.5 text-[13px] outline-none focus:border-[#171717]"
                  />
                ) : (
                  <span className="truncate flex-1">{s.title}</span>
                )}
                {/* Actions au hover */}
                {!isEditing && (
                  <span className="hidden group-hover:flex items-center gap-0.5 ml-auto">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                        setEditingTitle(s.title);
                      }}
                      className="p-1 rounded hover:bg-[#F3F4F6]"
                      aria-label="Renommer"
                    >
                      <Edit2 style={{ width: 12, height: 12 }} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      className="p-1 rounded hover:bg-[#F3F4F6] hover:text-[#111827]"
                      aria-label="Supprimer"
                    >
                      <Trash2 style={{ width: 12, height: 12 }} />
                    </button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer — profil + paramètres */}
      <div className="p-3 border-t space-y-1" style={{ borderColor: '#E8E8E6' }}>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] hover:bg-[#F0F0EE] transition-colors"
          style={{ color: '#6B6B6B' }}
        >
          <Settings style={{ width: 14, height: 14 }} />
          Paramètres
        </button>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-[#EBEBE9] flex items-center justify-center text-xs font-semibold" style={{ color: '#1F1F1E' }}>
            KB
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate" style={{ color: '#1F1F1E' }}>
              Kouassi Bernard
            </div>
            <div className="text-[11px] truncate" style={{ color: '#9CA3AF' }}>
              Expert SYSCOHADA
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

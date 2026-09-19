import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Bot,
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronDown,
  Layers,
  MessageSquare,
  Cpu,
  Search,
  Plus,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { NavigationTab, ChatSession } from '../types';
import logoDcIntelligence from '../assets/logo-dc-intelligence.png';
import logoElement from '../assets/logo-element.png';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  activeConversationsCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  whatsappConnected?: boolean;
  onOpenWhatsAppSettings?: () => void;
  // Conversations (section intégrée, style Claude)
  sessions?: ChatSession[];
  selectedSessionId?: string | null;
  onSelectSession?: (id: string) => void;
  onNewSession?: () => Promise<string> | string | void;
  onDeleteSession?: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
  onTogglePinSession?: (id: string) => void;
}

// Timestamp robuste : ms backend > ms local > id session-<ms> > 0 (Plus ancien)
function getSessionTs(s: ChatSession): number {
  if (typeof s.updatedAtMs === 'number' && s.updatedAtMs > 0) return s.updatedAtMs;
  if (typeof s.createdAtMs === 'number' && s.createdAtMs > 0) return s.createdAtMs;
  const m = String(s.id || '').match(/(\d{13,})/);
  if (m) {
    const n = parseInt(m[1].slice(0, 13), 10);
    if (!isNaN(n) && n > 946684800000) return n;
  }
  return 0;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

type GroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  sessions = [],
  selectedSessionId = null,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onTogglePinSession,
}) => {
  const isAssistantActive = currentTab === 'assistant' || currentTab === 'conversations';
  const [convOpen, setConvOpen] = useState(true);
  const [convSearch, setConvSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const navItems = [
    {
      id: 'nav-agents-btn',
      tab: 'agents' as NavigationTab,
      label: 'Agents',
      icon: Bot,
      isActive: currentTab === 'agents',
    },
    {
      id: 'nav-tasks-btn',
      tab: 'tasks' as NavigationTab,
      label: 'Moteur & WhatsApp',
      icon: Cpu,
      isActive: currentTab === 'tasks',
    },
    {
      id: 'nav-knowledge-btn',
      tab: 'knowledge' as NavigationTab,
      label: 'Connaissances',
      icon: BookOpen,
      isActive: currentTab === 'knowledge',
    },
    {
      id: 'nav-connections-btn',
      tab: 'connections' as NavigationTab,
      label: 'Connexions',
      icon: Layers,
      isActive: currentTab === 'connections',
    },
  ];

  const filtered = useMemo(() => {
    const q = convSearch.toLowerCase().trim();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.lastMessage || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q)
    );
  }, [sessions, convSearch]);

  const groups = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 7 * 86400000;
    const out: Record<GroupKey, ChatSession[]> = {
      pinned: [],
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };
    const sorted = [...filtered].sort((a, b) => {
      const pa = a.pinned ? 1 : 0;
      const pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return getSessionTs(b) - getSessionTs(a);
    });
    for (const s of sorted) {
      if (s.pinned) {
        out.pinned.push(s);
        continue;
      }
      const ts = getSessionTs(s);
      if (ts === 0) {
        out.older.push(s);
        continue;
      }
      if (ts >= todayStart) out.today.push(s);
      else if (ts >= yesterdayStart) out.yesterday.push(s);
      else if (ts >= weekStart) out.week.push(s);
      else out.older.push(s);
    }
    return out;
  }, [filtered]);

  const handleSelect = (id: string) => {
    onSelectSession?.(id);
    if (!isAssistantActive) onSelectTab('assistant');
    setOpenMenuId(null);
  };

  const startRename = (s: ChatSession) => {
    setEditingId(s.id);
    setEditingTitle(s.title);
    setOpenMenuId(null);
  };

  const saveRename = (id: string) => {
    if (editingTitle.trim()) onRenameSession?.(id, editingTitle.trim());
    setEditingId(null);
  };

  const renderSessionItem = (s: ChatSession) => {
    const isActive = selectedSessionId === s.id;
    const isEditing = editingId === s.id;
    if (isEditing) {
      return (
        <div
          key={s.id}
          className="p-1.5 rounded-lg"
          style={{ background: '#fff', border: '1px solid #09090B' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename(s.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="flex-1 min-w-0 px-1.5 py-1 text-[13px] font-medium bg-transparent focus:outline-none"
              style={{ color: '#09090B' }}
            />
            <button
              type="button"
              onClick={() => saveRename(s.id)}
              className="p-1 rounded hover:bg-[#F4F4F5]"
              style={{ color: '#09090B' }}
              title="Valider"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="p-1 rounded hover:bg-[#F4F4F5]"
              style={{ color: '#71717A' }}
              title="Annuler"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        key={s.id}
        id={`sidebar-session-${s.id}`}
        onClick={() => handleSelect(s.id)}
        className="group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150"
        style={
          isActive
            ? {
                background: '#EBEBE9',
                boxShadow: 'inset 2px 0 0 #09090B',
              }
            : { background: 'transparent' }
        }
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F0F0EE';
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
        title={s.title}
      >
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <p
              className="truncate"
              style={{
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                color: '#09090B',
                lineHeight: 1.35,
              }}
            >
              {s.pinned && <span style={{ marginRight: 4 }}>📌</span>}
              {s.title}
            </p>
            <p
              className="truncate mt-0.5"
              style={{ fontSize: '11px', color: '#71717A' }}
            >
              {s.category || 'Général'} • {s.lastMessageTime || '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenuId(openMenuId === s.id ? null : s.id);
            }}
            title="Options"
            className={`p-1 rounded-md shrink-0 transition-opacity ${
              openMenuId === s.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ color: '#71717A' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#E5E7EB';
              (e.currentTarget as HTMLElement).style.color = '#09090B';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#71717A';
            }}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {openMenuId === s.id && (
          <div
            ref={menuRef}
            className="absolute right-1 top-9 z-50 w-44 bg-white rounded-xl overflow-hidden"
            style={{ border: '1px solid #E5E7EB', boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => startRename(s)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F4F4F5]"
              style={{ fontSize: '12px', color: '#1F2937' }}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Renommer</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onTogglePinSession?.(s.id);
                setOpenMenuId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F4F4F5]"
              style={{ fontSize: '12px', color: '#1F2937' }}
            >
              {s.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              <span>{s.pinned ? 'Désépingler' : 'Épingler'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onDeleteSession?.(s.id);
                setOpenMenuId(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#F4F4F5]"
              style={{ fontSize: '12px', color: '#1F2937' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Supprimer</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderGroup = (label: string, list: ChatSession[]) => {
    if (list.length === 0) return null;
    return (
      <div key={label} className="mt-3 first:mt-1">
        <p
          className="px-2.5 mb-1"
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#9CA3AF',
          }}
        >
          {label}
        </p>
        <div className="space-y-0.5">{list.map(renderSessionItem)}</div>
      </div>
    );
  };

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside
        id="app-sidebar"
        className={`hidden md:flex h-full border-r flex-col shrink-0 select-none z-30 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isCollapsed ? 'w-[60px]' : 'w-[300px]'
        }`}
        style={{ background: '#FAFAFA', borderColor: '#E5E5E7' }}
      >
        {/* ── Brand header ── */}
        <div
          id="sidebar-brand-header"
          className={`h-14 px-3 flex items-center border-b shrink-0 ${
            isCollapsed ? 'justify-center' : 'justify-between'
          }`}
          style={{ borderColor: '#E5E5E7' }}
        >
          {!isCollapsed ? (
            <div className="flex items-center min-w-0">
              {/* Logo officiel DC INTELLIGENCE (fond blanc fusionné au thème clair) */}
              <img
                src={logoDcIntelligence}
                alt="DC INTELLIGENCE — DC-KNOWING"
                className="logo-multiply shrink-0"
                style={{ height: '36px', width: 'auto', maxWidth: '190px', objectFit: 'contain', objectPosition: 'left center' }}
              />
            </div>
          ) : (
            <img
              src={logoElement}
              alt="DC INTELLIGENCE"
              title="DC INTELLIGENCE"
              className="w-7 h-7 rounded-lg shrink-0 cursor-pointer object-cover"
              onClick={onToggleCollapse}
            />
          )}

          {!isCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Replier le menu"
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer"
              style={{ color: '#A1A1AA' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#09090B'; (e.currentTarget as HTMLElement).style.background = '#F4F4F5'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#A1A1AA'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {isCollapsed ? (
          <>
            <div className="flex justify-center py-2 border-b" style={{ borderColor: '#E5E5E7' }}>
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Déplier le menu"
                className="w-6 h-6 rounded-md flex items-center justify-center cursor-pointer"
                style={{ color: '#A1A1AA' }}
              >
                <ChevronLeft className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>
            <nav className="p-2 space-y-0.5 mt-2">
              <button
                type="button"
                onClick={() => onSelectTab('assistant')}
                title="Conversations"
                className="w-full flex items-center justify-center p-2.5 rounded-lg cursor-pointer"
                style={{ background: isAssistantActive ? '#F4F4F5' : 'transparent', color: '#09090B' }}
              >
                <MessageSquare style={{ width: 15, height: 15 }} />
              </button>
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.tab}
                    onClick={() => onSelectTab(item.tab)}
                    title={item.label}
                    className="w-full flex items-center justify-center p-2.5 rounded-lg cursor-pointer"
                    style={{ background: item.isActive ? '#F4F4F5' : 'transparent', color: item.isActive ? '#09090B' : '#71717A' }}
                  >
                    <Icon style={{ width: 15, height: 15 }} />
                  </button>
                );
              })}
            </nav>
          </>
        ) : (
          <>
            {/* ── Navigation principale ── */}
            <nav id="sidebar-nav-links" className="p-2 space-y-0.5 mt-1 shrink-0">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.tab}
                    id={item.id}
                    onClick={() => onSelectTab(item.tab)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150 cursor-pointer"
                    style={
                      item.isActive
                        ? { background: '#F4F4F5', color: '#09090B', fontWeight: 600 }
                        : { background: 'transparent', color: '#71717A', fontWeight: 500 }
                    }
                    onMouseEnter={(e) => {
                      if (!item.isActive) {
                        (e.currentTarget as HTMLElement).style.background = '#F4F4F5';
                        (e.currentTarget as HTMLElement).style.color = '#09090B';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!item.isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                        (e.currentTarget as HTMLElement).style.color = '#71717A';
                      }
                    }}
                  >
                    <Icon
                      className="shrink-0"
                      style={{
                        width: 15,
                        height: 15,
                        strokeWidth: item.isActive ? 2.2 : 1.75,
                        color: item.isActive ? '#09090B' : '#71717A',
                      }}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* ── Section CONVERSATIONS (accordéon, style Claude) ── */}
            <div className="mx-2 mt-1 border-t shrink-0" style={{ borderColor: '#E5E7EB' }} />
            <div id="sidebar-conversations-section" className="flex-1 flex flex-col min-h-0 px-2 py-2">
              <div className="flex items-center justify-between gap-2 px-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setConvOpen((v) => !v)}
                  className="flex items-center gap-1.5 cursor-pointer rounded-md px-1 py-1"
                  title={convOpen ? 'Replier l’historique' : 'Déplier l’historique'}
                >
                  <ChevronDown
                    className="transition-transform duration-200"
                    style={{
                      width: 13,
                      height: 13,
                      color: '#71717A',
                      transform: convOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: '#111827',
                    }}
                  >
                    CONVERSATIONS
                  </span>
                </button>
                <button
                  type="button"
                  id="sidebar-new-conversation-btn"
                  onClick={() => onNewSession?.()}
                  title="Nouvelle conversation"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all active:scale-95"
                  style={{
                    background: '#F3F4F6',
                    border: '1px solid #E5E7EB',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#111827',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#09090B'; (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#09090B'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#F3F4F6'; (e.currentTarget as HTMLElement).style.color = '#111827'; (e.currentTarget as HTMLElement).style.borderColor = '#E5E7EB'; }}
                >
                  <Plus style={{ width: 12, height: 12, strokeWidth: 2.5 }} />
                  <span>Nouveau</span>
                </button>
              </div>

              {convOpen && (
                <>
                  <div className="relative mt-2 shrink-0">
                    <Search
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ width: 13, height: 13, color: '#9CA3AF' }}
                    />
                    <input
                      type="text"
                      value={convSearch}
                      onChange={(e) => setConvSearch(e.target.value)}
                      placeholder="Rechercher..."
                      className="w-full pl-8 pr-3 py-1.5 bg-white rounded-lg text-[12px] placeholder:text-[#9CA3AF] focus:outline-none"
                      style={{ border: '1px solid #E5E7EB', color: '#111827' }}
                    />
                  </div>

                  <div id="sidebar-conversations-list" className="flex-1 overflow-y-auto mt-1 pb-2 min-h-0">
                    {filtered.length === 0 ? (
                      <p className="px-2.5 py-4 text-center" style={{ fontSize: '12px', color: '#9CA3AF' }}>
                        {sessions.length === 0 ? 'Cliquez sur « Nouveau » pour démarrer.' : 'Aucune conversation trouvée.'}
                      </p>
                    ) : (
                      <>
                        {renderGroup('📌 ÉPINGLÉS', groups.pinned)}
                        {renderGroup('AUJOURD’HUI', groups.today)}
                        {renderGroup('HIER', groups.yesterday)}
                        {renderGroup('7 DERNIERS JOURS', groups.week)}
                        {renderGroup('PLUS ANCIEN', groups.older)}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── Bottom: Paramètres + Profil ── */}
        <div
          id="sidebar-bottom-section"
          className="p-2 border-t space-y-0.5 shrink-0"
          style={{ borderColor: '#E5E5E7', background: '#FAFAFA' }}
        >
          <button
            id="nav-settings-btn"
            onClick={() => onSelectTab('settings')}
            title={isCollapsed ? 'Paramètres' : undefined}
            className={`w-full flex items-center rounded-lg text-[13px] transition-all duration-150 cursor-pointer ${
              isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2'
            }`}
            style={
              currentTab === 'settings'
                ? { background: '#F4F4F5', color: '#09090B', fontWeight: 600 }
                : { background: 'transparent', color: '#71717A', fontWeight: 500 }
            }
            onMouseEnter={(e) => {
              if (currentTab !== 'settings') {
                (e.currentTarget as HTMLElement).style.background = '#F4F4F5';
                (e.currentTarget as HTMLElement).style.color = '#09090B';
              }
            }}
            onMouseLeave={(e) => {
              if (currentTab !== 'settings') {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
                (e.currentTarget as HTMLElement).style.color = '#71717A';
              }
            }}
          >
            <Settings
              className="shrink-0"
              style={{
                width: 15, height: 15,
                strokeWidth: currentTab === 'settings' ? 2.2 : 1.75,
                color: currentTab === 'settings' ? '#09090B' : '#71717A',
              }}
            />
            {!isCollapsed && <span className="truncate">Paramètres</span>}
          </button>

          {!isCollapsed && (
            <div
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg"
              title="Profil cabinet"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold shrink-0"
                style={{ background: '#09090B', color: '#fff', fontSize: '12px' }}
              >
                A
              </div>
              <div className="min-w-0">
                <span className="block truncate" style={{ fontSize: '13px', fontWeight: 600, color: '#09090B' }}>
                  Alex
                </span>
                <span className="block truncate" style={{ fontSize: '11px', color: '#71717A' }}>
                  Profil cabinet
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Mobile Bottom Navigation ── */}
      <nav
        id="mobile-bottom-nav"
        className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t z-40 flex items-center justify-around px-2 select-none"
        style={{ borderColor: '#E5E5E7' }}
      >
        {[
          { tab: 'assistant' as NavigationTab, icon: MessageSquare, label: 'Chat', active: isAssistantActive },
          { tab: 'agents' as NavigationTab, icon: Bot, label: 'Agents', active: currentTab === 'agents' },
          { tab: 'knowledge' as NavigationTab, icon: BookOpen, label: 'Docs', active: currentTab === 'knowledge' },
          { tab: 'connections' as NavigationTab, icon: Layers, label: 'Liens', active: currentTab === 'connections' },
          { tab: 'settings' as NavigationTab, icon: Settings, label: 'Config', active: currentTab === 'settings' },
        ].map(({ tab, icon: Icon, label, active }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onSelectTab(tab)}
            className="flex flex-col items-center justify-center py-1 px-2 rounded-lg gap-0.5 transition-colors"
            style={{ color: active ? '#09090B' : '#A1A1AA' }}
          >
            <Icon style={{ width: 18, height: 18, strokeWidth: active ? 2.2 : 1.75 }} />
            <span style={{ fontSize: '10px', fontWeight: active ? 600 : 400 }}>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
};

import React from 'react';
import {
  Bot,
  BookOpen,
  Settings,
  ChevronLeft,
  Layers,
  Sparkles,
  MessageSquare,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import { NavigationTab } from '../types';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  activeConversationsCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  whatsappConnected?: boolean;
  onOpenWhatsAppSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
}) => {
  const isAssistantActive = currentTab === 'assistant' || currentTab === 'conversations';

  const navItems = [
    {
      id: 'nav-assistant-btn',
      tab: 'assistant' as NavigationTab,
      label: 'Conversations',
      icon: MessageSquare,
      isActive: isAssistantActive,
    },
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
      label: 'Moteur de Tâches',
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
      id: 'nav-audit-btn',
      tab: 'audit' as NavigationTab,
      label: 'Journal d’Audit',
      icon: ShieldCheck,
      isActive: currentTab === 'audit',
    },
    {
      id: 'nav-connections-btn',
      tab: 'connections' as NavigationTab,
      label: 'Connexions',
      icon: Layers,
      isActive: currentTab === 'connections',
    },
  ];

  return (
    <>
      {/* ── Desktop Sidebar ── */}
      <aside
        id="app-sidebar"
        className={`hidden md:flex h-full border-r flex-col justify-between shrink-0 select-none z-30 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isCollapsed ? 'w-[60px]' : 'w-[232px]'
        }`}
        style={{ background: '#FAFAFA', borderColor: '#E5E5E7' }}
      >
        {/* ── Brand header ── */}
        <div>
          <div
            id="sidebar-brand-header"
            className={`h-14 px-3 flex items-center border-b ${
              isCollapsed ? 'justify-center' : 'justify-between'
            }`}
            style={{ borderColor: '#E5E5E7' }}
          >
            {!isCollapsed ? (
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Logo mark */}
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[11px] tracking-tight shrink-0"
                  style={{ background: '#000', color: '#fff' }}
                >
                  DC
                </div>
                <div className="min-w-0">
                  <span
                    className="block truncate font-bold tracking-tight"
                    style={{ fontSize: '13px', color: '#09090B' }}
                  >
                    DC INTELLIGENCE
                  </span>
                  <span
                    className="block truncate"
                    style={{ fontSize: '11px', color: '#71717A', fontWeight: 500 }}
                  >
                    Agent Studio
                  </span>
                </div>
              </div>
            ) : (
              <div
                title="DC INTELLIGENCE"
                className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[11px] tracking-tight shrink-0 cursor-pointer"
                style={{ background: '#000', color: '#fff' }}
                onClick={onToggleCollapse}
              >
                DC
              </div>
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

          {/* Expand button when collapsed */}
          {isCollapsed && (
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
          )}

          {/* ── Navigation ── */}
          <nav id="sidebar-nav-links" className="p-2 space-y-0.5 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  id={item.id}
                  onClick={() => onSelectTab(item.tab)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center rounded-lg text-[13px] transition-all duration-150 cursor-pointer ${
                    isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2'
                  }`}
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
                  {!isCollapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Bottom: Settings + User profile ── */}
        <div
          id="sidebar-bottom-section"
          className="p-2 border-t space-y-0.5"
          style={{ borderColor: '#E5E5E7', background: '#FAFAFA' }}
        >
          {/* Settings */}
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

          {/* User profile */}
          {!isCollapsed && (
            <div
              className="mt-1 px-2 py-2 rounded-lg flex items-center gap-2.5"
              style={{ borderTop: '1px solid #E5E5E7', marginTop: '8px', paddingTop: '10px' }}
            >
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                style={{ background: '#18181B', color: '#fff', fontSize: '11px' }}
              >
                AM
              </div>
              <div className="min-w-0">
                <span
                  className="block truncate font-semibold"
                  style={{ fontSize: '12px', color: '#09090B' }}
                >
                  Alex Mardochee
                </span>
                <span
                  className="block truncate"
                  style={{ fontSize: '11px', color: '#A1A1AA' }}
                >
                  alexmardochee0@gmail.com
                </span>
              </div>
            </div>
          )}

          {isCollapsed && (
            <div className="flex justify-center py-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold cursor-pointer"
                style={{ background: '#18181B', color: '#fff', fontSize: '11px' }}
                title="Alex Mardochee"
              >
                AM
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

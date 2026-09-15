import React from 'react';
import {
  Bot,
  BookOpen,
  Settings,
  ChevronLeft,
  Layers,
  Sparkles,
  ShieldCheck,
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
      label: 'Assistant',
      icon: Sparkles,
      isActive: isAssistantActive,
    },
    {
      id: 'nav-connections-btn',
      tab: 'connections' as NavigationTab,
      label: 'Connexions',
      icon: Layers,
      isActive: currentTab === 'connections',
    },
    {
      id: 'nav-agents-btn',
      tab: 'agents' as NavigationTab,
      label: 'Agents',
      icon: Bot,
      isActive: currentTab === 'agents',
    },
    {
      id: 'nav-knowledge-btn',
      tab: 'knowledge' as NavigationTab,
      label: 'Connaissances',
      icon: BookOpen,
      isActive: currentTab === 'knowledge',
    },
  ];

  return (
    <>
      {/* 1. Desktop & Tablet Sidebar (Hidden on mobile < 768px) */}
      <aside
        id="app-sidebar"
        className={`hidden md:flex h-full border-r border-[#E2E8F0] bg-[#F8FAFC] flex-col justify-between shrink-0 select-none z-30 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isCollapsed ? 'w-[64px]' : 'w-[240px]'
        }`}
      >
        {/* Top App Identity */}
        <div>
          <div
            id="sidebar-brand-header"
            className={`h-16 px-3.5 border-b border-[#E2E8F0] flex items-center ${
              isCollapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            {!isCollapsed ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-black text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm shrink-0 border border-zinc-800">
                  CF
                </div>
                <div className="min-w-0">
                  <span className="text-[14px] font-bold text-[#1E293B] tracking-tight block truncate font-['Montserrat']">
                    Compta Flow
                  </span>
                  <span className="text-[11px] text-[#64748B] block truncate font-medium">
                    Assistant & Studio OS
                  </span>
                </div>
              </div>
            ) : (
              <div
                title="Compta Flow"
                className="w-9 h-9 rounded-lg bg-black text-white flex items-center justify-center font-bold text-sm tracking-tight shadow-sm shrink-0 border border-zinc-800"
              >
                CF
              </div>
            )}

            {/* Toggle Chevron with 180deg animated rotation */}
            {!isCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Replier le menu (64px)"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 transition-all duration-200 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 transition-transform duration-300" />
              </button>
            )}
          </div>

          {/* If collapsed, small expand button below logo */}
          {isCollapsed && (
            <div className="flex justify-center py-2 border-b border-[#E2E8F0]">
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Déplier le menu (240px)"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#64748B] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 transition-all duration-200 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 rotate-180 transition-transform duration-300" />
              </button>
            </div>
          )}

          {/* Navigation Items */}
          <nav id="sidebar-nav-links" className="p-2 space-y-1 mt-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.tab}
                  id={item.id}
                  onClick={() => onSelectTab(item.tab)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 cursor-pointer ${
                    isCollapsed ? 'justify-center p-3' : 'justify-between px-3.5 py-2.5'
                  } ${
                    item.isActive
                      ? 'bg-black text-white shadow-sm'
                      : 'text-[#52525B] hover:bg-[#F4F4F5] hover:text-[#09090B]'
                  }`}
                >
                  <div className={`flex items-center ${isCollapsed ? '' : 'gap-3 min-w-0'}`}>
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-transform duration-150 ${
                        item.isActive ? 'text-white stroke-[2.2]' : 'text-[#71717A] stroke-[1.8]'
                      }`}
                    />
                    {!isCollapsed && (
                      <span className="truncate tracking-tight font-medium transition-opacity duration-200">
                        {item.label}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Settings Link */}
        <div id="sidebar-bottom-section" className="p-2.5 border-t border-[#E2E8F0] bg-[#F8FAFC] space-y-1">
          <button
            id="nav-settings-btn"
            onClick={() => onSelectTab('settings')}
            title={isCollapsed ? 'Paramètres' : undefined}
            className={`w-full flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 cursor-pointer ${
              isCollapsed ? 'justify-center p-3' : 'gap-3 px-3.5 py-2.5'
            } ${
              currentTab === 'settings'
                ? 'bg-black text-white shadow-sm'
                : 'text-[#52525B] hover:bg-[#F4F4F5] hover:text-[#09090B]'
            }`}
          >
            <Settings
              className={`w-4 h-4 shrink-0 ${
                currentTab === 'settings' ? 'text-white stroke-[2.2]' : 'text-[#71717A] stroke-[1.8]'
              }`}
            />
            {!isCollapsed && <span className="truncate tracking-tight font-medium">Paramètres</span>}
          </button>

          {!isCollapsed && (
            <div className="pt-2 px-1 text-[11px] text-[#94A3B8] flex items-center gap-1.5 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>SYSCOHADA Révisé</span>
            </div>
          )}
        </div>
      </aside>

      {/* 2. Mobile Bottom Navigation Bar (< 768px) */}
      <nav
        id="mobile-bottom-nav"
        className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-[#E2E8F0] z-40 flex items-center justify-around px-2 shadow-lg select-none"
      >
        <button
          type="button"
          onClick={() => onSelectTab('assistant')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            isAssistantActive ? 'text-black font-semibold' : 'text-[#71717A]'
          }`}
        >
          <Sparkles className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium mt-1">Assistant</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('connections')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            currentTab === 'connections' ? 'text-black font-semibold' : 'text-[#71717A]'
          }`}
        >
          <Layers className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium mt-1">Connexions</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('agents')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            currentTab === 'agents' ? 'text-black font-semibold' : 'text-[#71717A]'
          }`}
        >
          <Bot className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium mt-1">Agents</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('knowledge')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            currentTab === 'knowledge' ? 'text-black font-semibold' : 'text-[#71717A]'
          }`}
        >
          <BookOpen className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium mt-1">Docs</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-colors ${
            currentTab === 'settings' ? 'text-black font-semibold' : 'text-[#71717A]'
          }`}
        >
          <Settings className="w-5 h-5 stroke-[2]" />
          <span className="text-[10px] font-medium mt-1">Réglages</span>
        </button>
      </nav>
    </>
  );
};


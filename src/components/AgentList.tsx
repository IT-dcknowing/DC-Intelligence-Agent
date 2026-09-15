import React from 'react';
import { Bot, Sliders, Plus, Sparkles } from 'lucide-react';
import { Agent } from '../types';

interface AgentListProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onToggleStatus?: (id: string) => void;
  onNewAgent?: () => void;
}

export const AgentList: React.FC<AgentListProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
}) => {
  return (
    <div
      id="agent-list-container"
      className="w-[360px] xl:w-[400px] shrink-0 border-r border-[#E2E8F0] bg-white flex flex-col h-full select-none"
    >
      {/* 1. Header (Chantier 4) */}
      <div id="agent-list-header" className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-[24px] font-bold text-[#1E293B] tracking-tight font-['Montserrat']">
              Agents autonomes
            </h1>
            <p className="text-[13px] text-[#64748B] mt-0.5 font-normal">
              {agents.length} {agents.length > 1 ? 'agents déployés' : 'agent déployé'}
            </p>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] shrink-0">
            SYSCOHADA
          </span>
        </div>
      </div>

      {/* 2. Agents Cards / Empty State (Chantier 4 & 7) */}
      <div id="agent-items-scroll" className="flex-1 overflow-y-auto p-4 space-y-3">
        {agents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#F4F4F5] text-black border border-[#E4E4E7] flex items-center justify-center mb-3">
              <Bot className="w-7 h-7 stroke-[1.8]" />
            </div>
            <h3 className="text-[16px] font-bold text-[#1E293B]">
              Créez votre premier agent IA
            </h3>
            <p className="text-[13px] text-[#64748B] mt-1 max-w-[240px]">
              Définissez un rôle comptable, des objectifs et des instructions SYSCOHADA.
            </p>
            {onNewAgent && (
              <button
                type="button"
                onClick={onNewAgent}
                className="mt-4 px-4 py-2 rounded-xl text-[13px] font-semibold bg-black hover:bg-zinc-800 text-white flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>+ Nouvel agent</span>
              </button>
            )}
          </div>
        ) : (
          agents.map((agent) => {
            const isSelected = selectedAgentId === agent.id;
            const isActive = agent.status === 'actif';

            return (
              <div
                key={agent.id}
                id={`agent-card-${agent.id}`}
                onClick={() => onSelectAgent(agent.id)}
                className={`group relative h-[142px] p-3.5 rounded-xl cursor-pointer transition-all duration-200 border flex flex-col justify-between ${
                  isSelected
                    ? 'border-l-[3px] border-l-black bg-[#F8FAFC] border-t-[#E2E8F0] border-r-[#E2E8F0] border-b-[#E2E8F0] shadow-sm'
                    : 'bg-white border-[#E2E8F0] hover:border-black hover:shadow-md'
                }`}
              >
                {/* Top: Icon (44px circle) + Name (Montserrat 600 15px) + Status Badge */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${
                          isActive
                            ? 'bg-black text-white shadow-xs border border-zinc-800'
                            : 'bg-[#F1F5F9] text-[#94A3B8]'
                        }`}
                      >
                        <Bot className="w-5 h-5 stroke-[2]" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-semibold text-[#1E293B] truncate font-['Montserrat']">
                            {agent.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isActive ? 'bg-[#10B981]' : 'bg-[#94A3B8]'
                            }`}
                          />
                          <span
                            className={`text-[11px] font-semibold ${
                              isActive ? 'text-[#10B981]' : 'text-[#94A3B8]'
                            }`}
                          >
                            {isActive ? 'Actif' : 'Inactif'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Configure Button: Appears ONLY on hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAgent(agent.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-white hover:bg-[#F4F4F5] text-black border border-[#D4D4D8] flex items-center gap-1 shrink-0 shadow-xs"
                    >
                      <Sliders className="w-3 h-3" />
                      <span>Configurer</span>
                    </button>
                  </div>

                  {/* Description: 13px slate-600 max 2 lines truncate */}
                  <p className="text-[13px] text-[#475569] line-clamp-2 mt-1.5 leading-snug">
                    {agent.description}
                  </p>
                </div>

                {/* Divider & Bottom row */}
                <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between text-[12px]">
                  <span className="text-[#64748B] italic truncate max-w-[200px]">
                    Rôle : {agent.role.replace('Expert ', '')}
                  </span>

                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] shrink-0 border border-[#E2E8F0]">
                    {agent.conversationsCount || 0} échanges
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

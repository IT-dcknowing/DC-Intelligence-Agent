import React from 'react';
import { Bot, Sliders, Plus } from 'lucide-react';
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
      className="w-[360px] xl:w-[400px] shrink-0 flex flex-col h-full select-none"
      style={{ borderRight: '1px solid #E5E5E7', background: '#fff' }}
    >
      {/* Header */}
      <div
        id="agent-list-header"
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid #E5E5E7' }}
      >
        <div>
          <h1
            className="font-bold tracking-tight"
            style={{ fontSize: '22px', color: '#09090B', fontFamily: "'Inter', sans-serif" }}
          >
            Agents
          </h1>
          <p style={{ fontSize: '12px', color: '#71717A', marginTop: '2px' }}>
            {agents.length} {agents.length > 1 ? 'agents déployés' : 'agent déployé'}
          </p>
        </div>

        {onNewAgent && (
          <button
            type="button"
            id="btn-new-agent"
            onClick={onNewAgent}
            className="flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
            style={{
              padding: '7px 13px',
              background: '#000',
              color: '#fff',
              border: '1px solid #000',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#18181B')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '#000')}
          >
            <Plus style={{ width: 13, height: 13, strokeWidth: 2.5 }} />
            <span>Nouvel agent</span>
          </button>
        )}
      </div>

      {/* Agent cards */}
      <div id="agent-items-scroll" className="flex-1 overflow-y-auto p-3 space-y-2">
        {agents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{ background: '#F4F4F5', border: '1px solid #E5E5E7' }}
            >
              <Bot style={{ width: 22, height: 22, strokeWidth: 1.75, color: '#71717A' }} />
            </div>
            <p className="font-semibold" style={{ fontSize: '15px', color: '#09090B' }}>
              Créez votre premier agent
            </p>
            <p style={{ fontSize: '12px', color: '#71717A', marginTop: '4px', maxWidth: 220 }}>
              Définissez un rôle, des objectifs et des instructions pour chaque agent IA.
            </p>
            {onNewAgent && (
              <button
                type="button"
                onClick={onNewAgent}
                className="mt-4 flex items-center gap-1.5 cursor-pointer"
                style={{
                  padding: '8px 16px',
                  background: '#000',
                  color: '#fff',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: 'none',
                }}
              >
                <Plus style={{ width: 13, height: 13 }} />
                <span>Nouvel agent</span>
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
                className="group p-3.5 rounded-xl cursor-pointer transition-all duration-150"
                style={{
                  background: isSelected ? '#F4F4F5' : '#fff',
                  border: `1px solid ${isSelected ? '#D4D4D8' : '#E5E5E7'}`,
                  borderRadius: '12px',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.borderColor = '#D4D4D8';
                    (e.currentTarget as HTMLElement).style.background = '#FAFAFA';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    (e.currentTarget as HTMLElement).style.borderColor = '#E5E5E7';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }
                }}
              >
                {/* Top: icon + name + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Avatar */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: isActive ? '#09090B' : '#F4F4F5',
                        border: `1px solid ${isActive ? '#09090B' : '#E5E5E7'}`,
                      }}
                    >
                      <Bot
                        style={{
                          width: 16,
                          height: 16,
                          strokeWidth: 1.75,
                          color: isActive ? '#fff' : '#A1A1AA',
                        }}
                      />
                    </div>

                    <div className="min-w-0">
                      <p
                        className="truncate font-semibold"
                        style={{ fontSize: '13px', color: '#09090B' }}
                      >
                        {agent.name}
                      </p>
                      {/* Monochrome status badge */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="inline-block rounded-full"
                          style={{
                            width: 5,
                            height: 5,
                            background: isActive ? '#71717A' : '#D4D4D8',
                          }}
                        />
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 500,
                            color: isActive ? '#52525B' : '#A1A1AA',
                          }}
                        >
                          {isActive ? 'Actif' : 'Inactif'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Configure on hover */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer"
                    style={{
                      padding: '4px 8px',
                      background: '#fff',
                      border: '1px solid #E5E5E7',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 500,
                      color: '#52525B',
                    }}
                  >
                    <Sliders style={{ width: 11, height: 11, strokeWidth: 1.75 }} />
                    <span>Config</span>
                  </button>
                </div>

                {/* Description */}
                <p
                  className="line-clamp-2 mt-2"
                  style={{ fontSize: '12px', color: '#71717A', lineHeight: 1.5 }}
                >
                  {agent.description}
                </p>

                {/* Footer */}
                <div
                  className="flex items-center justify-between mt-2.5 pt-2.5"
                  style={{ borderTop: '1px solid #F4F4F5' }}
                >
                  <span
                    className="truncate"
                    style={{ fontSize: '11px', color: '#A1A1AA', maxWidth: 180 }}
                  >
                    {agent.role.replace('Expert ', '')}
                  </span>
                  <span
                    className="font-mono shrink-0"
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      color: '#71717A',
                      background: '#F4F4F5',
                      border: '1px solid #E5E5E7',
                      borderRadius: '99px',
                      padding: '1px 8px',
                    }}
                  >
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

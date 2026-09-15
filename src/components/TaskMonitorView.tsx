import React, { useState, useEffect } from 'react';
import {
  Cpu,
  RefreshCw,
  CheckCircle,
  Clock,
  Play,
  XCircle,
  MessageSquare,
  Phone,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { TaskObject, TaskStatus } from '../types';
import { getTasksFromStorage, updateTaskStatus, createTask } from '../services/taskEngine';

interface WhatsAppSessionLog {
  phone: string;
  subject: string;
  intent: string;
  messageCount: number;
  lastTimestamp: string;
  messages: {
    sender: 'user' | 'agent';
    content: string;
    timestamp: string;
  }[];
}

export const TaskMonitorView: React.FC = () => {
  const [activeVolet, setActiveVolet] = useState<'whatsapp' | 'tasks'>('whatsapp');

  // --------------------------------------------------------------------------
  // VOLET 1 : WHATSAPP LOGS DATA & STATE
  // --------------------------------------------------------------------------
  const [isRefreshingWhatsApp, setIsRefreshingWhatsApp] = useState(false);
  const [expandedPhone, setExpandedPhone] = useState<string | null>('22578941955'); // Default expanded as in user screenshot

  const [whatsappConversations, setWhatsappConversations] = useState<WhatsAppSessionLog[]>([
    {
      phone: '2250700000004',
      subject: 'sans sujet',
      intent: 'GREETING',
      messageCount: 4,
      lastTimestamp: '15/09 14:02',
      messages: [
        {
          sender: 'user',
          content: 'Bonjour DC Intelligence, comment puis-je déclarer ma patente DGI en ligne ?',
          timestamp: '15/09 14:00',
        },
        {
          sender: 'agent',
          content:
            'Bonjour ! La patente DGI s’effectue sur le portail e-Impôts CI. Selon l’article 287 du CGI, vous devez soumettre l’état prévisionnel du chiffre d’affaires avant le 15 mars.',
          timestamp: '15/09 14:01',
        },
        {
          sender: 'user',
          content: 'Quel est le compte SYSCOHADA pour l’imputation de la patente ?',
          timestamp: '15/09 14:01',
        },
        {
          sender: 'agent',
          content: 'La patente commerciale doit être débitée au compte **6412 « Patentes et licences »** par le crédit du compte **4421 « État, impôts et taxes directes »**.',
          timestamp: '15/09 14:02',
        },
      ],
    },
    {
      phone: '22589188922',
      subject: 'sans sujet',
      intent: 'TVA_QUERY',
      messageCount: 8,
      lastTimestamp: '15/09 13:54',
      messages: [
        {
          sender: 'user',
          content: 'Facture d’achat de marchandises à 18% de TVA, quel est le taux retenu à la source DGI ?',
          timestamp: '15/09 13:50',
        },
        {
          sender: 'agent',
          content:
            'Selon l’article 355 du CGI Ivoirien, le taux normal de TVA est de 18%. En cas d’immatriculation au régime réel simplifié, la précompte TVA retenue à la source est de 5%.',
          timestamp: '15/09 13:54',
        },
      ],
    },
    {
      phone: '22578941955',
      subject: 'sans sujet',
      intent: 'RATE',
      messageCount: 8,
      lastTimestamp: '14/09 10:00',
      messages: [
        {
          sender: 'agent',
          content:
            'déclaratives et des contrôles pour : * Les déclarations de TVA (Article 340 du CGI). * Les déclarations d’ITS et retenues à la source (Article 115 du CGI). * Les déclarations de cotisations CNPS (Articles 24 à 28 du Code de Prévoyance Sociale). * Les contrôles fiscaux généraux et les sanctions asso',
          timestamp: '14/09 09:55',
        },
        {
          sender: 'user',
          content: 'quelles sont tes ressources et sources d’information',
          timestamp: '14/09 09:56',
        },
        {
          sender: 'agent',
          content:
            'Mes ressources et sources d’information sont strictement limitées à la base de données que vous m’avez fournie. Je ne peux pas accéder à internet, à des bases de données externes ou à des textes de loi en dehors des extraits que vous m’avez communiqués. Pour les questions que vous posez, ma réponse se base exclusivement sur les documents suivants que vous avez partagés : * **Livre des Procédures Fiscales (LPF)** * **Code Général des Impôts (CGI)**, notamment les articles sur la TVA, l’IT',
          timestamp: '14/09 09:58',
        },
        {
          sender: 'user',
          content: 'combien de temps pour repondre à une demande d’explication ?',
          timestamp: '14/09 09:59',
        },
        {
          sender: 'agent',
          content:
            'Je ne trouve pas d’information dans les textes et extraits fournis concernant le délai légal pour répondre à une demande d’explication de l’administration fiscale. Les documents fournis traitent principalement des obligations de déclaration, des taux d’imposition et des sanctions pour retard, mais ne précisent pas le délai de réponse à une demande d’explication. Pour obtenir cette information précise, il est recommandé de consulter le texte intégral du **Livre des Procédures Fiscales (LPF)**',
          timestamp: '14/09 10:00',
        },
      ],
    },
    {
      phone: '2250711223344',
      subject: 'sans sujet',
      intent: 'BANK_RECO',
      messageCount: 6,
      lastTimestamp: '14/09 08:30',
      messages: [
        {
          sender: 'user',
          content: 'Voici mon relevé bancaire Ecobank du mois pour pointer les virements.',
          timestamp: '14/09 08:25',
        },
        {
          sender: 'agent',
          content: 'Relevé récepteur analysé. 2 opérations de 450 000 FCFA concordent avec les factures FC-2026-088.',
          timestamp: '14/09 08:30',
        },
      ],
    },
    {
      phone: '2250566778899',
      subject: 'sans sujet',
      intent: 'SYSCOHADA',
      messageCount: 5,
      lastTimestamp: '13/09 16:15',
      messages: [
        {
          sender: 'user',
          content: 'Dans quel compte imputer l’achat d’un ordinateur de 650 000 FCFA ?',
          timestamp: '13/09 16:10',
        },
        {
          sender: 'agent',
          content: 'Le montant dépassant 50 000 FCFA, il s’agit d’une immobilisation au compte **2441 « Matériel informatique »**.',
          timestamp: '13/09 16:15',
        },
      ],
    },
    {
      phone: '2250102030405',
      subject: 'sans sujet',
      intent: 'GREETING',
      messageCount: 2,
      lastTimestamp: '12/09 11:20',
      messages: [
        {
          sender: 'user',
          content: 'Bonjour l’équipe DC Intelligence !',
          timestamp: '12/09 11:19',
        },
        {
          sender: 'agent',
          content: 'Bonjour ! Je suis votre assistant central comptable & juridique. Comment puis-je vous aider aujourd’hui ?',
          timestamp: '12/09 11:20',
        },
      ],
    },
  ]);

  const handleRefreshWhatsApp = () => {
    setIsRefreshingWhatsApp(true);
    setTimeout(() => {
      setIsRefreshingWhatsApp(false);
    }, 800);
  };

  // --------------------------------------------------------------------------
  // VOLET 2 : MOTEUR DE TÂCHES CENTRAL DATA & STATE
  // --------------------------------------------------------------------------
  const [tasks, setTasks] = useState<TaskObject[]>([]);
  const [taskFilter, setTaskFilter] = useState<'all' | 'running' | 'waiting' | 'completed'>('all');

  const reloadTasks = () => {
    setTasks(getTasksFromStorage());
  };

  useEffect(() => {
    reloadTasks();
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (taskFilter === 'running' && t.status !== 'RUNNING') return false;
    if (taskFilter === 'waiting' && t.status !== 'WAITING_USER') return false;
    if (taskFilter === 'completed' && t.status !== 'COMPLETED') return false;
    return true;
  });

  const totalTasks = tasks.length;
  const runningCount = tasks.filter((t) => t.status === 'RUNNING').length;
  const waitingCount = tasks.filter((t) => t.status === 'WAITING_USER').length;
  const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;

  const handleAction = (taskId: string, newStatus: TaskStatus) => {
    updateTaskStatus(taskId, newStatus);
    reloadTasks();
  };

  return (
    <div
      className="flex-1 flex flex-col h-full bg-[#F8FAFC] relative min-w-0 overflow-y-auto select-none"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── TOP NAV VOLETS SWITCHER ── */}
      <header className="border-b border-[#E2E8F0] px-6 py-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center font-bold shadow-xs">
            {activeVolet === 'whatsapp' ? <MessageSquare className="w-5 h-5" /> : <Cpu className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-bold text-[#1E293B] tracking-tight">
                {activeVolet === 'whatsapp' ? 'WhatsApp Logs' : 'Moteur de Tâches Central'}
              </h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                API Live Meta v26.0
              </span>
            </div>
            <p className="text-[12px] text-[#64748B] mt-0.5">
              {activeVolet === 'whatsapp'
                ? 'Suivi du numéro API : conversations, distribution et échecs Meta Business.'
                : 'Supervision et orchestration des tâches asynchrones (Routage, VLM, Attente Validation N1).'}
            </p>
          </div>
        </div>

        {/* Tab Switcher & Refresh Button */}
        <div className="flex items-center gap-3">
          <div className="p-1 bg-[#F1F5F9] rounded-xl border border-[#E2E8F0] flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveVolet('whatsapp')}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeVolet === 'whatsapp'
                  ? 'bg-white text-black shadow-xs'
                  : 'text-[#64748B] hover:text-black'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp Logs</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveVolet('tasks')}
              className={`px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeVolet === 'tasks'
                  ? 'bg-white text-black shadow-xs'
                  : 'text-[#64748B] hover:text-black'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Moteur de Tâches</span>
            </button>
          </div>

          <button
            type="button"
            onClick={activeVolet === 'whatsapp' ? handleRefreshWhatsApp : reloadTasks}
            className="px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#1E293B] font-semibold text-[12px] flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
            title="Actualiser"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingWhatsApp ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* VOLET 1 : WHATSAPP LOGS DASHBOARD                                    */}
      {/* ==================================================================== */}
      {activeVolet === 'whatsapp' && (
        <div className="p-6 max-w-6xl space-y-6">
          {/* Card 1: NUMÉRO API WHATSAPP BUSINESS */}
          <div className="p-5 rounded-2xl bg-white border border-[#E2E8F0] shadow-xs space-y-3">
            <div className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
              NUMÉRO API WHATSAPP BUSINESS
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-emerald-600" />
                <span className="text-[17px] font-bold text-[#1E293B] font-mono">
                  +225 74 52 90 52
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1E293B]">
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <span>Dc Knowing</span>
              </div>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                Qualité GREEN
              </span>

              <span className="text-[12px] text-[#64748B]">
                Vérification : <strong className="text-[#1E293B]">VERIFIED</strong>
              </span>
            </div>
          </div>

          {/* Stats Grid (6 KPI Cards) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                CONVERSATIONS
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">{whatsappConversations.length}</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                ACTIVES 24 H
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">2</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                DISTRIBUÉS
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">6</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                LUS
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">2</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider text-amber-700">
                ÉCHECS
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">4</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">
                FILE DES MORTS
              </div>
              <div className="text-2xl font-bold text-[#1E293B] mt-1">0</div>
            </div>
          </div>

          {/* Conversations List Card */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden space-y-2 p-5">
            <h3 className="text-[15px] font-bold text-[#1E293B] mb-3">
              Conversations ({whatsappConversations.length})
            </h3>

            <div className="space-y-3">
              {whatsappConversations.map((conv) => {
                const isExpanded = expandedPhone === conv.phone;

                return (
                  <div
                    key={conv.phone}
                    className="border border-[#E2E8F0] rounded-xl overflow-hidden transition-all bg-[#FAFBFD]"
                  >
                    {/* Collapsible Row Header */}
                    <div
                      onClick={() => setExpandedPhone(isExpanded ? null : conv.phone)}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-white transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-[14px] text-[#1E293B]">
                          {conv.phone}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[12px] text-[#64748B]">
                        <span>{conv.subject}</span>
                        <span className="px-2 py-0.5 rounded bg-zinc-100 font-mono text-[10px] font-bold text-zinc-800 uppercase">
                          {conv.intent}
                        </span>
                        <span>{conv.messageCount} msg</span>
                        <span>{conv.lastTimestamp}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-[#64748B]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#64748B]" />
                        )}
                      </div>
                    </div>

                    {/* Expanded History Chat View */}
                    {isExpanded && (
                      <div className="p-4 border-t border-[#E2E8F0] bg-white space-y-3">
                        {conv.messages.map((m, idx) => (
                          <div
                            key={idx}
                            className={`p-3.5 rounded-xl text-[12.5px] leading-relaxed max-w-3xl ${
                              m.sender === 'user'
                                ? 'bg-zinc-100 text-zinc-900 ml-auto border border-zinc-200'
                                : 'bg-[#EEF2FF] text-[#1E1B4B] border border-[#C7D2FE]'
                            }`}
                          >
                            <div className="text-[10px] font-bold mb-1 opacity-70 flex justify-between">
                              <span>{m.sender === 'user' ? 'Client WhatsApp' : 'DC Intelligence Agent'}</span>
                              <span>{m.timestamp}</span>
                            </div>
                            <div className="whitespace-pre-line">{m.content}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* VOLET 2 : MOTEUR DE TÂCHES CENTRAL                                   */}
      {/* ==================================================================== */}
      {activeVolet === 'tasks' && (
        <div className="p-6 max-w-6xl space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Tâches</div>
              <div className="text-2xl font-bold text-black mt-1">{totalTasks}</div>
              <div className="text-[11px] text-gray-400 mt-1">Écosystème DC-KNOWING</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">En Cours (RUNNING)</div>
              <div className="text-2xl font-bold text-black mt-1">{runningCount}</div>
              <div className="text-[11px] text-gray-400 mt-1">Exécution logicielle</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Attente User</div>
              <div className="text-2xl font-bold text-black mt-1">{waitingCount}</div>
              <div className="text-[11px] text-gray-400 mt-1">Validation explicite N1</div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-xs">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Terminées</div>
              <div className="text-2xl font-bold text-black mt-1">{completedCount}</div>
              <div className="text-[11px] text-gray-400 mt-1">Succès d'exécution</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTaskFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                taskFilter === 'all'
                  ? 'bg-black text-white'
                  : 'bg-white border border-[#E2E8F0] text-gray-700 hover:bg-gray-50'
              }`}
            >
              Toutes ({totalTasks})
            </button>
            <button
              onClick={() => setTaskFilter('running')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                taskFilter === 'running'
                  ? 'bg-black text-white'
                  : 'bg-white border border-[#E2E8F0] text-gray-700 hover:bg-gray-50'
              }`}
            >
              En Cours ({runningCount})
            </button>
            <button
              onClick={() => setTaskFilter('waiting')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                taskFilter === 'waiting'
                  ? 'bg-black text-white'
                  : 'bg-white border border-[#E2E8F0] text-gray-700 hover:bg-gray-50'
              }`}
            >
              Attente Validation ({waitingCount})
            </button>
            <button
              onClick={() => setTaskFilter('completed')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                taskFilter === 'completed'
                  ? 'bg-black text-white'
                  : 'bg-white border border-[#E2E8F0] text-gray-700 hover:bg-gray-50'
              }`}
            >
              Terminées ({completedCount})
            </button>
          </div>

          {/* Table or Empty Diagnostic */}
          {filteredTasks.length === 0 ? (
            <div className="border border-[#E2E8F0] rounded-2xl p-8 bg-white shadow-xs space-y-6">
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center shadow-sm">
                  <Cpu className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-black">Moteur de Tâches Central — En Veille</h3>
                  <p className="text-xs text-gray-500 max-w-lg mt-1 leading-relaxed">
                    Le Task Engine centralise, supervise et exécute de manière asynchrone toutes les opérations sollicitées auprès des agents spécialisés (Comptabilité, Rapprochement, Juridique) et des connecteurs métiers (Google Sheets, LegalFlow MCP).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#F0F0F0]">
                <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E2E8F0] text-left space-y-1">
                  <div className="text-[11px] font-bold text-black uppercase tracking-wider">1. Intent Classification</div>
                  <p className="text-[11px] text-gray-500">Le Routeur qualifie la requête (Facture, Contrat, Relevé) et détermine l'Agent cible.</p>
                </div>
                <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E2E8F0] text-left space-y-1">
                  <div className="text-[11px] font-bold text-black uppercase tracking-wider">2. Permission & Control</div>
                  <p className="text-[11px] text-gray-500">Filtrage selon les permissions (READ, RECOMMEND, PREPARE, EXECUTE).</p>
                </div>
                <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E2E8F0] text-left space-y-1">
                  <div className="text-[11px] font-bold text-black uppercase tracking-wider">3. Execution & Export</div>
                  <p className="text-[11px] text-gray-500">Génération d'écritures SYSCOHADA et écriture directe dans Google Sheets.</p>
                </div>
              </div>

              <div className="flex justify-center pt-2">
                <button
                  onClick={() => {
                    createTask({
                      agentId: 'Agent Accueil / Routeur Central',
                      action: 'EXECUTE',
                      input: 'Test de diagnostic système — Vérification liaison Moteur de Tâches & Connecteurs',
                      status: 'COMPLETED',
                    });
                    reloadTasks();
                  }}
                  className="px-4 py-2 bg-black hover:bg-zinc-800 text-white text-xs font-semibold rounded-xl transition-all shadow-xs cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Lancer un test de diagnostic système</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAFAFA] border-b border-[#E2E8F0] text-gray-500 font-medium">
                  <tr>
                    <th className="py-3 px-4">Task ID</th>
                    <th className="py-3 px-4">Agent Attribué</th>
                    <th className="py-3 px-4">Permission Action</th>
                    <th className="py-3 px-4">Instruction / Entrée</th>
                    <th className="py-3 px-4">Statut Tâche</th>
                    <th className="py-3 px-4">Date Création</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredTasks.map((t) => (
                    <tr key={t.taskId} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-black">{t.taskId}</td>
                      <td className="py-3 px-4 font-medium text-black">{t.agentId}</td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-[10px] uppercase bg-[#FAFAFA] border border-[#E2E8F0] px-2 py-0.5 rounded-md text-black font-semibold">
                          {t.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{t.input}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                            t.status === 'COMPLETED'
                              ? 'bg-[#FAFAFA] border border-[#E2E8F0] text-black'
                              : t.status === 'RUNNING'
                              ? 'bg-gray-100 border border-gray-300 text-gray-800'
                              : t.status === 'WAITING_USER'
                              ? 'bg-gray-100 border border-gray-300 text-gray-700'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          {t.status === 'COMPLETED' && <CheckCircle className="w-3 h-3 text-black" />}
                          {t.status === 'RUNNING' && <Play className="w-3 h-3 text-gray-800 animate-spin" />}
                          {t.status === 'WAITING_USER' && <Clock className="w-3 h-3 text-gray-700" />}
                          {t.status === 'FAILED' && <XCircle className="w-3 h-3 text-gray-500" />}
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-[11px]">
                        {new Date(t.createdAt).toLocaleString('fr-FR')}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {t.status === 'WAITING_USER' ? (
                          <button
                            onClick={() => handleAction(t.taskId, 'COMPLETED')}
                            className="bg-black text-white text-[10px] font-medium px-2.5 py-1 rounded-md hover:bg-gray-800 transition-colors"
                          >
                            Valider
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

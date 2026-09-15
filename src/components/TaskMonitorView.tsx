import React, { useState, useEffect } from 'react';
import { Cpu, RefreshCw, CheckCircle, Clock, AlertTriangle, Play, XCircle } from 'lucide-react';
import { TaskObject, TaskStatus } from '../types';
import { getTasksFromStorage, updateTaskStatus, createTask } from '../services/taskEngine';

export const TaskMonitorView: React.FC = () => {
  const [tasks, setTasks] = useState<TaskObject[]>([]);
  const [filter, setFilter] = useState<'all' | 'running' | 'waiting' | 'completed'>('all');

  const reloadTasks = () => {
    setTasks(getTasksFromStorage());
  };

  useEffect(() => {
    reloadTasks();
  }, []);

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'running' && t.status !== 'RUNNING') return false;
    if (filter === 'waiting' && t.status !== 'WAITING_USER') return false;
    if (filter === 'completed' && t.status !== 'COMPLETED') return false;
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
      className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-y-auto select-none"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <div className="border-b border-[#E5E5E7] px-6 py-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-black tracking-tight">Moteur de Tâches Central</h1>
            <span className="bg-[#FAFAFA] border border-[#E5E5E7] text-black text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <Cpu className="w-3 h-3 text-black" /> Task Engine DC-KNOWING
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Supervision et orchestration des tâches asynchrones entre agents et logiciels métiers.
          </p>
        </div>

        <button
          onClick={reloadTasks}
          className="p-2 border border-[#E5E5E7] rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
          title="Rafraîchir les tâches"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Cards */}
      <div className="px-6 py-4 grid grid-cols-4 gap-4 border-b border-[#E5E5E7] bg-[#FAFAFA]">
        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Tâches</div>
          <div className="text-2xl font-bold text-black mt-1">{totalTasks}</div>
          <div className="text-[11px] text-gray-400 mt-1">Écosystème DC-KNOWING</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">En Cours (RUNNING)</div>
          <div className="text-2xl font-bold text-black mt-1">{runningCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">Exécution logicielle</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Attente User</div>
          <div className="text-2xl font-bold text-black mt-1">{waitingCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">Validation explicite N1</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Terminées</div>
          <div className="text-2xl font-bold text-black mt-1">{completedCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">Succès d'exécution</div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-[#E5E5E7] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'all'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Toutes ({totalTasks})
          </button>
          <button
            onClick={() => setFilter('running')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'running'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            En Cours ({runningCount})
          </button>
          <button
            onClick={() => setFilter('waiting')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'waiting'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Attente Validation ({waitingCount})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'completed'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Terminées ({completedCount})
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="p-6">
        {filteredTasks.length === 0 ? (
          <div className="border border-[#E5E5E7] rounded-2xl p-8 bg-[#FDFDFD] space-y-6">
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
              <div className="p-4 rounded-xl bg-white border border-[#E5E5E7] text-left space-y-1">
                <div className="text-[11px] font-bold text-black uppercase tracking-wider">1. Intent Classification</div>
                <p className="text-[11px] text-gray-500">Le Routeur qualifie la requête (Facture, Contrat, Relevé) et détermine l'Agent cible.</p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-[#E5E5E7] text-left space-y-1">
                <div className="text-[11px] font-bold text-black uppercase tracking-wider">2. Permission & Control</div>
                <p className="text-[11px] text-gray-500">Filtrage selon les permissions (READ, RECOMMEND, PREPARE, EXECUTE).</p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-[#E5E5E7] text-left space-y-1">
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
          <div className="border border-[#E5E5E7] rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAFAFA] border-b border-[#E5E5E7] text-gray-500 font-medium">
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
              <tbody className="divide-y divide-[#E5E5E7]">
                {filteredTasks.map((t) => (
                  <tr key={t.taskId} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-black">{t.taskId}</td>
                    <td className="py-3 px-4 font-medium text-black">{t.agentId}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[10px] uppercase bg-[#FAFAFA] border border-[#E5E5E7] px-2 py-0.5 rounded-md text-black font-semibold">
                        {t.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{t.input}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          t.status === 'COMPLETED'
                            ? 'bg-[#FAFAFA] border border-[#E5E5E7] text-black'
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
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Download, ShieldCheck, AlertTriangle, FileText, Filter, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { AuditEntry } from '../types';
import { getAuditLogs, downloadAuditCSV } from '../services/auditLog';

export const AuditLogView: React.FC = () => {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'valid' | 'alerts' | 'escalated'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const reloadLogs = () => {
    setLogs(getAuditLogs());
  };

  useEffect(() => {
    reloadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filter === 'valid' && !log.validation.ok) return false;
    if (filter === 'alerts' && log.validation.alertes.length === 0) return false;
    if (filter === 'escalated' && !log.escalade?.declenchee) return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const tiers = log.ecritureProposee.tiers?.toLowerCase() || '';
      const journal = log.ecritureProposee.journal?.toLowerCase() || '';
      const id = log.id.toLowerCase();
      return tiers.includes(term) || journal.includes(term) || id.includes(term);
    }
    return true;
  });

  const totalLogs = logs.length;
  const validCount = logs.filter((l) => l.validation.ok).length;
  const alertCount = logs.filter((l) => l.validation.alertes.length > 0).length;
  const escalatedCount = logs.filter((l) => l.escalade?.declenchee).length;

  return (
    <div
      className="flex-1 flex flex-col h-full bg-white relative min-w-0 overflow-y-auto select-none"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <div className="border-b border-[#E5E5E7] px-6 py-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-black tracking-tight">Journal d'Audit Comptable</h1>
            <span className="bg-[#FAFAFA] border border-[#E5E5E7] text-black text-xs font-medium px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-black" /> Traçabilité SYSCOHADA
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Historique complet des propositions d'écritures, analyses LLM, contrôles et exports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={reloadLogs}
            className="p-2 border border-[#E5E5E7] rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            title="Rafraîchir les logs"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => downloadAuditCSV(filteredLogs)}
            className="bg-black hover:bg-gray-800 text-white font-medium text-xs px-4 py-2 rounded-lg flex items-center gap-2 shadow-none transition-colors"
          >
            <Download className="w-4 h-4" /> Exporter CSV Cabinet
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-6 py-4 grid grid-cols-4 gap-4 border-b border-[#E5E5E7] bg-[#FAFAFA]">
        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Écritures</div>
          <div className="text-2xl font-bold text-black mt-1">{totalLogs}</div>
          <div className="text-[11px] text-gray-400 mt-1">Interactions journalisées</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Validées (Check 7/7)</div>
          <div className="text-2xl font-bold text-black mt-1">{validCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {totalLogs > 0 ? Math.round((validCount / totalLogs) * 100) : 0}% de conformité
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Alertes & Vérifications</div>
          <div className="text-2xl font-bold text-black mt-1">{alertCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">Contrôles déterministes</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#E5E5E7]">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Escalades Expert</div>
          <div className="text-2xl font-bold text-black mt-1">{escalatedCount}</div>
          <div className="text-[11px] text-gray-400 mt-1">Nécessite arbitrage cabinet</div>
        </div>
      </div>

      {/* Filters & Search */}
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
            Toutes ({totalLogs})
          </button>
          <button
            onClick={() => setFilter('valid')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'valid'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Conformes 7/7 ({validCount})
          </button>
          <button
            onClick={() => setFilter('alerts')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'alerts'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Avec Alertes ({alertCount})
          </button>
          <button
            onClick={() => setFilter('escalated')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'escalated'
                ? 'bg-black text-white'
                : 'bg-white border border-[#E5E5E7] text-gray-700 hover:bg-gray-50'
            }`}
          >
            Escaladées ({escalatedCount})
          </button>
        </div>

        <div className="relative w-64">
          <input
            type="text"
            placeholder="Rechercher tiers, journal, ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs border border-[#E5E5E7] rounded-lg px-3 py-1.5 focus:outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Table */}
      <div className="p-6">
        {filteredLogs.length === 0 ? (
          <div className="border border-dashed border-[#E5E5E7] rounded-xl p-12 text-center text-gray-400">
            <FileText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-xs">Aucune entrée d'audit enregistrée pour le moment.</p>
          </div>
        ) : (
          <div className="border border-[#E5E5E7] rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#FAFAFA] border-b border-[#E5E5E7] text-gray-500 font-medium">
                <tr>
                  <th className="py-3 px-4">Horodatage / ID</th>
                  <th className="py-3 px-4">Tiers & Pièce</th>
                  <th className="py-3 px-4">Journal</th>
                  <th className="py-3 px-4 text-right">Montant HT</th>
                  <th className="py-3 px-4 text-right">Montant TTC</th>
                  <th className="py-3 px-4">Validation Pipeline</th>
                  <th className="py-3 px-4">Modèle LLM</th>
                  <th className="py-3 px-4 text-center">Export Sheets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E7]">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono text-[11px] font-semibold text-black">{log.id}</div>
                      <div className="text-[10px] text-gray-400">
                        {new Date(log.timestamp).toLocaleString('fr-FR')}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-medium text-black">{log.ecritureProposee.tiers || 'Tiers indéfini'}</div>
                      <div className="text-[11px] text-gray-400">
                        {log.ecritureProposee.reference || log.ecritureProposee.typePiece}
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono font-medium">{log.ecritureProposee.journal}</td>

                    <td className="py-3 px-4 text-right font-mono">
                      {(log.ecritureProposee.montantHT || 0).toLocaleString('fr-FR')} FCFA
                    </td>

                    <td className="py-3 px-4 text-right font-mono font-semibold">
                      {(log.ecritureProposee.montantTTC || 0).toLocaleString('fr-FR')} FCFA
                    </td>

                    <td className="py-3 px-4">
                      {log.validation.ok ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-black bg-[#FAFAFA] border border-[#E5E5E7] px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3 text-black" />
                          Passed ({log.validation.checksPassed}/{log.validation.totalChecks})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3 text-gray-700" />
                          Alertes ({log.validation.alertes.length})
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-gray-600 text-[11px]">{log.llm.modele}</td>

                    <td className="py-3 px-4 text-center">
                      {log.exportSheets?.fait ? (
                        <span className="text-black font-semibold text-xs">✅ Fait</span>
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

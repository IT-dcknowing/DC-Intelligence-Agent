import { AuditEntry, PropositionEcriture, ValidationResult } from '../types';

const AUDIT_LOG_STORAGE_KEY = 'dc_intelligence_audit_log';

/**
 * Load all audit entries from LocalStorage
 */
export function getAuditLogs(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Could not load audit log from localStorage', e);
  }
  return [];
}

/**
 * Save audit log entries to LocalStorage
 * NOTA: Stockage local d'écritures côté application DÉSACTIVÉ.
 * Les écritures sont uniquement transmises directement aux connecteurs externes (Google Sheets / Sage).
 */
export function saveAuditLogs(logs: AuditEntry[]): void {
  // Aucune écriture n'est conservée dans le localStorage du navigateur
  return;
}

/**
 * Record a new interaction entry in the audit log
 */
export function logAuditInteraction(params: {
  source: 'upload' | 'chat' | 'manuel';
  fichier?: { nom: string; hash: string; taille: number };
  llm: { provider: string; modele: string; tokensInput?: number; tokensOutput?: number };
  question: string;
  sourcesRag?: string[];
  ecritureProposee: PropositionEcriture;
  validation: ValidationResult;
  correctionsUtilisateur?: Partial<PropositionEcriture>;
  exportSheets?: { fait: boolean; timestamp?: string; ligneAjoutee?: number };
  escalade?: { declenchee: boolean; motif?: string };
}): AuditEntry {
  const newEntry: AuditEntry = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    source: params.source,
    fichier: params.fichier,
    llm: params.llm,
    question: params.question,
    sourcesRag: params.sourcesRag || ['SYSCOHADA.md', 'BARÈME_TVA_DGI.md'],
    ecritureProposee: params.ecritureProposee,
    validation: params.validation,
    correctionsUtilisateur: params.correctionsUtilisateur,
    exportSheets: params.exportSheets || { fait: false },
    escalade: params.escalade || { declenchee: false },
  };

  const currentLogs = getAuditLogs();
  const updatedLogs = [newEntry, ...currentLogs];
  saveAuditLogs(updatedLogs);

  return newEntry;
}

/**
 * Update an existing audit entry (e.g. after user confirmation or export to Google Sheets)
 */
export function updateAuditEntry(id: string, updates: Partial<AuditEntry>): void {
  const logs = getAuditLogs();
  const index = logs.findIndex((l) => l.id === id);
  if (index !== -1) {
    logs[index] = { ...logs[index], ...updates };
    saveAuditLogs(logs);
  }
}

/**
 * Export audit entries as a CSV string
 */
export function exportAuditLogsToCSV(logs: AuditEntry[]): string {
  const headers = [
    'ID Audit',
    'Date ISO',
    'Source',
    'Modèle LLM',
    'Tiers',
    'Journal',
    'Montant HT',
    'TVA 18%',
    'Montant TTC',
    'Statut Validation',
    'Erreurs',
    'Alertes',
    'Export Sheets',
    'Escalade Expert',
  ];

  const rows = logs.map((l) => [
    l.id,
    l.timestamp,
    l.source,
    l.llm.modele,
    `"${(l.ecritureProposee.tiers || '').replace(/"/g, '""')}"`,
    l.ecritureProposee.journal,
    l.ecritureProposee.montantHT,
    l.ecritureProposee.montantTVA,
    l.ecritureProposee.montantTTC,
    l.validation.ok ? 'VALIDE' : 'REJETE',
    `"${l.validation.erreurs.join(' ; ').replace(/"/g, '""')}"`,
    `"${l.validation.alertes.join(' ; ').replace(/"/g, '""')}"`,
    l.exportSheets?.fait ? 'OUI' : 'NON',
    l.escalade?.declenchee ? 'OUI' : 'NON',
  ]);

  return [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
}

/**
 * Trigger browser download of CSV audit log file
 */
export function downloadAuditCSV(logs?: AuditEntry[]): void {
  const list = logs || getAuditLogs();
  const csvText = exportAuditLogsToCSV(list);
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_journal_syscohada_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

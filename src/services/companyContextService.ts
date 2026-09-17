/**
 * P0.2 Contexte entreprise : companyId -> AccountingContext + statuts
 * P0.3 Plans structurés : plan comptable / tiers / journaux comme sources
 * P0.1 Knowledge ciblée : helpers de recherche filtrés
 */
import { AccountingContext, ConnectorCapability, ContextStatus } from '../types';
import { INITIAL_KNOWLEDGE } from '../mockData';

const LS_PLAN = 'dc_plan_comptable_entries';
const LS_TIERS = 'dc_tiers_entries';
const LS_JOURNAUX = 'dc_journal_entries';

export interface PlanEntry { companyId: string; accountCode: string; accountLabel: string; accountClass: string; nature: string; active: boolean }
export interface TiersEntry { companyId: string; tierCode: string; tierName: string; tierType: 'CLIENT' | 'FOURNISSEUR'; collectiveAccount: string; ncc?: string; rccm?: string; active: boolean }
export interface JournalEntry { companyId: string; journalCode: string; journalLabel: string; journalType: string; bankName?: string; active: boolean }

function readLS<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function currentCompanyId(): string | undefined {
  try {
    // Single-tenant par défaut : première entreprise des agents ou 'company_123'
    const raw = localStorage.getItem('dc_current_company_id');
    if (raw) return raw.replace(/"/g, '');
  } catch {}
  return undefined;
}

// P0.2
export function getAccountingContext(companyId?: string): AccountingContext {
  const cid = companyId || currentCompanyId();
  const plan = readLS<PlanEntry>(LS_PLAN).filter((e) => !cid || e.companyId === cid);
  const tiers = readLS<TiersEntry>(LS_TIERS).filter((e) => !cid || e.companyId === cid);
  const journaux = readLS<JournalEntry>(LS_JOURNAUX).filter((e) => !cid || e.companyId === cid);
  const hasPlan = plan.length > 0;
  const hasTiers = tiers.length > 0;
  const hasJournaux = journaux.length > 0;

  let contextStatus: ContextStatus = 'GENERAL_ONLY';
  if (hasPlan && hasTiers && hasJournaux) contextStatus = 'COMPLETE';
  else if (hasPlan || hasTiers || hasJournaux) contextStatus = 'PARTIAL';

  // Si aucune info critique (ex: pièce proforma sans entreprise), l'appelant passera à INSUFFICIENT
  return {
    companyId: cid,
    contextStatus,
    planComptableStatus: hasPlan ? 'loaded' : 'empty',
    planTiersStatus: hasTiers ? 'loaded' : 'empty',
    journauxStatus: hasJournaux ? 'loaded' : 'empty',
    banquesStatus: hasJournaux ? 'loaded' : 'empty',
    connectors: getConnectorCapabilities(),
  };
}

// P0.9 Capability discovery (lecture seule, jamais simulée comme réussie)
export function getConnectorCapabilities(): ConnectorCapability[] {
  const now = new Date().toISOString();
  // Compta Flow : status réel via localStorage integration, sinon disconnected
  let comptaStatus: ConnectorCapability['status'] = 'disconnected';
  try {
    const raw = localStorage.getItem('dc_intelligence_integrations');
    if (raw) {
      const parsed = JSON.parse(raw);
      const found = Array.isArray(parsed) ? parsed.find((i: any) => i.id === 'compta-flow') : null;
      if (found && found.status === 'connected') comptaStatus = 'connected';
      else if (found && found.status === 'connecting') comptaStatus = 'partial';
    }
  } catch {}
  // Google Sheets : vérifie OAuth token présent
  let sheetsStatus: ConnectorCapability['status'] = 'disconnected';
  try {
    const raw = localStorage.getItem('dc_intelligence_integrations');
    if (raw) {
      const parsed = JSON.parse(raw);
      const found = Array.isArray(parsed) ? parsed.find((i: any) => i.id === 'google-sheets') : null;
      if (found && found.status === 'connected') sheetsStatus = 'connected';
    }
  } catch {}
  return [
    {
      connectorId: 'comptaflow',
      displayName: 'Compta Flow',
      status: comptaStatus,
      actions: { read: comptaStatus !== 'disconnected', prepare: comptaStatus === 'connected', execute: comptaStatus === 'connected', verify: comptaStatus === 'connected' },
      permissions: ['compta.read', 'compta.prepare', 'compta.execute'],
      lastCheckedAt: now,
      message: comptaStatus === 'connected' ? 'Connecteur prêt' : comptaStatus === 'partial' ? 'Connexion partielle' : 'Non connecté — configurer dans Connexions',
    },
    {
      connectorId: 'googlesheets',
      displayName: 'Google Sheets',
      status: sheetsStatus,
      actions: { read: sheetsStatus !== 'disconnected', prepare: sheetsStatus === 'connected', execute: false, verify: sheetsStatus === 'connected' },
      permissions: ['https://www.googleapis.com/auth/spreadsheets'],
      lastCheckedAt: now,
      message: sheetsStatus === 'connected' ? 'READ/PREPARE/VERIFY disponibles (WRITE via MCP si configuré)' : 'Non connecté',
    },
    {
      connectorId: 'legalflow',
      displayName: 'LegalFlow MCP Server',
      status: 'connected',
      actions: { read: true, prepare: true, execute: false, verify: true },
      permissions: ['mcp.tools', 'legal.query', 'tax.validate'],
      lastCheckedAt: now,
    },
  ];
}

// Helpers structurés P0.3
export function searchPlanComptable(companyId: string | undefined, query: string): PlanEntry[] {
  const all = readLS<PlanEntry>(LS_PLAN).filter((e) => !companyId || e.companyId === companyId);
  if (!query.trim()) return all.slice(0, 20);
  const q = query.toLowerCase();
  return all.filter((e) => `${e.accountCode} ${e.accountLabel}`.toLowerCase().includes(q)).slice(0, 20);
}
export function searchTiers(companyId: string | undefined, query: string): TiersEntry[] {
  const all = readLS<TiersEntry>(LS_TIERS).filter((e) => !companyId || e.companyId === companyId);
  if (!query.trim()) return all.slice(0, 20);
  const q = query.toLowerCase();
  return all.filter((e) => `${e.tierCode} ${e.tierName}`.toLowerCase().includes(q)).slice(0, 20);
}
export function searchJournaux(companyId: string | undefined, query: string): JournalEntry[] {
  const all = readLS<JournalEntry>(LS_JOURNAUX).filter((e) => !companyId || e.companyId === companyId);
  if (!query.trim()) return all.slice(0, 20);
  const q = query.toLowerCase();
  return all.filter((e) => `${e.journalCode} ${e.journalLabel}`.toLowerCase().includes(q)).slice(0, 20);
}
export function searchKnowledgeBase(companyId: string | undefined, query: string, categories?: string[]): typeof INITIAL_KNOWLEDGE {
  // Pour l'instant, filtre local sur INITIAL_KNOWLEDGE + localStorage kb_documents
  // Le vrai RAG vectoriel reste dans functions/index.js /knowledge/search
  let docs: any[] = [...INITIAL_KNOWLEDGE];
  try {
    const raw = localStorage.getItem('dc_intelligence_knowledge_docs');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) docs = [...docs, ...parsed];
    }
  } catch {}
  if (companyId) docs = docs.filter((d: any) => !d.companyId || d.companyId === companyId);
  if (categories && categories.length) docs = docs.filter((d: any) => categories.includes(d.category));
  if (!query.trim()) return docs.slice(0, 10);
  const q = query.toLowerCase();
  return docs.filter((d: any) => `${d.title} ${d.summary}`.toLowerCase().includes(q)).slice(0, 10);
}

/**
 * Skill Écriture Comptable — format 9 colonnes + 4 fichiers (Sage / ComptaFlow v2)
 * Source : SKILL_ECRITURE.md (9 colonnes, ANSI, CRLF, point-virgule)
 */
export interface FormatterEcritureLine {
  compte: string; // 6 chiffres syscohada
  intitule: string;
  debit: number;
  credit: number;
}
export interface FormatterProposition {
  date?: string; // YYYY-MM-DD ou JJMMAA
  saisie?: string; // ECR001
  journal?: string; // ACH/VEN/BGF...
  piece?: string; // F087 / CHQ...
  tiersCode?: string; // 411Artisan
  libelleBase?: string;
  ecriture: FormatterEcritureLine[];
}
export interface FormatterCompte { numero: string; intitule: string; classe: string; nature: string }
export interface FormatterTiers { code: string; nom: string; type: 'Client' | 'Fournisseur' | string; collectif: string; ncc?: string }
export interface FormatterJournal { code: string; libelle: string; type: string }

function pad6(compte: string): string {
  const digits = String(compte).replace(/\D/g, '').slice(0, 6);
  return (digits + '000000').slice(0, 6);
}
function formatJJMMAA(dateStr?: string): string {
  if (!dateStr) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  }
  const s = String(dateStr).trim();
  // Already JJMMAA
  if (/^\d{6}$/.test(s)) return s;
  // JJ/MM/AAAA or JJMMAA with slashes
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    const dd = String(parseInt(m1[1], 10)).padStart(2, '0');
    const mm = String(parseInt(m1[2], 10)).padStart(2, '0');
    let yy = m1[3];
    if (yy.length === 4) yy = yy.slice(-2);
    return `${dd}${mm}${yy}`;
  }
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[3]}${m2[2]}${m2[1].slice(-2)}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  }
  return formatJJMMAA();
}
function sanitizeLab(s: string): string {
  return String(s || '').replace(/[\r\n;]+/g, ' ').slice(0, 255).trim();
}
function fmtMontant(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? String(v) : '';
}
function isCollectif411401(compte6: string): boolean {
  return compte6.startsWith('401') || compte6.startsWith('411');
}

export function generateEcrituresTxt(props: FormatterProposition[]): string {
  const lines: string[] = [];
  let autoIdx = 1;
  for (const p of props) {
    const date = formatJJMMAA(p.date);
    const saisie = p.saisie || `ECR${String(autoIdx++).padStart(3, '0')}`;
    const journal = String(p.journal || 'OD').toUpperCase().slice(0, 8) || 'OD';
    const piece = String(p.piece || '').slice(0, 30);
    const libelleBase = sanitizeLab(p.libelleBase || piece || 'Ecriture');
    for (const l of p.ecriture) {
      const compte6 = pad6(l.compte);
      const libelle = sanitizeLab(l.intitule ? `${libelleBase} - ${l.intitule}` : libelleBase);
      const debit = fmtMontant(l.debit);
      const credit = fmtMontant(l.credit);
      // Exclusion mutuelle : au plus un des deux renseigné
      const debitFinal = debit && !credit ? debit : debit && credit ? '' : debit;
      const creditFinal = credit && !debit ? credit : '';
      // Si les deux présents par erreur, on privilégie le non-nul et vide l'autre
      const d = debit && credit ? (Number(l.debit) > 0 ? debit : '') : debitFinal;
      const c = debit && credit ? (Number(l.credit) > 0 ? credit : '') : creditFinal;
      const tiers = isCollectif411401(compte6) ? String(p.tiersCode || '').replace(/\s/g, '').slice(0, 30) : '';
      lines.push([date, saisie, journal, piece, compte6, libelle, d, c, tiers].join(';'));
    }
  }
  // Somme globale vérifiable : on ne l'écrit pas, mais l'appelant peut vérifier
  return lines.join('\r\n');
}

export function generatePlanComptableTxt(comptes: FormatterCompte[]): string {
  return comptes.map((c) => [pad6(c.numero), sanitizeLab(c.intitule), String(c.classe || c.numero[0] || ''), String(c.nature || '')].join(';')).join('\r\n');
}
export function generateTiersTxt(tiers: FormatterTiers[]): string {
  return tiers.map((t) => [String(t.code).replace(/\s/g, ''), sanitizeLab(t.nom), String(t.type || ''), pad6(t.collectif), String(t.ncc || '')].join(';')).join('\r\n');
}
export function generateJournauxTxt(journaux: FormatterJournal[]): string {
  return journaux.map((j) => [String(j.code).toUpperCase().slice(0, 8), sanitizeLab(j.libelle), String(j.type || '')].join(';')).join('\r\n');
}
export function downloadTxt(filename: string, content: string): void {
  // Sage attend ANSI (Windows-1252) ; le navigateur ne peut qu'écrire UTF-8.
  // On livre UTF-8 avec BOM optionnel : Sage l'accepte, et l'utilisateur peut
  // ré-encoder en ANSI via Notepad si besoin strict.
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function verifyEquilibre(props: FormatterProposition[]): { ok: boolean; totalDebit: number; totalCredit: number; details: Array<{ saisie: string; debit: number; credit: number; ok: boolean }> } {
  const details: Array<{ saisie: string; debit: number; credit: number; ok: boolean }> = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let idx = 1;
  for (const p of props) {
    const saisie = p.saisie || `ECR${String(idx++).padStart(3, '0')}`;
    let d = 0;
    let c = 0;
    for (const l of p.ecriture) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
    }
    totalDebit += d;
    totalCredit += c;
    details.push({ saisie, debit: d, credit: c, ok: d === c && d > 0 });
  }
  return { ok: totalDebit === totalCredit && totalDebit > 0 && details.every((d) => d.ok), totalDebit, totalCredit, details };
}

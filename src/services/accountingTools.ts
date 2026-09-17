import { LigneEcriture, MentionsFacture } from '../types';

/**
 * SYSCOHADA Account Registry (Plan Comptable Général Révisé - Zone OHADA)
 */
export const SYSCOHADA_PLAN: Record<string, { libelle: string; classe: number }> = {
  // Classe 1 : Capitaux permanents
  '101': { libelle: 'Capital social', classe: 1 },
  '111': { libelle: 'Réserve légale', classe: 1 },
  '131': { libelle: 'Subventions d’équipement', classe: 1 },
  '162': { libelle: 'Emprunts auprès des établissements de crédit', classe: 1 },

  // Classe 2 : Immobilisations
  '211': { libelle: 'Terrains nus', classe: 2 },
  '212': { libelle: 'Bâtiments', classe: 2 },
  '213': { libelle: 'Constructions sur sol d’autrui', classe: 2 },
  '215': { libelle: 'Matériel de transport', classe: 2 },
  '218': { libelle: 'Autres immobilisations corporelles', classe: 2 },
  '221': { libelle: 'Immobilisations incorporelles', classe: 2 },
  '241': { libelle: 'Matériel industriel', classe: 2 },
  '244': { libelle: 'Matériel de bureau et informatique', classe: 2 },
  '245': { libelle: 'Matériel de transport', classe: 2 },

  // Classe 3 : Stocks
  '311': { libelle: 'Marchandises A', classe: 3 },
  '321': { libelle: 'Matières premières', classe: 3 },
  '335': { libelle: 'Emballages consignés', classe: 3 },

  // Classe 4 : Tiers
  '401': { libelle: 'Fournisseurs', classe: 4 },
  '4011': { libelle: 'Fournisseurs - Achats de biens et services', classe: 4 },
  '401100': { libelle: 'Fournisseurs collectifs', classe: 4 },
  '4081': { libelle: 'Fournisseurs - Factures non parvenues', classe: 4 },
  '4091': { libelle: 'Fournisseurs - Avances et acomptes versés', classe: 4 },
  '411': { libelle: 'Clients', classe: 4 },
  '4111': { libelle: 'Clients - Ventes de biens et services', classe: 4 },
  '411100': { libelle: 'Clients collectifs', classe: 4 },
  '416': { libelle: 'Clients douteux ou litigieux', classe: 4 },
  '4181': { libelle: 'Clients - Factures à établir', classe: 4 },
  '4191': { libelle: 'Clients - Avances et acomptes reçus', classe: 4 },
  '421': { libelle: 'Personnel - Rémunérations dues', classe: 4 },
  '422': { libelle: 'Personnel - Avances et acomptes', classe: 4 },
  '431': { libelle: 'Sécurité Sociale (CNPS)', classe: 4 },
  '4431': { libelle: 'TVA collectée', classe: 4 },
  '4441': { libelle: 'TVA due', classe: 4 },
  '4449': { libelle: 'Crédit de TVA à reporter', classe: 4 },
  '4451': { libelle: 'TVA récupérable sur immobilisations', classe: 4 },
  '4452': { libelle: 'TVA récupérable sur achats de marchandises', classe: 4 },
  '4453': { libelle: 'TVA récupérable sur prestations de services', classe: 4 },
  '4454': { libelle: 'TVA récupérable sur autres charges', classe: 4 },
  '4471': { libelle: 'Impôts retenus à la source (ITS)', classe: 4 },

  // Classe 5 : Trésorerie
  '521': { libelle: 'Banques', classe: 5 },
  '521100': { libelle: 'Banque principale (XOF)', classe: 5 },
  '531': { libelle: 'Chèques à l’encaissement', classe: 5 },
  '571': { libelle: 'Caisse', classe: 5 },
  '571100': { libelle: 'Caisse centrale', classe: 5 },
  '585': { libelle: 'Virements internes', classe: 5 },

  // Classe 6 : Charges
  '601': { libelle: 'Achats de marchandises', classe: 6 },
  '601100': { libelle: 'Achats de marchandises dans la région', classe: 6 },
  '602': { libelle: 'Achats de matières premières', classe: 6 },
  '6051': { libelle: 'Fourniture non stockable - Eau', classe: 6 },
  '6052': { libelle: 'Fourniture non stockable - Électricité', classe: 6 },
  '6056': { libelle: 'Achats de petit matériel et outillage (< 50 000 FCFA)', classe: 6 },
  '6058': { libelle: 'Achats d’équipements et fournitures de bureau (< 50 000 FCFA)', classe: 6 },
  '612': { libelle: 'Transports sur achats et ventes', classe: 6 },
  '615': { libelle: 'Entretien, réparations et maintenance', classe: 6 },
  '624': { libelle: 'Frais postaux et télécommunications / Internet', classe: 6 },
  '625': { libelle: 'Primes d’assurance', classe: 6 },
  '632': { libelle: 'Honoraires et prestations de conseils', classe: 6 },
  '638': { libelle: 'Autres services extérieurs', classe: 6 },
  '641': { libelle: 'Impôts et taxes directs', classe: 6 },
  '651': { libelle: 'Pertes sur créances clients', classe: 6 },
  '6611': { libelle: 'Appointements et salaires du personnel', classe: 6 },
  '6612': { libelle: 'Primes et gratifications au personnel', classe: 6 },
  '6613': { libelle: 'Indemnités et allocations diverses', classe: 6 },
  '6622': { libelle: 'Rémunération du gérant majoritaire / associé unique', classe: 6 },
  '681': { libelle: 'Dotations aux amortissements d’exploitation', classe: 6 },

  // Classe 7 : Produits
  '701': { libelle: 'Ventes de marchandises', classe: 7 },
  '706': { libelle: 'Prestations de services', classe: 7 },
  '707': { libelle: 'Ventes d’accessoires et produits annexes', classe: 7 },
  '754': { libelle: 'Cessions courantes d’immobilisations', classe: 7 },
  '781': { libelle: 'Reprises d’amortissements et de provisions', classe: 7 },

  // Classe 8 : Hors Activités Ordinaires (HAO)
  '812': { libelle: 'Valeurs comptables des cessions d’immobilisations', classe: 8 },
  '822': { libelle: 'Produits des cessions d’immobilisations', classe: 8 },
};

/**
 * 5.1 Vérifier l'équilibre stricte Débit = Crédit (Tolérance 0 FCFA)
 */
export function verifierEquilibre(
  debits: number[],
  credits: number[]
): { ok: boolean; ecart: number; sumDebit: number; sumCredit: number } {
  const sumDebit = Math.round(debits.reduce((a, b) => a + Number(b || 0), 0) * 100) / 100;
  const sumCredit = Math.round(credits.reduce((a, b) => a + Number(b || 0), 0) * 100) / 100;
  const ecart = Math.abs(sumDebit - sumCredit);
  return {
    ok: ecart === 0,
    ecart,
    sumDebit,
    sumCredit,
  };
}

/**
 * 5.2 Vérifier l'existence d'un compte dans le plan SYSCOHADA (STRICT).
 * N'accepte que : match exact, ou préfixe 2-3 chiffres existant au plan,
 * avec format numérique 2..8 chiffres. Fini le fallback "Classe 1-8" qui
 * validait n'importe quoi.
 */
export function verifierCompteSyscohada(compte: string): { ok: boolean; libelle?: string; classe?: number } {
  if (!compte) return { ok: false };
  const cleanCompte = compte.trim();
  if (!/^[1-8][0-9]{1,7}$/.test(cleanCompte)) return { ok: false };

  // Direct match
  if (SYSCOHADA_PLAN[cleanCompte]) {
    return {
      ok: true,
      libelle: SYSCOHADA_PLAN[cleanCompte].libelle,
      classe: SYSCOHADA_PLAN[cleanCompte].classe,
    };
  }

  // Prefix match strict (e.g. 401100 -> 401, 601100 -> 601) uniquement si la racine existe.
  const root3 = cleanCompte.substring(0, 3);
  if (SYSCOHADA_PLAN[root3]) {
    return {
      ok: true,
      libelle: `${SYSCOHADA_PLAN[root3].libelle} (sous-compte ${cleanCompte})`,
      classe: SYSCOHADA_PLAN[root3].classe,
    };
  }

  const root2 = cleanCompte.substring(0, 2);
  if (SYSCOHADA_PLAN[root2]) {
    return {
      ok: true,
      libelle: `${SYSCOHADA_PLAN[root2].libelle} (sous-compte ${cleanCompte})`,
      classe: SYSCOHADA_PLAN[root2].classe,
    };
  }

  return { ok: false };
}

/**
 * 5.3 Seuil d'immobilisation : > 50 000 FCFA ET usage > 1 an -> Classe 2. Sinon 6056/6058.
 */
export function classerImmobilisation(
  montant: number,
  dureeUsageMois: number = 12
): { type: 'immobilisation' | 'charge'; compteSuggere: string; justification: string } {
  const IMMO_THRESHOLD = 50000;
  if (montant > IMMO_THRESHOLD && dureeUsageMois > 12) {
    return {
      type: 'immobilisation',
      compteSuggere: '244',
      justification: `Montant (${montant.toLocaleString('fr-FR')} FCFA) > 50 000 FCFA et durée (${dureeUsageMois} mois) > 1 an : Imputation obligatoire en Classe 2 (Immobilisation).`,
    };
  }
  return {
    type: 'charge',
    compteSuggere: '6056',
    justification: `Montant (${montant.toLocaleString('fr-FR')} FCFA) <= 50 000 FCFA ou durée <= 12 mois : Imputation en charge courante (6056 Petit équipement).`,
  };
}

/**
 * 5.4 Calculer la TVA et déterminer le compte associé
 */
export function calculerTVA(
  montantHT: number,
  taux: 18 | 9 | 0 | 'exonere',
  typePrestation: 'biens' | 'services' | 'immo' = 'biens'
): { tva: number; compte: string; montantTTC: number } {
  let rateNumeric = 0;
  if (taux === 18) rateNumeric = 0.18;
  else if (taux === 9) rateNumeric = 0.09;

  const tva = Math.round(montantHT * rateNumeric);
  const montantTTC = montantHT + tva;

  let compte = '4452'; // Default TVA biens
  if (typePrestation === 'services') compte = '4453';
  else if (typePrestation === 'immo') compte = '4451';
  else if (rateNumeric === 0) compte = '4431';

  return { tva, compte, montantTTC };
}

/**
 * 5.5 Rémunération du gérant majoritaire / associé unique (Compte 6622 mandatory, NOT 6611)
 */
export function verifierCompteGerant(
  beneficiaire: string,
  comptePropose: string
): { ok: boolean; compteCorrige?: string; motif?: string } {
  const isGerantOrAssocie = /gérant|gerant|associé unique|associe unique|directeur général/i.test(
    beneficiaire || ''
  );
  if (isGerantOrAssocie && comptePropose.startsWith('6611')) {
    return {
      ok: false,
      compteCorrige: '6622',
      motif:
        'Conformément à la règle SYSCOHADA révisée, la rémunération des gérants majoritaires et associés uniques s’impute au compte 6622 et non au compte 6611 (salariés).',
    };
  }
  return { ok: true };
}

/**
 * 5.6 Calculer l'amortissement au prorata temporis
 */
export function calculerAmortissement(
  montant: number,
  dureeAnnees: number,
  dateMiseService: string,
  dateCloture: string = '2026-12-31'
): { annuite: number; moisUtilisation: number; prorata: number; dotation: number } {
  if (dureeAnnees <= 0) return { annuite: 0, moisUtilisation: 0, prorata: 0, dotation: 0 };
  const annuite = montant / dureeAnnees;

  const start = new Date(dateMiseService);
  const end = new Date(dateCloture);

  let moisUtilisation = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  if (moisUtilisation < 0) moisUtilisation = 0;
  if (moisUtilisation > 12) moisUtilisation = 12;

  const prorata = moisUtilisation / 12;
  const dotation = Math.round(annuite * prorata);

  return { annuite, moisUtilisation, prorata, dotation };
}

/**
 * 5.7 Vérification des mentions légales d'une facture
 */
export function verifierMentionsFacture(facture: MentionsFacture): { ok: boolean; manquants: string[] } {
  const manquants: string[] = [];
  if (!facture.rccm && !facture.cc && !facture.ncc) {
    manquants.push('Numéro d’immatriculation fiscale / RCCM / CC / NCC');
  }
  if (!facture.date) {
    manquants.push('Date d’émission de la pièce');
  }
  if (!facture.reference) {
    manquants.push('Numéro de facture / Référence pièce');
  }
  if (!facture.tiers) {
    manquants.push('Identification claire du Tiers (Fournisseur/Client)');
  }
  return {
    ok: manquants.length === 0,
    manquants,
  };
}

/**
 * Helpers P0.6 — normalisation & contrôles étendus (plan 12.3)
 */
export function normalizeAccountCode(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 6);
  return (digits + '000000').slice(0, 6);
}
export function isSyscohadaAccount(code: string): boolean {
  return verifierCompteSyscohada(code).ok;
}
export function isCollectiveAccount(code: string): boolean {
  const c = normalizeAccountCode(code);
  return c.startsWith('401') || c.startsWith('411');
}
export function normalizeTierCode(code: string): string {
  return String(code || '').replace(/\s/g, '').slice(0, 30);
}
export function validateJournalType(journal: string): { ok: boolean; expected?: string } {
  const j = String(journal || '').toUpperCase();
  if (['ACH', 'VEN', 'BQ', 'CSE', 'OD', 'AN', 'IM', 'BGF', 'BOA', 'BGFI'].includes(j)) return { ok: true };
  return { ok: false, expected: 'ACH/VEN/BQ/OD/AN/IM ou banque (BGF/BOA)' };
}
export function validateBankAccount(compte: string, banque?: string): { ok: boolean; message?: string } {
  if (!banque) return { ok: true };
  const c = normalizeAccountCode(compte);
  const b = banque.toLowerCase();
  if (b.includes('bgfi') && !c.startsWith('5211')) return { ok: false, message: `Banque BGFI attendue → compte 5211xx, reçu ${c}` };
  if (b.includes('boa') && !c.startsWith('5212')) return { ok: false, message: `Banque BOA attendue → compte 5212xx, reçu ${c}` };
  return { ok: true };
}
export function detectProforma(reference?: string, typePiece?: string): { isProforma: boolean; reason?: string } {
  const ref = String(reference || '').trim().toUpperCase();
  const tp = String(typePiece || '').toUpperCase();
  if (ref.startsWith('P') && /P\d/.test(ref)) return { isProforma: true, reason: `Référence proforma ${ref} (préfixe P)` };
  if (tp.includes('PROFORMA')) return { isProforma: true, reason: 'Type pièce PROFORMA' };
  return { isProforma: false };
}
export function formatJJMMAA(dateStr?: string): string {
  if (!dateStr) {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  }
  const s = String(dateStr).trim();
  if (/^\d{6}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}${m[2]}${m[1].slice(-2)}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getFullYear()).slice(-2)}`;
  return formatJJMMAA();
}
export function formatAmount(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v > 0 ? String(v) : '';
}

/**
 * 5.8 Détecter les écritures suspectes ou non conformes
 */
export function detecterEcrituresSuspectes(
  ecriture: LigneEcriture[],
  journal?: string
): { alertes: string[] } {
  const alertes: string[] = [];

  // Règle 1 : Règle d'or de séparation des flux
  if (journal === 'BQ' || journal === 'CSE') {
    const debit6xx = ecriture.some((l) => l.debit > 0 && l.compte.startsWith('6'));
    if (debit6xx) {
      alertes.push(
        'INTERDICTION SYSCOHADA : Débit direct d’un compte de charge (Classe 6) depuis le journal Banque/Caisse. L’écriture doit obligatoirement passer par le constat d’OD/ACH (4xx) puis le règlement.'
      );
    }
  }

  // Règle 2 : Débit/Crédit équilibre
  const debits = ecriture.map((l) => l.debit);
  const credits = ecriture.map((l) => l.credit);
  const eq = verifierEquilibre(debits, credits);
  if (!eq.ok) {
    alertes.push(
      `ÉCRITURE NON ÉQUILIBRÉE : Écart de ${eq.ecart.toLocaleString('fr-FR')} FCFA (Total Débits = ${eq.sumDebit}, Total Crédits = ${eq.sumCredit}).`
    );
  }

  // Règle 3 : Comptes existants
  for (const ligne of ecriture) {
    const chk = verifierCompteSyscohada(ligne.compte);
    if (!chk.ok) {
      alertes.push(`COMPTE INCONNU : Le compte ${ligne.compte} n’est pas répertorié dans le référentiel SYSCOHADA.`);
    }
  }

  // Règle 4 : Non compensation
  const aDebitEtCreditMemeLigne = ecriture.some((l) => l.debit > 0 && l.credit > 0);
  if (aDebitEtCreditMemeLigne) {
    alertes.push('NON-COMPENSATION : Une même ligne ne doit pas contenir simultanément un débit et un crédit.');
  }

  return { alertes };
}

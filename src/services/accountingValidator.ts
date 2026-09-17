import { PropositionEcriture, ValidationResult, ValidationCorrection } from '../types';
import {
  verifierEquilibre,
  verifierCompteSyscohada,
  classerImmobilisation,
  verifierCompteGerant,
  verifierMentionsFacture,
  detecterEcrituresSuspectes,
  normalizeAccountCode,
  isCollectiveAccount,
  detectProforma,
  validateJournalType,
} from './accountingTools';

/**
 * PIPELINE DE VALIDATION POST-LLM (7 CHECKS OBLIGATOIRES)
 * Règle absolue : aucune écriture ne part dans Google Sheets sans valider ce pipeline.
 */
export function validateAccountingProposal(proposal: PropositionEcriture): ValidationResult {
  const erreurs: string[] = [];
  const alertes: string[] = [];
  const corrections: ValidationCorrection[] = [];

  let checksPassed = 0;
  const totalChecks = 7;

  // -------------------------------------------------------------
  // CHECK 1 — JSON & Écriture bien formés
  // -------------------------------------------------------------
  if (!proposal || !Array.isArray(proposal.ecriture) || proposal.ecriture.length === 0) {
    erreurs.push('ÉCRITURE MAL FORMÉE : Aucune ligne d’écriture valide trouvée dans la proposition.');
  } else {
    checksPassed++;
  }

  // -------------------------------------------------------------
  // CHECK 2 — Comptes existent dans le plan SYSCOHADA ?
  // -------------------------------------------------------------
  let check2Ok = true;
  if (proposal.ecriture) {
    for (const ligne of proposal.ecriture) {
      const res = verifierCompteSyscohada(ligne.compte);
      if (!res.ok) {
        check2Ok = false;
        erreurs.push(`COMPTE INVALIDE : Le compte ${ligne.compte} (${ligne.intitule}) n'existe pas dans SYSCOHADA.`);
      }
    }
  }
  if (check2Ok) checksPassed++;

  // -------------------------------------------------------------
  // CHECK 3 — Équilibre Débit = Crédit (Tolérance 0 FCFA)
  // -------------------------------------------------------------
  if (proposal.ecriture) {
    const debits = proposal.ecriture.map((l) => l.debit || 0);
    const credits = proposal.ecriture.map((l) => l.credit || 0);
    const eq = verifierEquilibre(debits, credits);
    if (!eq.ok) {
      erreurs.push(
        `DÉSÉQUILIBRE DÉBIT/CRÉDIT : Total Débits (${eq.sumDebit.toLocaleString(
          'fr-FR'
        )} FCFA) != Total Crédits (${eq.sumCredit.toLocaleString('fr-FR')} FCFA). Écart : ${eq.ecart} FCFA.`
      );
    } else {
      checksPassed++;
    }
  }

  // -------------------------------------------------------------
  // CHECK 4 — Cohérence de la TVA
  // -------------------------------------------------------------
  if (proposal.montantHT > 0 && proposal.montantTVA > 0) {
    const ratioTva = proposal.montantTVA / proposal.montantHT;
    const isStandard18 = Math.abs(ratioTva - 0.18) < 0.02;
    const isReduced9 = Math.abs(ratioTva - 0.09) < 0.02;

    if (!isStandard18 && !isReduced9) {
      alertes.push(
        `TAUX TVA ANORMAL : La TVA (${proposal.montantTVA} FCFA) représente ${(ratioTva * 100).toFixed(
          1
        )}% du HT (${proposal.montantHT} FCFA). Taux officiels en Côte d'Ivoire : 18% ou 9%.`
      );
    } else {
      checksPassed++;
    }
  } else {
    checksPassed++; // Pas de TVA mentionnée (exonéré ou 0%)
  }

  // -------------------------------------------------------------
  // CHECK 5 — Seuil d'Immobilisation (50 000 FCFA)
  // -------------------------------------------------------------
  let check5Ok = true;
  if (proposal.ecriture) {
    for (const ligne of proposal.ecriture) {
      // Si imputation en charge (6056/6058) mais montant > 50 000 FCFA
      if ((ligne.compte.startsWith('6056') || ligne.compte.startsWith('6058')) && ligne.debit > 50000) {
        const sugg = classerImmobilisation(ligne.debit, 24);
        alertes.push(
          `SEUIL IMMOBILISATION : Le matériel d'une valeur de ${ligne.debit.toLocaleString(
            'fr-FR'
          )} FCFA dépasse le seuil de 50 000 FCFA. Suggéré : Classe 2 (${sugg.compteSuggere}).`
        );
        check5Ok = false;
      }
    }
  }
  if (check5Ok) checksPassed++;

  // -------------------------------------------------------------
  // CHECK 6 — Compte Gérant Majoritaire / Associé Unique (6622 vs 6611)
  // -------------------------------------------------------------
  let check6Ok = true;
  if (proposal.ecriture) {
    for (const ligne of proposal.ecriture) {
      const gerantCheck = verifierCompteGerant(proposal.tiers, ligne.compte);
      if (!gerantCheck.ok && gerantCheck.compteCorrige) {
        check6Ok = false;
        corrections.push({
          champ: `compte_${ligne.compte}`,
          avant: ligne.compte,
          apres: gerantCheck.compteCorrige,
          motif: gerantCheck.motif || 'Redirection automatique 6611 -> 6622 pour le gérant',
        });
        alertes.push(`CORRECTION AUTOMATIQUE : ${gerantCheck.motif}`);
        // Corriger directement dans la proposition
        ligne.compte = gerantCheck.compteCorrige;
        ligne.intitule = 'Rémunération du gérant majoritaire';
      }
    }
  }
  if (check6Ok) checksPassed++;

  // -------------------------------------------------------------
  // CHECK 7 — Mentions Légales Obligatoires sur la Facture
  // -------------------------------------------------------------
  const mentionsResult = verifierMentionsFacture(proposal.mentions || {});
  if (!mentionsResult.ok) {
    alertes.push(
      `MENTIONS LÉGALES MANQUANTES SUR PIÈCE : ${mentionsResult.manquants.join(', ')}.`
    );
  } else {
    checksPassed++;
  }

  // --- P0.6 contrôles étendus (compatibles, ajoutés sans casser les 7 historiques) ---
  // Proforma
  const pro = detectProforma(proposal.reference, proposal.typePiece);
  if (pro.isProforma) {
    erreurs.push(`PROFORMA BLOQUÉE : ${pro.reason} — une proforma n'est pas une pièce comptable définitive.`);
  }
  // Montant positif
  if (proposal.montantTTC !== undefined && proposal.montantTTC <= 0 && proposal.montantHT !== undefined && proposal.montantHT <= 0) {
    erreurs.push('MONTANT INVALIDE : montant HT/TTC doit être > 0.');
  }
  // Format compte 6 chiffres + tiers obligatoire sur 401/411
  if (proposal.ecriture) {
    for (const l of proposal.ecriture) {
      const norm = normalizeAccountCode(l.compte);
      if (l.compte !== norm && l.compte.length !== 6) {
        alertes.push(`FORMAT COMPTE : ${l.compte} normalisé en ${norm} (6 chiffres PPP000).`);
      }
      if (isCollectiveAccount(norm) && !(proposal as any).tiersCode && !l.credit) {
        // tiersCode attendu sur lignes collectives — on vérifie proposition globale
        // Si vraiment manquant, alerte (ne bloque pas si tiers renseigné)
        if (!proposal.tiers || !String(proposal.tiers).trim()) {
          alertes.push(`COMPTE TIERS MANQUANT : ligne ${norm} exige un code tiers (colonne 9) pour lettrage.`);
        }
      }
    }
  }
  // Journal cohérent avec type pièce
  const journalCheck = validateJournalType(proposal.journal);
  if (!journalCheck.ok) {
    alertes.push(`JOURNAL INCONNU : ${proposal.journal} — attendu ${journalCheck.expected}.`);
  } else if (proposal.journal) {
    const j = proposal.journal.toUpperCase();
    const t = String(proposal.typePiece || '').toUpperCase();
    if (t.includes('ACHAT') && j !== 'ACH' && j !== 'OD') alertes.push(`JOURNAL INCOHÉRENT : achat attendu ACH, reçu ${j}.`);
    if (t.includes('VENTE') && j !== 'VEN' && j !== 'OD') alertes.push(`JOURNAL INCOHÉRENT : vente attendue VEN, reçu ${j}.`);
  }

  // Contrôles supplémentaires de sécurité
  if (proposal.ecriture) {
    const susp = detecterEcrituresSuspectes(proposal.ecriture, proposal.journal);
    alertes.push(...susp.alertes);
  }

  const ok = erreurs.length === 0;

  return {
    ok,
    checksPassed,
    totalChecks,
    erreurs,
    alertes,
    corrections,
  };
}

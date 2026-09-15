import { MultimodalResult, RouterClassification } from '../types';

/**
 * SERVICE AGENT ACCUEIL / ROUTEUR CENTRAL (DC INTELLIGENCE)
 * Modèle LLM Dédié : dots-studio/dots-3-note-preview:free
 * Traite les entrées utilisateurs, identifie l'intention, qualifie le besoin (Qui, Quoi, Quel agent/outil)
 * et oriente la session vers l'agent spécialisé approprié sans résoudre soi-même les calculs complexes.
 */
export function routeUserRequest(
  userQuery: string,
  multimodalResult?: MultimodalResult
): RouterClassification {
  // 1. Si analyse documentaire multimodale disponible
  if (multimodalResult && multimodalResult.documentType !== 'general_query') {
    switch (multimodalResult.documentType) {
      case 'invoice':
        return {
          domain: 'COMPTABILITÉ',
          targetAgentId: 'agent-1', // Agent Comptabilité
          confidence: multimodalResult.confidence,
          reasoning: `Pièce de type Facture/Reçu détectée. Orientation automatique vers l'Agent Comptabilité (Compta Flow).`,
          requiresClarification: false,
        };

      case 'tax_notice':
      case 'legal_contract':
        return {
          domain: 'JURIDIQUE_FISCAL',
          targetAgentId: 'agent-3', // Agent Juridique & Fiscal
          confidence: multimodalResult.confidence,
          reasoning: `Document Fiscaux/Juridiques détecté. Orientation automatique vers l'Agent Juridique & Fiscal (Legal Flow).`,
          requiresClarification: false,
        };

      case 'bank_statement':
        return {
          domain: 'RAPPROCHEMENT',
          targetAgentId: 'agent-2', // Agent Rapprochement Bancaire
          confidence: multimodalResult.confidence,
          reasoning: `Relevé de compte bancaire détecté. Orientation automatique vers l'Agent Rapprochement (RECO).`,
          requiresClarification: false,
        };
    }
  }

  // 2. Analyse textuelle directe par mots-clés & intentions
  const text = (userQuery || '').toLowerCase();

  // Domaine Comptabilité
  if (
    /\b(compta|facture|écriture|ecriture|syscohada|ht|tva|ttc|601|401|411|achat|vente|journal|imputation)\b/.test(
      text
    )
  ) {
    return {
      domain: 'COMPTABILITÉ',
      targetAgentId: 'agent-1',
      confidence: 0.9,
      reasoning: "Demande orientée tenue comptable et imputation SYSCOHADA.",
      requiresClarification: false,
    };
  }

  // Domaine Rapprochement
  if (
    /\b(rapprochement|relevé|releve|banque|ecobank|sgbci|bicici|pointage|solde|521|écart|ecart)\b/.test(
      text
    )
  ) {
    return {
      domain: 'RAPPROCHEMENT',
      targetAgentId: 'agent-2',
      confidence: 0.9,
      reasoning: "Demande de conciliation bancaire et pointage de trésorerie.",
      requiresClarification: false,
    };
  }

  // Domaine Juridique & Fiscal
  if (
    /\b(fiscal|dgi|impôt|impot|statuts|contrat|bail|das|cnps|patente|airsi|retenue|télédéclaration|e-impots)\b/.test(
      text
    )
  ) {
    return {
      domain: 'JURIDIQUE_FISCAL',
      targetAgentId: 'agent-3',
      confidence: 0.9,
      reasoning: "Demande d'assistance fiscale DGI ou de conformité juridique.",
      requiresClarification: false,
    };
  }

  // Si la demande est vague ou trop courte
  if (text.length < 8) {
    return {
      domain: 'ACCUEIL',
      targetAgentId: 'agent-router',
      confidence: 0.5,
      reasoning: "Demande sommaire. Demande de clarification auprès de l'utilisateur.",
      requiresClarification: true,
      clarificationQuestion:
        "Bonjour ! Je suis l'Agent Accueil DC Intelligence. Souhaitez-vous traiter une facture (Comptabilité), effectuer un rapprochement bancaire ou consulter la fiscalité/les statuts ?",
    };
  }

  // Par défaut : Routeur Généraliste DC Intelligence
  return {
    domain: 'AUTRE',
    targetAgentId: 'agent-1',
    confidence: 0.75,
    reasoning: "Orientation par défaut vers l'Agent Principal DC Intelligence.",
    requiresClarification: false,
  };
}

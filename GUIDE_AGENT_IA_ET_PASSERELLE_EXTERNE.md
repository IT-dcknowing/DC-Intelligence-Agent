# GUIDE COMPLET : AGENT IA COMPTABLE ET PASSERELLE D'INTÉGRATION EXTERNE

Ce document est le guide technique officiel pour :
1. **Créer un Agent IA Comptable** capable d'analyser des documents (factures, reçus, pièces justificatives) et de passer automatiquement des écritures comptables selon le révisé SYSCOHADA (Zone OHADA).
2. **Connecter une plateforme externe** (ERP, CRM, logiciel de facturation comme Selflow, etc.) à COMPTAFLOW pour y déverser des écritures et synchroniser le référentiel comptable.

---

## PARTIE 1 : INVENTAIRE ET CONFIGURATION DE L'AGENT IA COMPTABLE

### 1.1 Fichiers Nécessaires dans le Codebase

Pour créer et exécuter un **Agent IA Comptable**, voici l'inventaire complet des fichiers essentiels identifiés et analysés dans le projet :

#### A. Scripts & Moteurs IA (Python)
- `ia_compta.py` : Script Python autonome d'analyse visuelle de factures par l'API Gemini (Google Generative AI). Encode l'image en Base64, applique le Master Prompt SYSCOHADA et extrait un JSON structuré d'écriture comptable.
- `scan_compta.py` : Script d'extraction OCR et de prétraitement pour la numérisation comptable.

#### B. Services Backend & Contrôleurs (Laravel / PHP)
- `app/Services/PythonAiService.php` : Service pont exécutant les scripts Python d'IA depuis Laravel et récupérant les résultats d'analyse.
- `app/Services/VertexAiService.php` : Service d'intégration alternative haute performance vers Google Cloud Vertex AI (Gemini 1.5/2.0 Pro & Flash).
- `app/Http/Controllers/IaController.php` : Contrôleur principal gérant les routes d'analyse IA (`/ia/traiter`, `/ecriture-scan`). Il construit le contexte entreprise (plan comptable, plan tiers, règles apprises), appelle l'IA, valide l'équilibre débit/crédit et génère le pré-tableau d'écriture.
- `app/Http/Controllers/AiAgentController.php` : Point d'entrée générique pour l'Agent IA (`/api/v1/agent/execute`) capable d'effectuer des actions automatisées (générer un Grand-Livre, une Balance, analyser des anomalies).
- `app/Http/Controllers/Api/EntryController.php` : Contrôleur gérant la création et la persistance des écritures comptables (lignes simples ou multiples via `storeMultiple`).

#### C. Modèles de Données Eloquent
- `app/Models/EcritureComptable.php` : Modèle de la table des écritures comptables (`company_id`, `exercices_comptables_id`, `code_journal_id`, `plan_comptable_id`, `plan_tiers_id`, `date`, `n_saisie`, `debit`, `credit`, `statut`, `cle_selflow`).
- `app/Models/PlanComptable.php` : Plan comptable général (classes 1 à 8, SYSCOHADA).
- `app/Models/PlanTiers.php` : Plan des comptes auxiliaires (clients `411xxx`, fournisseurs `401xxx`).
- `app/Models/CodeJournal.php` : Codes journaux (ACH, VTE, BQ, CAI, OD).
- `app/Models/IaLog.php` & `app/Models/IaMapping.php` : Tables d'historique et d'apprentissage continu des corrections comptables.

#### D. Fichiers de Documentation & Prompts
- `MASTER_PROMPT_IA.md` : Guide complet des consignes système données à l'IA (format JSON strict, règles de déduction de la TVA à 18% en Côte d'Ivoire / zone UEMOA, affectation des comptes de charge classe 6 et fournisseurs 401).

---

### 1.2 Structure du Prompt Système (Master Prompt SYSCOHADA)

L'Agent IA doit recevoir la pièce comptable accompagnée du prompt structuré suivant :

```text
Tu es un Expert-Comptable SYSCOHADA Senior spécialisé dans la zone OHADA.
Analyse la pièce justificative fournie et génère l'écriture comptable au format JSON strict.

RÈGLES D'AFFECTATION COMPTABLE :
1. FOURNISSEUR/TIERS : Compte collectif 401100 ou compte tiers spécifique.
2. NATION DE CHARGE (Classe 6) :
   - Achats de marchandises : 601xxx
   - Fournitures non stockables (Eau, Électricité) : 605xxx
   - Entretien & Réparations : 615xxx
   - Transports : 612xxx
   - Services télécoms / Internet : 624xxx
   - Honoraires / Prestataires : 632xxx
3. TVA : Si mentionnée ou déductible, compte 445100 (TVA récupérable sur factures). Taux standard 18%.
4. RÈGLEMENT : Si marqué "PAYÉ", "CASH" ou "REÇU", utiliser le compte 571100 (Caisse) ou 521100 (Banque).

FORMAT DE RÉPONSE EXIGÉ (JSON STRICT) :
{
  "est_facture": true,
  "tiers": "Nom du Fournisseur",
  "date": "YYYY-MM-DD",
  "reference": "N° Facture",
  "montant_ht": 100000,
  "montant_tva": 18000,
  "montant_ttc": 118000,
  "devise": "XOF",
  "ecriture": [
    {"compte": "601100", "intitule": "Achat marchandises", "debit": 100000, "credit": 0},
    {"compte": "445100", "intitule": "TVA récupérable", "debit": 18000, "credit": 0},
    {"compte": "401100", "intitule": "Fournisseur X", "debit": 0, "credit": 118000}
  ]
}
```

---

### 1.3 Workflow de Passation d'Écriture par l'IA

1. **Numérisation / Upload** : Réception du document (PDF ou Image JPG/PNG).
2. **Appel de l'IA** : Envoi de l'image + Master Prompt via `IaController@traiterFacture` ou `ia_compta.py`.
3. **Contrôle d'Équilibre (Validation Comptable)** :
   $$\sum \text{Débits} = \sum \text{Crédits}$$
4. **Persistance des Écritures** : Insertion via l'API `/api/v1/entries/multiple` dans les tables `ecriture_comptables` avec le statut `approved` ou `pending` (soumis à validation).

---

## PARTIE 2 : PASSERELLE D'INTÉGRATION POUR PLATEFORME EXTERNE

Pour connecter une autre plateforme (ERP, SaaS, Logiciel commercial) à COMPTAFLOW et y passer des écritures, la plateforme externe utilise l'**API Passerelle Externe (External Sync API)**.

### 2.1 Fichiers de la Passerelle dans le Codebase

- `app/Http/Controllers/Api/ExternalSyncController.php` : Contrôleur gérant le déversement d'écritures (`deverserEcritures`) et le déversement du référentiel (`deverserReferentiel`).
- `app/Http/Controllers/Api/ExternalCompanyController.php` : Gère le cycle de vie des clés (provisionnement, révocation, vérification, rotation).
- `app/Http/Middleware/VerifieCleEntreprise.php` : Middleware de sécurité authentifiant chaque requête HTTP par la clé unique du dossier (`X-Company-Key`).
- `routes/api.php` : Définition des routes du groupe `prefix('external')`.

---

### 2.2 Sécurité et Authentification (Clé par Entreprise)

Chaque entreprise/dossier possède sa propre clé de synchronisation sécurisée (`selflow_sync_key`).

#### Headers HTTP requis pour toute requête externe :
```http
Content-Type: application/json
X-Sync-Secret: <VOTRE_EXTERNAL_SYNC_SECRET>
X-Company-Key: <CLE_DE_SYNCHRONISATION_DOSSIER>
```

- `X-Sync-Secret` : Secret d'application configuré dans le `.env` (`EXTERNAL_SYNC_SECRET`).
- `X-Company-Key` : Clé d'entreprise délivrée lors de la liaison ou du provisionnement du dossier.

---

### 2.3 Processus de Connexion / Provisionnement d'un Dossier

#### Endpoint : Provisionner un dossier et obtenir une clé
- **URL** : `POST /api/external/companies/provision`
- **Headers** : `X-Sync-Secret: <EXTERNAL_SYNC_SECRET>`
- **Payload Request** :
```json
{
  "company_name": "ENTREPRISE DEMO SARL",
  "selflow_company_id": 102,
  "email_adresse": "contact@entreprise-demo.ci",
  "phone_number": "+2250700000000",
  "rccm": "CI-ABJ-2026-B-12345",
  "ncc": "2600000A"
}
```
- **Response Success (201 Created)** :
```json
{
  "success": true,
  "comptaflow_company_id": 15,
  "selflow_sync_key": "sec_key_abc123xyz...",
  "message": "Entreprise créée et liée avec succès."
}
```

---

### 2.4 Déversement d'Écritures Comptables depuis la Plateforme Externe

#### Endpoint : Passer des écritures dans COMPTAFLOW
- **URL** : `POST /api/external/ecritures/deverser`
- **Headers** : 
  - `Content-Type: application/json`
  - `X-Sync-Secret: <EXTERNAL_SYNC_SECRET>`
  - `X-Company-Key: <CLE_DE_SYNCHRONISATION_DOSSIER>`
- **Payload Request** :
```json
{
  "selflow_company_id": 102,
  "comptaflow_company_id": 15,
  "exercice_debut": "2026-01-01",
  "exercice_fin": "2026-12-31",
  "ecritures": [
    {
      "cle_selflow": "VTE-2026-00101-L1",
      "date_ecriture": "2026-03-15",
      "code_journal": "VTE",
      "reference_document": "FAC-2026-0045",
      "libelle": "Vente de marchandises - Client SOCIDA",
      "compte_debit": "411100",
      "compte_credit": null,
      "compte_tiers": "411SOCIDA",
      "debit": 118000,
      "credit": 0
    },
    {
      "cle_selflow": "VTE-2026-00101-L2",
      "date_ecriture": "2026-03-15",
      "code_journal": "VTE",
      "reference_document": "FAC-2026-0045",
      "libelle": "Vente de marchandises - Client SOCIDA",
      "compte_debit": null,
      "compte_credit": "701100",
      "compte_tiers": null,
      "debit": 0,
      "credit": 100000
    },
    {
      "cle_selflow": "VTE-2026-00101-L3",
      "date_ecriture": "2026-03-15",
      "code_journal": "VTE",
      "reference_document": "FAC-2026-0045",
      "libelle": "TVA facturée sur ventes",
      "compte_debit": null,
      "compte_credit": "443100",
      "compte_tiers": null,
      "debit": 0,
      "credit": 18000
    }
  ]
}
```

- **Response Success (200 OK)** :
```json
{
  "success": true,
  "count": 3,
  "ignorees": 0,
  "refus": [],
  "message": "3 écriture(s) déversée(s)."
}
```

---

### 2.5 Principes Métier & Sécurité de la Passerelle

1. **Idempotence (`cle_selflow`)** : Chaque ligne d'écriture possède un identifiant unique côté plateforme externe (`cle_selflow`). Si le même déversement est réémis, COMPTAFLOW ignore les lignes déjà enregistrées afin d'éviter les doublons.
2. **Harmonisation des Comptes SYSCOHADA** :
   - Si le compte général (`701100`, `601100`, etc.) n'existe pas encore dans le plan comptable du dossier, COMPTAFLOW le crée automatiquement avec la bonne classe et le bon type (`charge`, `produit`, `actif`, `passif`).
3. **Rattachement des Tiers** :
   - Le champ `compte_tiers` permet d'associer directement l'écriture au compte auxiliaire client (`411xxx`) ou fournisseur (`401xxx`).
4. **Validation de l'Exercice Comptable** :
   - Les dates de début et de fin d'exercice transmises sont vérifiées pour garantir que les écritures s'inscrivent dans l'exercice comptable actif.

---

### 2.6 Synchronisation du Référentiel (Plan Comptable, Journaux, Tiers)

#### Endpoint : Déverser le référentiel complet
- **URL** : `POST /api/external/referentiel/deverser`
- **Headers** : 
  - `X-Sync-Secret: <EXTERNAL_SYNC_SECRET>`
  - `X-Company-Key: <CLE_DE_SYNCHRONISATION_DOSSIER>`
- **Payload Request** :
```json
{
  "selflow_company_id": 102,
  "comptaflow_company_id": 15,
  "plan_comptable": [
    {"numero_de_compte": "601100", "intitule": "Achat de marchandises A"},
    {"numero_de_compte": "701100", "intitule": "Vente de marchandises A"}
  ],
  "codes_journaux": [
    {"code_journal": "VTE", "intitule": "Journal des Ventes", "type": "Ventes"},
    {"code_journal": "ACH", "intitule": "Journal des Achats", "type": "Achats"}
  ],
  "tiers": [
    {
      "numero_de_tiers": "411SOCIDA",
      "intitule": "SOCIDA CI",
      "compte_general": "411100",
      "informations": {
        "telephone": "+2250701020304",
        "email": "facturation@socida.ci",
        "ncc": "1234567A"
      }
    }
  ]
}
```

---

## RESUMÉ DES ETAPES D'IMPLÉMENTATION

1. **Pour l'Agent IA** :
   - Utiliser `IaController.php` / `ia_compta.py`.
   - Fournir l'image du document et appliquer le Master Prompt.
   - Envoyer les écritures validées au format JSON à l'API `/api/v1/entries/multiple`.

2. **Pour la Plateforme Externe** :
   - Demander la clé d'entreprise via `POST /api/external/companies/provision` ou liaison SuperAdmin.
   - Configurer le header `X-Company-Key` et `X-Sync-Secret`.
   - Déverser les écritures via `POST /api/external/ecritures/deverser`.

# GUIDE DES ÉCRITURES COMPTABLES — COMPTAFLOW (v2) — Skill Agent Comptable

Source canonique : `C:\Users\alexm\Downloads\SKILL ECRITURE.txt` (9 colonnes, 4 fichiers, Sage 100 / ComptaFlow).

## Intégration
Ce skill est chargé dans le prompt système de `Agent Comptabilité` (`agent-1`).
Référence en code : `src/services/ecritureFormatter.ts` (génération TXT), `src/mockData.ts` (prompt).

## 1. Format 9 colonnes (point-virgule, sans en-tête, CRLF, ANSI)
1 Date JJMMAA (150626) — exercice non clôturé
2 N° Saisie (ECR001) — partagé par toutes les lignes d'une écriture
3 Code Journal (ACH/VEN/BQ/OD/BGF/BOA) — doit exister (journaux.txt)
4 N° Pièce / Référence (F087, CHQ0133209) — recommandé
5 N° Compte général 6 chiffres (401000, 706100) — PPP000, CI uniquement
6 Libellé Opération ≤255c (type, n° pièce, tiers)
7 Débit | 8 Crédit — numériques positifs sans séparateur milliers, 0 décimale, exclusifs
9 Compte Tiers — uniquement sur 401/411 (colonne 9), vide sinon

## 2. Règles validation
- Partie double par N° Saisie : Σ Débit = Σ Crédit. Vérifier avant livraison.
- Somme globale débits = crédits tous journaux confondus.
- Date dans exercice actif.

## 3. Plan comptable (SYSCOHADA Révisé CI uniquement)
- 6 chiffres, PPP000 (401→401000).
- Ventes classe 7 : sous-compte par nature (706100 Audit, 706200 Tenue, 706300 Assistance) si volume justifie, sinon 706100 générique acceptable (signaler).
- Trésorerie classe 5 : sous-compte par banque réelle (521100 BGFI, 521200 BOA) — ne jamais présumer, demander confirmation si contradiction.
- TVA : 445200 déductible, 445500 collectée, 18% sauf mention "TVA exo.lég" → pas de TVA.

## 4. Tiers
- Code : préfixe collectif + nom court (411Artisan, 401Davide), rattachés 411100/401100, obligatoire sur 401/411 pour lettrage.
- Fichier tiers.txt : Code Tiers ; Nom ; Type ; Compte Collectif ; NCC/RCCM.

## 5. Proforma
- Préfixe P (P186...) = devis, NE JAMAIS comptabiliser.

## 6. Règlements clients (chèques)
- Montant identique à facture → lettrage direct.
- GLOBAL non affecté → 521xxx / 411100 (code tiers), ne pas forcer lettrage approximatif.
- Chèque reçu non encaissé : 5112 en attente puis 521, sinon 521 direct acceptable.
- Date antérieure aux factures = avance possible.

## 7. Journaux
- Un journal par flux (VEN/ACH/OD) + un par banque réelle (BGF/BOA), pas de BQ générique si plusieurs banques.
- Fichier journaux.txt : Code ; Libellé ; Type.

## 8. Livrables par lot (4 fichiers ; délimités)
1 ecritures.txt (9 colonnes), 2 plan_comptable.txt (N° Compte ; Intitulé ; Classe ; Nature), 3 tiers.txt, 4 journaux.txt — TXT ANSI (Sage), CRLF.

## 9. Réflexes avant livraison
- Équilibre par écriture + global, cohérence pièces (montants/dates/banques/tiers) — question ciblée si incohérence, pas de devinette.
- Jamais de proforma, jamais de plan hors CI, banque réelle vérifiée.

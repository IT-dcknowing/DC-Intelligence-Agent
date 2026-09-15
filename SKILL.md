---
name: syscohada-accounting
description: Normes comptables SYSCOHADA (CEMAC, UEMOA) — plan comptable, TVA par pays, écritures équilibrées, seuil d'immobilisation 50 000 FCFA. Référentiel PAR DÉFAUT de RECO.
when_to_use: |
  Lors de toute opération comptable en Afrique francophone : validation d'écritures,
  suggestion de comptes, classification de factures, calcul TVA, écritures de
  clôture. À utiliser tant que l'utilisateur n'a pas chargé son propre plan comptable.
---

# SKILL : PASSATION D'ÉCRITURES COMPTABLES SYSCOHADA

> **Règle de priorité du plan comptable (depuis 2026-08-28)**
> 1. Si l'utilisateur a chargé un plan custom dans `data/plan_comptable/clients/{client_id}/plan.json`,
>    ce plan est utilisé à la place de celui-ci.
> 2. Sinon, ce référentiel SYSCOHADA est la référence par défaut.
> Le resolver Python (`data/plan_comptable/resolver.py`) applique cette règle automatiquement.

## RÔLE
Tu es un expert-comptable spécialisé SYSCOHADA, capable de passer une écriture comptable correcte à partir de n'importe quelle description de transaction, facture, ou document comptable. Tu maîtrises le plan comptable OHADA révisé, les règles d'imputation, la gestion de la TVA, les immobilisations, la trésorerie, et tous les cas particuliers.

---

## PRINCIPE FONDAMENTAL

**Toute écriture comptable doit respecter l'equilibre :**
```
Σ DEBITS = Σ CREDITS
```

**Separation des flux :**
- **Flux juridique** (constatation) : date de la facture, de la prestation
- **Flux financier** (reglement) : date de valeur, date de paiement

**Regle d'or du journal BQ (Banque) et CSE (Caisse) :**
> Le journal de tresorerie ne doit JAMAIS debiter directement un compte de charge (Classe 6) ou de produit (Classe 7).
>
> Schema correct :
> - **OD** : Debit 6xx / Credit 4xx (constatation de la charge)
> - **BQ/CSE** : Debit 4xx / Credit 521/571 (reglement)

---

## PLAN COMPTABLE SYSCOHADA — REFERENTIEL COMPLET

### CLASSE 1 — COMPTES DE RESSOURCES DURABLES

| Compte | Libelle | Usage |
|--------|---------|-------|
| 101 | Capital social | Apports des associes |
| 111 | Reserves legales | 5% du benefice jusqu'a 10% du capital |
| 121 | Report a nouveau crediteur | Benefice reporte |
| 129 | Report a nouveau debiteur | Perte reportee |
| 131 | Resultat de l'exercice (benefice) | En fin d'exercice |
| 132 | Resultat de l'exercice (perte) | En fin d'exercice |
| 161 | Emprunts obligataires | Dettes a LT |
| 162 | Emprunts aupres des etablissements de credit | Dettes bancaires LT |
| 165 | Depots et cautionnements recus | Cautions clients |
| 166 | Provisions pour risques et charges | Provisions reglementees |

### CLASSE 2 — COMPTES D'ACTIF IMMOBILISE

| Compte | Libelle | Usage | Amortissement |
|--------|---------|-------|---------------|
| 211 | Frais de developpement | R&D | 20% (5 ans) |
| 213 | Logiciels | Logiciels > seuil | 20-33% |
| 215 | Fonds commercial | Goodwill | Non amortissable (depreciation) |
| 221 | Terrains nus | Terrains | Non amortissable |
| 223 | Terrains batis | Terrains avec constructions | Non amortissable |
| 231 | Batiments industriels | Usines, entrepots | 5% (20 ans) |
| 232 | Batiments commerciaux | Magasins, bureaux | 5% (20 ans) |
| 233 | Batiments agricoles | Hangars, serres | 5% (20 ans) |
| 234 | Installations techniques | Agencements, installations | 10% (10 ans) |
| 241 | Materiel technique | Machines, outillage | 20% (5 ans) |
| 242 | Materiel informatique | Ordinateurs, serveurs | 20-33% (3-5 ans) |
| 244 | Materiel de bureau | Mobilier, bureaux | 20% (5 ans) |
| 245 | Materiel de transport | Vehicules | 33,33% (3 ans) |
| 248 | Autres immobilisations corporelles | Divers | Selon nature |
| 249 | Immobilisations en cours | Travaux non termines | Pas d'amortissement |
| 251 | Titres de participation | Actions filiales | Non amortissable |
| 271 | Prets | Prets accordes | Selon echeance |
| 275 | Depots et cautionnements verses | Cautions versees | Non amortissable |
| 281 | Amortissements des immobilisations incorporelles | Contrepartie 211-215 | |
| 282 | Amortissements des immobilisations corporelles | Contrepartie 221-248 | |

**REGLE DU SEUIL D'IMMOBILISATION :**
> Si valeur > 50 000 FCFA ET usage durable (> 1 an) → **IMMOBILISER** (Classe 2)
> Si valeur < 50 000 FCFA OU consommable → **CHARGE** (Classe 6 : 6056, 6058)

**Cout d'entree d'une immobilisation :**
- Prix d'achat net (hors TVA recuperable)
- Frais de transport
- Droits de douane
- Frais d'installation necessaires a la mise en service
- **Tous ces elements sont agreges au debit du compte d'immobilisation**

**Regle du prorata temporis :**
> L'amortissement commence a la date de mise en service. Pour une acquisition en cours d'annee : annuite x (nombre de mois d'utilisation / 12).
> Exemple : acquisition le 01/10 = 3/12e de l'annuite annuelle.

### CLASSE 3 — COMPTES DE STOCKS

| Compte | Libelle | Usage |
|--------|---------|-------|
| 31 | Marchandises | Biens revendus en l'etat |
| 32 | Matieres premieres | Biens a transformer |
| 33 | Autres approvisionnements | Fournitures consommables |
| 35 | Produits finis | Production de l'entite |
| 36 | Produits intermediaires | Semi-finis |
| 38 | Stocks en cours de production | En-cours de fabrication |

### CLASSE 4 — COMPTES DE TIERS

| Compte | Libelle | Usage |
|--------|---------|-------|
| 401100 | Fournisseurs nationaux | Dettes fournisseurs locaux |
| 401200 | Fournisseurs etrangers | Dettes fournisseurs import |
| 402 | Fournisseurs, effets a payer | Traites, LCR acceptees |
| 408 | Fournisseurs, factures non parvenues | Dettes constatees sans facture |
| 409100 | Fournisseurs, acomptes verses | Avances aux fournisseurs |
| 409400 | Fournisseurs, creances pour emballages | Emballages a rendre |
| 411100 | Clients nationaux | Creances clients locaux |
| 411200 | Clients etrangers | Creances clients export |
| 412 | Clients, effets a recevoir | Billets a ordre, traites clients |
| 416 | Clients douteux | Creances en litige |
| 419100 | Clients, acomptes recus | Avances clients |
| 419400 | Clients, dettes pour emballages consignes | Emballages consignes |
| 421 | Personnel, avances et acomptes | Avances sur salaire |
| 422 | Personnel, remunerations dues | Net a payer, salaires |
| 423 | Personnel, oppositions | Saisies-arrets |
| 424 | Personnel, participations | Interessement |
| 431 | Securite sociale (CNPS) | Cotisations sociales |
| 432 | Caisses de retraite complementaire | Retraite complementaire |
| 441 | Etat, impot sur les benefices | IS, BIC, acomptes |
| 442 | Etat, impots et taxes recouvrables | Droits de douane |
| 4431 | Etat, TVA facturee sur ventes | TVA collectee |
| 4441 | Etat, TVA due | TVA a decaisser |
| 4449 | Etat, credit de TVA | Credit de TVA |
| 4451 | Etat, TVA recuperable sur immobilisations | TVA deductible immo |
| 4452 | Etat, TVA recuperable sur achats de biens | TVA deductible biens |
| 4453 | Etat, TVA recuperable sur services | TVA deductible services |
| 4454 | Etat, TVA recuperable sur autres charges | TVA deductible autres |
| 4471 | Etat, impots retenus a la source (ITS) | Retenue sur salaires |
| 4472 | Etat, impots retenus sur prestataires | Retenue BNC |
| 448 | Etat, charges a payer | Dettes fiscales diverses |
| 468 | Autres creances/charges a payer | Retenues de garantie |
| 481 | Fournisseurs d'immobilisations | Dettes sur investissements |
| 485 | Cessions d'immobilisations, creances | Creances sur cessions |
| 491 | Depreciation des comptes de tiers | Contrepartie 6594 |

### CLASSE 5 — COMPTES DE TRESORERIE

| Compte | Libelle | Usage |
|--------|---------|-------|
| 50 | Valeurs mobilieres de placement | Titres de placement |
| 501 | Actions | Titres actions |
| 502 | Obligations | Titres obligations |
| 506 | Interets courus sur valeurs mobilieres | Produits financiers a recevoir |
| 512 | Effets a l'encaissement | Transit effets remis en banque |
| 513 | Cheques a encaisser | Cheques recus, non remis |
| 514 | Cheques a l'encaissement | Cheques remis en banque |
| 515 | Cartes de credit a encaisser | Cartes bancaires en attente |
| 519 | Decouverts bancaires | Credit de tresorerie |
| 5211 | Banques locales | Comptes en FCFA |
| 5212 | Banques etrangeres | Comptes en devises |
| 522 | Banques, escompte de credit | Escompte de effets |
| 526 | Valeurs a encaisser | Effets non echus |
| 552 | Instruments de monnaie electronique | Generique |
| 554 | Porte-monnaie electronique | Orange Money, Wave, MTN |
| 555 | Autres instruments de paiement electronique | Djamo, Carte |
| 561 | Credits de tresorerie | Credits CT |
| 565 | Banques, credits de tresorerie | Decouverts, lignes de credit |
| 571000 | Caisse centrale | Caisse siege |
| 572000 | Caisse succursale | Caisse annexe |
| 581000 | Virements internes | Transit banque ↔ caisse |
| 585000 | Virements internes (autres) | Transit divers |

**Flux cheque (3 etapes) :**
1. **Reception** : Debit 513 / Credit 411 (ou 706 si encaissement direct)
2. **Remise en banque** : Debit 514 / Credit 513
3. **Avis de credit** : Debit 521 / Credit 514

**Flux effet de commerce :**
- **Fournisseur** : Acceptation traite → Debit 401 / Credit 402
- **Client** : Reception billet → Debit 412 / Credit 411
- **Remise en banque** : Debit 512 / Credit 412
- **Encaissement** : Debit 521 / Credit 512

### CLASSE 6 — COMPTES DE CHARGES

#### 60 — Achats et variations de stocks

| Compte | Libelle | Usage |
|--------|---------|-------|
| 601 | Achats de marchandises | Biens revendus en l'etat |
| 602 | Achats de matieres premieres | Biens a transformer |
| 6041 | Achats de matieres consommables | Fournitures stockees |
| 6042 | Achats de fournitures de bureau | Stockees |
| 605 | Achats et fournitures non stockables | Eau, electricite, gaz |
| 6055 | Fournitures de bureau non stockables | Papier, stylos (usage immediat) |
| 6056 | Petits equipements (< seuil) | Immobilisations < 50 000 FCFA |
| 6058 | Autres fournitures | Divers non stockables |
| 6081 | Emballages perdus | Emballages non recuperables |
| 6082 | Emballages recuperables non identifiables | Emballages recuperables |

#### 61 — Transports

| Compte | Libelle | Usage |
|--------|---------|-------|
| 611 | Transports sur achats | Transport de biens achetes |
| 612 | Transports sur ventes | Transport de biens vendus (facture ou non) |
| 614 | Transports de personnel | Navettes, deplacements salaries |
| 616 | Affaires postales et telecommunications | Courrier, colis |
| 618 | Transports administratifs | Deplacements professionnels |
| 6181 | Hebergement et deplacements | Frais de mission |
| 6183 | Carburants (transports admin) | Essence vehicule pro |

#### 62 — Services exterieurs B

| Compte | Libelle | Usage |
|--------|---------|-------|
| 622 | Locations et charges locatives | Loyers, locations materiel |
| 624 | Entretien, reparations et maintenance | Reparations, maintenance |
| 625 | Assurances | Primes d'assurance |
| 626 | Remunerations d'intermediaires et honoraires | Commissions, courtage |
| 627 | Publicite, etudes, recherche | Marketing, etudes |
| 628 | Divers | Services non classes ailleurs |

#### 63 — Services exterieurs C

| Compte | Libelle | Usage |
|--------|---------|-------|
| 6311 | Frais bancaires | Commissions, tenue de compte |
| 6318 | Autres frais bancaires | Frais divers bancaires |
| 6324 | Honoraires | Experts-comptables, avocats, notaires |
| 6327 | Autres prestations de services | Gardiennage, nettoyage, securite |
| 633 | Frais de formation | Formation du personnel |
| 634 | Frais de reception, de representation et de congres | Receptions, seminaires |
| 635 | Cotisations et dons | Syndicats, associations |
| 637 | Remunerations de personnel exterieur | Interimaires, stagiaires remuneres |
| 638 | Autres charges externes | Charges non classes ailleurs |
| 6384 | Hebergement | Frais d'hotel (hors mission) |

#### 64 — Impots, taxes et versements assimiles

| Compte | Libelle | Usage |
|--------|---------|-------|
| 641 | Impots directs | Patente, BIC, contribution patentielle |
| 645 | Taxes indirectes | Taxes annexes, redevances |
| 647 | Penalites et amendes fiscales | Penalites DGI |
| 648 | Autres impots et taxes | Taxes diverses |

#### 66 — Charges de personnel

| Compte | Libelle | Usage |
|--------|---------|-------|
| 6611 | Appointements et salaires | Salaires bruts |
| 6612 | Primes et gratifications | Primes, bonus |
| 6613 | Indemnites et avantages divers | Indemnites de transport, repas |
| 6621 | Remunerations des agents de l'artiste | Personnel artistique |
| 6622 | Remunerations du gerant | Gerant majoritaire, associe unique |
| 6631 | Indemnites de rupture de contrat | Licenciement |
| 6632 | Indemnites de mise a la retraite | Depart en retraite |
| 6641 | Cotisations patronales de securite sociale | CNPS |
| 6642 | Cotisations patronales de retraite complementaire | Retraite complementaire |
| 6643 | Cotisations patronales de prevoyance | Prevoyance |
| 6644 | Cotisations patronales d'assurance chomage | Chomage |
| 665 | Indemnites de conges payes | Provision pour conges |
| 666 | Indemnites de fin de carriere | Fin de carriere |
| 667 | Charges sociales diverses | Autres charges sociales |

> **REGLE CRITIQUE :** Le gerant majoritaire ou associe unique est remunere en **6622**, jamais en 6611. Le 6622 est une charge non deductible fiscalement (retraitement en 821).

#### 67 — Charges financieres

| Compte | Libelle | Usage |
|--------|---------|-------|
| 671 | Interets des emprunts | Interets bancaires, obligataires |
| 672 | Interets des dettes commerciales | Agios, interets fournisseurs |
| 673 | Escomptes accordes | Escompte de reglement clients |
| 674 | Pertes de change | Ecarts de change defavorables |
| 675 | Pertes sur cessions de valeurs mobilieres | Moins-values |
| 676 | Pertes de change sur creances et dettes | Ecarts de change commercial |
| 677 | Interets bancaires sur decouvert | Decouverts bancaires |
| 678 | Autres charges financieres | Divers |

#### 68 — Dotations aux amortissements, provisions et depreciations

| Compte | Libelle | Usage |
|--------|---------|-------|
| 681 | Dotations aux amortissements | Amortissements d'exploitation |
| 6811 | Dotations aux amortissements des immobilisations incorporelles | 211-215 |
| 6812 | Dotations aux amortissements des immobilisations corporelles | 221-248 |
| 6813 | Dotations aux amortissements des immobilisations en cours | 249 |
| 6814 | Dotations aux amortissements des immobilisations biologiques | Agriculture |
| 691 | Dotations aux provisions pour risques et charges | Provisions pour risques |
| 6911 | Dotations aux provisions pour litiges | Proces, contentieux |
| 6912 | Dotations aux provisions pour garanties | Garanties donnees |
| 697 | Dotations aux provisions pour depreciation | Depreciation stocks, creances |
| 6971 | Dotations aux depreciations des immobilisations | Depreciation immo |
| 6972 | Dotations aux depreciations des stocks | Depreciation stocks |
| 6974 | Dotations aux depreciations des comptes de tiers | Depreciation creances (416) |

#### 69 — Charges d'exploitation transferees

| Compte | Libelle | Usage |
|--------|---------|-------|
| 691 | Charges d'exploitation transferees | Recharges internes |

### CLASSE 7 — COMPTES DE PRODUITS

#### 70 — Ventes de biens et services produits

| Compte | Libelle | Usage |
|--------|---------|-------|
| 701 | Ventes de marchandises | Biens revendus en l'etat |
| 702 | Ventes de produits finis | Production fabriquee |
| 703 | Ventes de produits intermediaires | Semi-finis |
| 704 | Travaux | Travaux executes |
| 706 | Prestations de services | Services, conseils, maintenance |
| 707 | Produits accessoires | Revenus annexes |
| 7071 | Port facture | Frais de port refactures |
| 7072 | Commissions et courtages | Commissions recues (accessoires) |
| 7073 | Locations diverses | Locations accessoires |
| 7074 | Bonis sur reprises d'emballages | Emballages non rendus |
| 708 | Produits des activites annexes | Revenus divers |

#### 71 — Subventions d'exploitation

| Compte | Libelle | Usage |
|--------|---------|-------|
| 711 | Subventions sur produits | Subventions liees a la production |
| 718 | Autres subventions d'exploitation | Subventions d'exploitation diverses |

#### 72 — Production immobilisee

| Compte | Libelle | Usage |
|--------|---------|-------|
| 721 | Production immobilisee incorporelle | R&D capitalisee |
| 722 | Production immobilisee corporelle | Construction par l'entite |

#### 73 — Variations de stocks de produits

| Compte | Libelle | Usage |
|--------|---------|-------|
| 731 | Variations de stocks de produits finis | Delta stocks produits finis |
| 732 | Variations de stocks de produits intermediaires | Delta stocks semi-finis |

#### 75 — Autres produits d'exploitation

| Compte | Libelle | Usage |
|--------|---------|-------|
| 751 | Redevances | Locations de brevets, logiciels |
| 752 | Revenus de participations | Dividendes recus |
| 753 | Revenus de titres immobilises | Interets recus |
| 754 | Gains de change | Ecarts de change favorables |
| 755 | Quote-part de benefice transferee | Recharges internes |
| 756 | Gains de change sur creances et dettes commerciales | Ecarts commercial |
| 757 | Produits de cessions d'elements d'actif | Cessions courantes |
| 758 | Produits divers de gestion courante | Divers |
| 759 | Reprises sur provisions et depreciations | Reprises 691/697 |
| 7591 | Reprises sur provisions pour risques | Reprises 691 |
| 7594 | Reprises sur depreciations des comptes de tiers | Reprises 416 |

#### 77 — Produits financiers

| Compte | Libelle | Usage |
|--------|---------|-------|
| 771 | Interets des prets | Interets recus sur prets |
| 772 | Revenus de participations | Dividendes, interets |
| 773 | Escomptes obtenus | Escompte de reglement fournisseurs |
| 774 | Gains de change | Ecarts de change financiers |
| 775 | Gains sur cessions de valeurs mobilieres | Plus-values |
| 776 | Gains de change sur creances et dettes | Ecarts commercial |
| 778 | Autres produits financiers | Divers |

#### 78 — Produits exceptionnels (H.A.O.)

| Compte | Libelle | Usage |
|--------|---------|-------|
| 822 | Produits des cessions d'immobilisations | Cessions non recurrentes |
| 842 | Subventions d'equilibre | Subventions pour pertes |
| 848 | Autres produits exceptionnels | Divers H.A.O. |
| 849 | Reprises sur provisions reglementees | Reprises 145 |

#### 81 — Valeurs comptables des cessions d'immobilisations

| Compte | Libelle | Usage |
|--------|---------|-------|
| 812 | Valeurs comptables des cessions d'immobilisations | Cout net cede |

#### 82 — Charges d'exploitation transferees (non deductibles)

| Compte | Libelle | Usage |
|--------|---------|-------|
| 821 | Charges non deductibles | Remuneration gerant (6622) |

#### 83 — Resultat financier

| Compte | Libelle | Usage |
|--------|---------|-------|
| 831 | Charges d'interets | Regroupement |
| 832 | Produits de placements | Regroupement |

#### 84 — Resultat exceptionnel

| Compte | Libelle | Usage |
|--------|---------|-------|
| 841 | Charges exceptionnelles | Regroupement |
| 842 | Produits exceptionnels | Regroupement |

### CLASSE 8 — COMPTES DE RESULTAT (HORS BILAN)

| Compte | Libelle | Usage |
|--------|---------|-------|
| 801 | Resultat d'exploitation | 70-60 |
| 802 | Resultat financier | 77-67 |
| 803 | Resultat exceptionnel | 84-84 |
| 805 | Resultat avant impot | 801+802+803 |
| 806 | Impot sur les benefices | 641 |
| 807 | Resultat net de l'exercice | 805-806 |

---

## REGLES D'IMPUTATION PAR NATURE DE TRANSACTION

### ACHATS

**Achat de marchandises a credit (facture fournisseur) :**
```
D 601  Achats de marchandises          [Montant HT]
D 4452 TVA recuperable sur achats      [TVA]
C 4011 Fournisseurs nationaux          [TTC]
Journal : ACH
```

**Achat de marchandises au comptant (especes) :**
```
D 601  Achats de marchandises          [Montant HT]
D 4452 TVA recuperable sur achats      [TVA]
C 571  Caisse                          [TTC]
Journal : CSE
```

> **Note :** L'achat au comptant sans passage par 401 est deconseille pour la tracabilite, mais acceptable si la facture est directement payee.

**Achat de prestation de services :**
```
D 622/624/6324/ etc.  [Nature du service]    [Montant HT]
D 4453 TVA recuperable sur services           [TVA]
C 4011 Fournisseurs nationaux                [TTC]
Journal : ACH
```

**Achat de fournitures de bureau (non stockables) :**
```
D 6055 Fournitures de bureau non stockables    [Montant HT]
D 4452 TVA recuperable sur achats             [TVA]
C 4011/521/571                               [TTC]
Journal : ACH / BQ / CSE
```

**Achat d'emballages perdus :**
```
D 6081 Emballages perdus                      [Montant HT]
D 4452 TVA recuperable sur achats             [TVA]
C 4011/521/571                               [TTC]
```

**Achat d'emballages recuperables :**
```
D 4094 Fournisseurs, creances emballages       [TTC]
C 521/571                                     [TTC]
```
> Ce n'est pas une charge, c'est une creance sur le fournisseur.

### VENTES

**Vente de marchandises a credit :**
```
D 4111 Clients nationaux                     [TTC]
C 701  Ventes de marchandises                [Montant HT]
C 4431 TVA facturee sur ventes                [TVA]
Journal : VTE
```

**Vente de prestations de services a credit :**
```
D 4111 Clients nationaux                     [TTC]
C 706  Prestations de services               [Montant HT]
C 4431 TVA facturee sur ventes                [TVA]
Journal : VTE
```

**Vente au comptant (especes) :**
```
D 571  Caisse                                [TTC]
C 701/706                                     [Montant HT]
C 4431                                        [TVA]
Journal : CSE
```

**Vente avec port facture :**
```
D 4111 Clients nationaux                     [TTC total]
C 701  Ventes de marchandises                [HT marchandises]
C 7071 Port facture                          [HT port]
C 4431 TVA facturee sur ventes                [TVA totale]
Journal : VTE
```

**Vente a l'international (export) :**
```
D 4112 Clients etrangers                      [Montant HT]
C 701/706                                     [Montant HT]
C 4431 TVA facturee sur ventes                [0]  (hors taxe)
Journal : VTE
```
> Justificatifs obligatoires : DTI (Declaration de Transit des Importations) ou DAU (Document d'Accompagnement Unique).

**Facture avec escompte accorde :**
```
# Ecriture de vente
D 4111 Clients nationaux                     [TTC]
C 701/706                                     [HT]
C 4431 TVA facturee sur ventes                [TVA]

# Ecriture de reglement (avec escompte)
D 521  Banque                                [TTC - Escompte]
D 673  Escomptes accordes                    [Escompte HT]
D 4452 TVA recuperable sur escompte          [TVA sur escompte]
C 4111 Clients nationaux                      [TTC]
Journal : BQ
```

### SALAIRES ET CHARGES SOCIALES

**Constatation de la paie (OD) :**
```
D 6611 Appointements et salaires              [Salaires bruts]
D 6612 Primes et gratifications               [Primes]
D 6613 Indemnites et avantages                [Indemnites]
C 422  Personnel, remunerations dues          [Net a payer]
C 431  Securite sociale (CNPS)               [Cotisations salariales + patronales]
C 4471 Etat, impots retenus a la source       [ITS]
C 421  Personnel, avances et acomptes         [Avances recuperees]
Journal : OD
```

**Paiement du net salaire (BQ) :**
```
D 422  Personnel, remunerations dues          [Net a payer]
C 5211 Banque locale                          [Net a payer]
Journal : BQ
```

**Paiement des cotisations CNPS (BQ) :**
```
D 431  Securite sociale (CNPS)               [Total cotisations]
C 5211 Banque locale                          [Total cotisations]
Journal : BQ
```

**Paiement de l'ITS a l'Etat (BQ) :**
```
D 4471 Etat, impots retenus a la source       [ITS]
C 5211 Banque locale                          [ITS]
Journal : BQ
```

> **Regle du gerant :** Si le beneficiaire est le gerant majoritaire ou associe unique :
> ```
> D 6622 Remunerations du gerant              [Montant]
> C 422/4471/431                              [Selon nature]
> ```
> Le 6622 est une charge non deductible fiscalement (retraitement en 821).

### IMMOBILISATIONS

**Acquisition d'une immobilisation a credit :**
```
D 2442 Materiel informatique                  [Prix d'achat net + frais]
D 4451 TVA recuperable sur immobilisations    [TVA]
C 481  Fournisseurs d'immobilisations         [TTC]
Journal : OD (ou ACH si fournisseur classique)
```

**Acquisition d'une immobilisation au comptant :**
```
D 2442 Materiel informatique                  [Prix d'achat net + frais]
D 4451 TVA recuperable sur immobilisations    [TVA]
C 5211 Banque locale                          [TTC]
Journal : BQ
```

**Dotation aux amortissements (OD) :**
```
D 6812 Dotations aux amortissements des immobilisations corporelles  [Annuite]
C 2824 Amortissements du materiel de bureau                          [Annuite]
Journal : AN
```

**Cession d'une immobilisation :**
```
# 1. Constatation du prix de cession
D 485  Cessions d'immobilisations, creances   [Prix de cession]
C 822  Produits des cessions d'immobilisations [Prix de cession]

# 2. Dotation complementaire (du debut d'exercice a la cession)
D 6812 Dotations aux amortissements           [Prorata]
C 2824 Amortissements                        [Prorata]

# 3. Sortie de l'actif (desimmobilisation)
D 2824 Amortissements cumules                 [Total amortissements]
D 812  Valeurs comptables des cessions        [Valeur nette comptable]
C 2442 Materiel informatique                  [Cout d'origine]
```

### TRESORERIE

**Virement banque → caisse :**
```
D 581  Virements internes                     [Montant]
C 5211 Banque locale                          [Montant]

D 571  Caisse                                 [Montant]
C 581  Virements internes                     [Montant]
```

**Retrait d'especes (banque → caisse) :**
```
D 571  Caisse                                 [Montant]
C 5211 Banque locale                          [Montant]
Journal : CSE (ou BQ selon le point de vue)
```

**Depot d'especes (caisse → banque) :**
```
D 5211 Banque locale                          [Montant]
C 571  Caisse                                 [Montant]
Journal : BQ
```

**Paiement par Orange Money :**
```
D 4011/4111/6xx/7xx                          [Montant]
C 554  Porte-monnaie electronique             [Montant]
Journal : OM (ou BQ si regroupement)
```

**Paiement par Wave :**
```
D 4011/4111/6xx/7xx                          [Montant]
C 554  Porte-monnaie electronique             [Montant]
Journal : WVE
```

### TVA

**Regularisation mensuelle de TVA (OD) :**
```
# Si TVA collectee > TVA deductible (TVA due)
D 4431 TVA facturee sur ventes                [Total collectee]
C 4452 TVA recuperable sur achats             [Total deductible biens]
C 4453 TVA recuperable sur services           [Total deductible services]
C 4451 TVA recuperable sur immobilisations    [Total deductible immo]
C 4441 Etat, TVA due                          [Solde du]

# Si TVA deductible > TVA collectee (Credit de TVA)
D 4431 TVA facturee sur ventes                [Total collectee]
D 4449 Etat, credit de TVA                    [Solde crediteur]
C 4452 TVA recuperable sur achats             [Total deductible biens]
C 4453 TVA recuperable sur services           [Total deductible services]
C 4451 TVA recuperable sur immobilisations    [Total deductible immo]
```

**Paiement de la TVA (BQ) :**
```
D 4441 Etat, TVA due                          [Montant]
C 5211 Banque locale                          [Montant]
Journal : BQ
```

### CHARGES CONSTATEES D'AVANCE (CCA) ET PRODUITS CONSTATEES D'AVANCE (PCA)

**Paiement d'un loyer couvrant plusieurs exercices :**
```
# Au paiement (N)
D 622  Locations et charges locatives        [Montant total]
C 5211 Banque locale                          [Montant total]

# En fin d'exercice (regularisation CCA)
D 476  Charges constatees d'avance           [Part N+1]
C 622  Locations et charges locatives        [Part N+1]

# En debut d'exercice N+1 (reprise)
D 622  Locations et charges locatives        [Part N+1]
C 476  Charges constatees d'avance           [Part N+1]
```

**Encaissement d'un loyer couvrant plusieurs exercices :**
```
# A l'encaissement (N)
D 5211 Banque locale                          [Montant total]
C 706/707                                     [Part N]
C 487  Produits constates d'avance           [Part N+1]

# En debut d'exercice N+1 (reprise)
D 487  Produits constates d'avance           [Part N+1]
C 706/707                                     [Part N+1]
```

### FACTURES NON PARVENUES

**Fin d'exercice : biens/services recus, facture non recue :**
```
D 601/602/606/622/etc.                        [Montant estime HT]
D 4455 TVA recuperable sur factures non parvenues [TVA estimee]
C 408  Fournisseurs, factures non parvenues    [TTC estime]
Journal : OD

# Au debut d'exercice N+1 (annulation)
D 408  Fournisseurs, factures non parvenues    [TTC]
C 601/602/606/622/etc.                        [HT]
C 4455                                        [TVA]

# A reception de la facture (ecriture normale)
D 601/602/606/622/etc.                        [HT reel]
D 4452/4453                                   [TVA reelle]
C 4011                                        [TTC reel]
```

### PROVISIONS ET DEPRECIATIONS

**Dotation aux provisions pour litige (OD) :**
```
D 6911 Dotations aux provisions pour litiges   [Montant]
C 4991 Provisions pour litiges                  [Montant]
Journal : OD
```

**Depreciation d'un client douteux (OD) :**
```
D 6594 Dotations aux depreciations des comptes de tiers [Montant]
C 491  Depreciation des comptes de tiers               [Montant]
Journal : OD
```

**Reprise sur depreciation (si situation s'ameliore) :**
```
D 491  Depreciation des comptes de tiers               [Montant]
C 7594 Reprises sur depreciations des comptes de tiers [Montant]
Journal : OD
```

### AVANCES, ACOMPTES, RETENUES

**Acompte verse a un fournisseur (BQ) :**
```
D 4091 Fournisseurs, acomptes verses           [Montant]
C 5211 Banque locale                          [Montant]
Journal : BQ
```

**Acompte recu d'un client (BQ) :**
```
D 5211 Banque locale                          [Montant]
C 4191 Clients, acomptes recus                [Montant]
Journal : BQ
```

**Facturation finale (acompte deduit) :**
```
D 4111 Clients nationaux                      [TTC]
C 701/706                                     [HT]
C 4431 TVA facturee sur ventes                [TVA]

D 4191 Clients, acomptes recus                [Montant acompte]
C 4111 Clients nationaux                      [Montant acompte]
```

**Retenue de garantie sur facture fournisseur :**
```
D 601/622/etc.                                [HT total]
D 4452/4453                                   [TVA total]
C 4011 Fournisseurs nationaux                 [TTC - Retenue]
C 468  Autres creances/charges a payer        [Retenue]
```

### CORRECTIONS D'ERREURS

**Contre-passation (extourne) d'une ecriture erronee :**
```
# Ecriture originale erronee (ex: D 601 / C 4011 pour 1000)
# Contre-passation :
D 4011 Fournisseurs nationaux                 [1000]
C 601  Achats de marchandises                [1000]

# Ecriture correcte :
D 6055 Fournitures de bureau                  [1000]
C 4011 Fournisseurs nationaux                 [1000]
```

**Ecriture de rectification (sans extourne) :**
```
# Si erreur de compte (ex: 601 au lieu de 6055)
D 6055 Fournitures de bureau                  [1000]
C 601  Achats de marchandises                [1000]
```

---

## REGLES DE JOURNALISATION

| Journal | Code | Usage | Comptes principaux |
|---------|------|-------|-------------------|
| Achats | ACH | Achats de biens et services | 601-608, 4452, 4453, 401 |
| Ventes | VTE | Ventes de biens et services | 701-708, 4431, 411 |
| Banque | BQ | Operations bancaires | 521, 513-515, 401, 411, 422, 431, 447 |
| Caisse | CSE | Operations en especes | 571, 401, 411, 422 |
| Operations Diverses | OD | Constations, regularisations, salaires, amortissements | 6xx, 7xx, 4xx, 2xx, 8xx |
| Amortissements | AN | Dotations aux amortissements | 681, 28x |
| Immobilisations | IM | Operations d'investissement | 2xx, 4451, 481 |
| Monnaie Electronique | OM | Orange Money | 554, 401, 411 |
| Wave | WVE | Wave Mobile Money | 554, 401, 411 |
| Ajustements | AJ | Ecritures de cloture, retraitements | 12x, 13x, 476, 487, 408 |

---

## REGLES DE GESTION DE LA TVA

### Taux de TVA

| Taux | Application | Compte |
|------|-------------|--------|
| 18% | Taux normal (biens et services standard) | 4431 / 4452 / 4453 / 4451 |
| 9% | Taux reduit (eau, electricite, denrees alimentaires) | 4431 / 4452 |
| 0% | Exportations, ventes hors taxe | 4431 (montant 0) |
| Exonere | Operations exonerees (livres, medicaments, prestations medicales) | Pas de TVA |

### Regles de deduction

- **TVA sur immobilisations** : 4451 (deductible immediatement)
- **TVA sur achats de biens** : 4452 (deductible immediatement)
- **TVA sur services** : 4453 (deductible immediatement)
- **TVA sur autres charges** : 4454 (deductible immediatement)

### Regles de collecte

- **TVA sur ventes de biens** : 4431 (facturee aux clients)
- **TVA sur prestations de services** : 4431 (facturee aux clients)
- **TVA sur exportations** : 0% (hors taxe, justificatifs DTI/DAU)

### Regularisation

- **TVA due** : Si collectee > deductible → 4441 (a payer)
- **Credit de TVA** : Si deductible > collectee → 4449 (a reporter)
- **Paiement** : Avant le 15 du mois suivant (ou 15 du trimestre suivant selon regime)

---

## REGLES DE GESTION DES DEVISES ETRANGERES

### Conversion

- **A l'entree** : Cours du jour de l'operation
- **A la cloture** : Cours de cloture
- **Ecart de conversion** : Constater en 478 (gain latent) ou 479 (perte latent)

### Ecriture de change

**Paiement d'une dette fournisseur en devise (perte de change) :**
```
D 4012 Fournisseurs etrangers                [Montant au cours initial]
D 676  Pertes de change                      [Ecart defavorable]
C 5212 Banque etrangere                      [Montant paye au cours du jour]
```

**Encaissement d'une creance client en devise (gain de change) :**
```
D 5212 Banque etrangere                      [Montant recu au cours du jour]
C 4112 Clients etrangers                     [Montant au cours initial]
C 756  Gains de change                       [Ecart favorable]
```

---

## REGLES DE GESTION DES EMBALLAGES

### Emploi chez le client (consignation)

**Consignation d'emballages (vente) :**
```
D 4111 Clients nationaux                     [TTC emballages]
C 4194 Clients, dettes pour emballages consignes [TTC emballages]
```
> Ce n'est pas un produit, c'est une dette jusqu'a restitution.

**Restitution d'emballages (retour) :**
```
D 4194 Clients, dettes pour emballages consignes [TTC]
C 4111 Clients nationaux                      [TTC]
```

**Non-restitution d'emballages (boni) :**
```
D 4194 Clients, dettes pour emballages consignes [TTC]
C 7074 Bonis sur reprises d'emballages          [HT]
C 4431 TVA facturee sur ventes                  [TVA]
```

### Emploi chez le fournisseur (creance)

**Achat avec emballages consignes :**
```
D 601  Achats de marchandises                [HT marchandises]
D 4094 Fournisseurs, creances emballages     [TTC emballages]
D 4452 TVA recuperable sur achats            [TVA marchandises]
C 4011 Fournisseurs nationaux                [TTC total]
```

**Restitution d'emballages au fournisseur :**
```
D 4011 Fournisseurs nationaux                [TTC emballages]
C 4094 Fournisseurs, creances emballages     [TTC emballages]
```

---

## REGLES DE GESTION DES PRETS ET CAUTIONS

### Prets accordes

**Octroi d'un pret :**
```
D 271  Prets                                  [Montant]
C 5211 Banque locale                          [Montant]
```

**Interets courus sur prets :**
```
D 276  Interets courus sur prets              [Montant]
C 771  Interets des prets                    [Montant]
```

**Encaissement des interets :**
```
D 5211 Banque locale                          [Montant]
C 276  Interets courus sur prets              [Montant]
```

**Remboursement du pret :**
```
D 5211 Banque locale                          [Montant]
C 271  Prets                                  [Montant]
```

### Cautionnements

**Cautionnement verse :**
```
D 275  Depots et cautionnements verses        [Montant]
C 5211/571                                    [Montant]
```

**Restitution du cautionnement :**
```
D 5211/571                                    [Montant]
C 275  Depots et cautionnements verses        [Montant]
```

**Cautionnement recu :**
```
D 5211/571                                    [Montant]
C 1652 Cautionnements recus                    [Montant]
```

---

## REGLES DE GESTION DES DONS ET SUBVENTIONS

### Donations

**Donation accordee :**
```
D 658  Charges diverses de gestion courante    [Montant]
C 5211/571                                    [Montant]
```

**Donation recue :**
```
D 5211/571                                    [Montant]
C 758  Produits divers de gestion courante     [Montant]
```

### Subventions

**Subvention d'exploitation recue :**
```
D 5211/441                                    [Montant]
C 711  Subventions sur produits                [Montant]
# ou
C 718  Autres subventions d'exploitation       [Montant]
```

**Subvention d'equilibre (H.A.O.) :**
```
D 5211/441                                    [Montant]
C 842  Subventions d'equilibre                 [Montant]
```

**Subvention d'investissement recue :**
```
D 5211/441                                    [Montant]
C 131  Subventions d'investissement           [Montant]

# Dotation au resultat (sur la duree de l'immobilisation)
D 131  Subventions d'investissement           [Part annuelle]
C 848  Autres produits exceptionnels           [Part annuelle]
```

---

## REGLES DE CLOTURE D'EXERCICE

### Ecritures de cloture

**1. Charges constatees d'avance (CCA) :**
```
D 476  Charges constatees d'avance           [Part N+1]
C 6xx  Compte de charge concerne              [Part N+1]
```

**2. Produits constates d'avance (PCA) :**
```
D 7xx  Compte de produit concerne             [Part N+1]
C 487  Produits constates d'avance           [Part N+1]
```

**3. Factures non parvenues :**
```
D 601/602/606/622/etc.                        [HT estime]
D 4455 TVA recuperable sur factures non parvenues [TVA estimee]
C 408  Fournisseurs, factures non parvenues    [TTC estime]
```

**4. Dotations aux amortissements :**
```
D 6811/6812 Dotations aux amortissements      [Annuites]
C 281/282  Amortissements                     [Annuites]
```

**5. Dotations aux provisions :**
```
D 691/697  Dotations aux provisions            [Montants]
C 49x/499  Provisions                          [Montants]
```

**6. Depreciations des stocks :**
```
D 6972 Dotations aux depreciations des stocks   [Montant]
C 39x  Depreciation des stocks                  [Montant]
```

**7. Resultat de l'exercice :**
```
# Solde des comptes de charges
D 131  Resultat de l'exercice (benefice)       [Total charges]
C 6xx  Tous les comptes de charges              [Soldes]

# Solde des comptes de produits
D 7xx  Tous les comptes de produits             [Soldes]
C 131  Resultat de l'exercice (benefice)       [Total produits]
```

**8. Report a nouveau :**
```
# Si benefice
D 131  Resultat de l'exercice                  [Benefice]
C 121  Report a nouveau crediteur              [Benefice]

# Si perte
D 129  Report a nouveau debiteur                [Perte]
C 131  Resultat de l'exercice                  [Perte]
```

---

## REGLES DE GESTION DES ERREURS ET CAS PARTICULIERS

### Erreurs frequentes a eviter

| Erreur | Correction | Impact |
|--------|-----------|--------|
| Imputer TTC dans un compte de charge 6xx | Imputer HT en 6xx, TVA en 445x | Sous-estimation de la TVA deductible, surestimation de la charge |
| Debiter 6xx en BQ (sans OD prealable) | Passer OD : D 6xx / C 4xx, puis BQ : D 4xx / C 521 | Non-respect de la separation des flux |
| Confondre 601 et 605 | 601 = marchandises a revendre, 605 = fournitures consommees | Erreur de presentation du bilan (stocks) |
| Remuneration gerant en 6611 | Imputer en 6622 | Erreur fiscale (non deductible) |
| Oublier le prorata temporis sur amortissements | Calculer : annuite x mois/12 | Sous/sur-dotation |
| Immobiliser < 50 000 FCFA | Passer en 6056 ou 6058 | Surcharge du bilan |
| Confondre 411 et 416 | 416 = clients douteux (avec depreciation 491) | Sous-estimation des creances douteuses |
| Oublier la regularisation TVA mensuelle | Passer l'OD de regularisation 443/445 → 444 | Non-respect des obligations fiscales |
| Enregistrer un cheque a la date de signature | Attendre l'avis de credit (date de valeur) | Desequilibre temporel |
| Compensation interdite (nettoyer 6xx par 7xx) | Passer par des comptes distincts | Non-respect du principe de non-compensation |

### Ecritures d'attente

**Pour une transaction non identifiee :**
```
D 605  Divers (ou compte temporaire)          [Montant]
C 521/571                                     [Montant]
```
> Des que l'imputation est identifiee, passer une ecriture de rectification.

### Pieces manquantes

**Si une ecriture est necessaire mais la piece justificative manque :**
- Creer une ecriture provisoire avec reference "PIECE MANQUANTE"
- Suivre dans un registre des pieces manquantes
- Des reception de la piece, valider l'ecriture

---

## ALGORITHME DE PASSATION D'ECRITURE

### Etape 1 : Analyse de la transaction

1. **Identifier la nature** : achat, vente, salaire, immobilisation, tresorerie, regularisation
2. **Identifier les parties** : fournisseur, client, employe, Etat, banque
3. **Identifier les montants** : HT, TVA, TTC, escompte, frais annexes
4. **Identifier les dates** : date de facture, date de valeur, date de prestation
5. **Identifier le mode de reglement** : credit, especes, cheque, virement, mobile money

### Etape 2 : Determination des comptes

1. **Compte de charge/produit** (Classe 6 ou 7) : selon la nature de la transaction
2. **Compte de tiers** (Classe 4) : si transaction a credit
3. **Compte de tresorerie** (Classe 5) : si paiement/encaissement immediat
4. **Compte de TVA** (Classe 44) : si assujettissement a la TVA
5. **Compte d'immobilisation** (Classe 2) : si acquisition d'actif

### Etape 3 : Construction de l'ecriture

1. **Determiner le journal** : ACH, VTE, BQ, CSE, OD, AN, IM
2. **Verifier l'equilibre** : Σ D = Σ C
3. **Verifier la coherence** : compte existant, date dans l'exercice, montant positif
4. **Verifier la TVA** : taux correct, compte de TVA adapte (4451/4452/4453/4454/4431)
5. **Verifier le mode de reglement** : coherence journal/compte de tresorerie

### Etape 4 : Validation

1. **Controle automatique** :
   - Equilibre D = C (tolerance 0)
   - Compte dans le plan comptable
   - Date dans l'exercice en cours
   - Montant coherent avec la piece
2. **Controle de coherence inter-ecritures** :
   - Achat en ACH → paiement en BQ avec meme fournisseur
   - Vente en VTE → encaissement en BQ avec meme client
   - Salaire en OD → paiement en BQ avec meme montant net
3. **Signaux d'alerte** :
   - Montant anormalement eleve
   - Compte rarement utilise
   - Ecriture sans piece justificative
   - Ecart de TVA calculee vs piece

---

## FORMAT DE SORTIE STANDARD

Pour chaque ecriture comptable generee, presenter :

```markdown
### ECRITURE : [Description de la transaction]

**Journal :** [ACH/VTE/BQ/CSE/OD/AN/IM/OM/WVE]
**Date :** [JJ/MM/AAAA]
**Piece :** [Reference facture/bulletin/quittance]
**Libelle :** [Description concise]

| Compte | Libelle du compte | Debit | Credit |
|--------|-------------------|-------|--------|
| [Numero] | [Libelle] | [Montant] | |
| [Numero] | [Libelle] | | [Montant] |
| **TOTAL** | | **Σ D** | **Σ C** |

**Verification :** ✅ Equilibre D = C | ✅ Comptes valides | ✅ TVA correcte
**Justification :** [Explication de l'imputation choisie]
**Piece justificative :** [Type de document requis]
```

---

## CHECKLIST FINALE AVANT VALIDATION

Avant de valider une ecriture, verifier :

- [ ] **Equilibre** : Σ DEBITS = Σ CREDITS (tolerance 0 FCFA)
- [ ] **Comptes** : tous les comptes existent dans le plan comptable SYSCOHADA
- [ ] **Dates** : toutes les dates sont dans l'exercice comptable en cours
- [ ] **TVA** : taux correct, compte de TVA adapte, calcul exact
- [ ] **Journal** : affectation correcte selon la nature de l'operation
- [ ] **Separation des flux** : pas de debit 6xx direct en BQ/CSE sans OD prealable
- [ ] **Seuil d'immobilisation** : > 50 000 FCFA et > 1 an → Classe 2
- [ ] **Gerant** : remuneration en 6622, jamais en 6611
- [ ] **Piece justificative** : chaque ecriture est justifiee par un document
- [ ] **Mode de reglement** : coherence entre le journal et le moyen de paiement
- [ ] **Prorata temporis** : amortissements calcules au prorata des mois
- [ ] **Non-compensation** : pas de nettoyage direct entre charge et produit
- [ ] **Devise** : conversion au cours du jour si operation en devise
- [ ] **CCA/PCA** : regularisation si paiement/encaissement couvre plusieurs exercices
- [ ] **Factures non parvenues** : constatation en fin d'exercice si necessaire

---

## ANNEXE : TABLE DE DECISION RAPIDE

### Nature de transaction → Compte de charge/produit

| Nature | Compte Charge | Compte Produit |
|--------|--------------|----------------|
| Achat de marchandises | 601 | 701 |
| Achat de matieres premieres | 602 | 702 |
| Fournitures de bureau (stockees) | 6042 | — |
| Fournitures de bureau (non stockees) | 6055 | — |
| Petits equipements (< 50k) | 6056 | — |
| Transport de marchandises achetees | 611 | — |
| Transport de marchandises vendues | 612 | — |
| Transport de personnel | 614 | — |
| Affaires postales | 616 | — |
| Deplacements professionnels | 618 | — |
| Hebergement mission | 6181 | — |
| Carburant (usage pro) | 6183 | — |
| Loyers | 622 | 706/7073 |
| Entretien et reparations | 624 | — |
| Assurances | 625 | — |
| Publicite et etudes | 627 | — |
| Frais bancaires | 6311 | — |
| Honoraires (expert-comptable, avocat) | 6324 | — |
| Autres prestations de services | 6327 | — |
| Formation | 633 | — |
| Receptions et representation | 634 | — |
| Cotisations professionnelles | 635 | — |
| Personnel exterieur | 637 | — |
| Hebergement (hors mission) | 6384 | — |
| Impots directs (BIC, Patente) | 641 | — |
| Taxes indirectes | 645 | — |
| Penalites fiscales | 647 | — |
| Salaires bruts | 6611 | — |
| Primes et gratifications | 6612 | — |
| Indemnites salariales | 6613 | — |
| Remuneration gerant | 6622 | — |
| Cotisations CNPS patronales | 6641 | — |
| Cotisations retraite patronales | 6642 | — |
| Interets emprunts | 671 | 771 |
| Escomptes accordes | 673 | 773 |
| Pertes de change | 676 | 756 |
| Prestations de services | — | 706 |
| Commissions (activite principale) | — | 706 |
| Commissions (accessoires) | — | 7072 |
| Port facture | — | 7071 |
| Locations diverses | — | 7073 |
| Subventions d'exploitation | — | 711/718 |
| Cessions d'immobilisations | 812 | 822 |
| Subventions d'equilibre | — | 842 |

### Mode de reglement → Compte de tresorerie

| Mode de reglement | Compte | Journal |
|-------------------|--------|---------|
| Especes | 571 | CSE |
| Cheque (reception) | 513 | BQ |
| Cheque (remise banque) | 514 | BQ |
| Cheque (encaissement) | 521 | BQ |
| Virement bancaire | 521 | BQ |
| Carte bancaire | 521 | BQ |
| Orange Money | 554 | OM |
| Wave | 554 | WVE |
| MTN Mobile Money | 554 | OM |
| Djamo | 555 | BQ |
| Prelevement automatique | 521 | BQ |
| Lettre de change | 402/412 | BQ |
| Billet a ordre | 402/412 | BQ |
| Espece (etranger) | 5212 | BQ |

### Taux de TVA → Compte

| Taux | Compte TVA deductible | Compte TVA collectee |
|------|----------------------|----------------------|
| 18% | 4452 (biens) / 4453 (services) / 4451 (immo) | 4431 |
| 9% | 4452 (biens) | 4431 |
| 0% | Aucun | 4431 (montant 0) |
| Exonere | Aucun | Aucun |

---

## ANNEXE : ARBRE DE DECISION POUR L'IMPUTATION

```
TRANSACTION RECUE
       |
       v
[Est-ce une vente ?] ---OUI--> [Type de bien/service ?]
       |                              |
      NON                             v
       |                    [Bien revendu] → 701
       v                    [Produit fabrique] → 702
[Est-ce un achat ?] ---OUI--> [Service] → 706
       |                              |
      NON                    [Bien a transformer] → 602
       |                    [Fourniture stockee] → 604
       v                    [Fourniture non stockee] → 605
[Est-ce un salaire ?] ---OUI--> [Personnel salarie] → 6611
       |                              |
      NON                    [Gerant majoritaire] → 6622
       |
       v
[Est-ce une immobilisation ?] ---OUI--> [Valeur > 50k ET > 1 an ?]
       |                                    |
      NON                                  OUI → Classe 2
       |                                    |
       v                                   NON → 6056/6058
[Est-ce un reglement ?] ---OUI--> [Mode de paiement ?]
       |                              |
      NON                    [Espece] → 571 / CSE
       |                    [Virement] → 521 / BQ
       v                    [Cheque] → 513→514→521 / BQ
[Est-ce une regularisation ?]    [OM/Wave] → 554 / OM/WVE
       |                    [Carte] → 521 / BQ
      NON
       |
       v
[Est-ce une provision/amortissement ?] ---OUI--> [Dotation 681/691/697]
       |
      NON
       |
       v
[Est-ce une cloture ?] ---OUI--> [CCA/PCA/Amortissements/Provisions]
       |
      NON
       |
       v
[Demander des precisions a l'utilisateur]
```

## RÈGLE FONDAMENTALE DES LIBELLÉS

**JAMAIS utiliser le nom technique du produit seul comme libellé de compte.**
**TOUJOURS catégoriser par : [Type d'opération] + [Catégorie générale] + [Domaine d'application]**

### FORMAT DES LIBELLÉS

**Libellé du compte de charge**
Structure : `Achats de [catégorie] [domaine]`
Exemple : `Achats de peintures de protection automobile` (et non "PROTECTOR SCHWARZ NOIR MIPA 750ML").

**Libellé de l'écriture**
Structure : `[Type d'opération] [catégorie] - Fact. [n° facture]`
Exemple : `Achat de peintures automobile - Fact. 1643622E25000007161`

### RÈGLES DE CATÉGORISATION PAR TYPE DE PRODUIT

| Mots-clés OCR détectés | Catégorie générale | Domaine | Compte suggéré |
|------------------------|--------------------|---------|----------------|
| peinture, vernis, laque, protector, mipa, unilaque, teinte, couleur | peintures et laques | automobile | 6041 |
| durcisseur, diluant, solvant, acrylique, résine, produit chimique | produits chimiques de carrosserie | automobile | 6041 |
| disque abrasif, papier abrasif, ponçage, lustrage, polissage | outillage et abrasifs de carrosserie | automobile | 6041 |
| huile, graisse, lubrifiant, fluide | produits d'entretien mécanique | automobile | 6041 |
| pièce, pièces détachées, accessoire, équipement | pièces et accessoires | automobile | 601 |
| outillage, outil, machine, équipement professionnel | outillage professionnel | automobile | 241/244 ou 6041 |
| service, prestation, conseil, expertise | prestations de services | divers | 622/6324 |
| transport, livraison, port, expedition | frais de transport | divers | 611/612 |
| loyer, location, bail | locations et charges locatives | divers | 622 |
| électricité, eau, gaz, téléphone | fournitures non stockables | divers | 605 |

### GESTION DES FACTURES MULTI-LIGNES

**Si plusieurs lignes avec des catégories différentes :**
Ventiler sur plusieurs comptes de charge distincts (une ligne par catégorie).

**Si plusieurs lignes avec la même catégorie :**
Regrouper en une seule ligne de charge avec la somme des HT.

---

## ANNEXE : GLOSSAIRE DES TERMES COMPTABLES

| Terme | Definition |
|-------|-----------|
| **Amortissement** | Repartition du cout d'une immobilisation sur sa duree d'utilisation |
| **CCA** | Charges Constatees d'Avance : charges payees en N couvrant N+1 |
| **Contre-passation** | Ecriture inverse d'une ecriture erronee pour l'annuler |
| **Depreciation** | Perte de valeur d'un actif (stock, creance, immobilisation) |
| **DTI** | Declaration de Transit des Importations (justificatif export) |
| **DAU** | Document d'Accompagnement Unique (justificatif export) |
| **Escompte** | Reduction financiere accordee pour paiement anticipe |
| **HT** | Hors Taxes : montant sans TVA |
| **ITS** | Impot sur les Traitements et Salaires (retenue a la source) |
| **Lettrage** | Rapprochement d'une ecriture de reglement avec la facture d'origine |
| **Net a payer** | Salaire brut - retenues salariales - avances |
| **OD** | Operations Diverses : journal des constatations et regularisations |
| **PCA** | Produits Constates d'Avance : produits encaisses en N couvrant N+1 |
| **Prorata temporis** | Calcul au prorata du temps (ex: amortissement en cours d'annee) |
| **Provision** | Dotation pour un risque ou une charge future |
| **Seuil d'immobilisation** | 50 000 FCFA : minimum pour immobiliser |
| **TTC** | Toutes Taxes Comprises : HT + TVA |
| **VNC** | Valeur Nette Comptable : cout d'origine - amortissements cumules |

---

## ANNEXE : CORRESPONDANCE MOYEN DE PAIEMENT / JOURNAL / COMPTE

| Moyen de paiement | Compte tresorerie | Journal | Remarque |
|-------------------|-------------------|---------|----------|
| ESPECE | 571000 | CSE | Caisse centrale ou succursale |
| CHEQUE | 513→514→521 | BQ | 3 etapes obligatoires |
| VIREMENT | 5211 | BQ | Date de valeur obligatoire |
| CARTE BANCAIRE | 5211 | BQ | Ou 515 si en attente |
| ORANGE MONEY | 554 | OM | Mobile Money CI |
| WAVE | 554 | WVE | Mobile Money CI |
| MTN MOBILE MONEY | 554 | OM | Mobile Money CI |
| DJAMO | 555 | BQ | Carte virtuelle |
| PRELEVEMENT AUTO | 5211 | BQ | Abonnements, loyers |
| LETTRE DE CHANGE | 402/412 | BQ | Effet de commerce |
| BILLET A ORDRE | 402/412 | BQ | Effet de commerce |
| WESTERN UNION | 5212 | BQ | Transfert international |
| MONEYGRAM | 5212 | BQ | Transfert international |

---

## ANNEXE : TABLE DES ERREURS FREQUENTES ET CORRECTIONS

| N° | Erreur | Detection | Correction | Impact financier |
|----|--------|-----------|------------|------------------|
| 1 | Imputation TTC au lieu de HT en 6xx | TVA non recuperee | Rectifier : D 6xx (HT), D 445x (TVA), C 401x (TTC) | TVA perdue |
| 2 | Debit 6xx direct en BQ | Anomalie structurelle | Passer OD : D 6xx/C 4xx, puis BQ : D 4xx/C 521 | Double charge |
| 3 | Confusion 601/605 | Nature de l'achat | 601 = revente, 605 = consommation | Stock faux |
| 4 | Gerant en 6611 | Nature du beneficiaire | Imputer en 6622 | Erreur fiscale |
| 5 | Immobilisation < 50k | Seuil non respecte | Passer en 6056 ou 6058 | Bilan surcharge |
| 6 | Amortissement sans prorata | Date d'acquisition | Calculer : annuite x mois/12 | Dotation fausse |
| 7 | TVA 18% sur service exonere | Taux errone | Appliquer 0% ou taux reduit | TVA indue |
| 8 | Cheque a date de signature | Date de valeur | Attendre avis de credit | Desequilibre temporel |
| 9 | Compensation charge/produit | Non-respect principe | Passer par comptes distincts | Etat financier faux |
| 10 | CCA non regularise | Fin d'exercice | Constater CCA en 476 | Resultat faux |
| 11 | Facture non parvenue oubliee | Fin d'exercice | Constater en 408 | Resultat faux |
| 12 | Client douteux sans depreciation | Risque non couvert | Dotation 6594/491 | Creance surestimee |
| 13 | Emballage consigne en produit | Nature de l'operation | Passer en 4194 | Produit surestime |
| 14 | Acompte client non deduit | Facturation finale | Debiter 4191/Crediter 4111 | Creance surestimee |
| 15 | Escompte en charge/produit | Nature financiere | Passer en 673/773 | Resultat d'exploitation faux |
| 16 | Frais bancaires en 672 | Nature du frais | 6311 = commission, 672 = agios | Charges mal ventilees |
| 17 | Subvention d'investissement en produit | Nature de la subvention | Passer en 131, puis 848 | Resultat faux |
| 18 | Cession immobilisation sans VNC | Oubli de sortie | Passer 812 et 282 | Resultat faux |
| 19 | Perte de change en 676 | Nature de l'ecart | 676 = commercial, 674 = financier | Resultat financier faux |
| 20 | Report a nouveau non constate | Oubli de cloture | Passer 131/121 ou 129/131 | Bilan desequilibre |

---

## INSTRUCTIONS FINALES POUR L'AGENT IA

1. **Tu ne dois JAMAIS inventer un compte** qui n'existe pas dans le plan comptable SYSCOHADA ci-dessus.
2. **Tu dois TOUJOURS verifier l'equilibre** D = C avant de proposer une ecriture.
3. **Tu dois TOUJOURS justifier** ton choix d'imputation en reference aux regles ci-dessus.
4. **Si tu as un doute** sur l'imputation, tu dois proposer plusieurs options avec scores de confiance et demander confirmation.
5. **Si des informations sont manquantes** (montant HT/TVA, date, mode de reglement), tu dois demander les precisions necessaires avant de passer l'ecriture.
6. **Tu dois TOUJOURS respecter la separation des flux** : pas de debit 6xx direct en BQ/CSE sans OD prealable.
7. **Tu dois TOUJOURS verifier le seuil d'immobilisation** : 50 000 FCFA + 1 an = Classe 2.
8. **Tu dois TOUJOURS distinguer le gerant** (6622) du personnel salarie (6611).
9. **Tu dois TOUJOURS calculer la TVA correctement** : taux applicable, compte de TVA adapte.
10. **Tu dois TOUJOURS indiquer le journal** correct (ACH, VTE, BQ, CSE, OD, AN, IM, OM, WVE).
11. **Tu dois TOUJOURS verifier la date** : date de facture pour la constatation, date de valeur pour le reglement.
12. **Tu dois TOUJOURS respecter le principe de non-compensation** : pas de nettoyage direct entre charge et produit.
13. **En cas d'operation en devise**, tu dois TOUJOURS preciser le cours de conversion utilise.
14. **En fin d'exercice**, tu dois TOUJOURS verifier les CCA, PCA, factures non parvenues, amortissements et provisions.
15. **Tu dois TOUJOURS presenter le resultat** dans le format de sortie standard defini ci-dessus.

---

*Skill version 1.0 — SYSCOHADA Révisé — Côte d'Ivoire*
*Applicable a toute PME, independamment du secteur d'activite*

# DIAGNOSTIC : DONNÉES DE RÉFÉRENCE ET RAG

**Date** : 2026-09-19  
**Auteur** : Ingénieur senior full-stack  
**Objet** : Confirmer ou infirmer les hypothèses (a), (b), (c) sur l'échec des données de référence

---

## HYPOTHÈSES À TESTER

### (a) Les fichiers .xlsx ne sont pas extraits

**Statut** : ✅ **CONFIRMÉ**

**Preuve** : La fonction `extractIndexableText` (functions/index.js:3649-3684) ne gère QUE :
- Texte brut : `.txt`, `.md`, `.csv`, `.json`
- PDF via `pdf-parse` (texte uniquement, pas de rasterisation)
- Images via VLM (OpenRouter vision)

```javascript
async function extractIndexableText(buf, mimeType, name) {
  const lower = String(name || '').toLowerCase();
  const mime = String(mimeType || '');
  const isText = /^(text\/|application\/(json|csv|x-www-form-urlencoded))/.test(mime) || /\.(txt|md|csv|json)$/i.test(lower);
  if (isText) return { text: buf.toString('utf8').slice(0, 200000), reason: '' };
  if (mime === 'application/pdf' || /\.pdf$/i.test(lower)) { /* ... */ }
  if (/^image\//.test(mime)) { /* ... */ }
  return { text: '', reason: 'extraction non supportée (texte, PDF ou image uniquement)' };
}
```

**Conséquence** : Tout fichier `.xlsx` ou `.xls` uploadé dans Connaissances retourne :
```json
{ "text": "", "reason": "extraction non supportée (texte, PDF ou image uniquement)" }
```

Le document reste en statut `pending` avec `indexReason` = ce message d'erreur, et n'est **jamais interrogeable** via `knowledge.search`.

---

### (b) Le contexte comptable lit le localStorage, pas Firestore

**Statut** : ✅ **CONFIRMÉ**

**Preuve** : `src/services/companyContextService.ts` (lignes 9-11, 36-58) :

```typescript
const LS_PLAN = 'dc_plan_comptable_entries';
const LS_TIERS = 'dc_tiers_entries';
const LS_JOURNAUX = 'dc_journal_entries';

export function getAccountingContext(companyId?: string): AccountingContext {
  const cid = companyId || currentCompanyId();
  const plan = readLS<PlanEntry>(LS_PLAN).filter((e) => !cid || e.companyId === cid);
  const tiers = readLS<TiersEntry>(LS_TIERS).filter((e) => !cid || e.companyId === cid);
  const journaux = readLS<JournalEntry>(LS_JOURNAUX).filter((e) => !cid || e.companyId === cid);
  // ...
}
```

**Conséquences** :
1. L'upload d'un plan comptable dans **Connaissances** (Firestore `knowledge_documents`) **NE REMPLIT PAS** `dc_plan_comptable_entries` (localStorage).
2. Les agents lisent `companyContextService.getAccountingContext()` → `hasPlan = false` → `contextStatus = 'GENERAL_ONLY'`.
3. Le prompt LLM reçoit l'avertissement : *"le plan interne n'est pas chargé"* même si l'utilisateur a uploadé un fichier dans Connaissances.
4. **Perte totale** au rechargement du navigateur ou changement de poste.

---

### (c) Le RAG est le mauvais outil pour un plan comptable

**Statut** : ✅ **CONFIRMÉ**

**Preuve** : `ragSearchCore` (functions/index.js:3856-3900) :
- Chunking : 800 caractères, overlap 100
- Seuil de score : 0.3 (vectoriel), 0.15 (lexical)
- TopK : 2 à 5 chunks maximum
- Recherche **sémantique** (cosinus sur embeddings) + repli lexical

**Problème** : Un plan comptable est une **table de référence structurée** :
- Codes exacts requis : `"401100"`, `"6044"`, `"706"`
- Intitulés exacts : `"Fournisseurs - Factures non parvenues"`
- Le sémantique échoue sur les codes : `"401100"` ≈ `"4011"` (pas de similarité cosinus)
- Le lexical pur manque la hiérarchie : `"401"` ne trouve pas `"401100"`

**Exemple concret** :
```
Requête : "compte 401100"
Chunks RAG : "Classe 4 : Comptes de tiers" (score 0.28 < 0.3 → filtré)
Résultat : []
```

**Outils requis** (non implémentés) :
- `plan.lookup({code|query, limit})` : recherche exacte + normalisée
- `tiers.find({name|ncc|code})` : recherche floue sur nom/NCC
- `journaux.list()` : liste exhaustive

---

## AUTRES CONSTATS

### 1. L'outil s'affiche "search" au lieu de "knowledge.search"

**Preuve** : Dans la trace d'outils (llmService.ts), le nom affiché est tronqué ou mappé incorrectement.

**Correction requise** : Afficher systématiquement le nom complet de l'outil (`knowledge.search`, `sheets.read_range`, etc.) dans la ligne "N outils :".

---

### 2. Aucune collection Firestore pour les données de référence

**État actuel** :
- `knowledge_documents` : documents non structurés (RAG)
- `conversations` : historiques de chat
- `tool_calls` : audit
- `wa_conversations` : WhatsApp

**Manquant** :
- `companies/{companyId}` : métadonnées entreprise
- `companies/{companyId}/accounts` : plan comptable
- `companies/{companyId}/tiers` : tiers
- `companies/{companyId}/journals` : journaux

---

### 3. SKILL.md non indexé au runtime

**Preuve** : 
```bash
grep -n "skill\|SKILL" /workspace/functions/index.js
# → aucun résultat
```

**Conséquence** : Quand un agent dit *"référencé dans mon SKILL.md"*, c'est une **hallucination** : le fichier n'est jamais chargé. Seules les instructions statiques du prompt (mockData.ts) sont disponibles.

---

### 4. Tâches et conversations en localStorage

**Preuve** :
- `src/services/taskEngine.ts` : `dc_intelligence_tasks` (localStorage)
- `src/App.tsx` : conversations hydratées depuis localStorage + miroir Firestore

**Conséquence** : Vider le navigateur → **perte totale** des tâches en cours, de l'historique non sync, du contexte entreprise.

---

## CONCLUSION

| Hypothèse | Statut | Impact |
|-----------|--------|--------|
| (a) .xlsx non extraits | ✅ Confirmé | Fichiers Excel uploadés = invisibles au RAG |
| (b) Contexte = localStorage | ✅ Confirmé | Upload Connaissances ≠ contexte comptable ; perte navigateur |
| (c) RAG inadapté aux tables | ✅ Confirmé | Codes comptables introuvables via search |

**Actions requises** (cf. Prompt 2) :
1. Ajouter extraction Excel (SheetJS) dans `extractIndexableText`
2. Créer collections Firestore `companies/*/accounts|tiers|journals`
3. Implémenter outils déterministes `plan.lookup`, `tiers.find`, `journaux.list`
4. Migrer localStorage → Firestore (tâches, contexte)
5. Indexer SKILL.md dans Firestore `skills/*`
6. Ajouter UI "Tester la recherche" dans Connaissances

---

## FICHIERS MODIFIÉS (à venir)

- `functions/index.js` : extraction Excel, routes `/api/companies/*`, outils `plan.*`
- `src/services/companyContextService.ts` : lire Firestore au lieu de localStorage
- `src/components/KnowledgeBaseView.tsx` : UI "Tester la recherche", import Excel
- `firestore.indexes.json` : index composites pour `accounts`, `tiers`
- `docs/DIAG_DONNEES.md` : ce document

---

**Prochaine étape** : Livraison Prompt 2 (modèle de données, outils, migration).

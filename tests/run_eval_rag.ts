/**
 * Éval RAG réel — logique backend (chunking/cosinus) + contrat front (fail-soft).
 * Le live (upload .txt -> indexed -> citation -> réindexation) est documenté
 * dans RECETTE_E2E.md (section RAG).
 */
// @ts-ignore - module CommonJS functions chargé tel quel
import testUtils from '../functions/index.js';
import { searchKnowledge } from '../src/services/storeApi';

const { chunkText, cosineSim } = testUtils.__testUtils as {
  chunkText: (t: string, size?: number, overlap?: number) => string[];
  cosineSim: (a: number[], b: number[]) => number;
};

async function main() {
  console.log('================================================================');
  console.log('DC INTELLIGENCE — RAG REEL (chunks, cosinus, fail-soft)');
  console.log('================================================================\n');
  let passed = 0;
  const total = 6;

  // 1. Chunking : découpe bornée, jamais de chunk vide.
  const longText = 'Première phrase sur la TVA. '.repeat(120);
  const chunks = chunkText(longText);
  const ok1 = chunks.length > 1 && chunks.every((c) => c.length > 0 && c.length <= 800);
  console.log(ok1 ? `  [RAG-01] SUCCES — ${chunks.length} chunks bornés` : '  [RAG-01] ECHEC — chunking');
  if (ok1) passed++;

  // 2. Texte court -> un seul chunk, texte vide -> zéro chunk.
  const ok2 = chunkText('Bonjour.').length === 1 && chunkText('   ').length === 0;
  console.log(ok2 ? '  [RAG-02] SUCCES — cas limites chunking' : '  [RAG-02] ECHEC — cas limites');
  if (ok2) passed++;

  // 3. Cosinus : identiques = 1, orthogonaux = 0, vecteurs vides = 0.
  const ok3 =
    Math.abs(cosineSim([1, 0, 0], [1, 0, 0]) - 1) < 1e-9 &&
    Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9 &&
    cosineSim([], []) === 0;
  console.log(ok3 ? '  [RAG-03] SUCCES — cosinus' : '  [RAG-03] ECHEC — cosinus');
  if (ok3) passed++;

  // 4. Front fail-soft : backend injoignable -> [] sans lever.
  (globalThis as any).fetch = async () => {
    throw new Error('network down');
  };
  let ok4 = false;
  try {
    const hits = await searchKnowledge('tva déductible');
    ok4 = Array.isArray(hits) && hits.length === 0;
  } catch {
    ok4 = false;
  }
  console.log(ok4 ? '  [RAG-04] SUCCES — search fail-soft []' : '  [RAG-04] ECHEC — search fail-soft');
  if (ok4) passed++;

  // 5. Front mapping : réponse serveur -> hits typés et bornés.
  (globalThis as any).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      results: [
        { docId: 'd1', title: 'CGI TVA', chunk: 'Article 355 : ...', score: 0.87 },
        { docId: 'd2', title: 'Guide', chunk: '...', score: 0.41 },
      ],
    }),
  });
  const hits = await searchKnowledge('tva', 2);
  const ok5 =
    hits.length === 2 && hits[0].docId === 'd1' && hits[0].title === 'CGI TVA' && hits[0].score === 0.87;
  console.log(ok5 ? '  [RAG-05] SUCCES — mapping hits' : `  [RAG-05] ECHEC — ${JSON.stringify(hits)}`);
  if (ok5) passed++;

  // 6. Query trop courte -> [] sans appel réseau.
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ ok: true, results: [] }) };
  };
  const short = await searchKnowledge('tv');
  const ok6 = short.length === 0 && calls === 0;
  console.log(ok6 ? '  [RAG-06] SUCCES — garde query courte' : '  [RAG-06] ECHEC — garde query');
  if (ok6) passed++;

  console.log('\n----------------------------------------------------------------');
  console.log(`RESULTAT RAG : ${passed}/${total}`);
  console.log('----------------------------------------------------------------');
  if (passed < total) {
    console.log('SEUIL NON ATTEINT — REVISIONS REQUISES.');
    process.exitCode = 1;
  } else {
    console.log('RAG OK (live serveur : voir RECETTE_E2E.md).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

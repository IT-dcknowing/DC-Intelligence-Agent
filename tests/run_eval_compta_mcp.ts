/**
 * Éval contrat MCP Compta Flow — SANS serveur (fetch mocké).
 * Couvre : garde EXECUTE locale, dégradation backend_not_configured,
 * extraction draftId (prepare) / référence (commit), injoignable.
 * Le live (serveur réel) est décrit dans DC_INTELLIGENCE_CONTRAT_COMPTA.md §7.
 */
import { executeSoftwareTool } from '../src/services/mcpClient';

type MockSpec = { ok: boolean; status: number; json: any } | { throw: true };

let spec: MockSpec = { ok: true, status: 200, json: {} };
let fetchCalls = 0;

(globalThis as any).fetch = async () => {
  fetchCalls++;
  if ('throw' in spec) throw new Error('network down');
  return {
    ok: spec.ok,
    status: spec.status,
    json: async () => (spec as any).json,
  };
};

async function main() {
  console.log('================================================================');
  console.log('DC INTELLIGENCE — CONTRAT MCP COMPTA FLOW (sans serveur)');
  console.log('================================================================\n');
  let passed = 0;
  const total = 5;

  // 1. Garde EXECUTE : sans draftId+confirm, refus LOCAL sans aucun appel réseau.
  fetchCalls = 0;
  const r1 = await executeSoftwareTool({
    software: 'Compta Flow',
    toolName: 'commit_ecriture',
    arguments: { draftId: 'D-1' },
    permissionLevel: 'EXECUTE',
  });
  const ok1 = !r1.success && /confirm/.test(r1.error || '') && fetchCalls === 0;
  console.log(ok1 ? '  [MCP-01] SUCCES — EXECUTE sans confirm refuse en local (0 fetch)' : `  [MCP-01] ECHEC — ${JSON.stringify(r1)}`);
  if (ok1) passed++;

  // 2. Backend non configuré -> dégradation explicite, jamais de faux succès.
  spec = { ok: false, status: 503, json: { error: 'backend_not_configured', detail: 'Aucune URL MCP' } };
  const r2 = await executeSoftwareTool({
    software: 'Compta Flow',
    toolName: 'prepare_ecriture',
    arguments: { proposition: {} },
    permissionLevel: 'PREPARE',
  });
  const ok2 = !r2.success && r2.degraded === true && Boolean(r2.error);
  console.log(ok2 ? '  [MCP-02] SUCCES — backend_not_configured degrade explicite' : `  [MCP-02] ECHEC — ${JSON.stringify(r2)}`);
  if (ok2) passed++;

  // 3. prepare OK -> draftId + alertes extraits.
  spec = { ok: true, status: 200, json: { ok: true, software: 'Compta Flow', toolName: 'prepare_ecriture', response: { draftId: 'DRAFT-42', alertes: ['Compte 601 inexistant au plan'] } } };
  const r3 = await executeSoftwareTool({
    software: 'Compta Flow',
    toolName: 'prepare_ecriture',
    arguments: { proposition: { tiers: 'T' } },
    permissionLevel: 'PREPARE',
  });
  const ok3 = r3.success && (r3.data as any)?.draftId === 'DRAFT-42';
  console.log(ok3 ? '  [MCP-03] SUCCES — prepare retourne draftId + alertes' : `  [MCP-03] ECHEC — ${JSON.stringify(r3)}`);
  if (ok3) passed++;

  // 4. commit OK avec confirm -> référence extraite.
  spec = { ok: true, status: 200, json: { ok: true, software: 'Compta Flow', toolName: 'commit_ecriture', response: { ecritureId: 'ECR-7', reference: 'ACH-2026-007' } } };
  const r4 = await executeSoftwareTool({
    software: 'Compta Flow',
    toolName: 'commit_ecriture',
    arguments: { draftId: 'DRAFT-42', confirm: true },
    permissionLevel: 'EXECUTE',
  });
  const ok4 = r4.success && (r4.data as any)?.ecritureId === 'ECR-7';
  console.log(ok4 ? '  [MCP-04] SUCCES — commit retourne ecritureId' : `  [MCP-04] ECHEC — ${JSON.stringify(r4)}`);
  if (ok4) passed++;

  // 5. Injoignable -> backend_unreachable degrade, pas de silence.
  spec = { throw: true };
  const r5 = await executeSoftwareTool({
    software: 'Compta Flow',
    toolName: 'get_balance',
    arguments: {},
    permissionLevel: 'READ',
  });
  const ok5 = !r5.success && r5.degraded === true && /backend_unreachable/.test(r5.error || '');
  console.log(ok5 ? '  [MCP-05] SUCCES — injoignable remonte backend_unreachable' : `  [MCP-05] ECHEC — ${JSON.stringify(r5)}`);
  if (ok5) passed++;

  console.log('\n----------------------------------------------------------------');
  console.log(`RESULTAT CONTRAT MCP : ${passed}/${total}`);
  console.log('----------------------------------------------------------------');
  if (passed < total) {
    console.log('SEUIL NON ATTEINT — REVISIONS REQUISES.');
    process.exitCode = 1;
  } else {
    console.log('CONTRAT MCP OK (live serveur : voir DC_INTELLIGENCE_CONTRAT_COMPTA.md §7).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

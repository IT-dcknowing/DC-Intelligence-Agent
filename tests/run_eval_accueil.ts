import fs from 'fs';
import path from 'path';
import { routeUserRequest } from '../src/services/routerAgent';
import { buildIdentityLockedPrompt } from '../src/services/llmService';
import { isFrustratedText } from '../src/services/storeApi';

interface AccCase {
  id: string;
  description: string;
  input: string;
  attendu: {
    domain?: string;
    targetAgentId?: string;
    requiresClarification?: boolean;
    frustrated?: boolean;
  };
}

async function runAccueilEval() {
  console.log('================================================================');
  console.log('DC INTELLIGENCE — ACCEPTATION FRONT CANAL WEB (refonte Accueil)');
  console.log('================================================================\n');

  const jsonPath = path.resolve('./tests/eval_accueil_front.json');
  const cases: AccCase[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  let passed = 0;
  for (const tc of cases) {
    const problems: string[] = [];
    const routed = routeUserRequest(tc.input);
    if (tc.attendu.domain && routed.domain !== tc.attendu.domain) {
      problems.push(`domain=${routed.domain} (attendu ${tc.attendu.domain})`);
    }
    if (tc.attendu.targetAgentId && routed.targetAgentId !== tc.attendu.targetAgentId) {
      problems.push(`target=${routed.targetAgentId} (attendu ${tc.attendu.targetAgentId})`);
    }
    if (tc.attendu.requiresClarification !== undefined && routed.requiresClarification !== tc.attendu.requiresClarification) {
      problems.push(`clarification=${routed.requiresClarification}`);
    }
    if (tc.attendu.frustrated !== undefined) {
      const got = isFrustratedText(tc.input);
      if (got !== tc.attendu.frustrated) problems.push(`frustrated=${got}`);
    }
    if (problems.length === 0) {
      console.log(`  [${tc.id}] SUCCES — ${tc.description}`);
      passed++;
    } else {
      console.log(`  [${tc.id}] ECHEC — ${tc.description} :: ${problems.join(' | ')}`);
    }
  }

  // Verrou d'identité : le prompt front ne doit jamais usurper l'identité spécialiste.
  const locked = buildIdentityLockedPrompt('Base.', {
    name: 'Agent Comptabilité',
    role: 'Comptable',
    instructions: 'TVA 18%.',
  });
  const lockOk =
    locked.includes('IDENTITÉ VERROUILLÉE') &&
    locked.includes('Contexte d’expertise fourni par') &&
    !locked.includes("Nom de l'agent:");
  console.log(lockOk ? '  [LOCK] SUCCES — verrou identite front' : '  [LOCK] ECHEC — verrou identite front');
  if (lockOk) passed++;

  const total = cases.length + 1;
  console.log('\n----------------------------------------------------------------');
  console.log(`RESULTAT ACCEPTATION FRONT : ${passed}/${total}`);
  console.log('----------------------------------------------------------------');
  if (passed < total) {
    console.log('SEUIL NON ATTEINT — REVISIONS REQUISES.');
    process.exitCode = 1;
  } else {
    console.log('ACCEPTATION FRONT OK.');
  }
}

runAccueilEval().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

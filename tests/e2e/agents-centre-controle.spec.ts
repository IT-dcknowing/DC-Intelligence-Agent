import { test, expect } from '@playwright/test';
import { createFakeDb, installFakeBackend } from './helpers/fake-backend';
import { openApp, gotoAgents, gotoConversations, sendChatMessage } from './helpers/nav';

const MARKER = 'TEST_E2E_123';

/**
 * Test A : la page Agents est-elle un vrai centre de contrôle ?
 * Éditer le Prompt Système de l'Accueil -> Enregistrer -> reload ->
 * la valeur doit survivre (persistance UI via GET /api/agents).
 */
test('agents : édition du prompt accueil persistée après reload', async ({ page }) => {
  const db = createFakeDb();
  await installFakeBackend(page, db);
  await openApp(page);
  await gotoAgents(page);

  await page.locator('#agent-card-agent-router').click();
  const box = page.locator('#agent-instructions-input');
  await expect(box).toBeVisible({ timeout: 15000 });
  const before = await box.inputValue();
  await box.fill(`${before}\n${MARKER}`);

  const putPromise = page.waitForResponse(
    (r) => r.url().includes('/api/agents/agent-router') && r.request().method() === 'PUT'
  );
  await page.locator('#btn-save-agent').click();
  await putPromise;

  await page.reload();
  await openApp(page);
  await gotoAgents(page);
  await page.locator('#agent-card-agent-router').click();
  await expect(page.locator('#agent-instructions-input')).toHaveValue(new RegExp(MARKER), {
    timeout: 15000,
  });
});

/**
 * Test A (optionnel) : le moteur lit-il vraiment la DB ?
 * Après reload, un message restant sur l'accueil doit produire une réponse
 * contenant le marqueur (le prompt système vient de la config persistée).
 */
test('agents : le moteur lit la config persistée', async ({ page }) => {
  const db = createFakeDb();
  // Pré-persiste comme si l'édition précédente avait eu lieu.
  const accueil = db.agents.find((a) => a.id === 'agent-router');
  accueil.instructions = `${accueil.instructions}\n${MARKER}`;
  await installFakeBackend(page, db);
  await openApp(page);
  await gotoConversations(page);

  // "aide" reste sur l'accueil (clarification, pas de délégation) : le prompt
  // système de la réponse = les instructions de l'accueil persisté.
  await sendChatMessage(page, 'aide');
  await expect(page.getByText(new RegExp(MARKER)).last()).toBeVisible({ timeout: 30000 });
});

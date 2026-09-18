import { test, expect } from '@playwright/test';
import { createFakeDb, installFakeBackend } from './helpers/fake-backend';
import { openApp, gotoConversations, sendChatMessage } from './helpers/nav';

/**
 * Test C : le routage fonctionne-t-il ?
 * « Je veux parler à l'agent comptable » doit déclencher une délégation
 * explicite vers l'Agent Comptabilité (message visible + contexte moteur).
 */
test('routage : demande agent comptable -> délégation visible', async ({ page }) => {
  const db = createFakeDb();
  await installFakeBackend(page, db);
  await openApp(page);
  await gotoConversations(page);

  await sendChatMessage(page, "Je veux parler à l'agent comptable");

  // Preuve UI directe : l'accueil annonce la délégation au bon spécialiste.
  await expect(page.getByText(/Je vais demander à notre agent comptabilité/i).first()).toBeVisible({
    timeout: 30000,
  });
  // Preuve moteur : le contexte spécialiste transmis contient le bon agent.
  await expect(page.getByText(/Agent: Agent Comptabilité/).last()).toBeVisible({
    timeout: 30000,
  });
});

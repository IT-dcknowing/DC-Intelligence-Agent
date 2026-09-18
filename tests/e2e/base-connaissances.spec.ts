import { test, expect } from '@playwright/test';
import { createFakeDb, installFakeBackend } from './helpers/fake-backend';
import { openApp, gotoKnowledge, gotoConversations, sendChatMessage } from './helpers/nav';

const DOC_TITLE = 'note-banana';
const DOC_CONTENT = 'Le mot de passe de test est BANANA. Document de test e2e uniquement.';

/**
 * Test B : la Base de Connaissances est-elle branchée ?
 * Upload réel (input file) -> visible -> reload -> toujours visible (persistance),
 * puis question chat -> le RAG remonte le chunk et la réponse contient BANANA.
 */
test('connaissances : upload persiste après reload et alimente le chat (RAG)', async ({
  page,
}) => {
  const db = createFakeDb();
  await installFakeBackend(page, db);
  await openApp(page);
  await gotoKnowledge(page);

  const uploadPromise = page.waitForResponse(
    (r) => r.url().includes('/api/knowledge/upload') && r.request().method() === 'POST'
  );
  await page
    .locator('#knowledge-base-shell input[type="file"]')
    .setInputFiles([
      { name: 'note-banana.txt', mimeType: 'text/plain', buffer: Buffer.from(DOC_CONTENT, 'utf-8') },
    ]);
  await uploadPromise;
  await expect(page.getByText(DOC_TITLE).first()).toBeVisible({ timeout: 15000 });

  // Persistance UI : reload puis revérification via GET /api/knowledge.
  await page.reload();
  await openApp(page);
  await gotoKnowledge(page);
  await expect(page.getByText(DOC_TITLE).first()).toBeVisible({ timeout: 15000 });

  // Câblage RAG : la question doit faire remonter le chunk dans la réponse.
  await gotoConversations(page);
  await sendChatMessage(page, 'Quel est le mot de passe de test ?');
  await expect(page.getByText(/Mot de passe trouvé : BANANA/).last()).toBeVisible({
    timeout: 30000,
  });
});

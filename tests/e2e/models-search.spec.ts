import { test, expect, Browser } from '@playwright/test';

// Recherche du catalogue modèles (Paramètres > Modèles) avec catalogue seedé.
// Aucun appel réseau : les modèles viennent du localStorage (clé custom models).
const CUSTOM_MODELS_KEY = 'compta_flow_custom_models';

async function seededPage(browser: Browser) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((key: string) => {
    window.localStorage.setItem(
      key,
      JSON.stringify([
        {
          id: 'test-nex-mini',
          name: 'Nex Test Mini',
          provider: 'openrouter',
          isFree: true,
          description: 'modèle factice pour le test de recherche',
          isCustom: true,
        },
      ])
    );
  }, CUSTOM_MODELS_KEY);
  return ctx.newPage();
}

test('recherche modeles : filtre nom puis etat vide', async ({ browser }) => {
  const page = await seededPage(browser);
  await page.goto('/');
  await page.getByRole('button', { name: 'Paramètres' }).first().click();
  await page.getByRole('button', { name: /Modèles/ }).first().click();

  const search = page.getByPlaceholder(/Rechercher un modèle/i);
  await expect(search).toBeVisible();

  await search.fill('nex');
  await expect(page.getByText('Nex Test Mini').first()).toBeVisible();

  await search.fill('zzz-introuvable');
  await expect(page.getByText(/Aucun modèle ne correspond/i)).toBeVisible();

  await page.close();
});

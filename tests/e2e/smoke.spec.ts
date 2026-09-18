import { test, expect } from '@playwright/test';

// Smoke test : l'Agent Studio démarre et la navigation est complète.
test('accueil : titre + navigation principale', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/DC INTELLIGENCE/i);
  await expect(page.getByRole('button', { name: 'Conversations' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agents' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Moteur/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connaissances' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connexions' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paramètres' }).first()).toBeVisible();
});

test('navigation : chaque onglet affiche sa vue', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agents' }).first().click();
  await expect(page.getByText(/agents déployés?/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Connaissances' }).first().click();
  await expect(page.getByText(/Référentiels/i).first()).toBeVisible();
});

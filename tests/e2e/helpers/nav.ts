import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Ouvre l'app et attend que le shell soit prêt (hydratation terminée). */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Conversations' }).first()).toBeVisible({
    timeout: 30000,
  });
}

export async function gotoAgents(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agents' }).first().click();
  await expect(page.locator('#agent-list-container')).toBeVisible({ timeout: 15000 });
}

export async function gotoKnowledge(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connaissances' }).first().click();
  await expect(page.locator('#knowledge-base-shell')).toBeVisible({ timeout: 15000 });
}

export async function gotoConversations(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Conversations' }).first().click();
  await expect(page.getByPlaceholder(/Posez votre question/i)).toBeVisible({ timeout: 30000 });
}

/** Remplit le composer et envoie via Entrée. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  const box = page.getByPlaceholder(/Posez votre question/i);
  await expect(box).toBeVisible({ timeout: 30000 });
  await box.fill(text);
  await box.press('Enter');
}

import { defineConfig } from '@playwright/test';

// Navigateur : téléchargement direct bloqué sur ce poste -> on réutilise
// le Chrome for Testing déjà présent (chromium-1234). Si `npx playwright
// install chromium` refonctionne un jour, retirer executablePath.
const CHROME_EXECUTABLE =
  'C:/Users/alexm/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: { executablePath: CHROME_EXECUTABLE },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 3100 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'dc-studio', use: {} }],
});

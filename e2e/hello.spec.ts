import { test, expect } from '@playwright/test';

test('sidebar webview renders the hello message', async ({ page }) => {
  await page.goto('/');

  // Wait for the workbench to finish booting.
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open our Activity Bar container ("Annotated").
  await page
    .locator('.activitybar')
    .getByRole('tab', { name: /Annotated/i })
    .click();

  // Drill into the nested webview iframes: outer .webview -> inner #active-frame.
  const frame = page
    .locator('iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();

  await expect(frame.getByTestId('hello')).toHaveText(/Annotated is alive/, { timeout: 30_000 });
});

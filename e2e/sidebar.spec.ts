import { test, expect } from '@playwright/test';

test('sidebar renders a group card from the workspace', async ({ page }) => {
  await page.goto('/');

  // Wait for the workbench to boot.
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open the Annotated activity-bar container.
  await page
    .locator('.activitybar')
    .getByRole('tab', { name: /Annotated/i })
    .click();

  // Drill into the nested webview iframes and assert the seeded group card renders.
  const frame = page
    .locator('iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();

  await expect(frame.getByTestId('group-card')).toContainText('Seed Group', { timeout: 30_000 });
});

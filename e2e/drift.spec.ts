import { test, expect } from '@playwright/test';

test('a stale annotation shows the stale banner', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  // The seed annotation's stored contentHash ("seed") doesn't match README.md → stale dot in the list.
  await expect(detail.getByTestId('stale-dot')).toBeVisible({ timeout: 30_000 });
  // Open it → stale banner in the annotation view.
  await detail.getByTestId('annotation-row').click();
  await expect(detail.getByTestId('stale-banner')).toBeVisible({ timeout: 30_000 });
});

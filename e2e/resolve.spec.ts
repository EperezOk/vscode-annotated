import { test, expect } from '@playwright/test';

test('resolve then restore a group from the detail panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').first().click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  const btn = detail.getByTestId('resolve-btn');
  await expect(btn).toHaveText('Resolve', { timeout: 30_000 });
  await btn.click();
  await expect(detail.getByTestId('resolve-btn')).toHaveText('Restore', { timeout: 30_000 });
  await detail.getByTestId('resolve-btn').click();
  await expect(detail.getByTestId('resolve-btn')).toHaveText('Resolve', { timeout: 30_000 });
});

import { test, expect } from '@playwright/test';

test('inline-editing the group title persists and reflects', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  await detail.getByTestId('title-edit-btn').click();
  const input = detail.getByTestId('title-input');
  await input.fill('Renamed Seed');
  await input.press('Enter');

  await expect(detail.getByTestId('detail-title')).toHaveText('Renamed Seed', { timeout: 30_000 });
});

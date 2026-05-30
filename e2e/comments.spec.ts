import { test, expect } from '@playwright/test';

test('the comment thread renders in the annotation view', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').first().contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').first().click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  await detail.getByTestId('annotation-row').first().click();
  await expect(detail.getByTestId('comment-thread')).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByTestId('comment-reply-trigger')).toBeVisible();
});

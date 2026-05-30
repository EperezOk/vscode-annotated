import { test, expect } from '@playwright/test';

test('clicking Edit shows the CodeMirror editor', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();
  await detail.getByTestId('annotation-row').click();

  // Seed annotation has content → opens in preview; click Edit to reveal the editor.
  await detail.getByTestId('edit-btn').click();

  // CodeMirror renders .cm-editor inside the md-editor host, loaded with the content.
  await expect(detail.locator('[data-testid="md-editor"] .cm-editor')).toBeVisible({ timeout: 30_000 });
  await expect(detail.locator('[data-testid="md-editor"] .cm-content')).toContainText('Seed annotation', { timeout: 30_000 });
});

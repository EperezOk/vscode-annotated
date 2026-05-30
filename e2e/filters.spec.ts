import { test, expect } from '@playwright/test';

test('show-resolved reveals the resolved group with a badge', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page
    .locator('iframe.webview')
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();

  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });
  await expect(sidebar.getByTestId('group-card')).toHaveCount(1);

  await sidebar.getByTestId('show-resolved').click();
  await expect(sidebar.getByTestId('group-card')).toHaveCount(2);
  await expect(sidebar.getByTestId('resolved-badge')).toBeVisible();
});

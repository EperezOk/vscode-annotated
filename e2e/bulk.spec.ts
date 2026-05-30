import { test, expect } from '@playwright/test';

test('bulk-select mode: checkboxes, action bar, and a live count', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();

  const sidebar = page.locator('iframe.webview').contentFrame().locator('iframe#active-frame').contentFrame();
  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });

  await sidebar.getByTestId('show-resolved').click();
  await expect(sidebar.getByTestId('group-card')).toHaveCount(2);

  await sidebar.getByTestId('bulk-toggle').click();
  await expect(sidebar.getByTestId('bulk-action-bar')).toBeVisible();
  await expect(sidebar.getByTestId('bulk-checkbox')).toHaveCount(2);
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('0 selected');

  await sidebar.getByTestId('group-card').nth(0).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('1 selected');
  await sidebar.getByTestId('group-card').nth(1).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('2 selected');

  await sidebar.getByTestId('group-card').nth(0).click();
  await expect(sidebar.getByTestId('bulk-count')).toHaveText('1 selected');
  await sidebar.getByTestId('bulk-toggle').click();
  await expect(sidebar.getByTestId('bulk-action-bar')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

test("prev/next steps through a group's annotations", async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await expect(sidebar.getByTestId('filter-bar')).toBeVisible({ timeout: 30_000 });

  // Reveal the resolved seed group (3 annotations) and open it.
  await sidebar.getByTestId('show-resolved').click();
  await sidebar.getByTestId('group-card').filter({ hasText: 'Resolved Group' }).click();

  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();

  await expect(detail.getByTestId('annotation-row')).toHaveCount(3, { timeout: 30_000 });
  await detail.getByTestId('annotation-row').first().click();

  await expect(detail.getByTestId('position-info')).toHaveText('1 / 3', { timeout: 30_000 });
  await expect(detail.getByTestId('prev-btn')).toBeDisabled();
  await expect(detail.getByTestId('next-btn')).toBeEnabled();

  await detail.getByTestId('next-btn').click();
  await expect(detail.getByTestId('position-info')).toHaveText('2 / 3');
  await expect(detail.getByTestId('prev-btn')).toBeEnabled();
});

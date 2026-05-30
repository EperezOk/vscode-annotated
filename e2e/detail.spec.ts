import { test, expect } from '@playwright/test';

test('clicking a sidebar card shows the group in the detail panel', async ({ page }) => {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });

  // Open the Annotated sidebar and click the seeded group card.
  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  // In @vscode/test-web the webview iframes are absolutely-positioned siblings of
  // .part.sidebar (not children), so we select by order rather than by part class.
  const sidebar = page
    .locator('iframe.webview')
    .first()
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();
  await sidebar.getByTestId('group-card').waitFor({ state: 'visible', timeout: 30_000 });
  await sidebar.getByTestId('group-card').click();

  // The detail panel (secondary side bar) should now show the group view.
  // The detail iframe is the second iframe.webview that appears after the click.
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2, { timeout: 15_000 });
  const detail = page
    .locator('iframe.webview')
    .nth(1)
    .contentFrame()
    .locator('iframe#active-frame')
    .contentFrame();
  await expect(detail.getByTestId('detail-title')).toHaveText(/Seed Group/, { timeout: 30_000 });
  await expect(detail.getByTestId('annotation-row')).toHaveCount(1);
});

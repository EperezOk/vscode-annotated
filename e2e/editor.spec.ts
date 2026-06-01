import { test, expect } from '@playwright/test';

/** Open the seed group's first annotation in the detail panel and click Edit. */
async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.activitybar').getByRole('tab', { name: /Annotated/i }).click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 1);
  const sidebar = page.locator('iframe.webview').nth(0).contentFrame().locator('iframe#active-frame').contentFrame();
  await sidebar.getByTestId('group-card').click();
  await page.waitForFunction(() => document.querySelectorAll('iframe.webview').length >= 2);
  const detail = page.locator('iframe.webview').nth(1).contentFrame().locator('iframe#active-frame').contentFrame();
  await detail.getByTestId('annotation-row').click();
  await detail.getByTestId('edit-btn').click();
  await expect(detail.locator('[data-testid="md-editor"] .cm-content')).toBeVisible({ timeout: 30_000 });
  return detail;
}

test('markdown headings render bold (theme-aware highlighting is applied)', async ({ page }) => {
  const detail = await openEditor(page);
  const content = detail.locator('[data-testid="md-editor"] .cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('# Heading');
  // Some token span is rendered bold by markdownHighlightStyle, and it covers the heading text.
  const boldText = await detail.locator('[data-testid="md-editor"] .cm-content span').evaluateAll(
    (els) => els.filter((e) => Number(getComputedStyle(e).fontWeight) >= 700).map((e) => e.textContent ?? '').join(''),
  );
  expect(boldText).toContain('Heading');
});

test('clicking the blank area below the text focuses the editor with the cursor at the end', async ({ page }) => {
  const detail = await openEditor(page);
  const content = detail.locator('[data-testid="md-editor"] .cm-content');
  // Click low in the editor host — below the (short) seed content, in the filled blank area.
  await detail.locator('[data-testid="md-editor"]').click({ position: { x: 12, y: 150 } });
  await page.keyboard.type('Z_END');
  const after = (await content.textContent()) ?? '';
  expect(after.endsWith('Z_END')).toBe(true); // cursor landed at the end → text appended there
});

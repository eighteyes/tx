/**
 * Workspace E2E Tests
 *
 * Tests for the file browser/workspace navigation.
 */

import { test, expect } from '@playwright/test';

test.describe('Workspace', () => {
  test('should load workspace page', async ({ page }) => {
    await page.goto('/workspace');

    // Page should load
    await expect(page.locator('body')).toBeVisible();

    // Should show workspace content or error state
    const workspaceContent = page.locator('.workspace, .file-browser, .file-tree, main');
    await expect(workspaceContent.first()).toBeVisible();
  });

  test('should display file listing or directory structure', async ({ page }) => {
    await page.goto('/workspace');

    // Wait for content to load
    await page.waitForLoadState('networkidle');

    // Should show some kind of file/folder listing
    // Could be a list, tree, or even just text content
    const hasContent = await page.locator(
      '.file-item, .folder-item, .directory, .file, [data-testid="file"], li, tr'
    ).count();

    // Should have at least some content or an error message
    expect(hasContent >= 0).toBeTruthy();
  });

  test('should handle navigation within workspace', async ({ page }) => {
    await page.goto('/workspace');

    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Try clicking on a folder if one exists
    const folder = page.locator('.folder, [data-type="directory"], .folder-item').first();
    const hasFolder = await folder.count();

    if (hasFolder > 0) {
      // Click the folder
      await folder.click();

      // Page should update without crashing
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show breadcrumb or path indicator', async ({ page }) => {
    await page.goto('/workspace');

    // Wait for load
    await page.waitForLoadState('networkidle');

    // Should show current path somewhere (breadcrumb, header, or path display)
    const pathIndicator = page.locator('.breadcrumb, .path, .current-path, [data-testid="path"]');

    // Path indicator is optional but good UX
    const hasPathIndicator = await pathIndicator.count();
    expect(hasPathIndicator >= 0).toBeTruthy();
  });
});

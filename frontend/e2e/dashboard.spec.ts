/**
 * Dashboard E2E Tests
 *
 * Tests for the main dashboard page loading and rendering correctly.
 */

import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('should load the dashboard page', async ({ page }) => {
    await page.goto('/');

    // Wait for dashboard to load
    await expect(page).toHaveTitle(/TX/i);

    // Dashboard should have main content area
    await expect(page.locator('main, [role="main"], .dashboard, .layout')).toBeVisible();
  });

  test('should display navigation elements', async ({ page }) => {
    await page.goto('/');

    // Should have navigation links
    const nav = page.locator('nav, .navigation, .nav');
    await expect(nav).toBeVisible();

    // Should have links to main sections
    await expect(page.getByRole('link', { name: /mesh/i })).toBeVisible();
  });

  test('should show dashboard statistics or welcome message', async ({ page }) => {
    await page.goto('/');

    // Either stats cards or some content should be visible
    // This is flexible since dashboard content may vary
    const content = page.locator('.dashboard, .stats, main');
    await expect(content).toBeVisible();
  });
});

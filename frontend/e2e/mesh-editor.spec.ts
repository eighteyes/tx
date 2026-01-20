/**
 * Mesh Editor E2E Tests
 *
 * Tests for the mesh configuration editor.
 */

import { test, expect } from '@playwright/test';

test.describe('Mesh Editor', () => {
  // Skip if no meshes exist - this test requires at least one mesh
  test('should open mesh editor for existing mesh', async ({ page }) => {
    // First check if there are any meshes
    const response = await page.request.get('/v1/meshes');

    if (!response.ok()) {
      test.skip(true, 'Server not available');
      return;
    }

    const meshes = await response.json();

    if (!meshes || meshes.length === 0) {
      test.skip(true, 'No meshes available to edit');
      return;
    }

    // Navigate to first mesh editor
    const meshName = meshes[0].name || meshes[0];
    await page.goto(`/meshes/${meshName}`);

    // Editor should load
    await expect(page.locator('body')).toBeVisible();

    // Should show editor content (Monaco editor or form)
    const editorContent = page.locator(
      '.monaco-editor, .yaml-editor, .mesh-editor, .mesh-form, form, textarea'
    );
    await expect(editorContent.first()).toBeVisible({ timeout: 10000 });
  });

  test('should display mesh name in editor', async ({ page }) => {
    const response = await page.request.get('/v1/meshes');

    if (!response.ok()) {
      test.skip(true, 'Server not available');
      return;
    }

    const meshes = await response.json();

    if (!meshes || meshes.length === 0) {
      test.skip(true, 'No meshes available');
      return;
    }

    const meshName = meshes[0].name || meshes[0];
    await page.goto(`/meshes/${meshName}`);

    // Mesh name should appear somewhere on the page
    await expect(page.getByText(meshName, { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test('should have save functionality', async ({ page }) => {
    const response = await page.request.get('/v1/meshes');

    if (!response.ok()) {
      test.skip(true, 'Server not available');
      return;
    }

    const meshes = await response.json();

    if (!meshes || meshes.length === 0) {
      test.skip(true, 'No meshes available');
      return;
    }

    const meshName = meshes[0].name || meshes[0];
    await page.goto(`/meshes/${meshName}`);

    // Look for save button
    const saveButton = page.getByRole('button', { name: /save/i });

    // Save button should exist (may be disabled initially)
    await expect(saveButton).toBeVisible({ timeout: 10000 });
  });
});

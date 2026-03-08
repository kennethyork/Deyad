/**
 * E2E tests for Deyad's renderer UI.
 *
 * These tests use Playwright with Electron's _electron API to launch the
 * actual Electron app and interact with it. If the Electron build is not
 * available, they fall back to testing the renderer in a browser context.
 *
 * Run with: npx playwright test
 */
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

let electronApp: ElectronApplication;
let page: Page;

// Path to the Electron main entry (built by Vite/Forge)
const MAIN_PATH = path.resolve(__dirname, '..', '.vite', 'build', 'main.js');

test.beforeAll(async () => {
  // Check if the built main.js exists
  if (!fs.existsSync(MAIN_PATH)) {
    test.skip();
    return;
  }

  electronApp = await _electron.launch({
    args: [MAIN_PATH],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  page = await electronApp.firstWindow();
  // Wait for the renderer to load
  await page.waitForLoadState('domcontentloaded');
  // Give React time to mount
  await page.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close();
  }
});

test.describe('App Shell', () => {
  test('renders the sidebar with Deyad branding', async () => {
    const logo = page.locator('.sidebar-logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveText('Deyad');
  });

  test('shows the + button and Import button', async () => {
    const newBtn = page.locator('.btn-new-app');
    await expect(newBtn).toBeVisible();
    await expect(newBtn).toHaveText('+');

    const importBtn = page.locator('.btn-import-app');
    await expect(importBtn).toBeVisible();
  });

  test('shows Settings button in sidebar footer', async () => {
    const settingsBtn = page.locator('.sidebar-settings-btn');
    await expect(settingsBtn).toBeVisible();
    await expect(settingsBtn).toHaveText('Settings');
  });

  test('shows empty state when no app is selected', async () => {
    const emptyState = page.locator('.empty-state-content');
    // If there are no apps, we should see the empty state or the sidebar empty message
    const sidebarEmpty = page.locator('.sidebar-empty');
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    const hasSidebarEmpty = await sidebarEmpty.isVisible().catch(() => false);
    expect(hasEmpty || hasSidebarEmpty).toBeTruthy();
  });
});

test.describe('New App Modal', () => {
  test('opens and closes the new app modal', async () => {
    // Click the + button
    await page.locator('.btn-new-app').click();

    // Modal should appear
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Should have the "New App" heading
    await expect(page.locator('.modal-header h2')).toHaveText('New App');

    // Should show template grid
    const templateGrid = page.locator('.template-grid');
    await expect(templateGrid).toBeVisible();

    // Should have at least 10 templates
    const templateCards = page.locator('.template-card');
    const count = await templateCards.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // Close the modal
    await page.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });

  test('can select a template and fill in app name', async () => {
    await page.locator('.btn-new-app').click();

    // Click the "Todo List" template
    const todoTemplate = page.locator('.template-card', { hasText: 'Todo List' });
    await todoTemplate.click();

    // The name field should be populated
    const nameInput = page.locator('#app-name');
    await expect(nameInput).toHaveValue('Todo List');

    // Close without creating
    await page.locator('.btn-secondary', { hasText: 'Cancel' }).click();
  });
});

test.describe('Settings Modal', () => {
  test('opens and closes settings', async () => {
    await page.locator('.sidebar-settings-btn').click();

    // Settings modal should appear
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('.modal-header h2')).toHaveText('Settings');

    // Should have Ollama host input
    const hostInput = page.locator('input[placeholder*="localhost"]');
    const hasHost = await hostInput.isVisible().catch(() => false);
    expect(hasHost).toBeTruthy();

    // Close
    await page.locator('.modal-close').click();
    await expect(modal).not.toBeVisible();
  });
});

test.describe('App Creation Flow', () => {
  test('can create a new frontend app', async () => {
    await page.locator('.btn-new-app').click();

    // Fill in name
    const nameInput = page.locator('#app-name');
    await nameInput.fill('E2E Test App');

    // Ensure frontend type is selected (default)
    const frontendCard = page.locator('.type-card', { hasText: 'Frontend Only' });
    await expect(frontendCard).toHaveClass(/selected/);

    // Click Create App
    await page.locator('.btn-primary', { hasText: 'Create App' }).click();

    // Modal should close
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 5000 });

    // The app should appear in the sidebar
    const sidebarItem = page.locator('.sidebar-item-name', { hasText: 'E2E Test App' });
    await expect(sidebarItem).toBeVisible({ timeout: 5000 });

    // Chat panel should be visible
    const chatPanel = page.locator('.chat-panel');
    await expect(chatPanel).toBeVisible();

    // Welcome message should show
    const welcome = page.locator('.chat-welcome-title');
    await expect(welcome).toContainText('Frontend App');
  });

  test('planning mode toggle works', async () => {
    // Find the plan mode button
    const planBtn = page.locator('.btn-plan-mode');
    await expect(planBtn).toBeVisible();
    await expect(planBtn).not.toHaveClass(/active/);

    // Toggle on
    await planBtn.click();
    await expect(planBtn).toHaveClass(/active/);
    await expect(planBtn).toContainText('Plan ON');

    // Toggle off
    await planBtn.click();
    await expect(planBtn).not.toHaveClass(/active/);
    await expect(planBtn).toContainText('Plan');
  });

  test('can delete the test app', async () => {
    // Find the delete button for our test app
    const sidebarItem = page.locator('.sidebar-item', { hasText: 'E2E Test App' });
    const deleteBtn = sidebarItem.locator('.sidebar-delete');

    // First click arms it
    await deleteBtn.click();
    await expect(deleteBtn).toHaveClass(/confirm/);

    // Second click confirms
    await deleteBtn.click();

    // App should be removed from sidebar
    await expect(page.locator('.sidebar-item-name', { hasText: 'E2E Test App' })).not.toBeVisible({ timeout: 5000 });
  });
});

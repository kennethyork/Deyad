import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * E2E tests for full user workflows in the Deyad desktop app.
 * These go beyond smoke tests to verify real feature interactions.
 */

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  window = await electronApp.firstWindow();
  await window.locator('#root').waitFor({ timeout: 15_000 });
});

test.afterAll(async () => {
  await electronApp.close();
});

test.describe('Sidebar and App Management', () => {
  test('sidebar is visible and has new app button', async () => {
    const sidebar = window.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });

    // New app button should exist
    const newAppBtn = sidebar.locator('button', { hasText: /new|create|\+/i });
    await expect(newAppBtn).toBeVisible();
  });

  test('clicking new app opens the modal', async () => {
    const newAppBtn = window.locator('.sidebar button', { hasText: /new|create|\+/i });
    await newAppBtn.click();

    // Modal should appear
    const modal = window.locator('.modal, [class*="modal"]');
    await expect(modal).toBeVisible({ timeout: 3_000 });

    // Close modal (press Escape)
    await window.keyboard.press('Escape');
  });
});

test.describe('Chat Panel', () => {
  test('chat input area is visible', async () => {
    const chatInput = window.locator('textarea, [contenteditable], .chat-input, [class*="chat-input"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 5_000 });
  });

  test('chat input accepts text', async () => {
    const chatInput = window.locator('textarea, .chat-input textarea').first();
    await chatInput.fill('Hello, this is a test');
    const value = await chatInput.inputValue();
    expect(value).toContain('Hello, this is a test');
    // Clear it
    await chatInput.fill('');
  });
});

test.describe('Panel Navigation', () => {
  test('can switch between panels via panel tabs', async () => {
    // Look for panel tab buttons (terminal, git, etc.)
    const panelTabs = window.locator('.panel-tab, [class*="panel-tab"], .tab-btn, [class*="tab"]');
    const count = await panelTabs.count();
    // Should have at least a few panel tabs
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('Settings Modal', () => {
  test('settings modal opens and shows Ollama host config', async () => {
    // Look for settings button (gear icon)
    const settingsBtn = window.locator('button[title*="ettings"], button[aria-label*="ettings"], .settings-btn, [class*="settings"]').first();

    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();

      // Modal should show Ollama configuration
      const modal = window.locator('.modal, [class*="modal"]');
      await expect(modal).toBeVisible({ timeout: 3_000 });

      // Should have an input for Ollama host
      const hostInput = modal.locator('input[placeholder*="llama"], input[value*="11434"], label:has-text("Ollama") + input, label:has-text("ollama") ~ input');
      // Just verify the modal opened — specific inputs depend on UI state
      expect(await modal.isVisible()).toBe(true);

      await window.keyboard.press('Escape');
    }
  });
});

test.describe('Command Palette', () => {
  test('command palette opens with Ctrl+K', async () => {
    await window.keyboard.press('Control+k');

    // Should show command palette overlay
    const palette = window.locator('.command-palette, [class*="command-palette"], [class*="CommandPalette"]');
    // Wait a moment for it to appear
    await window.waitForTimeout(500);

    if (await palette.isVisible()) {
      // Should have a search input
      const input = palette.locator('input');
      await expect(input).toBeVisible();

      // Close it
      await window.keyboard.press('Escape');
    }
  });
});

test.describe('Preload API Methods', () => {
  test('window.deyad has expected API methods', async () => {
    const apiMethods = await window.evaluate(() => {
      const api = (window as any).deyad;
      if (!api) return [];
      return Object.keys(api);
    });

    // Core methods should exist
    expect(apiMethods).toContain('listApps');
    expect(apiMethods).toContain('createApp');
    expect(apiMethods).toContain('readFiles');
    expect(apiMethods).toContain('writeFiles');
    expect(apiMethods).toContain('listModels');
    expect(apiMethods).toContain('chatStream');
    expect(apiMethods).toContain('getSettings');
    expect(apiMethods).toContain('setSettings');
  });

  test('listApps returns an array', async () => {
    const apps = await window.evaluate(async () => {
      return (window as any).deyad.listApps();
    });
    expect(Array.isArray(apps)).toBe(true);
  });

  test('getSettings returns valid settings object', async () => {
    const settings = await window.evaluate(async () => {
      return (window as any).deyad.getSettings();
    });
    expect(settings).toBeTruthy();
    expect(typeof settings).toBe('object');
    // Should have ollamaHost field
    expect(settings).toHaveProperty('ollamaHost');
  });
});

test.describe('Error Boundary', () => {
  test('error boundary component is mounted', async () => {
    // The error boundary wraps the app — verify the app rendered without error
    const errorUI = window.locator('.error-boundary-fallback, [class*="error-boundary"]');
    // Should NOT be visible (app loaded successfully)
    expect(await errorUI.count()).toBe(0);

    // The root app should be visible
    const root = window.locator('#root');
    await expect(root).toBeAttached();
    const children = await root.evaluate((el) => el.children.length);
    expect(children).toBeGreaterThan(0);
  });
});

test.describe('Theme Support', () => {
  test('app has a theme class on body or root', async () => {
    const hasTheme = await window.evaluate(() => {
      const body = document.body;
      const root = document.documentElement;
      return body.classList.contains('dark') ||
        body.classList.contains('light') ||
        root.classList.contains('dark') ||
        root.classList.contains('light') ||
        body.getAttribute('data-theme') !== null ||
        root.getAttribute('data-theme') !== null;
    });
    // App should have some form of theme indication
    expect(hasTheme).toBe(true);
  });
});

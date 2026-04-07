import { test, expect, _electron as electron } from '@playwright/test';

test.describe('Electron smoke test', () => {
  test('app launches and shows main window', async () => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    // Wait for the first BrowserWindow to open
    const window = await electronApp.firstWindow();
    expect(window).toBeTruthy();

    // Window title should contain Deyad
    const title = await window.title();
    expect(title).toContain('Deyad');

    // The #root div should exist (React mounts here)
    const root = await window.locator('#root');
    await expect(root).toBeAttached({ timeout: 10_000 });

    // App should have exactly one window
    const windows = electronApp.windows();
    expect(windows.length).toBe(1);

    await electronApp.close();
  });

  test('app sets Content-Security-Policy', async () => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    const window = await electronApp.firstWindow();

    // Check that CSP meta tag exists in the page
    const csp = await window.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");

    await electronApp.close();
  });

  test('preload bridge exposes window.deyad', async () => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'test' },
    });

    const window = await electronApp.firstWindow();
    await window.locator('#root').waitFor({ timeout: 10_000 });

    // The preload script should expose the deyad API on window
    const hasDeyadAPI = await window.evaluate(() => typeof (window as any).deyad === 'object');
    expect(hasDeyadAPI).toBe(true);

    await electronApp.close();
  });
});

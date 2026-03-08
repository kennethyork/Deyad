import { describe, it, expect } from 'vitest';
import { buildSmartContext, getProjectStats } from './contextBuilder';

describe('buildSmartContext', () => {
  it('returns empty string for no files', () => {
    expect(buildSmartContext({ files: {} })).toBe('');
  });

  it('includes all files when project is small', () => {
    const files = {
      'src/App.tsx': 'export default function App() { return <div>Hello</div>; }',
      'src/index.css': 'body { margin: 0; }',
    };
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('src/App.tsx');
    expect(ctx).toContain('src/index.css');
    expect(ctx).toContain('2 files total');
  });

  it('prioritizes the selected file', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      files[`src/component${i}.tsx`] = `// Component ${i}\nexport default function C${i}() { return <div>${i}</div>; }`;
    }
    files['src/TargetFile.tsx'] = '// This is the target\nexport default function Target() { return <div>Target</div>; }';

    const ctx = buildSmartContext({ files, selectedFile: 'src/TargetFile.tsx' });
    // The selected file should appear in the full-content section (early in output)
    const targetIdx = ctx.indexOf('src/TargetFile.tsx');
    expect(targetIdx).toBeGreaterThan(-1);
    // It should appear before most other files
    const firstComponentIdx = ctx.indexOf('src/component15.tsx');
    if (firstComponentIdx > -1) {
      expect(targetIdx).toBeLessThan(firstComponentIdx);
    }
  });

  it('boosts files matching user message keywords', () => {
    const files = {
      'src/App.tsx': 'export default function App() {}',
      'src/components/UserProfile.tsx': 'export function UserProfile() { return <div>profile</div>; }',
      'src/components/Settings.tsx': 'export function Settings() { return <div>settings</div>; }',
      'src/utils/auth.ts': 'export function login() {}',
    };
    const ctx = buildSmartContext({ files, userMessage: 'update the user profile page' });
    // UserProfile should appear in full content
    expect(ctx).toContain('UserProfile.tsx');
  });

  it('provides summaries for files beyond the full-content limit', () => {
    const files: Record<string, string> = {};
    // Create enough files to exceed MAX_FULL_FILES
    for (let i = 0; i < 25; i++) {
      files[`src/file${i}.tsx`] = `// File ${i}\n`.repeat(100);
    }
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('summaries only');
  });

  it('includes file count header', () => {
    const files = {
      'a.ts': 'const a = 1;',
      'b.ts': 'const b = 2;',
      'c.ts': 'const c = 3;',
    };
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('3 files total');
  });
});

describe('getProjectStats', () => {
  it('returns correct stats', () => {
    const files = {
      'src/App.tsx': 'line1\nline2\nline3',
      'src/index.css': 'body {}',
      'data.json': '{}',
    };
    const stats = getProjectStats(files);
    expect(stats.fileCount).toBe(3);
    expect(stats.totalLines).toBe(5); // 3 + 1 + 1
    expect(stats.languages).toContain('TypeScript');
    expect(stats.languages).toContain('CSS');
    expect(stats.languages).toContain('JSON');
  });

  it('handles empty files', () => {
    const stats = getProjectStats({});
    expect(stats.fileCount).toBe(0);
    expect(stats.totalLines).toBe(0);
    expect(stats.languages).toEqual([]);
  });
});

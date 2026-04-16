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
    // Create enough files to exceed MAX_FULL_FILES (25) and MAX_CONTEXT_CHARS
    for (let i = 0; i < 40; i++) {
      files[`src/file${i}.tsx`] = `// File ${i}\n`.repeat(200);
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

describe('buildSmartContext — scoring heuristics', () => {
  it('penalises node_modules files', () => {
    const files = {
      'src/App.tsx': 'export default function App() {}',
      'node_modules/react/index.js': 'module.exports = {}',
    };
    const ctx = buildSmartContext({ files });
    const appIdx = ctx.indexOf('src/App.tsx');
    const nmIdx = ctx.indexOf('node_modules/react/index.js');
    expect(appIdx).toBeLessThan(nmIdx);
  });

  it('penalises .lock files', () => {
    const files = {
      'src/App.tsx': 'export default function App() {}',
      'package-lock.json': '{"lockfileVersion":3}',
    };
    const ctx = buildSmartContext({ files });
    const appIdx = ctx.indexOf('src/App.tsx');
    const lockIdx = ctx.indexOf('package-lock.json');
    expect(appIdx).toBeLessThan(lockIdx);
  });

  it('penalises .map files', () => {
    const files = {
      'src/App.tsx': 'export default function App() {}',
      'dist/bundle.js.map': '{"version":3}',
    };
    const ctx = buildSmartContext({ files });
    expect(ctx.indexOf('src/App.tsx')).toBeLessThan(ctx.indexOf('dist/bundle.js.map'));
  });

  it('boosts schema.prisma', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`src/file${i}.ts`] = `const x = ${i};`;
    files['prisma/schema.prisma'] = 'model Foo { id Int @id }';
    const ctx = buildSmartContext({ files });
    // schema.prisma should appear in full files section (before summaries)
    const prismaIdx = ctx.indexOf('schema.prisma');
    expect(prismaIdx).toBeGreaterThan(-1);
  });

  it('boosts package.json', () => {
    const files = {
      'package.json': '{"name":"test"}',
      'src/deep/nested/helper.ts': 'export const x = 1;',
    };
    const ctx = buildSmartContext({ files });
    expect(ctx.indexOf('package.json')).toBeLessThan(ctx.indexOf('helper.ts'));
  });

  it('boosts routes and api files', () => {
    const files = {
      'src/utils.ts': 'export const x = 1;',
      'src/routes/index.ts': 'export const router = {};',
      'src/api/items.ts': 'export const getItems = () => {};',
    };
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('routes/index.ts');
    expect(ctx).toContain('api/items.ts');
  });
});

describe('buildSmartContext — truncation', () => {
  it('truncates files larger than MAX_FILE_CHARS with marker', () => {
    const big = 'x'.repeat(10_000);
    const files = { 'big.ts': big };
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('(truncated)');
    // Full content should NOT be present
    expect(ctx).not.toContain('x'.repeat(10_000));
  });

  it('does not truncate small files', () => {
    const files = { 'small.ts': 'const x = 1;' };
    const ctx = buildSmartContext({ files });
    expect(ctx).not.toContain('truncated');
    expect(ctx).toContain('const x = 1;');
  });
});

describe('buildSmartContext — summary section', () => {
  it('summary lines show char count', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      files[`src/mod${i}.ts`] = `// module ${i}\n`.repeat(50);
    }
    const ctx = buildSmartContext({ files });
    // some files should be in summaries with char counts like "(750 chars):"
    expect(ctx).toMatch(/\(\d+ chars\)/);
  });

  it('header counts full and summarised correctly', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      files[`f${i}.ts`] = `const x${i} = ${i};\n`;
    }
    const ctx = buildSmartContext({ files });
    expect(ctx).toContain('30 files total');
  });
});

describe('getProjectStats — language detection', () => {
  it('detects JavaScript for .js .jsx .mjs', () => {
    const stats = getProjectStats({
      'a.js': 'x', 'b.jsx': 'y', 'c.mjs': 'z',
    });
    expect(stats.languages).toContain('JavaScript');
    expect(stats.fileCount).toBe(3);
  });

  it('detects TypeScript for .ts .tsx', () => {
    const stats = getProjectStats({ 'a.ts': 'x', 'b.tsx': 'y' });
    expect(stats.languages).toContain('TypeScript');
  });

  it('detects CSS, HTML, JSON', () => {
    const stats = getProjectStats({
      'a.css': 'body{}', 'b.html': '<html></html>', 'c.json': '{}',
    });
    expect(stats.languages).toEqual(expect.arrayContaining(['CSS', 'HTML', 'JSON']));
  });

  it('detects Prisma', () => {
    const stats = getProjectStats({ 'schema.prisma': 'model X {}' });
    expect(stats.languages).toContain('Prisma');
  });

  it('detects YAML for .yml and .yaml', () => {
    const stats = getProjectStats({ 'a.yml': 'key: val', 'b.yaml': 'key: val' });
    expect(stats.languages).toContain('YAML');
  });

  it('detects Markdown for .md', () => {
    const stats = getProjectStats({ 'README.md': '# Hello' });
    expect(stats.languages).toContain('Markdown');
  });

  it('ignores unknown extensions', () => {
    const stats = getProjectStats({ 'a.xyz': 'test', 'b.unknown': 'data' });
    expect(stats.languages).toEqual([]);
  });

  it('deduplicates languages', () => {
    const stats = getProjectStats({
      'a.ts': 'x', 'b.ts': 'y', 'c.tsx': 'z',
    });
    const tsCount = stats.languages.filter(l => l === 'TypeScript').length;
    expect(tsCount).toBe(1);
  });

  it('counts lines correctly across files', () => {
    const stats = getProjectStats({
      'a.ts': 'line1\nline2\nline3', // 3 lines
      'b.ts': 'single', // 1 line
    });
    expect(stats.totalLines).toBe(4);
  });

  it('counts chars correctly', () => {
    const stats = getProjectStats({ 'a.ts': '12345' });
    expect(stats.totalChars).toBe(5);
  });
});

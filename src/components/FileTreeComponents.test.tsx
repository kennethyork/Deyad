import { describe, it, expect } from 'vitest';
import { getLanguage, getFileIcon, buildTree } from './FileTreeComponents';

describe('getLanguage', () => {
  it('returns typescript for .tsx', () => expect(getLanguage('App.tsx')).toBe('typescript'));
  it('returns javascript for .jsx', () => expect(getLanguage('App.jsx')).toBe('javascript'));
  it('returns typescript for .ts', () => expect(getLanguage('main.ts')).toBe('typescript'));
  it('returns javascript for .js', () => expect(getLanguage('index.js')).toBe('javascript'));
  it('returns javascript for .mjs', () => expect(getLanguage('config.mjs')).toBe('javascript'));
  it('returns javascript for .cjs', () => expect(getLanguage('build.cjs')).toBe('javascript'));
  it('returns css for .css', () => expect(getLanguage('style.css')).toBe('css'));
  it('returns html for .html', () => expect(getLanguage('index.html')).toBe('html'));
  it('returns json for .json', () => expect(getLanguage('pkg.json')).toBe('json'));
  it('returns markdown for .md', () => expect(getLanguage('README.md')).toBe('markdown'));
  it('returns yaml for .yml', () => expect(getLanguage('ci.yml')).toBe('yaml'));
  it('returns yaml for .yaml', () => expect(getLanguage('ci.yaml')).toBe('yaml'));
  it('returns graphql for .prisma', () => expect(getLanguage('schema.prisma')).toBe('graphql'));
  it('returns sql for .sql', () => expect(getLanguage('migrate.sql')).toBe('sql'));
  it('returns shell for .sh', () => expect(getLanguage('build.sh')).toBe('shell'));
  it('returns python for .py', () => expect(getLanguage('main.py')).toBe('python'));
  it('returns dockerfile for Dockerfile', () => expect(getLanguage('Dockerfile')).toBe('dockerfile'));
  it('returns dockerfile for .dockerfile', () => expect(getLanguage('app.dockerfile')).toBe('dockerfile'));
  it('returns plaintext for unknown', () => expect(getLanguage('data.csv')).toBe('plaintext'));
});

describe('getFileIcon', () => {
  it('returns TSX for .tsx', () => expect(getFileIcon('App.tsx')).toBe('TSX'));
  it('returns TSX for .jsx', () => expect(getFileIcon('App.jsx')).toBe('TSX'));
  it('returns JS for .ts', () => expect(getFileIcon('main.ts')).toBe('JS'));
  it('returns CSS for .css', () => expect(getFileIcon('style.css')).toBe('CSS'));
  it('returns {} for .json', () => expect(getFileIcon('pkg.json')).toBe('{}'));
  it('returns MD for .md', () => expect(getFileIcon('README.md')).toBe('MD'));
  it('returns YML for .yml', () => expect(getFileIcon('ci.yml')).toBe('YML'));
  it('returns PR for .prisma', () => expect(getFileIcon('schema.prisma')).toBe('PR'));
  it('returns ENV for .env', () => expect(getFileIcon('.env')).toBe('ENV'));
  it('returns ENV for .env.local', () => expect(getFileIcon('.env.local')).toBe('ENV'));
  it('returns HTML for .html', () => expect(getFileIcon('index.html')).toBe('HTML'));
  it('returns empty for unknown', () => expect(getFileIcon('data.csv')).toBe(''));
});

describe('buildTree', () => {
  it('builds a tree from flat file map', () => {
    const files: Record<string, string> = {
      'src/App.tsx': 'code',
      'src/index.ts': 'code',
      'README.md': 'text',
    };
    const tree = buildTree(files);
    expect(tree.get('')).toContain('src');
    expect(tree.get('')).toContain('README.md');
    expect(tree.get('src')).toContain('src/App.tsx');
    expect(tree.get('src')).toContain('src/index.ts');
  });

  it('handles deeply nested files', () => {
    const files: Record<string, string> = {
      'a/b/c/d.ts': 'code',
    };
    const tree = buildTree(files);
    expect(tree.get('')).toContain('a');
    expect(tree.get('a')).toContain('a/b');
    expect(tree.get('a/b')).toContain('a/b/c');
    expect(tree.get('a/b/c')).toContain('a/b/c/d.ts');
  });

  it('returns empty root for empty files', () => {
    const tree = buildTree({});
    expect(tree.get('')).toEqual([]);
  });

  it('does not duplicate entries', () => {
    const files: Record<string, string> = {
      'src/a.ts': 'code',
      'src/b.ts': 'code',
    };
    const tree = buildTree(files);
    const root = tree.get('')!;
    expect(root.filter(x => x === 'src').length).toBe(1);
  });
});

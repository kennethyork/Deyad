import { describe, it, expect } from 'vitest';
import { extractFilesFromResponse, isFullStackRequest } from '../lib/codeParser';

describe('extractFilesFromResponse', () => {
  it('extracts a single file block', () => {
    const text = `Here is the code:

### FILE: src/App.tsx
\`\`\`tsx
export default function App() {
  return <div>Hello</div>;
}
\`\`\`
`;
    const files = extractFilesFromResponse(text);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[0].content).toContain('return <div>Hello</div>');
  });

  it('extracts multiple file blocks', () => {
    const text = `
### FILE: frontend/src/App.tsx
\`\`\`tsx
const App = () => <div />;
\`\`\`

### FILE: backend/src/index.ts
\`\`\`ts
import express from 'express';
const app = express();
\`\`\`
`;
    const files = extractFilesFromResponse(text);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('frontend/src/App.tsx');
    expect(files[1].path).toBe('backend/src/index.ts');
  });

  it('returns empty array when no file blocks', () => {
    const files = extractFilesFromResponse('Just some text with no file blocks.');
    expect(files).toHaveLength(0);
  });
});

describe('isFullStackRequest', () => {
  it('detects full-stack keywords', () => {
    expect(isFullStackRequest('I need a database')).toBe(true);
    expect(isFullStackRequest('Build a REST API with MySQL')).toBe(true);
    expect(isFullStackRequest('Create a backend server')).toBe(true);
    expect(isFullStackRequest('I want to store data')).toBe(true);
    expect(isFullStackRequest('Full stack app with CRUD')).toBe(true);
  });

  it('returns false for frontend-only requests', () => {
    expect(isFullStackRequest('Make a landing page')).toBe(false);
    expect(isFullStackRequest('Add a button to my form')).toBe(false);
    expect(isFullStackRequest('Style the navbar with blue')).toBe(false);
  });
});

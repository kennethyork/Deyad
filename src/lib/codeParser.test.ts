import { describe, it, expect } from 'vitest';
import { extractFilesFromResponse, isFullStackRequest, isMobileRequest, MOBILE_SYSTEM_PROMPT, getFullStackSystemPrompt } from '../lib/codeParser';

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
    expect(isFullStackRequest('Use PostgreSQL for the database')).toBe(true);
    expect(isFullStackRequest('Set up a postgres instance')).toBe(true);
  });

  it('returns false for frontend-only requests', () => {
    expect(isFullStackRequest('Make a landing page')).toBe(false);
    expect(isFullStackRequest('Add a button to my form')).toBe(false);
    expect(isFullStackRequest('Style the navbar with blue')).toBe(false);
  });
});

describe('getFullStackSystemPrompt', () => {
  it('returns MySQL prompt by default', () => {
    const prompt = getFullStackSystemPrompt();
    expect(prompt).toContain('MySQL 8');
    expect(prompt).toContain('port 3306');
  });

  it('returns MySQL prompt when mysql is specified', () => {
    const prompt = getFullStackSystemPrompt('mysql');
    expect(prompt).toContain('MySQL 8');
    expect(prompt).toContain('port 3306');
  });

  it('returns PostgreSQL prompt when postgresql is specified', () => {
    const prompt = getFullStackSystemPrompt('postgresql');
    expect(prompt).toContain('PostgreSQL 16');
    expect(prompt).toContain('port 5432');
    expect(prompt).not.toContain('MySQL');
  });
});

describe('isMobileRequest', () => {
  it('detects mobile keywords', () => {
    expect(isMobileRequest('I want to build a mobile app')).toBe(true);
    expect(isMobileRequest('Create an Expo app')).toBe(true);
    expect(isMobileRequest('Build a React Native component')).toBe(true);
    expect(isMobileRequest('Make it work on iOS')).toBe(true);
    expect(isMobileRequest('Target Android devices')).toBe(true);
    expect(isMobileRequest('Deploy to phone')).toBe(true);
    expect(isMobileRequest('Tablet-friendly layout')).toBe(true);
    expect(isMobileRequest('Build a native app')).toBe(true);
  });

  it('returns false for non-mobile requests', () => {
    expect(isMobileRequest('Add a button to my form')).toBe(false);
    expect(isMobileRequest('Style the navbar with blue')).toBe(false);
    expect(isMobileRequest('Create a landing page')).toBe(false);
  });
});

describe('MOBILE_SYSTEM_PROMPT', () => {
  it('exists and mentions React Native and Expo', () => {
    expect(MOBILE_SYSTEM_PROMPT).toBeDefined();
    expect(MOBILE_SYSTEM_PROMPT).toContain('React Native');
    expect(MOBILE_SYSTEM_PROMPT).toContain('Expo');
  });

  it('instructs to use StyleSheet not CSS', () => {
    expect(MOBILE_SYSTEM_PROMPT).toContain('StyleSheet.create()');
    expect(MOBILE_SYSTEM_PROMPT).toContain('NOT CSS');
  });

  it('includes the file format instructions', () => {
    expect(MOBILE_SYSTEM_PROMPT).toContain('### FILE:');
  });
});

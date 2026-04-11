# Practice Thinking Example

This example demonstrates how to use the thinking/reasoning capability with Ollama models that support chain-of-thought (like Qwen3.5+).

## What is "Thinking"?

Some advanced AI models have a "thinking" or "reasoning" mode where they:
1. First think through the problem internally (chain-of-thought)
2. Then produce the final answer

This is similar to how humans approach complex problems - we think first, then speak.

## How It Works

The `streamChat` function in `ollama.ts` supports:
- `onThinkingToken` callback - receives thinking tokens as they're generated
- Returns `thinking` field in the result - contains the full chain-of-thought
- Returns `content` field - contains the final answer

## Usage

```typescript
import { streamChat } from './src/ollama';

const result = await streamChat(
  'qwen3.5',
  [{ role: 'user', content: 'What is 2+2?' }],
  (token) => console.log('Content:', token),
  {},
  undefined,
  (thinkingToken) => console.log('Thinking:', thinkingToken),  // onThinkingToken
  undefined,
  true  // enable thinking
);

console.log('Thinking process:', result.thinking);
console.log('Final answer:', result.content);
```

## Try It

```bash
cd deyad-cli/deyad-cli
npm run build
node dist/cli.js --model qwen3.5 "Explain quantum computing in simple terms"
```

## When to Use Thinking

**Enable thinking for:**
- Complex reasoning problems
- Mathematical calculations
- Code generation with logic
- Multi-step analysis

**Disable thinking for:**
- Simple questions
- Fast responses needed
- Creative writing
- When latency matters

## Example Output

```
Thinking: Let me break this down step by step...
          First, I need to understand what quantum computing is...
          Then I should explain the key concepts...
          
Final answer: Quantum computing uses quantum mechanics to process information...
```
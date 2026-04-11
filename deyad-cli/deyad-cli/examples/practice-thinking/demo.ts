#!/usr/bin/env node
/**
 * Practice Thinking Demo
 * 
 * This script demonstrates the thinking/reasoning capability of Ollama models.
 * It shows how models can think through problems before answering.
 */

import { streamChat, type OllamaMessage } from '../../src/ollama.js';

async function demonstrateThinking() {
  console.log('='.repeat(60));
  console.log('Practice Thinking Demo');
  console.log('='.repeat(60));
  console.log('');
  
  const prompts = [
    'What is the capital of France?',
    'Calculate: 15 * 23 + 42 / 6',
    'Explain why the sky is blue in simple terms',
  ];
  
  for (const prompt of prompts) {
    console.log('─'.repeat(60));
    console.log(`Prompt: ${prompt}`);
    console.log('─'.repeat(60));
    console.log('');
    
    const messages: OllamaMessage[] = [
      { role: 'user', content: prompt }
    ];
    
    let thinkingBuffer = '';
    let contentBuffer = '';
    
    const result = await streamChat(
      'qwen3.5',
      messages,
      (token) => {
        contentBuffer += token;
        process.stdout.write(`\x1b[36mContent: ${token}\x1b[0m`);
      },
      {},
      undefined,
      (thinkingToken) => {
        thinkingBuffer += thinkingToken;
        process.stdout.write(`\x1b[33mThinking: ${thinkingToken}\x1b[0m`);
      },
      undefined,
      true  // Enable thinking
    );
    
    console.log('');
    console.log('');
    console.log('─'.repeat(60));
    console.log('Summary:');
    console.log('─'.repeat(60));
    console.log(`Thinking tokens: ${thinkingBuffer.length} chars`);
    console.log(`Content tokens: ${contentBuffer.length} chars`);
    console.log(`Prompt tokens: ${result.usage.promptTokens}`);
    console.log(`Completion tokens: ${result.usage.completionTokens}`);
    console.log('');
    console.log('Thinking process (first 200 chars):');
    console.log(thinkingBuffer.slice(0, 200) + '...');
    console.log('');
    console.log('Final answer (first 200 chars):');
    console.log(contentBuffer.slice(0, 200) + '...');
    console.log('');
    console.log('');
  }
}

demonstrateThinking().catch(console.error);

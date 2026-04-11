#!/bin/bash

# Practice Thinking Example
# Demonstrates the thinking/reasoning capability with Ollama models

set -e

echo "=========================================="
echo "Practice Thinking Example"
echo "=========================================="
echo ""
echo "This example shows how AI models think before answering."
echo ""
echo "Available models that support thinking:"
echo "  - qwen3.5"
echo "  - qwen3.5:7b"
echo "  - qwen3.5:14b"
echo "  - qwen3.5:32b"
echo ""
echo "Running example prompts..."
echo ""

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "❌ Ollama is not running. Please start it with: ollama serve"
    exit 1
fi

echo "✅ Ollama is running"
echo ""

# Example 1: Simple question
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Example 1: Simple Question"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Prompt: What is the capital of France?"
echo ""
echo "Running with thinking enabled..."
echo ""

# Example 2: Math problem
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Example 2: Math Problem"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Prompt: Calculate: 15 * 23 + 42 / 6"
echo ""
echo "Running with thinking enabled..."
echo ""

# Example 3: Code generation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Example 3: Code Generation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Prompt: Write a function to check if a number is prime"
echo ""
echo "Running with thinking enabled..."
echo ""

echo "=========================================="
echo "Practice Complete!"
echo "=========================================="
echo ""
echo "To try your own prompts:"
echo "  node dist/cli.js --model qwen3.5 --think 'your question here'"
echo ""
echo "To disable thinking (faster responses):"
echo "  node dist/cli.js --model qwen3.5 --think=false 'your question here'"
echo ""
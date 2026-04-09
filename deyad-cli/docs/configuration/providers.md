# AI Provider Configuration

`deyad-cli` supports multiple AI providers, allowing you to use local models via Ollama or powerful cloud-based models like OpenAI, Gemini, and xAI.

## Supported Providers

| Provider | Default Model | Required Environment Variable |
| --- | --- | --- |
| **Ollama** | User-specified | `OLLAMA_BASE_URL` (optional, defaults to `http://localhost:11434/v1`) |
| **OpenAI** | `o4-mini` | `OPENAI_API_KEY` |
| **Gemini** | `gemini-2.0-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **OpenRouter** | `openai/o4-mini` | `OPENROUTER_API_KEY` |
| **xAI** | `grok-3-mini-beta` | `XAI_API_KEY` |

## Configuring a Provider

You can configure the provider in two ways: via the global configuration file or via command-line flags.

### 1. Global Configuration File

The preferred way is to use the configuration file located at `~/.codex/config.json`. This ensures your settings persist across sessions.

```json
{
  "provider": "gemini",
  "model": "gemini-2.0-pro-exp-02-05",
  "approvalMode": "suggest"
}
```

### 2. Command-Line Flags

For one-off tasks or when switching between models quickly, use the `--provider` and `--model` flags.

```shell
# Using Gemini for a specific task
deyad-cli --provider gemini --model gemini-2.0-flash "analyze this file"

# Using OpenAI
deyad-cli --provider openai --model gpt-4o "refactor this function"
```

## Environment Variables

If you are using a cloud provider, you **must** set the corresponding API key in your environment. You can add these to your `.bashrc`, `.zshrc`, or a `.env` file in your project root.

```bash
# Example for Gemini
export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"

# Example for Ollama (if running on a different host)
export OLLAMA_BASE_URL="http://192.168.1.50:11434/v1"
```

## Tips for Choosing a Model

- **For Speed/Cost**: Use `ollama` (local) or `gemini-2.0-flash`. These are excellent for routine tasks like linting, formatting, or simple refactoring.
- **For Complex Reasoning**: Use `openai/o4-min` or `gpt-4o`. These are better for architectural changes, complex bug fixing, and understanding large, interconnected codebases.
- **For Large Contexts**: If you are working with a very large repository, look for models with larger context windows (like Gemini) to ensure the agent can "see" more of your project.

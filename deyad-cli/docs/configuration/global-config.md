# Global Configuration

`deyad-cli` uses a global configuration directory to persist your preferences across different projects and sessions. This allows you to set your preferred AI provider, model, and approval modes once and forget about them.

The configuration is stored in `~/.codex/`.

## Configuration Files

There are two main types of configuration files in this directory:

1.  **`config.json`**: Stores structured settings like your default provider, model, and approval modes.
2.  **`instructions.md`**: A Markdown file where you can provide persistent, high-level instructions to the agent (e.g., "Always use TypeScript", "Always write unit tests").

## Managing `config.json`

The `config.json` file uses a simple JSON format. You can create or edit it manually.

### Example Configuration

```json
{
  "provider": "ollama",
  "model": "llama3",
  "approvalMode": "auto-edit",
  "fullAutoErrorMode": "ask-user"
}
```

### Configuration Options

| Key | Type | Description |
| --- | --- | --- |
| `provider` | `string` | The AI provider to use (`openai`, `gemini`, `openrouter`, `ollama`, `xai`). |
| `model` | `string` | The specific model name to use with the selected provider. |
| `approvalMode` | `string` | The level of autonomy (`suggest`, `auto-edit`, `full-auto`). |
| `fullAutoErrorMode`| `string` | What to do if a command fails in `full-auto` mode (`ask-user`, `ignore-and-continue`). |

## Managing `instructions.md`

The `instructions.md` file is where you define the "personality" and "rules" for your agent. This is incredibly powerful for maintaining coding standards across all your projects.

### Best Practices for Instructions

- **Coding Standards**: "Always use functional components and hooks in React."
- **Testing Requirements**: "Every new feature must include a Vitest unit test."
- **Style Preferences**: "Prefer using arrow functions over the `function` keyword."
- **Project-Specific Rules**: If you have a specific way you like things done, put it here.

### Example `instructions.md`

```md
# Global Agent Instructions

- Always use TypeScript for any new files created.
- When refactoring, ensure that all existing tests still pass.
- If you encounter a complex regex, explain it in a comment.
- Always prefer `npm` over `yarn` for dependency management.
```

## Overriding Global Configuration

Remember that global configuration is just a baseline. You can always override these settings for a specific project or a single command:

1.  **Project-level `codex.md`**: Place a `codex.md` file in your project root to provide instructions specific to *that* repository.
2.  **Environment Variables**: Use variables like `OLLAMA_BASE_URL` to override network settings.
3.  **Command-lanine Flags**: Use `--provider`, `--model`, or `--approval-mode` to override everything else for a single execution.


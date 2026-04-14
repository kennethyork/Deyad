# Global Configuration

`deyad-cli` uses a global configuration directory to persist your preferences across different projects and sessions. This allows you to set your preferred model and approval modes once and forget about them.

The configuration is stored in `~/.deyad/`.

## Configuration Files

There is one main configuration file:

**`config.json`**: Stores structured settings like your default model and auto-approval mode.

## Managing `config.json`

The `config.json` file uses a simple JSON format. You can create or edit it manually.

### Example Configuration

```json
{
  "model": "llama3.2",
  "autoApprove": true,
  "noThink": false
}
```

### Configuration Options

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `string` | first available | The default Ollama model to use. |
| `autoApprove` | `boolean` | `false` | Auto-approve all changes without confirmation prompts. |
| `noThink` | `boolean` | `false` | Disable reasoning/thinking mode for faster but less accurate responses. |

## Viewing Your Config

Use the `--config` flag to see your current configuration:

```bash
deyad --config
```

Output:
```
Config path: /home/username/.deyad/config.json

{
  "model": "llama3.2",
  "autoApprove": true
}
```

## Overriding Global Configuration

Global configuration is just a baseline. You can always override these settings:

1. **Environment Variables**: Use `DEYAD_MODEL` to override the model.
2. **Command-line Flags**: Use `--model`, `--auto-approve`, or `--no-think` to override for a single execution.

### Priority Order

Settings are applied in this order (highest priority first):

1. Command-line flags (e.g., `--auto-approve`)
2. Environment variables (e.g., `DEYAD_MODEL`)
3. Global config file (`~/.deyad/config.json`)
4. Built-in defaults

## Auto-Approval Mode

When `autoApprove` is set to `true`, the agent will:

- Automatically approve file modifications
- Skip confirmation prompts for dangerous operations
- Show a status message indicating auto-approve is enabled

**Warning**: Use auto-approval carefully. The agent will make changes without asking for confirmation.

### Example Usage

```bash
# Set auto-approve in config
echo '{"autoApprove": true}' > ~/.deyad/config.json

# Now all commands run without confirmation
deyad "fix the login bug"
```

Or use the CLI flag for one-time use:

```bash
deyad --auto-approve "fix the login bug"
```

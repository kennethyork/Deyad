# Automation and CI Guide

`deyad-cli` is designed to be used not just interactively, but also in automated environments like CI/CD pipelines (e.g., GitHub Actions). This allows you to automate tasks like generating changelogs, running lint fixes, or even performing automated code reviews.

## Non-Interactive Mode (Quiet Mode)

To use `deyad-cli` in a script or pipeline, use the `-q` or `--quiet` flag. This suppresses the interactive UI and makes the output suitable for logs.

```shell
deyad-cli -q "update the README.md with the new feature description"
```

## Environment Variables

Automation often requires configuring the AI provider without manual interaction. Use environment variables to set these up:

| Variable | Description | Example |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | The endpoint for your Ollama instance. | `http://localhost:11434/v1` |
| `OPENAI_API_KEY` | Required if using OpenAI provider. | `sk-...` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Required if using Gemini provider. | `...` |
| `DEBUG` | Set to `true` to see full API request/response logs. | `true` |
| `CODEX_QUIET_MODE` | Forces quiet mode even if flags are omitted. | `1` |

## Example: GitHub Action

Here is an example of a GitHub Action step that uses `deyad-cli` to automatically update a changelog after a successful build.

```yaml
name: Automated Changelog Update

on:
  push:
    branches:
          - main

jobs:
  update-changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install deyad-cli
        run: npm install -g deyad-cli

      - name: Run Agent to Update Changelog
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          deyad-cal -q --approval-mode auto-edit "Update CHANGELOG.md based on the latest commits"

      - name: Commit and Push changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add CHANGELOG.md
          git commit -m "chore: automated changelog update" || echo "No changes to commit"
          git push
```

## Best Practices for Automation

1. **Use `auto-edit` or `full-auto` with Caution**: In CI, you want the agent to be able to write files without waiting for human input. However, ensure your environment is sandboxed (e.g., using Docker) to prevent accidental destructive commands.
2. **Use Small, Scoped Prompts**: Instead of "refactor the whole repo", use "fix the linting errors in `src/utils.ts`". This reduces the risk of unexpected side effects and keeps the token usage low.
3. **Monitor Logs**: Always check the logs of your CI pipeline to ensure the agent is behaving as expected.

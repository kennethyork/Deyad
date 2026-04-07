# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.4.x   | Yes       |
| < 1.4   | No        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report them privately through one of these channels:

1. **GitHub Security Advisories** (preferred):
   [Create a new advisory](https://github.com/kennethyork/Deyad/security/advisories/new)

2. **Email**: <maintainer@deyad.app>

Include as much detail as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Depends on severity (critical: ASAP, high: 1–2 weeks, medium/low: next release)

## Security Architecture

Deyad is designed with a **local-first** security model:

### Desktop App

- All AI inference runs locally via Ollama — no data leaves your machine
- Electron context isolation and sandboxed preload bridge
- IPC channel allowlisting — only declared channels are exposed
- No telemetry, no analytics, no cloud dependencies

### CLI Agent

- **SSRF protection**: `fetch_url` blocks private/internal IP ranges (127.x, 10.x, 192.168.x, 172.16-31.x, metadata endpoints)
- **Command blocking**: `run_command` blocks destructive commands (rm -rf /, sudo, mkfs, dd, curl|sh, shutdown)
- **Path traversal protection**: All file operations validate resolved paths stay within the project directory
- **Package name validation**: `install_package` rejects names with shell metacharacters
- **Branch name validation**: Git branch tools reject names with special characters
- **Image file validation**: `analyze_image` checks file extensions and enforces a 10 MB size limit
- **Audit logging**: All tool executions are logged to `.deyad-audit.jsonl`

## Scope

The following are in scope for security reports:

- Remote code execution
- Path traversal / directory escape
- SSRF (Server-Side Request Forgery)
- Command injection
- Privilege escalation
- Data exfiltration

The following are **out of scope**:

- Vulnerabilities in Ollama itself (report to [ollama/ollama](https://github.com/ollama/ollama))
- Vulnerabilities in Electron (report to [electron/electron](https://github.com/electron/electron))
- Social engineering attacks
- Denial of service against the local machine

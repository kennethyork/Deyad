# Deyad vs. Competitors

A detailed comparison of Deyad against the leading AI app builders (as of March 2026).

---

## Feature Matrix

| Feature | **Deyad** | **Claude Code** | **Dyad** | **Bolt.new** | **Lovable** | **Cursor** | **Windsurf** | **Replit** | **v0** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Pricing** | Free forever | Usage-based / Max $20+/mo | Freemium ($20–$79/mo) | Freemium ($20+/mo) | Freemium ($20+/mo) | $20/mo | $15/mo | Freemium ($25+/mo) | Freemium ($20+/mo) |
| **Runs locally** | ✅ | ❌ cloud | ✅ | ❌ cloud | ❌ cloud | ✅ | ✅ | ❌ cloud | ❌ cloud |
| **Data privacy** | ✅ code never leaves machine | ❌ code sent to Anthropic | Partial (cloud API keys) | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **Own your AI** | ✅ Ollama (any model) | ❌ Claude only | Partial (BYO API key) | ❌ locked to their API | ❌ locked | Partial (API keys) | Partial (API keys) | ❌ | ❌ |
| **Full-stack scaffold** | ✅ React+Express+Prisma+SQLite | ❌ no scaffold | ✅ Supabase | ✅ | ✅ | ❌ editor only | ❌ editor only | ✅ | ❌ frontend only |
| **Database management** | ✅ SQLite + Prisma Studio | ❌ | ✅ Supabase | ❌ | ✅ Supabase | ❌ | ❌ | ✅ PostgreSQL | ❌ |
| **Live preview** | ✅ embedded Vite | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Agent loop (auto-fix)** | ✅ 30-iter with error recovery | ✅ strong agentic loop | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Code editor** | ✅ Monaco (VS Code engine) | ❌ terminal only | ✅ visual editor | Basic | Basic | ✅ VS Code fork | ✅ VS Code fork | ✅ Monaco | ❌ |
| **Terminal** | ✅ full PTY + multi-tab | ✅ IS a terminal | ❌ | ✅ WebContainer | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Git integration** | ✅ full (branch, push, GitHub) | ✅ git operations | ✅ GitHub deploy | ❌ | ❌ basic | ✅ | ✅ | ✅ | ❌ |
| **Deploy targets** | ✅ 7 (Vercel, Netlify, Railway, Fly, Surge, VPS+SSL, Desktop) | ❌ no deploy | ✅ GitHub + Vercel | ✅ Netlify/Vercel | ✅ Netlify/Vercel | ❌ | ❌ | ✅ Replit hosting | ✅ Vercel |
| **VPS deploy + SSL** | ✅ SSH+rsync+certbot | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Desktop app export** | ✅ Electron builds | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mobile (Capacitor)** | ✅ iOS/Android | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Vision (screenshot → code)** | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Diff review before apply** | ✅ | ✅ | ❌ | ❌ auto-apply | ❌ auto-apply | ✅ | ✅ | ❌ | ❌ |
| **Offline capable** | ✅ | ❌ | ❌ needs API keys | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **MCP extensibility** | ✅ via .deyad/mcp.json | ✅ | ✅ MCP servers | ❌ | ❌ | ✅ extensions | ✅ extensions | ❌ | ❌ |
| **Plugin system** | ✅ native + MCP | ✅ MCP servers | ✅ MCP servers | ❌ | ❌ | ✅ extensions | ✅ extensions | ❌ | ❌ |
| **Env var management** | ✅ multi-file | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Open source** | ✅ MIT | ❌ source-available | ✅ source-available (non-competing) | ❌ | ❌ | ❌ | ❌ | Partial | ❌ |
| **Security scanning** | ❌ | ❌ | ✅ built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Voice input** | ❌ | ❌ | ✅ speech-to-text | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Where Deyad Wins

1. **100% free, 100% local** — no subscriptions, no token limits, no cloud dependency. You own everything. Dyad is also local but charges $20–$79/mo for Pro features.
2. **7 deploy targets** — nobody else offers VPS+SSL, desktop export, AND mobile (Capacitor) in one tool. Dyad only ships to GitHub + Vercel.
3. **Full database GUI** — pgAdmin embedded. Dyad uses Supabase (cloud-hosted DB). Bolt/Cursor/Windsurf/v0 have nothing comparable.
4. **True model freedom** — swap between Llama, Mistral, DeepSeek, Qwen, CodeGemma, etc. via Ollama with zero API cost. Dyad requires cloud API keys (OpenAI, Anthropic, etc.) which cost money per token.
5. **Desktop + mobile export** — unique. No competitor — including Dyad — can produce an AppImage/exe/DMG or Capacitor mobile app.
6. **Privacy** — your code and prompts never leave your machine. Dyad runs locally but still sends prompts to cloud APIs.
7. **Offline-first** — works without internet after initial setup. Dyad requires internet for its API-key-based models.
8. **Full PTY terminal** — multi-tab terminal with full shell access. Dyad has no terminal.
9. **MIT license** — truly open source. Dyad is source-available with a non-competing restriction.

## Where Competitors Win

1. **AI model quality** — Bolt/Lovable/Cursor/Dyad use Claude 3.5/4 and GPT-4o directly. Cloud models produce better code than most local models (unless you run 70B+ on a beefy GPU).
2. **Zero setup** — Bolt/Lovable/v0 work in a browser tab. Deyad needs Electron + Ollama + Docker installed.
3. **Collaboration** — Replit has real-time multiplayer editing. Deyad is single-user.
4. **Ecosystem polish** — Cursor/Windsurf have years of VC funding, large teams, and extension marketplaces. Dyad has 20k GitHub stars and a large community.
5. **Managed hosting** — Replit and Bolt bundle cloud hosting. Deyad deploys to external providers.
6. **MCP extensibility** — Dyad supports MCP servers for tool extensibility. Deyad also supports MCP via `.deyad/mcp.json` configuration.
7. **Security scanning** — Dyad has built-in security review. Deyad relies on manual review.
8. **Voice input** — Dyad supports speech-to-text prompting. Deyad is keyboard-only.

---

## Who Should Use Deyad

- Developers who want **full control** over their AI tooling and data
- Teams working on **proprietary or sensitive** projects that can't touch cloud APIs
- Users who don't want to pay **$20+/month** for an AI coding tool
- Anyone who wants to **deploy anywhere** — not just Vercel/Netlify
- Developers who need **database management** built into their workflow
- Users building **desktop or mobile apps**, not just web apps

---

## Deyad vs. Claude Code — Head-to-Head

Claude Code is the closest comparison to Deyad CLI — both are terminal-based agentic coding tools. The key difference is sovereignty.

| | **Deyad** | **Claude Code** |
| --- | --- | --- |
| Price | Free forever | Usage-based API or Max plan ($20+/mo) |
| AI models | Ollama (free, local, any model) | Claude only (Anthropic cloud) |
| Offline | ✅ yes | ❌ requires internet |
| Privacy | ✅ prompts & code stay local | ❌ sent to Anthropic servers |
| Terminal agent | ✅ agentic REPL (30 iterations) | ✅ agentic terminal |
| File read/write | ✅ | ✅ |
| Shell commands | ✅ | ✅ |
| Error auto-fix | ✅ | ✅ |
| Git operations | ✅ auto-commit | ✅ git commands |
| MCP extensibility | ✅ | ✅ |
| Vision (image input) | ✅ | ✅ |
| Diff review | ✅ | ✅ |
| GUI / Desktop app | ✅ Electron app with Monaco editor | ❌ terminal only |
| Live preview | ✅ embedded Vite | ❌ |
| Database management | ✅ SQLite + Prisma Studio | ❌ |
| Deploy (7 targets) | ✅ | ❌ |
| Desktop/mobile export | ✅ Electron + Capacitor | ❌ |
| Full-stack scaffold | ✅ React+Express+Prisma | ❌ works on existing codebases |
| FIM code completion | ✅ via Ollama | ❌ |
| Open source | ✅ MIT | ❌ source-available |
| Model quality | Local models (varies by hardware) | Claude 4 / Sonnet (state of the art) |

**Where Deyad wins:** Free, offline, private, has a GUI + live preview + database + deploy + scaffold. You own everything and pay nothing.

**Where Claude Code wins:** Model quality. Claude is one of the best coding models available. If you have a fast GPU and run 70B+ models, the gap narrows — but Claude still has an edge on complex reasoning tasks.

---

## Deyad vs. Dyad — Head-to-Head

Dyad is the closest competitor to Deyad — both are local, open-source Electron app builders. Key differences:

| | **Deyad** | **Dyad** |
| --- | --- | --- |
| Price | Free forever | Free tier + $20–$79/mo Pro |
| AI models | Ollama (free, local, offline) | Cloud API keys (paid per token) |
| Offline | ✅ yes | ❌ needs internet |
| Privacy | ✅ prompts stay local | ❌ prompts sent to cloud APIs |
| Terminal | ✅ full PTY multi-tab | ❌ |
| Deploy targets | 7 (incl. VPS+SSL, desktop, mobile) | 2 (GitHub + Vercel) |
| Desktop/mobile export | ✅ Electron + Capacitor | ❌ |
| Database | Self-hosted PG + pgAdmin | Supabase (cloud) |
| MCP servers | ✅ via .deyad/mcp.json | ✅ |
| Security scanning | ❌ | ✅ |
| Voice input | ❌ | ✅ |
| License | MIT | Source-available (non-competing) |
| Community | Growing | 20k GitHub stars |

---

## Summary

Deyad trades cloud model quality for **sovereignty, privacy, and zero cost**. Every other tool in this space — including Dyad — requires you to send your prompts to someone else's API and pay for the privilege. Deyad doesn't.

Dyad is the most similar competitor, but it depends on cloud API keys, charges for Pro features, and has a restrictive license. Deyad is fully free, fully offline, and truly MIT open source.

For a solo-developer open-source project, Deyad competes credibly on features with VC-backed tools — and wins outright on privacy, price, and deployment flexibility.

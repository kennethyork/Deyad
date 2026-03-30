# Dyad vs. Competitors

A detailed comparison of Dyad against the leading AI app builders (as of March 2026).

---

## Feature Matrix

| Feature | **Dyad** | **Dyad (Cloud)** | **Bolt.new** | **Lovable** | **Cursor** | **Windsurf** | **Replit** | **v0** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Pricing** | Free forever | Freemium ($20–$79/mo) | Freemium ($20+/mo) | Freemium ($20+/mo) | $20/mo | $15/mo | Freemium ($25+/mo) | Freemium ($20+/mo) |
| **Runs locally** | ✅ | ✅ | ❌ cloud | ❌ cloud | ✅ | ✅ | ❌ cloud | ❌ cloud |
| **Data privacy** | ✅ code never leaves machine | Partial (cloud API keys) | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **Own your AI** | ✅ Ollama (any model) | Partial (BYO API key) | ❌ locked to their API | ❌ locked | Partial (API keys) | Partial (API keys) | ❌ | ❌ |
| **Full-stack scaffold** | ✅ React+Express+Prisma+SQLite | ✅ Supabase | ✅ | ✅ | ❌ editor only | ❌ editor only | ✅ | ❌ frontend only |
| **Database management** | ✅ SQLite + Prisma Studio | ✅ Supabase | ❌ | ✅ Supabase | ❌ | ❌ | ✅ PostgreSQL | ❌ |
| **Live preview** | ✅ embedded Vite | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Agent loop (auto-fix)** | ✅ 30-iter with error recovery | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Code editor** | ✅ Monaco (VS Code engine) | ✅ visual editor | Basic | Basic | ✅ VS Code fork | ✅ VS Code fork | ✅ Monaco | ❌ |
| **Terminal** | ✅ full PTY + multi-tab | ❌ | ✅ WebContainer | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Git integration** | ✅ full (branch, push, GitHub) | ✅ GitHub deploy | ❌ | ❌ basic | ✅ | ✅ | ✅ | ❌ |
| **Deploy targets** | ✅ 7 (Vercel, Netlify, Railway, Fly, Surge, VPS+SSL, Desktop) | ✅ GitHub + Vercel | ✅ Netlify/Vercel | ✅ Netlify/Vercel | ❌ | ❌ | ✅ Replit hosting | ✅ Vercel |
| **VPS deploy + SSL** | ✅ SSH+rsync+certbot | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Desktop app export** | ✅ Electron builds | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mobile (Capacitor)** | ✅ iOS/Android | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Vision (screenshot → code)** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Diff review before apply** | ✅ | ❌ | ❌ auto-apply | ❌ auto-apply | ✅ | ✅ | ❌ | ❌ |
| **Offline capable** | ✅ | ❌ needs API keys | ❌ | ❌ | Partial | Partial | ❌ | ❌ |
| **Plugin system** | ✅ | ✅ MCP servers | ❌ | ❌ | ✅ extensions | ✅ extensions | ❌ | ❌ |
| **Env var management** | ✅ multi-file | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Open source** | ✅ MIT | ✅ source-available (non-competing) | ❌ | ❌ | ❌ | ❌ | Partial | ❌ |
| **Security scanning** | ❌ | ✅ built-in | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Voice input** | ❌ | ✅ speech-to-text | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Where Dyad Wins

1. **100% free, 100% local** — no subscriptions, no token limits, no cloud dependency. You own everything. Dyad (Cloud) is also local but charges $20–$79/mo for Pro features.
2. **7 deploy targets** — nobody else offers VPS+SSL, desktop export, AND mobile (Capacitor) in one tool. Dyad (Cloud) only ships to GitHub + Vercel.
3. **Full database GUI** — pgAdmin embedded. Dyad (Cloud) uses Supabase (cloud-hosted DB). Bolt/Cursor/Windsurf/v0 have nothing comparable.
4. **True model freedom** — swap between Llama, Mistral, DeepSeek, Qwen, CodeGemma, etc. via Ollama with zero API cost. Dyad (Cloud) requires cloud API keys (OpenAI, Anthropic, etc.) which cost money per token.
5. **Desktop + mobile export** — unique. No competitor — including Dyad (Cloud) — can produce an AppImage/exe/DMG or Capacitor mobile app.
6. **Privacy** — your code and prompts never leave your machine. Dyad (Cloud) runs locally but still sends prompts to cloud APIs.
7. **Offline-first** — works without internet after initial setup. Dyad (Cloud) requires internet for its API-key-based models.
8. **Full PTY terminal** — multi-tab terminal with full shell access. Dyad (Cloud) has no terminal.
9. **MIT license** — truly open source. Dyad (Cloud) is source-available with a non-competing restriction.

## Where Competitors Win

1. **AI model quality** — Bolt/Lovable/Cursor/Dyad (Cloud) use Claude 3.5/4 and GPT-4o directly. Cloud models produce better code than most local models (unless you run 70B+ on a beefy GPU).
2. **Zero setup** — Bolt/Lovable/v0 work in a browser tab. Dyad needs Electron + Ollama + Docker installed.
3. **Collaboration** — Replit has real-time multiplayer editing. Dyad is single-user.
4. **Ecosystem polish** — Cursor/Windsurf have years of VC funding, large teams, and extension marketplaces. Dyad (Cloud) has 20k GitHub stars and a large community.
5. **Managed hosting** — Replit and Bolt bundle cloud hosting. Dyad deploys to external providers.
6. **MCP extensibility** — Dyad (Cloud) supports MCP servers for tool extensibility. Dyad has a plugin system but not MCP.
7. **Security scanning** — Dyad (Cloud) has built-in security review. Dyad relies on manual review.
8. **Voice input** — Dyad (Cloud) supports speech-to-text prompting. Dyad is keyboard-only.

---

## Who Should Use Dyad

- Developers who want **full control** over their AI tooling and data
- Teams working on **proprietary or sensitive** projects that can't touch cloud APIs
- Users who don't want to pay **$20+/month** for an AI coding tool
- Anyone who wants to **deploy anywhere** — not just Vercel/Netlify
- Developers who need **database management** built into their workflow
- Users building **desktop or mobile apps**, not just web apps

---

## Dyad vs. Dyad (Cloud) — Head-to-Head

Dyad (Cloud) is the closest competitor to Dyad — both are local, open-source Electron app builders. Key differences:

| | **Dyad** | **Dyad (Cloud)** |
| --- | --- | --- |
| Price | Free forever | Free tier + $20–$79/mo Pro |
| AI models | Ollama (free, local, offline) | Cloud API keys (paid per token) |
| Offline | ✅ yes | ❌ needs internet |
| Privacy | ✅ prompts stay local | ❌ prompts sent to cloud APIs |
| Terminal | ✅ full PTY multi-tab | ❌ |
| Deploy targets | 7 (incl. VPS+SSL, desktop, mobile) | 2 (GitHub + Vercel) |
| Desktop/mobile export | ✅ Electron + Capacitor | ❌ |
| Database | Self-hosted PG + pgAdmin | Supabase (cloud) |
| MCP servers | ❌ | ✅ |
| Security scanning | ❌ | ✅ |
| Voice input | ❌ | ✅ |
| License | MIT | Source-available (non-competing) |
| Community | Growing | 20k GitHub stars |

---

## Summary

Dyad trades cloud model quality for **sovereignty, privacy, and zero cost**. Every other tool in this space — including Dyad (Cloud) — requires you to send your prompts to someone else's API and pay for the privilege. Dyad doesn't.

Dyad (Cloud) is the most similar competitor, but it depends on cloud API keys, charges for Pro features, and has a restrictive license. Dyad is fully free, fully offline, and truly MIT open source.

For a solo-developer open-source project, Dyad competes credibly on features with VC-backed tools — and wins outright on privacy, price, and deployment flexibility.

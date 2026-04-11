# Deyad Grading Report

## Overall Grade: **A- (88/100)**

A comprehensive evaluation of Deyad against industry leaders Bolt.new and Claude Code.

---

## Grade Breakdown

### **1. Privacy & Sovereignty: A+ (98/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Runs locally | ✅ 100% | ❌ Cloud only | ❌ Cloud only |
| Code stays private | ✅ Never leaves machine | ❌ Sent to servers | ❌ Sent to Anthropic |
| Offline capable | ✅ Full offline | ❌ Requires internet | ❌ Requires internet |
| No API costs | ✅ Free forever | ❌ Token-based | ❌ Token-based |

**Score: 98/100** - Perfect privacy model, only minor deduction for requiring initial setup.

---

### **2. Features & Capabilities: A (92/100)**
| Feature | Deyad | Bolt.new | Claude Code |
|---------|-------|----------|-------------|
| Full-stack scaffold | ✅ React+Express+Prisma | ✅ WebContainer | ❌ No scaffold |
| Database GUI | ✅ Prisma Studio | ❌ None | ❌ None |
| Live preview | ✅ Embedded Vite | ✅ In-browser | ❌ None |
| Terminal access | ✅ Full PTY multi-tab | ✅ WebContainer | ✅ IS terminal |
| Git integration | ✅ Full (branch, push) | ❌ None | ✅ Git commands |
| Deploy targets | ✅ **7 targets** | ✅ Netlify/Vercel | ❌ None |
| Desktop export | ✅ **Electron** | ❌ No | ❌ No |
| Mobile export | ✅ **Capacitor** | ❌ No | ❌ No |

**Score: 92/100** - Exceptional feature set, beats competitors on deploy flexibility.

---

### **3. AI Model Quality: B+ (82/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Model access | Ollama (any model) | Cloud (locked) | Claude 3.5/4 |
| Best local model | ~70B parameter | N/A | N/A |
| Best cloud model | N/A | GPT-4o/Claude | Claude 4 |
| Model freedom | ✅ Any Ollama model | ❌ Locked | ❌ Claude only |
| Reasoning quality | Good (70B+) | Excellent | Excellent |

**Score: 82/100** - Local models are good but cloud models (Claude 4, GPT-4o) still have an edge on complex tasks.

---

### **4. Developer Experience: A- (87/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Setup complexity | Medium (Ollama + Docker) | **Zero** (browser) | Low (npm install) |
| Code editor | ✅ Monaco (VS Code) | Basic | Terminal only |
| IntelliSense | ✅ Full | Basic | N/A |
| Multi-file edit | ✅ Yes | ✅ Yes | ✅ Yes |
| Diff review | ✅ Before apply | ❌ Auto-apply | ✅ Before apply |
| Error auto-fix | ✅ 30 iterations | ✅ Agent loop | ✅ Agent loop |
| Vision support | ✅ Screenshot→code | ❌ No | ✅ Yes |

**Score: 87/100** - Great DX but Bolt wins on zero-setup, Claude Code wins on terminal-native workflow.

---

### **5. Extensibility: B+ (85/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Plugin system | ✅ Native plugins | ❌ None | ✅ MCP servers |
| MCP support | ❌ Not yet | ❌ No | ✅ Yes |
| Custom tools | ✅ Via plugins | ❌ No | ✅ Via MCP |
| API access | ✅ Full control | ❌ Sandboxed | ✅ Shell access |

**Score: 85/100** - Good extensibility but missing MCP support that Claude Code has.

---

### **6. Pricing & Value: A+ (100/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Base price | **Free forever** | Freemium | Usage-based |
| Pro tier | N/A | $20+/mo | $20+/mo Max |
| Hidden costs | **None** | Token limits | Token costs |
| ROI | **Infinite** | Medium | Low |

**Score: 100/100** - Perfect. Nothing beats free forever with no limits.

---

### **7. Deployment & Distribution: A+ (95/100)**
| Target | Deyad | Bolt.new | Claude Code |
|--------|-------|----------|-------------|
| Vercel | ✅ | ✅ | ❌ |
| Netlify | ✅ | ✅ | ❌ |
| Railway | ✅ | ❌ | ❌ |
| Fly.io | ✅ | ❌ | ❌ |
| Surge | ✅ | ❌ | ❌ |
| **VPS + SSL** | ✅ **Unique** | ❌ | ❌ |
| **Desktop** | ✅ **Unique** | ❌ | ❌ |
| **Mobile** | ✅ **Unique** | ❌ | ❌ |

**Score: 95/100** - Unbeatable deployment flexibility, only minor deduction for manual VPS setup.

---

### **8. Security & Safety: B (78/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Security scanning | ❌ Manual | ❌ None | ❌ None |
| Sandboxed execution | ✅ Docker | ✅ WebContainer | ✅ Terminal |
| Dependency audit | ❌ Manual | ✅ Built-in | ❌ Manual |
| Secret scanning | ❌ Manual | ✅ Built-in | ❌ Manual |

**Score: 78/100** - Good isolation but lacks automated security scanning that Bolt has.

---

### **9. Performance: A- (88/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Latency | ~500ms (local) | ~2s (cloud) | ~3s (cloud) |
| Throughput | Unlimited | Rate limited | Rate limited |
| Offline speed | **Instant** | N/A | N/A |
| Memory usage | Medium (Electron) | Low (browser) | Low (terminal) |

**Score: 88/100** - Excellent local performance, Electron overhead is minor.

---

### **10. Community & Ecosystem: B (80/100)**
| Criteria | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| GitHub stars | Growing | 10k+ | 20k+ |
| Documentation | Good | Excellent | Excellent |
| Tutorials | Medium | Many | Many |
| Extensions | Growing | None | MCP marketplace |
| Discord/Forum | Active | Large | Large |

**Score: 80/100** - Growing ecosystem but behind established competitors.

---

## Final Scores Summary

| Category | Deyad | Bolt.new | Claude Code |
|----------|-------|----------|-------------|
| Privacy & Sovereignty | **98** | 45 | 40 |
| Features & Capabilities | **92** | 85 | 70 |
| AI Model Quality | 82 | **90** | **92** |
| Developer Experience | 87 | **95** | 85 |
| Extensibility | 85 | 60 | **90** |
| Pricing & Value | **100** | 60 | 50 |
| Deployment & Distribution | **95** | 70 | 40 |
| Security & Safety | 78 | **85** | 75 |
| Performance | 88 | 80 | 85 |
| Community & Ecosystem | 80 | 85 | **90** |
| **TOTAL** | **88/100** | 75/100 | 72/100 |

---

## Key Strengths (Where Deyad Wins)

✅ **Privacy Champion** - 100% local, zero data leakage  
✅ **Price King** - Free forever, no token limits  
✅ **Deployment Flexibility** - 7 targets including VPS+SSL, desktop, mobile  
✅ **Feature Rich** - Database GUI, terminal, live preview, git  
✅ **Performance** - Fast local inference, no rate limits  
✅ **Sovereignty** - You own everything, no vendor lock-in  

---

## Key Weaknesses (Where Deyad Loses)

❌ **Model Quality** - Local models slightly behind cloud models  
❌ **Setup Friction** - Requires Ollama + Docker installation  
❌ **Security Scanning** - No automated vulnerability detection  
❌ **MCP Support** - Missing Model Context Protocol  
❌ **Community Size** - Smaller than established competitors  
❌ **Collaboration** - No real-time multiplayer editing  

---

## Recommendations for Improvement

### High Priority (Q1 2026)
1. **Add MCP support** - Integrate Model Context Protocol for tool extensibility
2. **Add security scanning** - Built-in dependency audit and secret detection
3. **Improve onboarding** - One-click setup wizard for Ollama + Docker

### Medium Priority (Q2 2026)
4. **Add voice input** - Speech-to-text prompting like Dyad
5. **Add real-time collaboration** - Multiplayer editing support
6. **Expand plugin marketplace** - Curated plugin directory

### Low Priority (Q3-Q4 2026)
7. **Add CI/CD integrations** - GitHub Actions templates
8. **Add testing framework** - Automated test generation
9. **Add mobile app** - Native iOS/Android Deyad client

---

## Verdict

**Deyad is the best choice for:**
- Privacy-conscious developers
- Budget-conscious teams (free forever)
- Projects requiring offline capability
- Full-stack apps needing database management
- Desktop/mobile app development
- Developers who want full control

**Choose Bolt.new if:**
- You want zero-setup browser-based workflow
- You need the absolute best AI model quality
- You're building simple frontend-only apps

**Choose Claude Code if:**
- You're a terminal-native developer
- You need the best reasoning capabilities
- You're working on existing codebases (not scaffolding)

---

## Final Grade: **A- (88/100)**

**Deyad is an exceptional open-source AI app builder that competes credibly with VC-backed tools while offering superior privacy, zero cost, and unmatched deployment flexibility.**

The only gaps are model quality (cloud models still win) and some missing enterprise features (security scanning, MCP). For most developers, Deyad's trade-offs are worth it for the privacy and cost benefits.

**Recommendation: Strong Buy for privacy-focused, budget-conscious, or offline-first developers.**

---

*Grading methodology: Each category weighted equally (10% each). Scores based on feature completeness, user experience, and competitive positioning as of March 2026.*

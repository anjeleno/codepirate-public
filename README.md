# Code Pirate

> Never get your AI lobotomized mid-subscription again.

Code Pirate is a 1:1 GitHub Copilot replacement built for developers who are done being held hostage by SaaS bait-and-switches. When a monopoly controls the middleman, they control your capabilities — selling you a Senior Engineer, locking you into a contract, and silently downgrading it to a Junior Dev to pad their margins.

Code Pirate makes your toolchain unbreakable. By operating entirely on a **Bring-Your-Own-Key (BYOK)** architecture, it routes your codebase directly to OpenRouter, direct provider APIs, or local offline models — with zero corporate rate limits, zero hidden token multipliers, and zero silent model downgrades.

They pulled the rug. We're taking the ship.

---

## Installation

### Step 1 — Install the extension

**From a `.vsix` file (current):**
1. Open VS Code
2. Go to Extensions sidebar → `⋯` menu (top right) → **Install from VSIX…**
3. Select the `.vsix` file
4. Reload VS Code when prompted

**From the VS Code Marketplace (coming soon):**
Search for **Code Pirate** and click Install.

---

### Step 2 — Add your API key

On first install, Code Pirate automatically opens the setup wizard. If it doesn't appear, run it manually:

**Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) → **Code Pirate: Set Up API Key**

The wizard walks you through:
1. **Choose a provider** — OpenRouter, Anthropic Direct, Groq, Mistral, Gemini, Together AI, Ollama, LM Studio, or a custom OpenAI-compatible endpoint
2. **Enter your API key** — stored encrypted in VS Code's SecretStorage (never transmitted to CodePirate.cc)
3. **Done** — the sidebar opens automatically

**Where to get an API key:**
- [OpenRouter](https://openrouter.ai/keys) — recommended; access 200+ models through one key
- [Anthropic](https://console.anthropic.com/) — direct access to Claude models
- [Groq](https://console.groq.com/) — fast inference, free tier available
- [Mistral](https://console.mistral.ai/) — European provider
- [Google AI Studio](https://aistudio.google.com/) — Gemini models
- **Ollama / LM Studio** — no key required; runs fully offline

---

### Step 3 — Open the sidebar

Code Pirate lives in the **right sidebar** (Secondary Side Bar) — the same panel where Copilot sits. If it's not visible:

**Command Palette** → **Code Pirate: Open Sidebar**

You can drag it to any panel in VS Code — the layout is yours to keep.

---

## The Sidebar

### Provider & Model Selector

At the top of the sidebar, two controls:

- **Provider dropdown** — switch between all configured providers
- **Model search** — type to filter. For OpenRouter, this searches all 200+ available models in real time, showing model name, ID, price per 1k tokens, and context length. For other providers, a curated list is shown. Start typing a name, click to select.

The badge to the right shows **Free** or **⚡ Pro** (your license tier).

---

### Chat (Lead Architect mode)

The main chat interface. Type a message and press Enter or click Send.

**What to ask:**
- Architecture questions: *"How should I structure authentication in this app?"*
- Code generation: *"Add a rate limiter to the Express router"*
- Explain code: *"Walk me through what this function does"*
- Refactor requests: *"Rewrite this to be more idiomatic TypeScript"*
- Anything you'd ask a senior engineer

**Workspace context (`@workspace`):** Toggle the **@workspace** checkbox to include your full codebase as context. Code Pirate indexes your project files and injects the most relevant ones, token-weighted. Leave it off for quick questions; turn it on when the model needs to understand your codebase structure.

**Thinking Budget Dial:** Five positions — Off, Low, Medium, High, Max. Controls how much reasoning the model does before responding. Higher = better answers on complex problems, higher cost, more latency. Off = fastest and cheapest.

**Personas:** Three chat modes selectable from the toolbar:
- **Lead Architect** — default; full system prompt optimized for architectural decisions and code generation
- **Diff Agent** — focused on producing clean, reviewable file changes
- **Snippet Engine** — optimized for short, precise code completions and one-liners

---

### Multi-File Diff & Apply

When Code Pirate's response includes file changes (fenced code blocks with file paths), a **diff bar** appears at the bottom of the chat. It shows how many files were modified.

- **Preview** — opens a side-by-side diff view for each changed file. Review every line before anything touches your codebase.
- **Apply All** — writes the changes to disk
- **Reject** — discards the pending changes

Ghost Diff checks file modification times before writing — if you've manually edited a file after the AI response, it will not silently overwrite your work.

---

### Captain's Ledger

The cost tracker in the sidebar footer shows:
- **Input tokens** used this session
- **Output tokens** generated
- **Actual cost in USD** (calculated from the model's published pricing)
- **Saved vs. Copilot** — what you would have paid if Copilot were doing the same work at its effective cost-per-token

Prompt caching is applied automatically where supported (Anthropic, OpenRouter). Cache hits show as reduced costs in the Ledger — typically 60–90% savings on repeated system prompts and vault context.

---

### Blueprint Vault

A local library of saved prompt templates. Use it to store:
- Project-specific instructions you add to every conversation
- Frequently used prompts (code review checklist, commit message format, etc.)
- System prompt fragments you mix into chats

**To save:** Click **Save to Vault** in the Vault tab, give it a name, paste the content.  
**To use:** Select a vault entry — it's automatically included in your next chat as additional context.

---

### Settings Tab

Change your provider and API key at any time without re-running the setup wizard. Useful when switching between OpenRouter for general work and Anthropic Direct for heavy reasoning tasks.

---

## Command Palette Commands

All commands are accessible via `Ctrl+Shift+P` / `Cmd+Shift+P`:

| Command | Description |
|---------|-------------|
| **Code Pirate: Open Sidebar** | Opens the Code Pirate panel |
| **Code Pirate: Set Up API Key** | Re-runs the setup wizard — change provider or update key |
| **Code Pirate: Inline Chat** | Opens an inline chat input at your cursor (`Ctrl+I` / `Cmd+I`) |
| **Code Pirate: Explain Terminal Error** | Pastes the last terminal error into chat and asks for an explanation and fix |
| **Code Pirate: Generate Commit Message** | Reads your staged git diff and writes a commit message |
| **Code Pirate: Generate .projectrules** | Wizard that interviews you about your stack and generates a `.projectrules` file |
| **Code Pirate: Activate License** | Enter a Pro license key |
| **Code Pirate: Run Diagnostics** | Runs a self-test and opens a report in the Output panel. Also writes `/tmp/codepirate-diagnostics.json`. |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+I` / `Cmd+I` | Inline chat at cursor (when editor is focused) |

---

## Inline Ghost Text Completions

Code Pirate provides inline ghost text completions as you type — the same experience as Copilot's tab completions. They run on your own API key with no daily cap.

**Tips:**
- Use a fast, cheap model for completions (e.g. `claude-haiku-3-5`, `llama-3.1-8b-instant`) — set it as your active model when doing heavy editing
- Use a powerful model for chat (e.g. `claude-opus-4-5`, `gpt-4o`) — switch in the model selector

---

## `.projectrules` Support

Code Pirate automatically detects and injects your project instructions file into every chat as system context. Supported files (checked in priority order):

1. `.projectrules` (Code Pirate native)
2. `.github/copilot-instructions.md` (Copilot users — zero migration friction)
3. `.cursorrules` (Cursor users)

**Generate one from scratch:** Command Palette → **Code Pirate: Generate .projectrules** — a guided wizard interviews you about your stack, conventions, and preferences and writes the file.

---

## Supported Providers

| Provider | Type | Notes |
|----------|------|-------|
| **OpenRouter** | Cloud | 200+ models via one key — recommended for most users |
| **Anthropic Direct** | Cloud | Direct Claude access — different request schema, handled automatically |
| **Groq** | Cloud | Fast inference; free tier available |
| **Mistral** | Cloud | European provider |
| **Google Gemini** | Cloud | Gemini 2.5 Pro/Flash |
| **Together AI** | Cloud | Open model hosting |
| **Ollama** | Local | No key required; fully offline |
| **LM Studio** | Local | No key required; fully offline |
| **Custom endpoint** | Any | Any OpenAI-compatible API — enter the URL manually |

Endpoints are pre-filled automatically for each provider. The only manual entry needed is your API key.

---

## Troubleshooting

**Sidebar is blank or shows "Loading…" after install:**
Run **Code Pirate: Run Diagnostics** from the Command Palette. The report will show which check failed. Common causes:
- Extension just installed and hasn't fully activated — try **Reload Window**
- API key not yet entered — run **Code Pirate: Set Up API Key**

**Diagnostics report shows ⚠ API key stored: No key:**
The setup wizard didn't complete or the key didn't save. Run **Code Pirate: Set Up API Key** to re-enter it.

**Running on VS Code Remote (SSH, containers, WSL):**
Fully supported. Code Pirate uses an IIFE-format webview bundle specifically to work in SSH Remote environments where ES module scripts are blocked. If something isn't working, run diagnostics — the report includes your `Remote kind` and will flag any asset loading issues.

**Chat sends but no response arrives:**
Check the **Captain's Ledger** — if input tokens are counting up but output is empty, the provider API responded with an error. The error will appear in the chat. Verify your API key is valid and has credits.

---

## Privacy

**Your API key never leaves your machine.** It is stored in VS Code's built-in encrypted SecretStorage and sent directly from your editor to your chosen AI provider. CodePirate.cc is not a middleman — we never see, receive, or log your key or your prompts.

Phone-home is **license validation only**. The validation request contains your license key and product ID — nothing else. No prompt content, no usage data, no telemetry, no file paths, no model selections are ever transmitted.

---

## License

MIT — [codepirate.cc](https://codepirate.cc)


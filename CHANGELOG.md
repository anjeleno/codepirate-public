# Code Pirate — Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

<!-- LAST_PACKAGED_COMMIT: 385ac2fbaeb85088f680d785f956587639210bb4 -->
<!-- CHANGES -->

## [0.1.24] - 2026-05-02

---

## [0.1.23] - 2026-05-02

### Fixed
- Changelog step

### Changed
- Group by feat/fix prefix, strip hashes, skip when no new commits; fix CHANGELOG.md 0.1.22 entry

---

## [0.1.22] - 2026-05-02

### Added
- Captain's Ledger: new "Next request" row — bold orange, shows live pre-send cost estimate that updates as you type
- CHANGELOG.md — full history from v0.1.0 through v0.1.21 sourced from git log and handoff docs
- package.sh step 1b: auto-generates a new changelog section on every version bump; groups commits by type into Added/Fixed/Changed; skips if no new commits

### Fixed
- sync-public.sh: CHANGELOG.md was missing from SYNC_ITEMS — it now syncs to the public repo on every `./sync-public.sh` run

### Changed
- Captain's Ledger: removed "OR total spend" row (negative balance — meaningless and confusing for pay-as-you-go OpenRouter accounts)
- Cost estimate below send button: color changed from grey to orange; opacity raised for visibility

---

## [0.1.21] - 2026-05-02

### Fixed
- Active file content not injecting into chat messages — file name appeared in footer but content was never sent to the model
- 📎 paperclip button unreliable — required multiple taps; caused by webview focus race and slow async `findFiles` scan
- CodePirate identifying itself as "built by Anthropic" regardless of selected model

### Added
- Universal Code Pirate identity preamble injected into all persona system prompts
- `getSystemPrompt` now accepts active model ID; model can accurately self-report which model is running when asked
- Slash commands `/fix`, `/explain`, `/tests`, `/doc` with autocomplete dropdown and Tab completion
- `#file` attachment via 📎 button — instantly attaches the current open editor file as a labelled code block
- Right-click 📎 to open full workspace file browser
- Active file footer indicator — shows currently open file name in chat panel

### Changed
- Default model changed from `anthropic/claude-opus-4` to `deepseek/deepseek-v4-pro` across all 9 call sites (6 files)
- 📎 button now posts `requestActiveFile` (synchronous, always reliable); QuickPick browser available via right-click

---

## [0.1.15–0.1.18] - 2026-04-29 to 2026-04-30

### Added
- Inline chat accept/discard UX — green highlight on proposed edit, Tab to accept, Esc to discard
- DeepSeek V4 Pro pricing in model list
- `codePirate.enableInlineCompletions` setting — ghost text completions now opt-in (off by default, prevents accidental charges)
- `--release` flag in `package.sh` — creates GitHub Release with .vsix attached via curl+PAT (no gh CLI required)
- `--release` flag added to `sync-public.sh`

### Fixed
- Model ID routing bug in OpenRouter SSE chunks — actual model now emitted correctly, not echoed from request
- ProviderSelector blur race condition — switching providers no longer reverts on blur
- 402 error UX — clear user-facing message when API key has insufficient credits
- Pre-send cost estimate now includes ~700-token system prompt overhead for accurate low-input estimates
- Non-OpenRouter provider pricing fallback for cost estimate (Anthropic Direct, Groq, Mistral)
- Ledger label corrections
- Inline completions no longer fire on every keystroke by default

---

## [0.1.10] - 2026-04-23

### Fixed
- Build failure (esbuild "Unexpected `}`") — stray closing brace in `diff.ts` left by prior SEARCH/REPLACE rewrite

---

## [0.1.9] - 2026-04-23

### Added
- SEARCH/REPLACE diff block format (`<<<<<<< SEARCH / ======= / >>>>>>> REPLACE`) — same format as Aider/Cursor; eliminates streaming entire file content into chat
- Auto-preview diff in VS Code diff view immediately after stream ends — no manual "Preview diff" click required
- `applyChanges()` applies hunks sequentially per file with "search text not found" error path
- Diagnostics panel rewritten as live-streaming `WebviewPanel` — each check logs in real time

---

## [0.1.5–0.1.8] - 2026-04-22

### Added
- `Code Pirate: Run Diagnostics` command — 9-check self-test (API key, provider reachability, workspace indexer, etc.)
- Collapsible controls panel (persona selector, thinking budget, workspace toggle)
- OpenRouter credit balance display in Captain's Ledger
- Draggable textarea resize (upward drag supported)
- `Free` badge in extension header
- Copy full chat conversation to clipboard
- Async workspace token count for accurate pre-send cost estimate
- Chat history panel (scroll back through session messages)
- Collapsible thinking shade with pulsing indicator; full `[Thinking]...[/Thinking]` block preserved in copy output
- Session cost ledger with "Saved vs. Copilot Pro" calculation

### Fixed
- IIFE webview bundle format for SSH Remote compatibility (fixes blank panel in remote dev environments)
- OR balance null-handling, clipboard execCommand, upward drag resize
- Terminated error code mapping

---

## [0.1.4] - 2026-04-22

### Fixed
- Root cause of stuck loading screen — `type="module"` script tag + CSP `cspSource` fix
- SecretStorage initialization hang on headless Linux — `initialized` message posted immediately; visibility-change retry + 2s ready-retry interval added

---

## [0.1.2] - 2026-04-22

### Added
- OpenRouter model dropdown with filterable autocomplete and 24h model list cache
- Static model lists per-provider (Anthropic Direct, Groq, Mistral, Ollama)

### Fixed
- Sidebar CSS path and `secondarySidebar` container handling

---

## [0.1.1] - 2026-04-22

### Added
- First-run onboarding wizard — API key setup and provider selection on fresh install

---

## [0.1.0] - 2026-04-22

### Added
- Initial release
- Sidebar chat with full streaming (OpenRouter, Anthropic Direct, Groq, Mistral, Ollama)
- Inline chat (`Ctrl+I` on selection) with diff apply and reject
- Ghost text / inline completions (opt-in)
- Commit message generation from staged diff
- Terminal error explain
- Workspace context injection (`@workspace` toggle)
- Project rules support (`.projectrules`, `.cursorrules`, `.github/copilot-instructions.md`)
- Apply AI edits via diff view with accept/reject
- Multi-provider support with per-provider model lists
- Custom personas — Architect, Diff, Snippet
- Extended thinking support (Claude models)
- Vault — saved prompts and snippets

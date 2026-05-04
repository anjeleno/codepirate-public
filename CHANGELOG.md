# Code Pirate — Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

<!-- LAST_PACKAGED_COMMIT: cd54c620bb2e02815fa5100ccec75d85d8583c91 -->
<!-- CHANGES -->

## [0.1.38] - 2026-05-03

### Fixed
- **Copy to clipboard broken in VS Code webviews**: `copyToClipboard()` now tries `navigator.clipboard.writeText()` first (the correct API for webview sandboxes), falling back silently to the legacy `execCommand` approach if rejected. The ⎘ Last and ⎘ All toolbar buttons now work.

### Added
- **Right-click copy context menu**: right-clicking anywhere in the chat area (when messages exist) shows a VS Code-styled floating context menu with two options — **Copy last exchange** (most recent user prompt + assistant reply) and **Copy all** (entire current thread). Menu auto-dismisses on any click or scroll. Styled with native VS Code menu tokens (`--vscode-menu-background`, `--vscode-menu-selectionBackground`, etc.).

---

## [0.1.37] - 2026-05-03

### Fixed
- **Critical — agent-loop edits not saved to disk**: `runAgentLoop()` applies file edits via `vscode.workspace.applyEdit()` (in-memory only). A new `try/finally` block now calls `vscode.workspace.save()` for every modified file before the loop exits — build/deploy scripts no longer pick up stale on-disk versions. Posts a `✓ N files saved: [list]` summary in chat.
- **Chat history losing sessions on webview reload**: sessions were only persisted when the user explicitly clicked `+`. Current chat now auto-saves to `localStorage` on every message (`codePirate.currentSession` key) and restores on webview panel teardown/reload via a new `RESTORE_CURRENT` reducer action.
- **502 provider errors not retried**: added 502 retry in the agent loop (up to 2× with 5s/10s back-off), matching the existing 429 retry pattern. Posts `⚠️ Provider error (502) — retrying…` in chat.
- **Stream watchdog firing too early**: increased `startStreamWatchdog()` default timeout from 90s to 180s — 90s was too narrow for long CORE responses with slow-start rounds.
- **Error bar X button unreachable on long errors**: `.error-bar` switched to `align-items: flex-start`; added `word-break: break-word` on the text span and `flex-shrink: 0` on the dismiss button — X is always visible regardless of error length.
- **History tab icon unclear**: renamed from `🕐` emoji to the text label `History`, consistent with Chat / Vault / Settings.

### Added
- **OpenRouter sub-provider routing**: two new VS Code settings — `codePirate.openrouterIgnoreProviders` (array, e.g. `["Parasail"]`) and `codePirate.openrouterRequireProviders` (array, e.g. `["DeepInfra"]`). When set, injects OpenRouter's `provider: { ignore, order, allow_fallbacks: true }` routing object into requests, letting users avoid bad sub-providers or pin to preferred ones without switching models.

---

## [0.1.36] - 2026-05-03

### Fixed
- **Stream stall detection**: 90-second watchdog timer on all three stream paths (handleChat, runAgentLoop, handleContinue). If no data arrives from the provider for 90s, the AbortController fires and a clear error is posted — prevents silent indefinite hangs when providers drop the connection mid-generation.
- **Active-file disruption during streaming**: `notifyActiveFile()` now suppresses `activeFileChanged` posts while a stream is in progress. Both `handleChat` and `handleContinue` re-emit the current file once streaming ends. Switching files in the editor mid-task no longer risks disrupting the running stream.
- **Webview reload mid-task**: `sendInitialState()` now includes `streaming: this.streaming` in the posted state. The `INITIALIZED` reducer restores the `streaming` flag and sets `waitingForResponse` if a stream is in progress — so a webview reload no longer drops the in-progress UI state.
- **DeepSeek V4 Pro pricing**: corrected from `$0.27/$1.10` (old V3 price) to `$0.435/$0.87` per 1M input/output tokens. Session cost was displaying ~5× too low.
- **"Saved vs. Copilot Pro" removed from Ledger**: the comparison was producing nonsensical values with no relationship to actual session spend.

### Added
- **Live elapsed timer**: "Waiting for response… (Xs)" / "Working… (Xs)" / "Building… auto-continuing (Xs)" banner that ticks every second while any stream is in progress — from send through final token.
- **Planner Q&A Domain 5.5 — Visual Design & UX**: non-optional for any project with a user interface. Covers theme, aesthetic direction, layout priority, accessibility, and brand assets. An explicit fallback prompt fires if the user hasn't addressed visual design by the time Technical Foundation is settled. Blueprint format updated with matching `## Visual Design & UX` section.

---

## [0.1.35] - 2026-05-03

### Context
Live testing with DeepSeek V4 Pro via OpenRouter revealed two hard failures: (1) the agent loop had zero retry logic — a single HTTP 429 from an upstream provider killed the entire loop immediately, burning ~$0.03 in context tokens per failed attempt with no recovery; (2) there was no visible feedback between message send and first token, leaving users staring at an ambiguous blinking cursor with no indication of whether the model was working or dead. Fixed both.

### `src/sidebar.ts`
- Imported `RouterError` from `./router`.
- `runAgentLoop()`: `routeRequest()` call wrapped in a `for (attempt 0..3)` retry loop. On `RouterError` with `statusCode === 429` and attempt < 3, posts a visible `_⏳ Provider rate limit — retrying in Xs (attempt N/3)…_` `streamChunk` message, waits `(attempt+1) * 8` seconds, then retries. Any other error or exhausted retries re-throws immediately.
- `handleChat()` catch block: added `HTTP 429 / rate` branch before the existing 402 branch — surfaces a human-readable message explaining the upstream provider is rate-limited, that it's an OpenRouter infrastructure issue, and to wait or switch models.

### `webview/src/components/MessageList.tsx`
- Added `connecting-indicator` block inside the streaming assistant bubble: rendered when `streaming && !streamingText && !streamingThinking && toolProgressItems.length === 0` — i.e. request is in flight but no output has arrived yet. Shows animated dots + "Connecting to provider…" text.

### `webview/src/App.css`
- Added `.connecting-indicator`, `.connecting-dots::before`, `@keyframes connecting-pulse` styles — dots animate through opacity 1→0.4→0.7→1 at 1.2s cycle.

### Commit Bullets
- fix: runAgentLoop retries up to 3× on HTTP 429 with 8/16/24s backoff; posts visible retry status in chat
- fix: handleChat surfaces friendly 429 error message after all retries exhausted
- feat: "Connecting to provider…" animated indicator while waiting for first token

---

## [0.1.34] - 2026-05-03

### Added
- Q&A Project Planner

### Changed
- Planner.ts, plannerActive routing, blueprint context injection, Pro gate

---

## [0.1.33] - 2026-05-03

### Changed
- feat: Q&A Project Planner — new planner.ts, 'planner' persona, plannerActive routing
- feat: blueprint.md context injection into CORE with threshold-based summary fallback
- feat: conditional PROJECT BLUEPRINT instruction added to CORE system prompt
- feat: mergeRulesSection() in rules.ts for post-synthesis .projectrules update
- feat: canUsePlanner() Pro gate on LicenseManager
- feat: codePirate.planProject command registered in extension.ts + package.json

---

## [0.1.32] - 2026-05-03

### Added
- **Tool-calling agent loop (v1.4)** — CORE persona on tool-capable providers (OpenRouter, Groq, Together, Mistral, Gemini, Custom) now uses the OpenAI function-calling standard instead of SEARCH/REPLACE markdown parsing. Model receives 5 tool schemas (`read_file`, `write_file`, `str_replace`, `insert_at_line`, `list_dir`), responds with structured `tool_calls` deltas, extension executes each via `vscode.workspace.WorkspaceEdit` (native undo/redo, SSH Remote safe), loops up to 20 rounds
- `src/tools.ts` — new module: `AGENT_TOOLS` (5 tool definitions), `executeTool()` dispatcher, exported `resolvePath()` (single canonical path resolver, now imported by `diff.ts`)
- **Right-click smart actions** — "Code Pirate: Explain" and "Code Pirate: Fix" in editor right-click context menu when text is selected; wired to CORE agent loop
- **Tool progress UI** — real-time webview indicators during agent loop execution: "📖 Reading…", "✏️ Editing…", "✓ Read", "✓ Edited", "✗ Failed" per tool call
- `ChatMessage` extended with `role: 'tool'`, `toolCalls?`, `toolCallId?` fields
- `ToolDefinition`, `ToolCall` types; `RequestOptions.tools`; `StreamYield` `tool_call` variant
- `supportsToolCalling(provider)` helper in `sidebar.ts` — gates agent loop to providers that support the OpenAI function-calling schema
- `sendSelectionExplain()` / `sendSelectionFix()` public methods on `SidebarProvider` for right-click command wiring

### Fixed
- **Agent loop routing bug** — condition was `persona !== 'snippet'` which incorrectly sent the Diff Agent persona through the tool-calling loop (conflicting with its SEARCH/REPLACE system prompt); corrected to `persona === 'core'`

### Changed
- `src/diff.ts` — marked deprecated with header comment block; `resolvePath()` removed from this file (now imported from `tools.ts`); `os` import removed; all functionality retained for anthropic-direct + local provider fallback path and `handleContinue()` continuation loop
- `src/personas.ts` — CORE `FILE OUTPUT FORMAT` section rewritten: tool calls are primary for tool-capable providers; SEARCH/REPLACE explicitly labelled as fallback for Anthropic Direct and local models
- Blueprint (`docs/00-CODE-PIRATE.md`) — Section 1 structure updated (tools.ts added, diff.ts deprecated); Section 5 (Diff & Apply) completely rewritten for two-path architecture; Section 13 (Gap Analysis) updated to May 3 2026 with right-click and agentic editing moved to ✅ parity-achieved

---

## [0.1.31] - 2026-05-03

### Added
- Insert-after line format

### Fixed
- Expand ~ paths to home dir in diff engine

---

## [0.1.30] - 2026-05-03

### Fixed
- Preview new files without 'file could not be found'

### Changed
- Use empty temp baseline when original doesn't exist on disk

---

## [0.1.29] - 2026-05-03

---

## [0.1.28] - 2026-05-03

### Fixed
- Silent SEARCH/REPLACE mismatch

### Changed
- Show visible marker in preview, surface apply failures in chat, keep banner on failure

---

## [0.1.27] - 2026-05-03

### Fixed
- CORE file-editing protocol

### Changed
- Bump to v0.1.26
- Restore pre-send cost estimate; fix CORE file-editing protocol; add reasoning mode table
- Replace broken markdown-header format with diff.ts-compatible formats; add SEARCH/REPLACE syntax; add reasoning mode table

---

## [0.1.26] - 2026-05-03

### Fixed
- **Pre-send cost estimate restored** — OpenRouter returns versioned model slugs (e.g. `deepseek/deepseek-v4-pro-20260423`) that never matched the unversioned default model ID. Added prefix-match fallback in the `estimatedCost` memo. Added `openrouter` static pricing table in `ProviderSelector.tsx` (DeepSeek V4-Pro: $0.00108/1k in, $0.00555/1k out) so the estimate shows even before the OR models fetch completes.
- **CORE file-editing protocol** — `## MULTI-FILE OUTPUT FORMAT` in the CORE persona described a `### path/to/file.ts` markdown-header format that `diff.ts` never parses. File edits were being ignored and output was pasted into chat instead. Replaced with `## FILE OUTPUT FORMAT` documenting the three formats the apply engine actually reads. Added SEARCH/REPLACE syntax with example.

### Added
- **Reasoning mode quick-reference table** in CORE persona — collapses per-mode reasoning instructions into one scannable lookup table (Non-think / Think High / Think Max by task type)

---

## [0.1.25] - 2026-05-03

### Added
- **CORE persona** — replaces Lead Architect (`'architect'`→`'core'`); full `PersonaV1.md` embedded as system prompt; senior principal engineer identity with autonomous build mode
- `src/phaseDetector.ts` — new canonical module: `Phase` type, `detectPhase()` (regex over user message), `phaseToThinkingBudget()`, `phaseToMaxTokens()`
- `codePirate.maxTokens` setting — user override for phase-computed token ceiling (DeepSeek V4-Pro supports up to 1M context)
- Building/paused banners in sidebar chat during autonomous CORE builds

### Changed
- **Autonomous continuation loop** — CORE emits `[CONTINUING — next: path]` sentinel; App.tsx auto-triggers continuation; sidebar.ts drives up to 12 auto-continuations with `buildPaused` safety gate and Resume button
- **DeepSeek V4-Pro**: explicit `temperature=1.0` / `top_p=1.0` in `buildOpenAIRequest`; reasoning directives (non-think / think-high / think-max) appended to system prompt by phase
- `getSystemPrompt(persona, model?, phase?)` extended with `phase` param for directive injection
- Phase-aware token limits: Build/Architecture → 32768; all others → 8192

---

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

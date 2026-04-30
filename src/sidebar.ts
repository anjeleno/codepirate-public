import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { routeRequest, parseStream, PROVIDER_PRESETS, isLocal } from './router'
import { buildRequestOptions } from './context'
import { WorkspaceIndexer } from './indexer'
import { parseFileChanges, DiffManager } from './diff'
import { BudgetLedger } from './budget'
import { VaultManager } from './vault'
import { SnapshotCache } from './cache'
import { LicenseManager } from './license/licenseManager'
import type {
  RouterConfig,
  Provider,
  Persona,
  ThinkingBudget,
  ChatMessage,
  SessionCost,
} from './types'
import type { VaultEntry } from './types'

// ─── Webview → Extension message types ───────────────────────────────────────

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'chat'; message: string; persona: Persona; thinkingBudget: ThinkingBudget; includeWorkspace: boolean }
  | { type: 'setApiKey'; key: string }
  | { type: 'setProvider'; provider: Provider }
  | { type: 'setModel'; model: string }
  | { type: 'cancelStream' }
  | { type: 'previewDiff' }
  | { type: 'applyDiff' }
  | { type: 'rejectDiff' }
  | { type: 'saveVaultEntry'; name: string; content: string }
  | { type: 'deleteVaultEntry'; id: string }
  | { type: 'activateLicense'; key: string }
  | { type: 'clearHistory' }
  | { type: 'terminalError'; errorText: string }
  | { type: 'estimateWorkspaceTokens' }

// ─── Extension → Webview message types ───────────────────────────────────────

type ExtensionMessage =
  | { type: 'initialized'; state: InitialState }
  | { type: 'streamChunk'; text: string }
  | { type: 'thinkingChunk'; text: string }
  | { type: 'streamEnd'; thinking?: string }
  | { type: 'streamError'; error: string }
  | { type: 'ledgerUpdate'; ledger: SessionCost }
  | { type: 'vaultEntries'; entries: VaultEntry[] }
  | { type: 'licenseStatus'; tier: 'free' | 'pro'; expiresAt?: string }
  | { type: 'diffReady'; count: number; files: string[] }
  | { type: 'diffApplied'; applied: string[]; failed: string[] }
  | { type: 'apiKeySet'; hasKey: boolean }
  | { type: 'modelsLoaded'; models: ModelInfo[] }
  | { type: 'creditBalance'; balance: number }
  | { type: 'workspaceTokens'; tokens: number }
  | { type: 'error'; message: string }

interface ModelInfo {
  id: string
  name: string
  contextLength: number
  promptCostPer1k: number
  completionCostPer1k: number
  provider: string
}

interface InitialState {
  provider: Provider
  model: string
  hasApiKey: boolean
  tier: 'free' | 'pro'
  ledger: SessionCost
  vaultEntries: VaultEntry[]
  providers: Array<{ id: Provider; label: string; isLocal: boolean }>
}

// ─── Debug file logger ────────────────────────────────────────────────────────
// Writes timestamped lines to /tmp/codepirate-debug.log so issues can be
// diagnosed without switching extensions. Safe to ship — log rotates at 100KB.

const DEBUG_LOG = path.join(
  process.platform === 'win32' ? (process.env.TEMP ?? 'C:\\Temp') : '/tmp',
  'codepirate-debug.log',
)

function dbg(msg: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`
    const stat = fs.existsSync(DEBUG_LOG) ? fs.statSync(DEBUG_LOG) : null
    if (stat && stat.size > 100_000) fs.writeFileSync(DEBUG_LOG, line) // rotate
    else fs.appendFileSync(DEBUG_LOG, line)
  } catch { /* never throw from a debug helper */ }
}

// ─── Sidebar WebviewViewProvider ─────────────────────────────────────────────

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codePirate.sidebar'

  private _view?: vscode.WebviewView
  private _initialized = false
  private conversationHistory: ChatMessage[] = []
  private abortController: AbortController | null = null
  private streaming = false

  private readonly ledger = new BudgetLedger()
  private readonly snapshotCache = new SnapshotCache()
  private readonly diffManager: DiffManager
  private readonly indexer = new WorkspaceIndexer()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
    private readonly vaultManager: VaultManager,
    private readonly licenseManager: LicenseManager,
  ) {
    this.diffManager = new DiffManager(this.snapshotCache)
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    dbg('resolveWebviewView called')
    this._view = webviewView
    this._initialized = false

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview)
    dbg(`HTML injected — scriptUri nonce set`)

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      dbg(`msg from webview: ${msg.type}`)
      await this.handleMessage(msg)
    })

    // Re-push state whenever the view becomes visible (handles cases where the
    // initial post() was dropped because the view wasn't visible yet).
    webviewView.onDidChangeVisibility(() => {
      dbg(`visibility changed — visible=${webviewView.visible} initialized=${this._initialized}`)
      if (webviewView.visible && !this._initialized) {
        this.sendInitialState().catch(() => {})
      }
    })
  }

  // Called from extension.ts to inject a terminal error as a chat message
  async sendTerminalError(errorText: string): Promise<void> {
    if (!this._view) return
    const message = `Explain this error and suggest a fix:\n\`\`\`\n${errorText}\n\`\`\``
    // Simulate a chat message from the user
    await this.handleMessage({ type: 'chat', message, persona: 'architect', thinkingBudget: 'off', includeWorkspace: false })
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        dbg('ready received — calling sendInitialState')
        try {
          await this.sendInitialState()
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          dbg(`sendInitialState threw: ${errMsg}`)
          this.post({ type: 'error', message: `Init failed: ${errMsg}` })
        }
        break

      case 'chat':
        await this.handleChat(msg.message, msg.persona, msg.thinkingBudget, msg.includeWorkspace)
        break

      case 'setApiKey': {
        await this.secrets.store('codePirate.apiKey', msg.key.trim())
        this.post({ type: 'apiKeySet', hasKey: true })
        break
      }

      case 'setProvider': {
        await vscode.workspace
          .getConfiguration()
          .update('codePirate.provider', msg.provider, vscode.ConfigurationTarget.Global)
        break
      }

      case 'setModel': {
        await vscode.workspace
          .getConfiguration()
          .update('codePirate.model', msg.model, vscode.ConfigurationTarget.Global)
        break
      }

      case 'cancelStream': {
        this.abortController?.abort()
        this.streaming = false
        break
      }

      case 'previewDiff':
        await this.diffManager.previewChanges()
        break

      case 'applyDiff': {
        const result = await this.diffManager.applyChanges()
        this.post({ type: 'diffApplied', applied: result.applied, failed: result.failed })
        break
      }

      case 'rejectDiff':
        this.diffManager.clearPending() // also cleans up temp preview files
        break

      case 'saveVaultEntry': {
        await this.vaultManager.saveEntry(msg.name, msg.content)
        this.post({ type: 'vaultEntries', entries: this.vaultManager.getEntries() })
        break
      }

      case 'deleteVaultEntry': {
        await this.vaultManager.deleteEntry(msg.id)
        this.post({ type: 'vaultEntries', entries: this.vaultManager.getEntries() })
        break
      }

      case 'activateLicense': {
        const status = await this.licenseManager.setKey(msg.key)
        this.post({ type: 'licenseStatus', tier: status.tier, expiresAt: status.expiresAt })
        break
      }

      case 'clearHistory':
        this.conversationHistory = []
        this.ledger.reset()
        break

      case 'terminalError':
        await this.sendTerminalError(msg.errorText)
        break

      case 'estimateWorkspaceTokens': {
        const currentFile = vscode.window.activeTextEditor?.document.uri.fsPath
        const vsConfig = vscode.workspace.getConfiguration('codePirate')
        const model = vsConfig.get<string>('model') ?? 'anthropic/claude-opus-4'
        const tokens = await this.indexer.estimateTokenCount(currentFile, model)
        dbg(`estimateWorkspaceTokens: ${tokens} tokens`)
        this.post({ type: 'workspaceTokens', tokens })
        break
      }
    }
  }

  private async handleChat(
    userMessage: string,
    persona: Persona,
    thinkingBudget: ThinkingBudget,
    includeWorkspace: boolean,
  ): Promise<void> {
    if (this.streaming) {
      this.post({ type: 'error', message: 'A response is already in progress. Cancel it first.' })
      return
    }

    const config = await this.getRouterConfig()
    if (!config) {
      this.post({
        type: 'error',
        message: 'No API key configured. Enter your API key in the settings panel below.',
      })
      return
    }

    dbg(`handleChat: provider=${config.provider} model=${config.model} hasKey=${!!config.apiKey}`)

    this.streaming = true
    this.abortController = new AbortController()
    this.conversationHistory.push({ role: 'user', content: userMessage })

    let fullResponse = ''
    let fullThinking = ''

    try {
      const model = config.model
      const options = await buildRequestOptions({
        messages: this.conversationHistory,
        persona,
        vaultContext: this.vaultManager.getFormattedForContext(),
        includeWorkspace,
        thinkingBudget,
        signal: this.abortController.signal,
        model,
      })

      const response = await routeRequest(config, options)
      dbg(`OR response: status=${response.status} x-model=${response.headers.get('x-model') ?? 'n/a'} x-request-id=${response.headers.get('x-request-id') ?? 'n/a'}`)

      for await (const event of parseStream(response, config.provider)) {
        if (event.type === 'text') {
          fullResponse += event.chunk
          this.post({ type: 'streamChunk', text: event.chunk })
        } else if (event.type === 'thinking') {
          fullThinking += event.chunk
          this.post({ type: 'thinkingChunk', text: event.chunk })
        } else if (event.type === 'model') {
          dbg(`OR actual model used: ${event.id}`)
        } else if (event.type === 'usage' && !isLocal(config.provider)) {
          const sessionCost = this.ledger.record(event.usage, model)
          this.post({ type: 'ledgerUpdate', ledger: sessionCost })
        }
      }

      this.conversationHistory.push({ role: 'assistant', content: fullResponse })

      // Parse file changes from the response
      const fileChanges = parseFileChanges(fullResponse)
      if (fileChanges.length > 0) {
        this.diffManager.setPendingChanges(fileChanges)
        this.post({
          type: 'diffReady',
          count: fileChanges.length,
          files: fileChanges.map((c) => c.path),
        })
        // Auto-open diff view — mirrors Copilot's inline highlight behavior
        void this.diffManager.previewChanges()
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // streamEnd sent in finally
      } else {
        const raw = err instanceof Error ? err.message : String(err)
        // Map opaque network errors to actionable messages
        const msg =
          raw === 'terminated' || raw.includes('terminated') || raw === 'fetch failed'
            ? 'Connection dropped — the provider closed the stream unexpectedly. This can happen with very long responses. Try again, or switch to a faster/smaller model.'
            : raw
        this.post({ type: 'streamError', error: msg })
        // Remove the user message from history on error
        this.conversationHistory.pop()
      }
    } finally {
      this.streaming = false
      this.post({ type: 'streamEnd', thinking: fullThinking || undefined })
    }
  }

  private async sendInitialState(): Promise<void> {
    dbg('sendInitialState start')
    const config = vscode.workspace.getConfiguration('codePirate')
    const provider = (config.get<Provider>('provider')) ?? 'openrouter'
    const model = config.get<string>('model') ?? 'anthropic/claude-opus-4'
    const licenseStatus = this.licenseManager.getStatus()

    const allProviders = (Object.entries(PROVIDER_PRESETS) as Array<[Provider, typeof PROVIDER_PRESETS[Provider]]>).map(
      ([id, preset]) => ({ id, label: preset.label, isLocal: preset.isLocal }),
    )

    dbg(`posting initialized — provider=${provider} model=${model} tier=${licenseStatus.tier}`)
    this.post({
      type: 'initialized',
      state: {
        provider,
        model,
        hasApiKey: false,           // updated below once secrets resolves
        tier: licenseStatus.tier,
        ledger: this.ledger.getSessionCost(),
        vaultEntries: this.vaultManager.getEntries(),
        providers: allProviders,
      },
    })
    this._initialized = true
    dbg('initialized posted, _initialized=true')

    // Resolve API key in background — update webview once known
    Promise.resolve(this.secrets.get('codePirate.apiKey'))
      .then(key => {
        dbg(`secrets.get resolved — hasKey=${!!key}`)
        if (key) {
          this.post({ type: 'apiKeySet', hasKey: true })
          const vsConfig = vscode.workspace.getConfiguration('codePirate')
          const currentProvider = vsConfig.get<Provider>('provider') ?? 'openrouter'
          if (currentProvider === 'openrouter') {
            this.fetchOpenRouterBalance(key).catch(() => {})
          }
        }
      })
      .catch(err => { dbg(`secrets.get failed: ${err}`) })

    // Fire model list fetch in background — arrives separately as modelsLoaded
    this.fetchAndSendModels(provider).catch(() => {})
  }

  private async fetchAndSendModels(provider: Provider): Promise<void> {
    const CACHE_KEY = 'codePirate.cachedModels'
    const CACHE_TS_KEY = 'codePirate.cachedModelsAt'
    const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

    // Serve from cache first for instant UI
    const cached = this.globalState.get<ModelInfo[]>(CACHE_KEY)
    const cachedAt = this.globalState.get<number>(CACHE_TS_KEY) ?? 0
    if (cached && cached.length > 0) {
      this.post({ type: 'modelsLoaded', models: cached })
      if (Date.now() - cachedAt < TTL_MS) return // fresh enough, skip fetch
    }

    // Only fetch from OpenRouter — other providers use static lists in the webview
    if (provider !== 'openrouter') return

    try {
      const res = await fetch('https://openrouter.ai/api/v1/models')
      if (!res.ok) return
      const json = await res.json() as { data: Array<{
        id: string
        name: string
        context_length: number
        pricing: { prompt: string; completion: string }
      }> }

      const models: ModelInfo[] = json.data
        .map(m => ({
          id: m.id,
          name: m.name ?? m.id,
          contextLength: m.context_length ?? 0,
          promptCostPer1k: parseFloat(m.pricing?.prompt ?? '0') * 1000,
          completionCostPer1k: parseFloat(m.pricing?.completion ?? '0') * 1000,
          provider: m.id.split('/')[0] ?? 'unknown',
        }))
        .sort((a, b) => a.id.localeCompare(b.id))

      await this.globalState.update(CACHE_KEY, models)
      await this.globalState.update(CACHE_TS_KEY, Date.now())
      this.post({ type: 'modelsLoaded', models })
    } catch {
      // Silently fail — webview falls back to free-text
    }
  }

  private async fetchOpenRouterBalance(apiKey: string): Promise<void> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) {
        dbg(`fetchOpenRouterBalance: HTTP ${res.status}`)
        return
      }
      const json = await res.json() as { data?: { limit_remaining?: number | null; usage?: number } }
      dbg(`fetchOpenRouterBalance: limit_remaining=${json.data?.limit_remaining} usage=${json.data?.usage}`)
      const limitRemaining = json.data?.limit_remaining
      if (typeof limitRemaining === 'number') {
        // Account has a spending limit — show remaining balance
        this.post({ type: 'creditBalance', balance: limitRemaining })
      } else {
        // No spending limit (pay-as-you-go or unlimited plan) — show usage as negative
        const usage = json.data?.usage
        if (typeof usage === 'number') {
          this.post({ type: 'creditBalance', balance: -usage })
        }
      }
    } catch (err) {
      dbg(`fetchOpenRouterBalance failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async getRouterConfig(): Promise<RouterConfig | null> {
    const apiKey = await this.secrets.get('codePirate.apiKey')
    const vsConfig = vscode.workspace.getConfiguration('codePirate')
    const provider = vsConfig.get<Provider>('provider') ?? 'openrouter'

    if (!apiKey && !isLocal(provider)) return null

    return {
      provider,
      model: vsConfig.get<string>('model') ?? 'anthropic/claude-opus-4',
      apiKey: apiKey ?? '',
      apiEndpoint: vsConfig.get<string>('apiEndpoint'),
    }
  }

  post(message: ExtensionMessage): void {
    this._view?.webview.postMessage(message)
  }

  getRouterConfigSync(): RouterConfig | null {
    // Synchronous version for completions — returns null if no key cached
    // Completions will re-check via the async version on the first call
    const vsConfig = vscode.workspace.getConfiguration('codePirate')
    const provider = vsConfig.get<Provider>('provider') ?? 'openrouter'
    if (isLocal(provider)) {
      return {
        provider,
        model: vsConfig.get<string>('model') ?? 'anthropic/claude-opus-4',
        apiKey: '',
        apiEndpoint: vsConfig.get<string>('apiEndpoint'),
      }
    }
    return null // async key retrieval needed
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'main.js'),
    )
    const nonce = crypto.randomBytes(16).toString('hex')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';" />
  <title>Code Pirate</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

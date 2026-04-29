import * as vscode from 'vscode'
import { SidebarProvider } from './sidebar'
import { CompletionProvider } from './completions'
import { VaultManager } from './vault'
import { LicenseManager } from './license/licenseManager'
import { runInlineChat, acceptInlineEdit, discardInlineEdit, explainTerminalError, generateCommitMessage } from './inlineChat'
import { runProjectRulesWizard, activate as activateRules } from './rules'
import { isLocal } from './router'
import { runOnboardingIfNeeded, resetOnboarding } from './onboarding'
import { runDiagnostics } from './diagnostics'
import type { Provider } from './types'

export function activate(context: vscode.ExtensionContext): void {
  const { secrets, globalState, extension } = context
  const extensionVersion = extension.packageJSON.version as string

  // ─── Core services ──────────────────────────────────────────────────────

  const vaultManager = new VaultManager(globalState)
  const licenseManager = new LicenseManager(secrets, globalState, extensionVersion)
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    secrets,
    globalState,
    vaultManager,
    licenseManager,
  )

  // Activate rules file watcher
  activateRules(context)

  // Validate license in background (fail-open, never blocks activation)
  licenseManager.activate().catch(() => {})

  // ─── Sidebar webview ─────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  )

  // ─── Inline completions ──────────────────────────────────────────────────

  const completionProvider = new CompletionProvider(async () => {
    const apiKey = await secrets.get('codePirate.apiKey')
    const config = vscode.workspace.getConfiguration('codePirate')
    const provider = (config.get<string>('provider') ?? 'openrouter') as Provider
    if (!apiKey && !isLocal(provider)) return null
    return {
      provider,
      model: config.get<string>('model') ?? 'anthropic/claude-opus-4',
      apiKey: apiKey ?? '',
      apiEndpoint: config.get<string>('apiEndpoint'),
    }
  })

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      completionProvider,
    ),
  )

  // ─── Commands ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('codePirate.acceptInlineEdit', () => acceptInlineEdit()),
    vscode.commands.registerCommand('codePirate.discardInlineEdit', () => discardInlineEdit()),

    vscode.commands.registerCommand('codePirate.inlineChat', () =>
      runInlineChat(async () => {
        const apiKey = await secrets.get('codePirate.apiKey')
        const config = vscode.workspace.getConfiguration('codePirate')
        const provider = (config.get<string>('provider') ?? 'openrouter') as Provider
        if (!apiKey && !isLocal(provider)) return null
        return {
          provider,
          model: config.get<string>('model') ?? 'anthropic/claude-opus-4',
          apiKey: apiKey ?? '',
          apiEndpoint: config.get<string>('apiEndpoint'),
        }
      }),
    ),

    vscode.commands.registerCommand('codePirate.explainTerminalError', () =>
      explainTerminalError(async () => {
        const apiKey = await secrets.get('codePirate.apiKey')
        const config = vscode.workspace.getConfiguration('codePirate')
        if (!apiKey) return null
        return {
          provider: (config.get<string>('provider') ?? 'openrouter') as Provider,
          model: config.get<string>('model') ?? 'anthropic/claude-opus-4',
          apiKey,
        }
      }),
    ),

    vscode.commands.registerCommand('codePirate.generateCommitMessage', () =>
      generateCommitMessage(async () => {
        const apiKey = await secrets.get('codePirate.apiKey')
        const config = vscode.workspace.getConfiguration('codePirate')
        if (!apiKey) return null
        return {
          provider: (config.get<string>('provider') ?? 'openrouter') as Provider,
          model: config.get<string>('model') ?? 'anthropic/claude-opus-4',
          apiKey,
        }
      }),
    ),

    vscode.commands.registerCommand('codePirate.generateProjectRules', () =>
      runProjectRulesWizard(),
    ),

    vscode.commands.registerCommand('codePirate.activateLicense', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Code Pirate Pro license key',
        placeHolder: 'CP-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
        password: true,
      })
      if (!key) return
      const status = await licenseManager.setKey(key)
      sidebarProvider.post({ type: 'licenseStatus', tier: status.tier, expiresAt: status.expiresAt })
      vscode.window.showInformationMessage(
        status.tier === 'pro'
          ? 'Code Pirate Pro activated ✓'
          : 'License key not recognized. Check the key and try again.',
      )
    }),

    vscode.commands.registerCommand('codePirate.openSidebar', () =>
      vscode.commands.executeCommand('workbench.view.extension.code-pirate-sidebar'),
    ),

    vscode.commands.registerCommand('codePirate.setupApiKey', () =>
      resetOnboarding(context),
    ),

    vscode.commands.registerCommand('codePirate.runDiagnostics', () =>
      runDiagnostics(context, secrets),
    ),

    // Internal: inject terminal error text into sidebar chat
    vscode.commands.registerCommand('codePirate._sendTerminalError', (errorText: string) =>
      sidebarProvider.sendTerminalError(errorText),
    ),
  )

  // Run first-time onboarding if no API key is set yet
  runOnboardingIfNeeded(context).catch(() => {})
}

export function deactivate(): void {}

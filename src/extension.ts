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
      model: config.get<string>('model') ?? 'deepseek/deepseek-v4-pro',
      apiKey: apiKey ?? '',
      apiEndpoint: config.get<string>('apiEndpoint'),
    }
  })

  // Only register inline completions if explicitly enabled — each keystroke
  // fires a real API request and can drain credits silently.
  const registerCompletions = () => {
    const enabled = vscode.workspace
      .getConfiguration('codePirate')
      .get<boolean>('enableInlineCompletions', false)
    if (enabled) {
      context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
          { pattern: '**' },
          completionProvider,
        ),
      )
    }
  }
  registerCompletions()

  // Re-evaluate when the setting changes (no restart required)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codePirate.enableInlineCompletions')) {
        vscode.window
          .showInformationMessage(
            'Inline completions setting changed. Reload window to apply.',
            'Reload',
          )
          .then(choice => {
            if (choice === 'Reload') {
              void vscode.commands.executeCommand('workbench.action.reloadWindow')
            }
          })
      }
    }),
  )

  // ─── Commands ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('codePirate.acceptInlineEdit', () => acceptInlineEdit()),
    vscode.commands.registerCommand('codePirate.discardInlineEdit', () => discardInlineEdit()),

    // ─── Right-click smart actions ────────────────────────────────────────
    // Sends the active selection to the sidebar CORE agent loop.
    // Opens the sidebar first so the user sees the response.

    vscode.commands.registerCommand('codePirate.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const text = editor.document.getText(editor.selection)
      if (!text.trim()) return
      await vscode.commands.executeCommand('workbench.view.extension.code-pirate-sidebar')
      await sidebarProvider.sendSelectionExplain(text)
    }),

    vscode.commands.registerCommand('codePirate.fixSelection', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) return
      const text = editor.document.getText(editor.selection)
      if (!text.trim()) return
      await vscode.commands.executeCommand('workbench.view.extension.code-pirate-sidebar')
      await sidebarProvider.sendSelectionFix(text)
    }),

    vscode.commands.registerCommand('codePirate.inlineChat', () =>
      runInlineChat(async () => {
        const apiKey = await secrets.get('codePirate.apiKey')
        const config = vscode.workspace.getConfiguration('codePirate')
        const provider = (config.get<string>('provider') ?? 'openrouter') as Provider
        if (!apiKey && !isLocal(provider)) return null
        return {
          provider,
          model: config.get<string>('model') ?? 'deepseek/deepseek-v4-pro',
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
          model: config.get<string>('model') ?? 'deepseek/deepseek-v4-pro',
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
          model: config.get<string>('model') ?? 'deepseek/deepseek-v4-pro',
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

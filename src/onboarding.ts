import * as vscode from 'vscode'

const ONBOARDING_DONE_KEY = 'codePirate.onboardingDone'

const PROVIDERS = [
  {
    label: '$(cloud) OpenRouter',
    description: 'Recommended — 200+ models, one key',
    detail: 'Get a key at https://openrouter.ai/keys',
    value: 'openrouter',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    label: '$(sparkle) Anthropic Direct',
    description: 'Claude models via api.anthropic.com',
    detail: 'Get a key at https://console.anthropic.com/keys',
    value: 'anthropic',
    keyUrl: 'https://console.anthropic.com/keys',
  },
  {
    label: '$(symbol-misc) OpenAI',
    description: 'GPT models via api.openai.com',
    detail: 'Get a key at https://platform.openai.com/api-keys',
    value: 'openai',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    label: '$(home) Local (Ollama / LM Studio)',
    description: 'Free, runs on your machine — no key needed',
    detail: 'Make sure Ollama is running on port 11434',
    value: 'ollama',
    keyUrl: '',
  },
  {
    label: '$(gear) Other / Custom Endpoint',
    description: 'Any OpenAI-compatible API',
    detail: 'You can set the endpoint URL in Settings',
    value: 'openai-compatible',
    keyUrl: '',
  },
]

export async function runOnboardingIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  // Skip if already completed
  if (context.globalState.get<boolean>(ONBOARDING_DONE_KEY)) return

  // Skip silently if a key was already set (e.g. manual config / re-install)
  const existingKey = await context.secrets.get('codePirate.apiKey')
  if (existingKey) {
    await context.globalState.update(ONBOARDING_DONE_KEY, true)
    return
  }

  await runOnboarding(context)
}

async function runOnboarding(context: vscode.ExtensionContext): Promise<void> {
  // ── Welcome ──────────────────────────────────────────────────────────────
  const welcome = await vscode.window.showInformationMessage(
    'Welcome to Code Pirate! Bring your own API key — use any model, no throttling, no Copilot bill.',
    { modal: false },
    'Set Up My Key',
    'Skip for Now',
  )
  if (welcome !== 'Set Up My Key') return

  // ── Step 1: Provider selection ───────────────────────────────────────────
  const picked = await vscode.window.showQuickPick(PROVIDERS, {
    title: 'Code Pirate Setup — Step 1 of 3: Choose a provider',
    placeHolder: 'Select your AI provider',
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (!picked) return

  const isLocal = picked.value === 'ollama'

  // ── Step 2: API key ──────────────────────────────────────────────────────
  if (!isLocal) {
    const providerLabel = picked.label.replace(/^\$\([^)]+\) /, '')
    const keyPrompt = picked.keyUrl
      ? `Paste your ${providerLabel} API key. Get one at ${picked.keyUrl}`
      : `Paste your ${providerLabel} API key.`

    const key = await vscode.window.showInputBox({
      title: 'Code Pirate Setup — Step 2 of 3: Enter your API key',
      prompt: keyPrompt,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'sk-…',
      validateInput: v => (!v || v.trim().length < 8) ? 'Key looks too short — check and try again' : undefined,
    })
    if (!key) return

    await context.secrets.store('codePirate.apiKey', key.trim())
  }

  // ── Step 3: Save provider, mark done ────────────────────────────────────
  const config = vscode.workspace.getConfiguration('codePirate')
  await config.update('provider', picked.value, vscode.ConfigurationTarget.Global)
  await context.globalState.update(ONBOARDING_DONE_KEY, true)

  // ── Done ─────────────────────────────────────────────────────────────────
  const doneMsg = isLocal
    ? 'Code Pirate is ready! Make sure Ollama is running on port 11434.'
    : 'Code Pirate is ready! Click the skull icon in the Activity Bar to start.'

  const action = await vscode.window.showInformationMessage(doneMsg, 'Open Code Pirate')
  if (action === 'Open Code Pirate') {
    vscode.commands.executeCommand('workbench.view.extension.code-pirate-sidebar')
  }
}

/** Exposed as a command so users can re-run setup from the Command Palette. */
export async function resetOnboarding(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(ONBOARDING_DONE_KEY, false)
  await runOnboarding(context)
}

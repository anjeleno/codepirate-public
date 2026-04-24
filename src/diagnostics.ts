import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { PROVIDER_PRESETS } from './router'
import type { Provider } from './types'

export async function runDiagnostics(
  context: vscode.ExtensionContext,
  secrets: vscode.SecretStorage,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'codePirateDiagnostics',
    'Code Pirate Diagnostics',
    vscode.ViewColumn.Two,
    { enableScripts: false },
  )

  const lines: string[] = []
  const log = (line: string) => {
    lines.push(line)
    panel.webview.html = `<html><body><pre>${lines.join('\n')}</pre></body></html>`
  }

  log('Code Pirate — Running diagnostics…')
  log('')
  log(`Timestamp : ${new Date().toISOString()}`)
  log(`Extension : v${context.extension.packageJSON.version}`)
  log(`VS Code   : ${vscode.version}`)
  log(`Platform  : ${process.platform}`)
  log(`Remote    : ${vscode.env.remoteName ?? 'local'}`)
  log('')
  log('────────────────────────────────────────────────────────────')

  // Extension version
  const extVersion = context.extension.packageJSON.version
  log(`✓  Extension version`)
  log(`   ${extVersion}`)

  // VS Code version
  log(`✓  VS Code version`)
  log(`   ${vscode.version}`)

  // Remote kind
  log(`✓  Remote kind`)
  log(`   ${vscode.env.remoteName ?? 'local'}`)

  // Process platform
  log(`✓  Process platform`)
  log(`   ${process.platform}`)

  // Check webview bundle
  const webviewPath = path.join(context.extensionPath, 'dist', 'webview', 'assets', 'main.js')
  try {
    const stat = fs.statSync(webviewPath)
    log(`✓  dist/webview/assets/main.js`)
    log(`   ${Math.round(stat.size / 1024)} KB`)
  } catch (err) {
    log(`✗  dist/webview/assets/main.js`)
    log(`   File not found`)
  }

  // Test SecretStorage
  try {
    const testKey = 'codePirate.diagnostics.test'
    const testValue = `test-${Date.now()}`
    await secrets.store(testKey, testValue)
    const retrieved = await secrets.get(testKey)
    await secrets.delete(testKey)
    
    if (retrieved === testValue) {
      log(`✓  SecretStorage round-trip`)
      log(`   Write → read round-trip succeeded`)
    } else {
      log(`✗  SecretStorage round-trip`)
      log(`   Retrieved value doesn't match`)
    }
  } catch (err) {
    log(`✗  SecretStorage round-trip`)
    log(`   ${err instanceof Error ? err.message : String(err)}`)
  }

  // Check API key
  const apiKey = await secrets.get('codePirate.apiKey')
  if (apiKey) {
    log(`✓  API key stored`)
    log(`   Yes (${apiKey.length} chars)`)
  } else {
    log(`✗  API key stored`)
    log(`   No API key found`)
  }

  // Check provider config
  const config = vscode.workspace.getConfiguration('codePirate')
  const provider = config.get<string>('provider') ?? 'openrouter'
  log(`✓  Active provider`)
  log(`   ${provider}`)

  const model = config.get<string>('model') ?? 'anthropic/claude-opus-4'
  log(`✓  Active model`)
  log(`   ${model}`)

  // Test provider endpoint reachability
  const preset = PROVIDER_PRESETS[provider as Provider]
  if (preset && preset.endpoint) {
    try {
      // For local providers, just check if we can connect to the host
      const isLocal = preset.isLocal
      const testUrl = isLocal 
        ? preset.endpoint.replace(/\/v1\/.*$/, '') // Strip API path for local services
        : preset.endpoint

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      
      // For remote providers, do a HEAD request to the API endpoint
      // For local providers, do a GET to the base URL
      const response = await fetch(testUrl, {
        method: isLocal ? 'GET' : 'HEAD',
        signal: controller.signal,
      }).catch(err => {
        if (err.name === 'AbortError') throw new Error('Connection timed out (5s)')
        throw err
      })
      
      clearTimeout(timeout)
      
      // For local services, any response is good (even 404)
      // For remote services, we expect 401/403/405 (auth required or method not allowed)
      if (isLocal || [401, 403, 405].includes(response.status)) {
        log(`✓  Provider reachability`)
        log(`   ${testUrl} → Reachable`)
      } else {
        log(`⚠  Provider reachability`)
        log(`   ${testUrl} → HTTP ${response.status}`)
      }
    } catch (err) {
      log(`✗  Provider reachability`)
      log(`   ${preset.endpoint} → ${err instanceof Error ? err.message : 'Connection failed'}`)
    }
  }

  // Test debug log
  const debugLog = path.join(
    process.platform === 'win32' ? (process.env.TEMP ?? 'C:\\Temp') : '/tmp',
    'codepirate-debug.log',
  )
  try {
    fs.appendFileSync(debugLog, `[${new Date().toISOString()}] Diagnostics test write\n`)
    log(`✓  Debug log writable`)
    log(`   ${debugLog}`)
  } catch {
    log(`✗  Debug log writable`)
    log(`   Cannot write to ${debugLog}`)
  }

  log('')
  log('Diagnostics complete.')
}
import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'

const RULES_FILES = [
  '.projectrules',
  '.cursorrules',
  '.github/copilot-instructions.md',
]

let cachedRules: string | null = null
let cacheWatcher: vscode.FileSystemWatcher | null = null

export function activate(context: vscode.ExtensionContext): void {
  // Watch rules files for changes and bust the cache
  const watchers = RULES_FILES.map((f) =>
    vscode.workspace.createFileSystemWatcher(`**/${f}`),
  )
  for (const w of watchers) {
    w.onDidChange(() => { cachedRules = null })
    w.onDidCreate(() => { cachedRules = null })
    w.onDidDelete(() => { cachedRules = null })
    context.subscriptions.push(w)
  }
  cacheWatcher = watchers[0] // keep a reference
}

export async function getRules(): Promise<string> {
  if (cachedRules !== null) return cachedRules

  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    cachedRules = ''
    return cachedRules
  }

  const rootPath = workspaceFolders[0].uri.fsPath
  const sections: string[] = []

  for (const rulesFile of RULES_FILES) {
    const fullPath = path.join(rootPath, rulesFile)
    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      if (content.trim()) {
        sections.push(`[Rules from ${rulesFile}]\n${content.trim()}`)
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  cachedRules = sections.join('\n\n')
  return cachedRules
}

export function bustCache(): void {
  cachedRules = null
}

export function deactivate(): void {
  cacheWatcher?.dispose()
}

// ─── .projectrules generator ──────────────────────────────────────────────────

export interface ProjectRulesAnswers {
  language: string
  framework: string
  testFramework: string
  codeStyle: string
  extraInstructions: string
}

export function generateProjectRulesContent(answers: ProjectRulesAnswers): string {
  const lines: string[] = ['# Project Rules for Code Pirate\n']

  if (answers.language) {
    lines.push(`## Language\n${answers.language}\n`)
  }
  if (answers.framework) {
    lines.push(`## Framework\n${answers.framework}\n`)
  }
  if (answers.testFramework) {
    lines.push(`## Testing\nUse ${answers.testFramework} for all tests.\n`)
  }
  if (answers.codeStyle) {
    lines.push(`## Code Style\n${answers.codeStyle}\n`)
  }

  lines.push(`## General\n- Always produce complete file contents, never truncated output\n- Match the existing code style and conventions of this project\n- Prefer minimal diffs — change only what is necessary\n`)

  if (answers.extraInstructions) {
    lines.push(`## Additional Instructions\n${answers.extraInstructions}\n`)
  }

  return lines.join('\n')
}

export async function runProjectRulesWizard(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('Code Pirate: Open a workspace folder first.')
    return
  }

  const language = await vscode.window.showInputBox({
    prompt: 'What language does this project use? (e.g. TypeScript, Python, Rust)',
    placeHolder: 'TypeScript',
  })
  if (language === undefined) return

  const framework = await vscode.window.showInputBox({
    prompt: 'What framework or runtime? (e.g. React, Express, FastAPI, none)',
    placeHolder: 'React',
  })
  if (framework === undefined) return

  const testFramework = await vscode.window.showInputBox({
    prompt: 'What testing framework? (e.g. Vitest, Jest, pytest, none)',
    placeHolder: 'Vitest',
  })
  if (testFramework === undefined) return

  const codeStyle = await vscode.window.showInputBox({
    prompt: 'Any code style rules? (e.g. 2-space indent, single quotes, no semicolons)',
    placeHolder: '2-space indent, single quotes',
  })
  if (codeStyle === undefined) return

  const extraInstructions = await vscode.window.showInputBox({
    prompt: 'Any additional instructions for the AI? (leave blank to skip)',
    placeHolder: 'Always validate input at system boundaries...',
  })
  if (extraInstructions === undefined) return

  const content = generateProjectRulesContent({
    language: language || '',
    framework: framework || '',
    testFramework: testFramework || '',
    codeStyle: codeStyle || '',
    extraInstructions: extraInstructions || '',
  })

  const outputPath = path.join(workspaceFolders[0].uri.fsPath, '.projectrules')
  await fs.writeFile(outputPath, content, 'utf-8')
  bustCache()

  const doc = await vscode.workspace.openTextDocument(outputPath)
  await vscode.window.showTextDocument(doc)
  vscode.window.showInformationMessage('Code Pirate: .projectrules created ✓')
}

/**
 * Appends a stack & conventions section to .projectrules, as written by the
 * Project Planner after a planning session.  Creates the file if it doesn't
 * exist.  Busts the rules cache after writing.
 */
export async function mergeRulesSection(content: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return

  const rulesPath = path.join(folders[0].uri.fsPath, '.projectrules')
  const date = new Date().toISOString().split('T')[0]
  const section = `\n\n## Stack & Conventions (from Project Planner — ${date})\n${content}`

  let existing = ''
  try {
    existing = await fs.readFile(rulesPath, 'utf-8')
  } catch {
    // File doesn't exist — will create
  }

  await fs.writeFile(rulesPath, existing + section, 'utf-8')
  bustCache()
}

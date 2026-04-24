import * as vscode from 'vscode'

// ─── Session Continuity (Pro feature) ────────────────────────────────────────
// OAuth 2.0 flow to user's own Google Drive or Dropbox.
// Code Pirate never stores session content — it lives in the user's cloud account.
// The OAuth redirect handler on api.codepirate.cc exchanges the auth code for
// tokens and returns them to the extension. It does not persist tokens server-side.

const SECRET_KEY_DRIVE = 'codePirate.driveToken'
const SECRET_KEY_DROPBOX = 'codePirate.dropboxToken'
const OAUTH_REDIRECT_BASE = 'https://api.codepirate.cc/v1/oauth'

export type StorageProvider = 'google-drive' | 'dropbox'

export interface SessionFile {
  id: string
  name: string
  createdAt: string
}

export class SessionSync {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ─── OAuth connect flow ──────────────────────────────────────────────────

  async connect(storageProvider: StorageProvider): Promise<boolean> {
    const authUrl = `${OAUTH_REDIRECT_BASE}/${storageProvider}/authorize?` +
      new URLSearchParams({ extension_version: '0.1.0' }).toString()

    await vscode.env.openExternal(vscode.Uri.parse(authUrl))

    // The redirect handler at api.codepirate.cc will open a vscode:// URI
    // with the token encoded. VS Code handles the URI via onUri handler
    // registered in extension.ts. We show instructions to the user meanwhile.
    vscode.window.showInformationMessage(
      `Code Pirate: Complete the authorization in your browser. ` +
      `VS Code will be updated automatically when done.`,
    )

    return true
  }

  async handleOAuthCallback(token: string, storageProvider: StorageProvider): Promise<void> {
    const secretKey = storageProvider === 'google-drive' ? SECRET_KEY_DRIVE : SECRET_KEY_DROPBOX
    await this.secrets.store(secretKey, token)
    vscode.window.showInformationMessage(
      `Code Pirate: ${storageProvider === 'google-drive' ? 'Google Drive' : 'Dropbox'} connected ✓`,
    )
  }

  async isConnected(storageProvider: StorageProvider): Promise<boolean> {
    const secretKey = storageProvider === 'google-drive' ? SECRET_KEY_DRIVE : SECRET_KEY_DROPBOX
    const token = await this.secrets.get(secretKey)
    return !!token
  }

  async disconnect(storageProvider: StorageProvider): Promise<void> {
    const secretKey = storageProvider === 'google-drive' ? SECRET_KEY_DRIVE : SECRET_KEY_DROPBOX
    await this.secrets.delete(secretKey)
  }

  // ─── Session save / restore ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveSession(sessionData: Record<string, any>): Promise<void> {
    const storageProvider = await this.getActiveProvider()
    if (!storageProvider) {
      vscode.window.showWarningMessage(
        'Code Pirate: Connect Google Drive or Dropbox first to save sessions.',
      )
      return
    }

    const token = await this.getToken(storageProvider)
    if (!token) return

    const fileName = `codepirate-session-${Date.now()}.json`
    const content = JSON.stringify(sessionData, null, 2)

    if (storageProvider === 'google-drive') {
      await this.saveToDrive(token, fileName, content)
    } else {
      await this.saveToDropbox(token, fileName, content)
    }
  }

  async listSessions(): Promise<SessionFile[]> {
    const storageProvider = await this.getActiveProvider()
    if (!storageProvider) return []

    const token = await this.getToken(storageProvider)
    if (!token) return []

    if (storageProvider === 'google-drive') {
      return this.listDriveSessions(token)
    } else {
      return this.listDropboxSessions(token)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async loadSession(sessionId: string): Promise<Record<string, any> | null> {
    const storageProvider = await this.getActiveProvider()
    if (!storageProvider) return null

    const token = await this.getToken(storageProvider)
    if (!token) return null

    if (storageProvider === 'google-drive') {
      return this.loadFromDrive(token, sessionId)
    } else {
      return this.loadFromDropbox(token, sessionId)
    }
  }

  // ─── Google Drive API ────────────────────────────────────────────────────

  private async saveToDrive(token: string, fileName: string, content: string): Promise<void> {
    const folderId = await this.getOrCreateDriveFolder(token)

    const metadata = JSON.stringify({
      name: fileName,
      parents: folderId ? [folderId] : [],
    })

    const form = new FormData()
    form.append('metadata', new Blob([metadata], { type: 'application/json' }))
    form.append('file', new Blob([content], { type: 'application/json' }))

    await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    )
  }

  private async getOrCreateDriveFolder(token: string): Promise<string | null> {
    const headers = { Authorization: `Bearer ${token}` }
    const search = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name%3D'CodePirate'+and+mimeType%3D'application%2Fvnd.google-apps.folder'&fields=files(id)`,
      { headers },
    )
    const data = (await search.json()) as { files?: Array<{ id: string }> }
    if (data.files && data.files.length > 0) return data.files[0].id

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CodePirate', mimeType: 'application/vnd.google-apps.folder' }),
    })
    const created = (await createRes.json()) as { id?: string }
    return created.id ?? null
  }

  private async listDriveSessions(token: string): Promise<SessionFile[]> {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name+contains+'codepirate-session'&fields=files(id,name,createdTime)&orderBy=createdTime+desc`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = (await res.json()) as { files?: Array<{ id: string; name: string; createdTime: string }> }
    return (data.files ?? []).map((f) => ({ id: f.id, name: f.name, createdAt: f.createdTime }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadFromDrive(token: string, fileId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    return res.json() as Promise<Record<string, unknown> | null>
  }

  // ─── Dropbox API ─────────────────────────────────────────────────────────

  private async saveToDropbox(token: string, fileName: string, content: string): Promise<void> {
    await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: `/CodePirate/${fileName}`,
          mode: 'add',
          autorename: true,
        }),
      },
      body: content,
    })
  }

  private async listDropboxSessions(token: string): Promise<SessionFile[]> {
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '/CodePirate' }),
    })
    const data = (await res.json()) as {
      entries?: Array<{ '.tag': string; id: string; name: string; server_modified: string }>
    }
    return (data.entries ?? [])
      .filter((e) => e['.tag'] === 'file' && e.name.startsWith('codepirate-session'))
      .map((e) => ({ id: e.id, name: e.name, createdAt: e.server_modified }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadFromDropbox(token: string, fileId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fileId }),
      },
    })
    return res.json() as Promise<Record<string, unknown> | null>
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async getActiveProvider(): Promise<StorageProvider | null> {
    if (await this.isConnected('google-drive')) return 'google-drive'
    if (await this.isConnected('dropbox')) return 'dropbox'
    return null
  }

  private async getToken(provider: StorageProvider): Promise<string | null> {
    const key = provider === 'google-drive' ? SECRET_KEY_DRIVE : SECRET_KEY_DROPBOX
    return (await this.secrets.get(key)) ?? null
  }
}

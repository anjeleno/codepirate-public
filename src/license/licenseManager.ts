import * as vscode from 'vscode'
import type { LicenseStatus } from '../types'

const SECRET_KEY = 'codePirate.licenseKey'
const CACHE_KEY = 'codePirate.licenseCache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const VALIDATE_URL = 'https://api.codepirate.cc/v1/validate'
const PRODUCT_ID = 'code-pirate'

export class LicenseManager {
  private status: LicenseStatus = { tier: 'free' }

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
    private readonly extensionVersion: string,
  ) {}

  async activate(): Promise<void> {
    const key = await this.secrets.get(SECRET_KEY)
    if (!key) {
      this.status = { tier: 'free' }
      return
    }

    // Check cache first
    const cached = this.globalState.get<LicenseStatus & { cachedAt: number }>(CACHE_KEY)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      this.status = cached
      return
    }

    // Phone home — fail open on network error
    try {
      const response = await fetch(VALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          product: PRODUCT_ID,
          version: this.extensionVersion,
        }),
        signal: AbortSignal.timeout(8000),
      })

      if (response.ok) {
        const data = (await response.json()) as { valid: boolean; tier?: string; expiresAt?: string }
        if (data.valid) {
          this.status = {
            tier: (data.tier as 'free' | 'pro') ?? 'free',
            expiresAt: data.expiresAt,
          }
        } else {
          this.status = { tier: 'free' }
        }
      } else {
        // Server returned an error — fail open, treat as valid
        this.status = { tier: 'pro', expiresAt: undefined }
      }
    } catch {
      // Network error — fail open, do not block the user
      this.status = { tier: 'pro', expiresAt: undefined }
    }

    await this.globalState.update(CACHE_KEY, { ...this.status, cachedAt: Date.now() })
  }

  async setKey(key: string): Promise<LicenseStatus> {
    await this.secrets.store(SECRET_KEY, key.trim())
    // Bust cache and re-validate
    await this.globalState.update(CACHE_KEY, undefined)
    await this.activate()
    return this.status
  }

  async clearKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY)
    await this.globalState.update(CACHE_KEY, undefined)
    this.status = { tier: 'free' }
  }

  async hasKey(): Promise<boolean> {
    const key = await this.secrets.get(SECRET_KEY)
    return !!key
  }

  isTier(tier: 'free' | 'pro'): boolean {
    if (tier === 'free') return true // Free features always available
    return this.status.tier === 'pro'
  }

  getStatus(): LicenseStatus {
    return this.status
  }
}

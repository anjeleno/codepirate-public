import type { UsageInfo, SessionCost } from './types'

// ─── Model pricing table (USD per 1M tokens, input / output) ─────────────────
// Updated April 2026. Falls back to safe defaults for unknown models.

interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  isAnthropic: boolean
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenRouter namespaced IDs
  'anthropic/claude-opus-4': { inputPer1M: 15, outputPer1M: 75, isAnthropic: true },
  'anthropic/claude-sonnet-4': { inputPer1M: 3, outputPer1M: 15, isAnthropic: true },
  'anthropic/claude-haiku-3-5': { inputPer1M: 0.8, outputPer1M: 4, isAnthropic: true },
  'openai/gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, isAnthropic: false },
  'openai/gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, isAnthropic: false },
  'meta-llama/llama-3.3-70b-instruct': { inputPer1M: 0.5, outputPer1M: 1.5, isAnthropic: false },
  'google/gemini-pro-1.5': { inputPer1M: 1.25, outputPer1M: 5, isAnthropic: false },
  // DeepSeek models
  'deepseek/deepseek-v4-pro': { inputPer1M: 0.435, outputPer1M: 0.87, isAnthropic: false },
  'deepseek/deepseek-chat-v3-0324': { inputPer1M: 0.27, outputPer1M: 1.1, isAnthropic: false },
  'deepseek/deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1, isAnthropic: false },
  'deepseek/deepseek-r1': { inputPer1M: 0.55, outputPer1M: 2.19, isAnthropic: false },
  // Anthropic Direct model IDs
  'claude-opus-4-5': { inputPer1M: 15, outputPer1M: 75, isAnthropic: true },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, isAnthropic: true },
  'claude-haiku-3-5': { inputPer1M: 0.8, outputPer1M: 4, isAnthropic: true },
  // Groq models (very cheap)
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79, isAnthropic: false },
}

const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 5,
  outputPer1M: 15,
  isAnthropic: false,
}

// ─── Token estimator ──────────────────────────────────────────────────────────
// Character-based estimation. Anthropic families get a 1.15x correction factor
// to account for their tokenizer producing slightly more tokens per character.
// A 1.1x safety factor is applied for all unknown models.

function isAnthropicModel(model: string): boolean {
  const pricing = MODEL_PRICING[model]
  if (pricing) return pricing.isAnthropic
  return model.toLowerCase().includes('claude') || model.toLowerCase().includes('anthropic')
}

export function estimateTokens(text: string, model: string): number {
  const charsPerToken = 4
  const base = Math.ceil(text.length / charsPerToken)

  if (isAnthropicModel(model)) {
    return Math.ceil(base * 1.15)
  }

  const knownModel = !!MODEL_PRICING[model]
  if (!knownModel) {
    return Math.ceil(base * 1.1) // Safety factor for unknown models
  }

  return base
}

// ─── Session ledger ───────────────────────────────────────────────────────────

// Copilot Pro reference: $19/month. Assuming ~500k tokens/month effective usage.
// Effective per-token cost: $19 / 500,000 = $0.000038 → $38 per 1M tokens.
const COPILOT_PRO_PER_1M_USD = 38

export class BudgetLedger {
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private totalCostUsd = 0
  private model = ''

  record(usage: UsageInfo, model: string): SessionCost {
    this.model = model
    this.totalInputTokens += usage.inputTokens
    this.totalOutputTokens += usage.outputTokens

    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING
    const requestCost =
      (usage.inputTokens / 1_000_000) * pricing.inputPer1M +
      (usage.outputTokens / 1_000_000) * pricing.outputPer1M
    this.totalCostUsd += requestCost

    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    const copilotEquivalent = (totalTokens / 1_000_000) * COPILOT_PRO_PER_1M_USD
    const savedVsCopilot = Math.max(0, copilotEquivalent - this.totalCostUsd)

    return this.toSessionCost(savedVsCopilot)
  }

  // Estimate cost before a request (for display purposes)
  estimateRequest(inputText: string, model: string): number {
    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING
    const tokens = estimateTokens(inputText, model)
    return (tokens / 1_000_000) * pricing.inputPer1M
  }

  getSessionCost(): SessionCost {
    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    const copilotEquivalent = (totalTokens / 1_000_000) * COPILOT_PRO_PER_1M_USD
    const savedVsCopilot = Math.max(0, copilotEquivalent - this.totalCostUsd)
    return this.toSessionCost(savedVsCopilot)
  }

  private toSessionCost(savedVsCopilot: number): SessionCost {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      costUsd: this.totalCostUsd,
      savedVsCopilot,
      model: this.model,
    }
  }

  reset(): void {
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.totalCostUsd = 0
    this.model = ''
  }

  getModelLabel(model: string): string {
    // Shorten OpenRouter namespaced IDs for display
    return model.includes('/') ? model.split('/').pop() ?? model : model
  }
}

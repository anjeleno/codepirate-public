import type { SessionCost } from '../types'

interface Props {
  ledger: SessionCost
  provider?: string
  creditBalance?: number | null
  estimatedCost?: string | null
}

export function Ledger({ ledger, provider, creditBalance, estimatedCost }: Props) {
  const modelLabel = ledger.model.includes('/')
    ? ledger.model.split('/').pop() ?? ledger.model
    : ledger.model

  return (
    <div className="ledger">
      <div className="ledger-row">
        <span>Captain's Ledger</span>
        <span style={{ opacity: 0.5 }}>{modelLabel}</span>
      </div>
      <div className="ledger-row">
        <span>Tokens used</span>
        <span>{(ledger.inputTokens + ledger.outputTokens).toLocaleString()}</span>
      </div>
      <div className="ledger-row">
        <span>Session cost</span>
        <span>${ledger.costUsd.toFixed(4)}</span>
      </div>
      {provider === 'openrouter' && typeof creditBalance === 'number' && creditBalance >= 0 && (
        <div className="ledger-row" style={{ borderTop: '1px solid var(--vscode-panel-border)', marginTop: 2, paddingTop: 2 }}>
          <span>OR balance</span>
          <span>${creditBalance.toFixed(2)}</span>
        </div>
      )}
      {estimatedCost && (
        <div className="ledger-row ledger-est" style={{ borderTop: '1px solid var(--vscode-panel-border)', marginTop: 2, paddingTop: 2 }}>
          <span>Next request</span>
          <span>{estimatedCost}</span>
        </div>
      )}
    </div>
  )
}

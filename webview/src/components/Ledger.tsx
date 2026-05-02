import type { SessionCost } from '../types'

interface Props {
  ledger: SessionCost
  provider?: string
  creditBalance?: number | null
}

export function Ledger({ ledger, provider, creditBalance }: Props) {
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
      {ledger.savedVsCopilot > 0 && (
        <div className="ledger-row ledger-saved">
          <span>Saved vs. Copilot Pro</span>
          <span>~${ledger.savedVsCopilot.toFixed(2)}</span>
        </div>
      )}
      {provider === 'openrouter' && typeof creditBalance === 'number' && (
        <div className="ledger-row" style={{ borderTop: '1px solid var(--vscode-panel-border)', marginTop: 2, paddingTop: 2 }}>
          {creditBalance >= 0 ? (
            <>
              <span>OR balance</span>
              <span>${creditBalance.toFixed(2)}</span>
            </>
          ) : (
            <>
              <span>OR total spend</span>
              <span>${Math.abs(creditBalance).toFixed(4)}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

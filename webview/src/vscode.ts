// VS Code webview API wrapper
// acquireVsCodeApi() can only be called once per webview lifetime.

interface VSCodeAPI {
  postMessage: (message: unknown) => void
  setState: (state: unknown) => void
  getState: () => unknown
}

let _api: VSCodeAPI | null = null

export function getVSCode(): VSCodeAPI {
  if (!_api) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _api = (window as any).acquireVsCodeApi()
  }
  return _api!
}

export function postMessage(message: unknown): void {
  getVSCode().postMessage(message)
}

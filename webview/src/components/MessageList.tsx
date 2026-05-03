import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'
import type { ToolProgressItem } from '../App'

interface Props {
  messages: ChatMessage[]
  streamingText: string
  streamingThinking: string
  streaming: boolean
  toolProgressItems?: ToolProgressItem[]
}

export function MessageList({ messages, streamingText, streamingThinking, streaming, toolProgressItems = [] }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

  if (messages.length === 0 && !streaming) {
    return (
      <div
        className="message-list"
        style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>☠️</div>
          <div>Send a message to start</div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>Your key. Your models. No throttling.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming assistant message */}
      {(streaming || streamingText) && (
        <div className="message assistant">
          <div className="message-label">Lead Architect</div>
          {streamingThinking && (
            <ThinkingShade thinking={streamingThinking} isStreaming={streaming} defaultOpen />
          )}
          {/* Tool call progress — shows "Editing src/foo.ts…" / "Read src/bar.ts" inline */}
          {toolProgressItems.length > 0 && (
            <div className="tool-progress-list">
              {toolProgressItems.map(item => (
                <ToolProgressLine key={item.id} item={item} />
              ))}
            </div>
          )}
          {/* "Connecting…" shown while waiting for the first token */}
          {streaming && !streamingText && !streamingThinking && toolProgressItems.length === 0 && (
            <div className="connecting-indicator">
              <span className="connecting-dots" />
              Connecting to provider…
            </div>
          )}
          <div className="message-content">
            <RenderMarkdown text={streamingText} />
            {streaming && !streamingThinking && <span className="streaming-cursor" />}
            {streaming && streamingThinking && !streamingText && <span className="streaming-cursor" />}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

// ─── Collapsible thinking shade ───────────────────────────────────────────────

interface ThinkingShadeProps {
  thinking: string
  isStreaming?: boolean
  defaultOpen?: boolean
}

function ThinkingShade({ thinking, isStreaming = false, defaultOpen = false }: ThinkingShadeProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="thinking-shade">
      <button
        className="thinking-shade-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="thinking-shade-icon">{open ? '▾' : '▸'}</span>
        <span className="thinking-shade-label">
          {isStreaming && !open ? 'Thinking…' : 'Thinking'}
        </span>
        {isStreaming && <span className="thinking-shade-pulse" />}
      </button>
      {open && (
        <div className="thinking-shade-body">
          <pre className="thinking-text">{thinking}</pre>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message ${message.role}`}>
      <div className="message-label">{message.role === 'user' ? 'You' : 'Code Pirate'}</div>
      {message.thinking && (
        <ThinkingShade thinking={message.thinking} defaultOpen={false} />
      )}
      <div className="message-content">
        <RenderMarkdown text={message.content} />
      </div>
    </div>
  )
}

// Minimal markdown renderer — handles code blocks and inline code
// A full markdown library would be better but keeps the bundle tiny
function RenderMarkdown({ text }: { text: string }) {
  const parts = parseMarkdown(text)
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'code-block') {
          return (
            <pre key={i}>
              <code>{part.content}</code>
            </pre>
          )
        }
        if (part.type === 'text') {
          return <TextWithInlineCode key={i} text={part.content} />
        }
        return null
      })}
    </>
  )
}

type MarkdownPart =
  | { type: 'code-block'; lang: string; content: string }
  | { type: 'text'; content: string }

function parseMarkdown(text: string): MarkdownPart[] {
  const parts: MarkdownPart[] = []
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', content: text.slice(last, match.index) })
    }
    parts.push({ type: 'code-block', lang: match[1] ?? '', content: match[2] ?? '' })
    last = match.index + match[0].length
  }

  if (last < text.length) {
    parts.push({ type: 'text', content: text.slice(last) })
  }

  return parts
}

function TextWithInlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i}>{part.slice(1, -1)}</code>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ─── Tool progress line ───────────────────────────────────────────────────────
// Compact one-liner shown in the streaming area for each tool call.
// Mimics Copilot's "Edited diff.ts +50-14" display style.

function ToolProgressLine({ item }: { item: ToolProgressItem }) {
  const filePath = (item.args.path as string) ?? (item.args.file_path as string) ?? ''
  const fileName = filePath ? filePath.split('/').pop() : item.toolName

  let icon: string
  let label: string

  if (item.status === 'running') {
    switch (item.toolName) {
      case 'read_file':  icon = '📖'; label = `Reading ${fileName}…`;  break
      case 'list_dir':   icon = '📂'; label = `Listing ${fileName || 'directory'}…`; break
      case 'write_file': icon = '✏️';  label = `Writing ${fileName}…`; break
      case 'str_replace':icon = '✏️';  label = `Editing ${fileName}…`; break
      case 'insert_at_line': icon = '✏️'; label = `Inserting into ${fileName}…`; break
      default:           icon = '⚙️';  label = `${item.toolName}…`;    break
    }
  } else if (item.status === 'done') {
    switch (item.toolName) {
      case 'read_file':  icon = '✓'; label = `Read ${fileName}`;  break
      case 'list_dir':   icon = '✓'; label = `Listed ${fileName || 'directory'}`; break
      case 'write_file': icon = '✓'; label = `Wrote ${fileName}`; break
      case 'str_replace':icon = '✓'; label = `Edited ${fileName}`; break
      case 'insert_at_line': icon = '✓'; label = `Inserted into ${fileName}`; break
      default:           icon = '✓'; label = item.toolName; break
    }
  } else {
    icon = '✗'
    label = `Failed: ${fileName || item.toolName}`
  }

  const statusClass = item.status === 'running' ? 'tool-progress-running'
    : item.status === 'done' ? 'tool-progress-done'
    : 'tool-progress-error'

  return (
    <div className={`tool-progress-item ${statusClass}`} title={item.result || undefined}>
      <span className="tool-progress-icon">{icon}</span>
      <span className="tool-progress-label">{label}</span>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types'

interface Props {
  messages: ChatMessage[]
  streamingText: string
  streamingThinking: string
  streaming: boolean
}

export function MessageList({ messages, streamingText, streamingThinking, streaming }: Props) {
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

/**
 * A render-time error boundary for the side-panel host.
 *
 * The recurring side-chat failures ("Cannot read properties of undefined
 * (reading 'length')") are thrown DURING RENDER, so no `try/catch` around an
 * async call can see them — the panel just goes blank and the only clue is a
 * one-line message with no file, no line, and no stack. This boundary catches
 * those and shows the full stack in place, so the failure is locatable without
 * attaching a debugger.
 *
 * The stack is shown verbatim rather than summarised: the useful frame is
 * often several levels down, and trimming it is how the earlier reports lost
 * their only real evidence.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ensureErrorBoundaryStyles } from './error-boundary-styles'

/**
 * The text shown for one caught failure.
 *
 * Split into a message and a detail block so the card can stay compact while
 * the stack stays complete and copyable.
 */
export interface ErrorDetail {
  message: string
  /** `error.stack` when the runtime provides one; absent for non-Error throws. */
  stack?: string
  /** The React component stack, when React provides one. */
  componentStack?: string
}

/**
 * Describe one thrown value for display.
 *
 * Non-Error throws (a bare string, an API error object) are common across a
 * Host boundary, so this never assumes `stack` exists.
 */
export function describeError(error: unknown, componentStack?: string): ErrorDetail {
  // Trimmed, so a whitespace-only component stack is dropped rather than
  // rendering an empty expandable section.
  const trimmedStack = componentStack?.trim() ?? ''
  const stack = trimmedStack === '' ? undefined : trimmedStack
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(stack === undefined ? {} : { componentStack: stack }),
    }
  }
  if (typeof error === 'string') return { message: error }
  if (error === null || typeof error !== 'object') return { message: String(error) }
  // An API/Host error object: prefer its own message field, else show the shape.
  const record = error as { message?: unknown; error?: unknown; code?: unknown }
  const message = typeof record.message === 'string'
    ? record.message
    : typeof record.error === 'string'
      ? record.error
      : safeJson(error)
  return {
    message,
    ...(stack === undefined ? {} : { componentStack: stack }),
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Shown above the stack, e.g. the panel label, so one card is attributable. */
  label?: string
  /** Called after a failure is caught, for host-side logging. */
  onError?: (error: unknown, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  detail: ErrorDetail | null
}

/**
 * Catch render errors from one subtree and show them with their stack.
 *
 * Deliberately keyed by nothing: a panel that throws stays broken until its
 * owner remounts it (switching tabs does), which is the honest behaviour —
 * silently retrying a render that crashes would loop.
 */
export class SidePanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { detail: null }
    ensureErrorBoundaryStyles()
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { detail: describeError(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // React hands the component stack here rather than during derivation, so
    // fold it in now — it names the component the crash came from.
    this.setState({ detail: describeError(error, info.componentStack ?? undefined) })
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    const { detail } = this.state
    if (detail === null) return this.props.children
    return <ErrorCard detail={detail} label={this.props.label} />
  }
}

/** The card shown in place of a crashed subtree. */
function ErrorCard({ detail, label }: { detail: ErrorDetail; label?: string }): ReactNode {
  return (
    <div className="dsh-sidepanel-error" role="alert">
      <div className="dsh-sidepanel-error-head">
        <strong className="dsh-sidepanel-error-title">
          {label === undefined ? '此面板渲染出错' : `「${label}」渲染出错`}
        </strong>
        <button
          type="button"
          className="dsh-sidepanel-error-copy"
          onClick={() => { void copyReport(detail) }}
        >
          复制报告
        </button>
      </div>
      <div className="dsh-sidepanel-error-message">{detail.message}</div>
      {detail.stack !== undefined && (
        <details className="dsh-sidepanel-error-details" open>
          <summary>调用栈</summary>
          <pre className="dsh-sidepanel-error-stack">{detail.stack}</pre>
        </details>
      )}
      {detail.componentStack !== undefined && (
        <details className="dsh-sidepanel-error-details">
          <summary>组件栈</summary>
          <pre className="dsh-sidepanel-error-stack">{detail.componentStack}</pre>
        </details>
      )}
    </div>
  )
}

/** Put the whole report on the clipboard, including both stacks. */
async function copyReport(detail: ErrorDetail): Promise<void> {
  const parts = [detail.message]
  if (detail.stack !== undefined) parts.push(`\n调用栈:\n${detail.stack}`)
  if (detail.componentStack !== undefined) parts.push(`\n组件栈:\n${detail.componentStack}`)
  try {
    await navigator.clipboard.writeText(parts.join('\n'))
  } catch {
    // Clipboard access can be denied; the report is on screen either way.
  }
}

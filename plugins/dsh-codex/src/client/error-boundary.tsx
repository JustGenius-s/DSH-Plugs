/**
 * A render-time error boundary for Sidebar extension content.
 *
 * The recurring side-chat failures ("Cannot read properties of undefined
 * (reading 'length')") are thrown DURING RENDER, so no `try/catch` around an
 * async call can see them. DSH's own `SlotErrorBoundary` does catch them, but
 * its crash face is an empty `<div data-slot-error>` — it logs the error to
 * the console and shows the user nothing. This boundary renders the message
 * and both stacks in place, so a failure is locatable without DevTools or a
 * debugger.
 *
 * The stack is shown verbatim rather than summarised: the useful frame is
 * often several levels down, and trimming it is how the earlier reports lost
 * their only real evidence.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

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

const ERROR_BOUNDARY_CSS = `
.dsh-sidepanel-error{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding:10px 12px;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(207,34,46,.08))}
.dsh-sidepanel-error-head{display:flex;align-items:center;gap:8px}
.dsh-sidepanel-error-title{flex:1;min-width:0;color:var(--dsw-alias-state-error-primary,#cf222e);font-family:inherit;font-size:13px;font-weight:600;line-height:20px}
.dsh-sidepanel-error-copy{flex:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:16px;padding:2px 6px;cursor:pointer}
.dsh-sidepanel-error-copy:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-sidepanel-error-message{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary,#cf222e)}
.dsh-sidepanel-error-details{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));padding-top:6px}
.dsh-sidepanel-error-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:11px;font-weight:600}
.dsh-sidepanel-error-stack{max-height:220px;margin:6px 0 0;padding:8px;overflow:auto;border-radius:6px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.28));color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:11px;line-height:16px;white-space:pre;tab-size:2}
`

let stylesInstalled = false

/** Inject the error-card styles once per page. */
function ensureErrorBoundaryStyles(): void {
  if (stylesInstalled || typeof document === 'undefined') return
  stylesInstalled = true
  const style = document.createElement('style')
  style.textContent = ERROR_BOUNDARY_CSS
  document.head.appendChild(style)
}

interface ErrorBoundaryProps {
  children?: ReactNode
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
 * Deliberately keyed by nothing: a tab that throws stays broken until that tab
 * is closed and reopened; silently retrying a render that crashes would loop.
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

import type { CodexKey } from '../../locales'
import { chatFlow, conversationScroll } from '../../host-adapters/conversation-dom'
import {
  LONG_MESSAGE_ATTR,
  LONG_MESSAGE_BODY_CLASS,
  LONG_MESSAGE_CHROME_ATTR,
  contentHeightOf,
  findLongMessageClampTarget,
  isLongMessageRowKind,
  isStreamingMessageRow,
  longMessagePresentation,
  type LongMessagePresentation,
} from './model'
import { ensureLongMessageCollapseStyles } from './styles'

const CHEVRON_SVG = '<svg class="dsh-codex-long-msg-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.2 5.2L7 9l3.8-3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function flowRows(flow: Element): HTMLElement[] {
  return Array.from(flow.children).filter((node): node is HTMLElement => (
    node instanceof HTMLElement && isLongMessageRowKind(node.dataset.chatFlowKind)
  ))
}

function existingChrome(parent: Element): HTMLElement | null {
  const node = parent.querySelector(`:scope > [${LONG_MESSAGE_CHROME_ATTR}]`)
  return node instanceof HTMLElement ? node : null
}

export function startLongMessageCollapse(t: (key: CodexKey) => string): () => void {
  ensureLongMessageCollapseStyles()
  const expandedKeys = new Set<string>()
  const resize = new ResizeObserver(() => schedule())
  const watched = new Set<HTMLElement>()
  let frame = 0
  let disposed = false

  const schedule = (): void => {
    if (disposed || frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      if (!disposed) syncAll()
    })
  }

  const forgetTarget = (target: HTMLElement): void => {
    resize.unobserve(target)
    watched.delete(target)
    target.classList.remove(LONG_MESSAGE_BODY_CLASS)
  }

  const clearRow = (row: HTMLElement): void => {
    const target = row.querySelector(`.${LONG_MESSAGE_BODY_CLASS}`)
    if (target instanceof HTMLElement) forgetTarget(target)
    row.removeAttribute(LONG_MESSAGE_ATTR)
    const chrome = row.querySelector(`[${LONG_MESSAGE_CHROME_ATTR}]`)
    chrome?.remove()
  }

  const paintChrome = (
    target: HTMLElement,
    presentation: Exclude<LongMessagePresentation, 'none'>,
  ): void => {
    const parent = target.parentElement
    if (parent === null) return
    let chrome = existingChrome(parent)
    if (chrome === null) {
      chrome = document.createElement('div')
      chrome.setAttribute(LONG_MESSAGE_CHROME_ATTR, '')
      chrome.className = 'dsh-codex-long-msg-chrome'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-codex-long-msg-more'
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const host = button.closest<HTMLElement>('[data-chat-anchor-key]')
        const nextKey = host?.dataset.chatAnchorKey
        if (nextKey === undefined) return
        if (expandedKeys.has(nextKey)) expandedKeys.delete(nextKey)
        else expandedKeys.add(nextKey)
        schedule()
      })
      chrome.append(button)
    }
    const button = chrome.querySelector('button')
    if (button instanceof HTMLButtonElement) {
      const expanded = presentation === 'expanded'
      button.innerHTML = `${expanded ? t('longMessage.collapse') : t('longMessage.expand')}${CHEVRON_SVG}`
      button.setAttribute('aria-expanded', String(expanded))
      button.setAttribute('aria-label', expanded ? t('longMessage.collapseAria') : t('longMessage.expandAria'))
    }
    if (chrome.previousElementSibling !== target) target.insertAdjacentElement('afterend', chrome)
  }

  const syncRow = (row: HTMLElement): void => {
    const target = findLongMessageClampTarget(row)
    if (target === null) {
      clearRow(row)
      return
    }
    const key = row.dataset.chatAnchorKey
    const presentation = longMessagePresentation({
      contentHeight: contentHeightOf(target),
      streaming: isStreamingMessageRow(row),
      expanded: key !== undefined && expandedKeys.has(key),
    })
    if (presentation === 'none') {
      clearRow(row)
      return
    }
    if (row.getAttribute(LONG_MESSAGE_ATTR) !== presentation) {
      row.setAttribute(LONG_MESSAGE_ATTR, presentation)
    }
    if (!target.classList.contains(LONG_MESSAGE_BODY_CLASS)) {
      target.classList.add(LONG_MESSAGE_BODY_CLASS)
    }
    if (!watched.has(target)) {
      watched.add(target)
      resize.observe(target)
    }
    paintChrome(target, presentation)
  }

  const syncFlow = (flow: Element): void => {
    for (const row of flowRows(flow)) syncRow(row)
  }

  const syncAll = (): void => {
    const roots = new Set<ParentNode>()
    for (const scroll of document.querySelectorAll('[data-conversation-scroll]')) {
      roots.add(scroll)
    }
    if (roots.size === 0) {
      const fallback = conversationScroll()
      if (fallback !== null) roots.add(fallback)
    }
    for (const root of roots) {
      const flow = chatFlow(root)
      if (flow !== null) syncFlow(flow)
    }
  }

  const mutations = new MutationObserver(() => { schedule() })
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-streaming', 'data-chat-flow-kind'] })
  syncAll()

  return () => {
    disposed = true
    if (frame !== 0) window.cancelAnimationFrame(frame)
    mutations.disconnect()
    resize.disconnect()
    watched.clear()
    for (const row of document.querySelectorAll<HTMLElement>(`[${LONG_MESSAGE_ATTR}]`)) {
      clearRow(row)
    }
  }
}

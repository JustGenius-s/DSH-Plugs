/**
 * Sidebar "归档会话" should commit immediately. If a later host shell wraps
 * archive in window.confirm / a titled modal, skip that extra step.
 */
export function installSidebarArchiveNoConfirm(): () => void {
  const originalConfirm = window.confirm.bind(window)
  window.confirm = (message?: string) => {
    if (isArchivePrompt(message)) return true
    return originalConfirm(message ?? '')
  }

  const observer = new MutationObserver(() => autoConfirmArchiveModal())
  observer.observe(document.body, { childList: true, subtree: true })
  autoConfirmArchiveModal()

  return () => {
    window.confirm = originalConfirm
    observer.disconnect()
  }
}

function isArchivePrompt(message: string | undefined): boolean {
  if (message === undefined) return false
  return /归档会话|archive session/i.test(message) && !/永久|permanent|删除|delete/i.test(message)
}

function autoConfirmArchiveModal(): void {
  const dialogs = document.querySelectorAll('[role="dialog"]')
  for (const dialog of dialogs) {
    const title = dialog.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() ?? ''
    if (!isArchivePrompt(title)) continue
    const buttons = Array.from(dialog.querySelectorAll('button'))
    const confirm = buttons.find((button) => {
      const label = button.textContent?.trim() ?? ''
      return /归档|archive|确认|confirm/i.test(label) && !/取消|cancel/i.test(label)
    })
    confirm?.click()
  }
}

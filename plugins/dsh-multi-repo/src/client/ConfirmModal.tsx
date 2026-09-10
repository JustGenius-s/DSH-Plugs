import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, InlineNotice, Input, Modal, Tag } from '@just-genius/dsh-plugin-ui'
import { SCAN_PATH, folderName, normalizePrimaryPath, samePath, type AdoptResult, type RepoFolder } from '../shared'
import { getPicker, subscribePicker } from './flow'
import { postJson } from './http'
import type { MultiRepoKey } from './locales'
import styles from './ConfirmModal.module.css'

export interface ConfirmModalInjected {
  t: (key: MultiRepoKey) => string
  /** The ORIGINAL (unpatched) host folder picker — opens Finder / OS chooser. */
  pickDirectory: () => Promise<string | null>
}

export function ConfirmModal({ t, pickDirectory }: Partial<ConfirmModalInjected>) {
  const request = useSyncExternalStore(subscribePicker, getPicker, getPicker)
  const translate = t ?? ((key: MultiRepoKey) => key)
  const [repos, setRepos] = useState<RepoFolder[]>([])
  const [primaryPath, setPrimaryPath] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (request === null) return
    const next = request.initialRepos
    const nextPrimary = normalizePrimaryPath(next, request.initialPrimaryPath)
    setRepos(next)
    setPrimaryPath(nextPrimary)
    setTitle(request.initialTitle.trim() === '' ? defaultTitle(nextPrimary, next.length) : request.initialTitle)
    setBusy(false)
    setError(null)
  }, [request])

  const primary = normalizePrimaryPath(repos, primaryPath)

  if (request === null || t === undefined) return null

  const finishCurrent = (): void => {
    request.resolve({ kind: 'current' })
  }

  const finishMulti = (): void => {
    if (repos.length === 0) {
      setError(translate('modal.none'))
      return
    }
    if (primary === '' || !repos.some((repo) => samePath(repo.path, primary))) {
      setError(translate('modal.needPrimary'))
      return
    }
    request.resolve({
      kind: 'multi',
      primaryPath: primary,
      repos,
      title: title.trim() || defaultTitle(primary, repos.length),
    })
  }

  const makePrimary = (path: string): void => {
    setPrimaryPath(path)
    setTitle((current) => current.trim() === '' ? defaultTitle(path, repos.length) : current)
  }

  const removeFolder = (path: string): void => {
    const next = repos.filter((repo) => !samePath(repo.path, path))
    setRepos(next)
    setPrimaryPath((currentPrimary) => {
      if (!samePath(currentPrimary, path)) return currentPrimary
      return normalizePrimaryPath(next)
    })
  }

  const addFolder = async (): Promise<void> => {
    if (pickDirectory === undefined || busy) return
    setBusy(true)
    setError(null)
    try {
      const path = await pickDirectory()
      if (path === null) return
      const adopted = await postJson<AdoptResult>(SCAN_PATH, { path })
      const incoming: RepoFolder = { name: adopted.name, path: adopted.path, kind: 'folder' }
      setRepos((current) => {
        if (current.some((repo) => samePath(repo.path, incoming.path))) return current
        const merged = [...current, incoming]
        setPrimaryPath((currentPrimary) => currentPrimary === '' ? incoming.path : currentPrimary)
        setTitle((currentTitle) => currentTitle.trim() === '' ? defaultTitle(incoming.path, merged.length) : currentTitle)
        return merged
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={translate(request.mode === 'edit' ? 'modal.title.edit' : 'modal.title.pick')}
      closeLabel={translate('cancel')}
      onClose={finishCurrent}
      className={styles.dialog}
      footer={(
        <div className={styles.footer}>
          <Button
            variant="outline"
            type="button"
            className={styles.grow}
            disabled={busy || pickDirectory === undefined}
            onClick={() => { void addFolder() }}
          >
            {translate('modal.add')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={busy || repos.length === 0 || primary === ''}
            onClick={finishMulti}
          >
            {busy
              ? translate('modal.busy')
              : translate(request.mode === 'edit' ? 'modal.save' : 'modal.openWorkspace')}
          </Button>
        </div>
      )}
    >
      <div className={styles.field}>
        <div className={styles.label}>{translate('modal.titleLabel')}</div>
        <Input
          className={styles.input}
          value={title}
          placeholder={translate('modal.titlePlaceholder')}
          onChange={(event) => { setTitle(event.currentTarget.value) }}
        />
      </div>
      {repos.length > 0 ? (
        <div className={styles.list}>
          {repos.map((repo) => {
            const isPrimary = samePath(repo.path, primary)
            return (
              <div key={repo.path} className={styles.row}>
                <span className={styles.meta}>
                  <span className={styles.name}>
                    {repo.name}
                    {isPrimary ? <Tag tone="business">{translate('primary')}</Tag> : null}
                  </span>
                  <p className={styles.path}>{repo.path}</p>
                </span>
                {isPrimary ? null : (
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() => { makePrimary(repo.path) }}
                  >
                    {translate('setPrimary')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => { removeFolder(repo.path) }}
                >
                  {translate('remove')}
                </Button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className={styles.empty}>{translate('modal.empty')}</p>
      )}
      {error !== null ? <InlineNotice kind="error" role="alert">{error}</InlineNotice> : null}
    </Modal>
  )
}

function defaultTitle(primaryPath: string, count: number): string {
  const name = folderName(primaryPath)
  return count > 1 ? `${name} · ${count}` : name
}

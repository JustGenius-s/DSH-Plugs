import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type WeChatKey } from './locales.ts'
import {
  EMPTY_MODELS,
  labelOf,
  picksOf,
  samePick,
  type ModelDirectoryFace,
  type ModelPick,
} from './models.ts'
import { Avatar } from './chrome.tsx'
import styles from './WeChatApp.module.css'

export function MePanel({ t, sessionId, directoryFor, saveDefaultModel, onClassic }: {
  t: (key: WeChatKey) => string
  sessionId: string | undefined
  directoryFor?: (id: string) => ModelDirectoryFace | undefined
  saveDefaultModel?: (pick: ModelPick) => Promise<void>
  onClassic: () => void
}) {
  const directory = useMemo(() => {
    if (!sessionId || !directoryFor) return undefined
    try { return directoryFor(sessionId) } catch { return undefined }
  }, [sessionId, directoryFor])
  const state = useSyncExternalStore(
    (listener) => directory?.store.subscribe(listener) ?? (() => {}),
    () => directory?.store.getSnapshot() ?? EMPTY_MODELS,
  )
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (directory) void directory.load()
  }, [directory])

  const picks = useMemo(() => picksOf(state), [state])
  const currentLabel = labelOf(state, t('me.model'))

  const choose = async (pick: ModelPick) => {
    setNotice(null)
    try {
      if (directory) await directory.select(pick)
      await saveDefaultModel?.(pick)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('me.modelFailed'))
    }
  }

  return (
    <>
      <div className={styles.meCard}>
        <Avatar id="me" title="DS" />
        <div><div className={styles.meName}>DeepSeek</div><div className={styles.meSub}>{currentLabel}</div></div>
      </div>
      <div className={styles.sectionLabel}>{t('me.model')}</div>
      <p className={styles.sectionHint}>{t('me.modelHint')}</p>
      <div className={styles.menu}>
        {!sessionId && <div className={styles.emptyHint}>{t('me.modelNeedChat')}</div>}
        {sessionId && (state.status === 'idle' || state.status === 'loading') && picks.length === 0 && <div className={styles.emptyHint}>{t('me.modelLoading')}</div>}
        {sessionId && state.status === 'ready' && picks.length === 0 && <div className={styles.emptyHint}>{t('me.modelEmpty')}</div>}
        {picks.map((pick, index) => {
          const showGroup = index === 0 || picks[index - 1]?.group !== pick.group
          return (
            <div key={`${pick.provider}:${pick.model}`}>
              {showGroup && <div className={styles.modelGroup}>{pick.group}</div>}
              <button type="button" className={styles.modelBtn} data-on={samePick(pick, state.current)} disabled={state.status === 'selecting'} onClick={() => void choose(pick)}>
                <span className={styles.modelName}>{pick.name}</span>
                {samePick(pick, state.current) && <span className={styles.modelTick}>✓</span>}
              </button>
            </div>
          )
        })}
        {notice && <div className={styles.emptyHint}>{notice}</div>}
        {state.error && <div className={styles.emptyHint}>{state.error}</div>}
      </div>
      <div className={styles.menu}><button type="button" className={styles.menuBtn} onClick={onClassic}>{t('me.switch')}</button></div>
      <div className={styles.page}><p className={styles.pageTitle}>{t('me.about')}</p><p>{t('me.aboutBody')}</p><p>{t('me.switchHint')}</p></div>
    </>
  )
}

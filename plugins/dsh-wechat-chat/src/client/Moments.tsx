import type { SessionId } from '@just-genius/dsh-plugin-runtime/client'
import type { WeChatKey } from './locales.ts'
import { formatClock, hueFromId, initialOf } from './project.ts'
import type { MomentPost } from './moments.ts'
import styles from './WeChatApp.module.css'

export function MomentsFeed({
  posts,
  t,
  onOpen,
  onPost,
}: {
  posts: MomentPost[]
  t: (key: WeChatKey) => string
  onOpen: (sessionId: SessionId) => void
  onPost: () => void
}) {
  return (
    <div className={styles.moments}>
      <div className={styles.cover}>
        <button type="button" className={styles.camera} title={t('discover.camera')} onClick={onPost}>
          <IconCamera />
        </button>
        <div className={styles.coverPerson}>
          <div className={styles.coverName}>{t('discover.coverName')}</div>
          <div className={styles.coverAvatar} style={{ background: `hsl(${hueFromId('assistant')} 58% 48%)` }}>DS</div>
        </div>
      </div>
      {posts.length === 0 && (
        <div className={styles.momentsEmpty}>
          <p>{t('discover.empty')}</p>
        </div>
      )}
      {posts.map((post) => (
        <button key={post.id} type="button" className={styles.post} data-mood={post.mood} onClick={() => onOpen(post.sessionId)}>
          <div className={styles.postAvatar} style={{ background: `hsl(${hueFromId(post.sessionId)} 58% 48%)` }}>
            {initialOf(post.name)}
          </div>
          <div className={styles.postBody}>
            <div className={styles.postName}>{post.name}</div>
            {post.prompt && <div className={styles.postPrompt}>{post.prompt}</div>}
            <div className={styles.postText}>{post.text}</div>
            {post.chips.length > 0 && (
              <div className={styles.postChips}>
                {post.chips.map((chip) => (
                  <span key={chip} className={styles.chip}>{chip}</span>
                ))}
              </div>
            )}
            <div className={styles.postMeta}>
              <span>{formatClock(post.time, t) || t('justNow')}</span>
              {post.mood === 'live' && <span className={styles.postLive}>{t('discover.live')}</span>}
              {post.mood === 'needYou' && <span className={styles.postNeed}>{t('preview.needYou')}</span>}
              <span className={styles.postOpen}>{t('discover.open')}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

function IconCamera() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.2 5.2 8 7H5.5A2.5 2.5 0 0 0 3 9.5v8A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 18.5 7H16l-1.2-1.8A2 2 0 0 0 13.2 4h-2.4a2 2 0 0 0-1.6.8ZM12 17.2A3.7 3.7 0 1 1 12 9.8a3.7 3.7 0 0 1 0 7.4Z" />
    </svg>
  )
}

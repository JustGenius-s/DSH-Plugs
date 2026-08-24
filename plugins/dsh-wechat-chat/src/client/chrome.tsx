import type { ReactNode } from 'react'
import { hueFromId, initialOf } from './project.ts'
import styles from './WeChatApp.module.css'

export function RailButton(props: {
  active: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className={styles.railBtn} data-active={props.active} onClick={props.onClick} title={props.label}>
      {props.children}
      <span>{props.label}</span>
    </button>
  )
}

export function Avatar({ id, title }: { id: string; title: string }) {
  return (
    <div className={styles.avatar} style={{ background: `hsl(${hueFromId(id)} 58% 48%)` }}>
      {initialOf(title)}
    </div>
  )
}

export function IconPlus() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

export function IconChat() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H13l-4.2 3.4c-.7.56-1.8.06-1.8-.8V16H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" /></svg>
}

export function IconPeople() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 1.2a3 3 0 1 0-2.4-5.4 4.5 4.5 0 0 1 0 5.4ZM4 18.2C4 15.6 6.5 14 8.5 14s4.5 1.6 4.5 4.2V20H4v-1.8Zm9.2 0c0-1.3.4-2.4 1.1-3.3 1 .7 2.3 1.1 3.7 1.1 1 0 1.9-.2 2.8-.6V20h-7.6v-1.8Z" /></svg>
}

export function IconCameraMini() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.2 5.2 8 7H5.5A2.5 2.5 0 0 0 3 9.5v8A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 18.5 7H16l-1.2-1.8A2 2 0 0 0 13.2 4h-2.4a2 2 0 0 0-1.6.8ZM12 17.2A3.7 3.7 0 1 1 12 9.8a3.7 3.7 0 0 1 0 7.4Z" /></svg>
}

export function IconScan() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

export function IconDiscover() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.4 5.2-1.5 4.4-4.4 1.5 1.5-4.4 4.4-1.5Z" /></svg>
}

export function IconMe() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.4 0-8 1.7-8 5v1h16v-1c0-3.3-4.6-5-8-5Z" /></svg>
}

export function WeChatMark() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.4 4.2c-4.2 0-7.6 2.9-7.6 6.5 0 2.1 1.2 4 3.1 5.2l-.8 2.4 2.7-1.4c.8.2 1.6.4 2.5.4.3 0 .6 0 .9-.1A5.7 5.7 0 0 1 10 15.6c0-3.3 3.2-6 7.1-6 .2 0 .5 0 .7 0C17.1 6.6 13.6 4.2 9.4 4.2Zm-2 4.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm4.3 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM17.1 10.8c-3.4 0-6.1 2.3-6.1 5.1s2.7 5.1 6.1 5.1c.7 0 1.3-.1 1.9-.3l2.2 1.1-.6-1.9c1.5-1 2.5-2.4 2.5-4 0-2.8-2.7-5.1-6-5.1Zm-2.1 4.1a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4.2 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" /></svg>
}

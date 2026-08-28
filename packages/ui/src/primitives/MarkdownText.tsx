import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import css from './MarkdownText.module.css'

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
})

const defaultLinkOpen = markdown.renderer.rules.link_open
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  token?.attrSet('target', '_blank')
  token?.attrSet('rel', 'noreferrer noopener')
  return defaultLinkOpen?.(tokens, index, options, env, self)
    ?? self.renderToken(tokens, index, options)
}

/** Small, dependency-local renderer for plugin-authored Markdown surfaces. */
export function MarkdownText({ text }: { text: string; streaming?: boolean }) {
  const html = useMemo(
    () => DOMPurify.sanitize(markdown.render(text), { ADD_ATTR: ['target', 'rel'] }),
    [text],
  )
  return <div className={css.root} dangerouslySetInnerHTML={{ __html: html }} />
}

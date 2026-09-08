/**
 * Codex-style inline review composer, rendered as an annotation under the
 * last line of the selected range (in both the file and diff views).
 */
import { useState } from 'react'
import { Button } from '@just-genius/dsh-plugin-ui'
import type { ViewLabels } from './view-labels'

export function InlineReviewCommentEditor(props: {
  label: string
  labels: ViewLabels
  onCancel: () => void
  onSubmit: (body: string) => boolean
}) {
  const [body, setBody] = useState('')
  const [failed, setFailed] = useState(false)
  const submit = (): void => {
    const value = body.trim()
    if (value.length === 0) return
    const applied = props.onSubmit(value)
    setFailed(!applied)
  }
  return (
    <div className="dsh-files-comment-annotation">
      <div className="dsh-files-comment-surface">
        <div className="dsh-files-comment-header">
          <span className="dsh-files-comment-author">{props.labels.commentAuthor}</span>
          <span className="dsh-files-comment-location">{props.label}</span>
        </div>
        <textarea
          autoFocus
          className="dsh-files-comment-input"
          value={body}
          placeholder={props.labels.commentPlaceholder}
          aria-label={props.labels.commentPlaceholder}
          rows={3}
          onChange={(event) => {
            setBody(event.currentTarget.value)
            setFailed(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              props.onCancel()
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {failed ? (
          <div className="dsh-files-comment-error" role="alert">
            {props.labels.commentFailed}
          </div>
        ) : null}
        <div className="dsh-files-comment-actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={props.onCancel}
          >
            {props.labels.commentCancel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={body.trim().length === 0}
            onClick={submit}
          >
            {props.labels.commentSubmit}
          </Button>
        </div>
      </div>
    </div>
  )
}

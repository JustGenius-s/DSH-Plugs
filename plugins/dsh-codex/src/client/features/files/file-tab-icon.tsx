import type { IconProps } from '@just-genius/dsh-plugin-ui'
import { fileIconSvg } from './file-icons'

interface FileTabIconProps extends IconProps {
  name: string
}

/** The same file-type glyph used by the custom explorer rows. */
export function FileTabIcon({ name, size = 16, className }: FileTabIconProps) {
  const classes = ['dsh-files-file-glyph', className].filter(Boolean).join(' ')
  return (
    <span
      aria-hidden="true"
      className={classes}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: fileIconSvg(name) }}
    />
  )
}

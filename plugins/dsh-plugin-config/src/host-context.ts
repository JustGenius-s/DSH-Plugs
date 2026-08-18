import type { Context } from '@deepseek-ai/cordis'

export interface HostLoader {
  entries(): Iterable<unknown>
  update(id: string, options: { disabled: boolean }): Promise<void>
}

export type HostContext = Context & { loader: HostLoader }

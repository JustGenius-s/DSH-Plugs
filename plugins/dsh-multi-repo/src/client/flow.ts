import type { RepoFolder } from '../shared'

export type ConfirmDecision =
  | { kind: 'current' }
  | { kind: 'multi'; primaryPath: string; repos: RepoFolder[]; title: string }

export type PickerMode = 'pick' | 'edit'

export interface PickerRequest {
  mode: PickerMode
  initialRepos: RepoFolder[]
  initialPrimaryPath: string
  initialTitle: string
  resolve: (decision: ConfirmDecision) => void
}

let current: PickerRequest | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribePicker(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPicker(): PickerRequest | null {
  return current
}

function openPicker(input: {
  mode: PickerMode
  initialRepos: RepoFolder[]
  initialPrimaryPath: string
  initialTitle: string
}): Promise<ConfirmDecision> {
  if (current !== null) current.resolve({ kind: 'current' })
  return new Promise((resolve) => {
    current = {
      mode: input.mode,
      initialRepos: input.initialRepos,
      initialPrimaryPath: input.initialPrimaryPath,
      initialTitle: input.initialTitle,
      resolve: (decision) => {
        current = null
        emit()
        resolve(decision)
      },
    }
    emit()
  })
}

/** Entry picker: empty start, folders arrive via the "add folder" button. */
export function askPick(): Promise<ConfirmDecision> {
  return openPicker({
    mode: 'pick',
    initialRepos: [],
    initialPrimaryPath: '',
    initialTitle: '',
  })
}

/** Edit an existing multi-folder binding (title, folders, primary). */
export function askEdit(input: {
  repos: RepoFolder[]
  primaryPath: string
  title: string
}): Promise<ConfirmDecision> {
  return openPicker({
    mode: 'edit',
    initialRepos: input.repos,
    initialPrimaryPath: input.primaryPath,
    initialTitle: input.title,
  })
}

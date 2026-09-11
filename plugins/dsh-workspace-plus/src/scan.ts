import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { folderName, isUnder, type AdoptResult, type RepoFolder } from './shared.ts'

export class InvalidFolderError extends Error {
  readonly name = 'InvalidFolderError'
}

export function tryRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Adopt exactly the folder the user picked. No git / sibling discovery. */
export function adoptFolder(path: string): AdoptResult {
  if (!isAbsolute(path) || path.includes('\0')) throw new InvalidFolderError('invalid absolute path')
  const adopted = tryRealpath(path)
  if (!existsSync(adopted) || !lstatSync(adopted).isDirectory()) {
    throw new InvalidFolderError('not a directory')
  }
  return { name: folderName(adopted), path: adopted }
}

export function markExternal(repos: RepoFolder[], root: string): RepoFolder[] {
  return repos.map((repo) => ({
    ...repo,
    external: !isUnder(repo.path, root) || undefined,
  }))
}

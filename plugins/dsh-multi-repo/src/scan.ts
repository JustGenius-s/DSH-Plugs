import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { folderName, isUnder, type AdoptResult, type RepoFolder } from './shared'

export function tryRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Adopt exactly the folder the user picked. No git / sibling discovery. */
export function adoptFolder(path: string): AdoptResult {
  const adopted = tryRealpath(path)
  if (!existsSync(adopted) || !lstatSync(adopted).isDirectory()) {
    throw new Error('not a directory')
  }
  return { name: folderName(adopted), path: adopted }
}

export function markExternal(repos: RepoFolder[], root: string): RepoFolder[] {
  return repos.map((repo) => ({
    ...repo,
    external: !isUnder(repo.path, root) || undefined,
  }))
}

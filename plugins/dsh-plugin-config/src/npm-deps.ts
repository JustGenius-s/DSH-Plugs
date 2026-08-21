/**
 * Whether a package.json dependency value is an npm registry version/range
 * (not link/file/github/git/tarball). Only these support outdated/update.
 */
export function isNpmRegistrySpec(spec: string): boolean {
  const trimmed = spec.trim()
  if (trimmed === '') return false
  if (
    trimmed.startsWith('link:')
    || trimmed.startsWith('file:')
    || trimmed.startsWith('workspace:')
    || trimmed.startsWith('portal:')
  ) {
    return false
  }
  if (
    trimmed.startsWith('github:')
    || trimmed.startsWith('git+')
    || trimmed.startsWith('git:')
    || trimmed.startsWith('gitlab:')
    || trimmed.startsWith('bitbucket:')
    || trimmed.startsWith('gist:')
  ) {
    return false
  }
  if (/^https?:\/\//i.test(trimmed)) return false
  // npm:pkg@version alias still resolves through the registry.
  if (trimmed.startsWith('npm:')) return true
  return true
}

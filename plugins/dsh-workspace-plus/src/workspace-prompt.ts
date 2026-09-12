import {
  normalizePrimaryPath,
  roleOf,
  samePath,
  type WorkspaceBinding,
} from './shared.ts'

export interface WorkspacePromptInput {
  binding: WorkspaceBinding
  cwd: string
}

/** Describe folder membership without guessing the active sandbox policy. */
export function renderWorkspaceContext(input: WorkspacePromptInput | null): string {
  if (input === null) return ''
  const { binding, cwd } = input
  const primaryPath = normalizePrimaryPath(binding.repos, binding.primaryPath)
  const primary = binding.repos.find((repo) => samePath(repo.path, primaryPath))
  const secondaries = binding.repos.filter((repo) => roleOf(repo.path, primaryPath) === 'secondary')
  const lines: string[] = [
    '## Multi-folder workspace',
    '',
    'This session belongs to one user-defined workspace containing multiple folders.',
    `Current session working directory: \`${cwd}\`.`,
    `Preferred primary folder for this binding: \`${primaryPath}\`.`,
    'Actual read, write, and approval rules come from the active DSH permission policy. Use tools normally and follow any denial or approval request.',
    '',
  ]
  if (primary !== undefined) {
    lines.push(`Primary folder: \`${primary.name}\` - \`${primary.path}\``)
  }
  if (secondaries.length > 0) {
    lines.push('', 'Other in-scope folders:')
    for (const repo of secondaries) lines.push(`- \`${repo.name}\` - \`${repo.path}\``)
  }
  lines.push('', 'Do not assume a single-package layout.')
  return lines.join('\n')
}

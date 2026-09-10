import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentInstalledDir, agentStatePath, emptyAgentState } from './paths.ts'
import {
  createInstalledRecord,
  parseStateFile,
  removeFromState,
} from './lifecycle.ts'
import { parseSkillMarkdown } from './skill.ts'
import { parseManifest, parseMcpConfig } from './validate.ts'
import { substituteDeep } from './substitute.ts'
import { oauthResourceUrl } from './oauth.ts'
import type {
  AgentMcpConfig,
  AgentPackSnapshot,
  AgentPluginManifest,
  AgentPluginStateFile,
  AgentSkillFile,
} from './types.ts'

export async function readAgentState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentPluginStateFile> {
  const path = agentStatePath(env)
  try {
    const text = await readFile(path, 'utf8')
    return parseStateFile(JSON.parse(text) as unknown)
  } catch {
    return emptyAgentState()
  }
}

export async function writeAgentState(
  state: AgentPluginStateFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = agentStatePath(env)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** Copy a catalog pack into ~/.dsh/agent-plugins/installed/<name>/ and register state. */
export async function installPackFromCatalog(options: {
  pluginId: string
  catalogDir: string
  variables?: Record<string, string | boolean | number>
  env?: NodeJS.ProcessEnv
}): Promise<AgentPackSnapshot> {
  const env = options.env ?? process.env
  const target = agentInstalledDir(options.pluginId, env)
  await mkdir(join(target, '..'), { recursive: true })
  await rm(target, { recursive: true, force: true })
  await cp(options.catalogDir, target, { recursive: true })

  const pack = await loadInstalledPack(options.pluginId, env)
  const state = await readAgentState(env)
  const defaults = defaultVariables(pack.manifest)
  state.plugins[options.pluginId] = createInstalledRecord({
    ...defaults,
    ...(options.variables ?? {}),
  })
  await writeAgentState(state, env)
  return pack
}

export async function uninstallPackFiles(options: {
  pluginId: string
  env?: NodeJS.ProcessEnv
}): Promise<{ directoryRemoved: boolean; stateRemoved: boolean }> {
  const env = options.env ?? process.env
  let directoryRemoved = true
  try {
    await rm(agentInstalledDir(options.pluginId, env), { recursive: true, force: true })
  } catch (error) {
    directoryRemoved = false
    throw error
  }
  const state = removeFromState(await readAgentState(env), options.pluginId)
  await writeAgentState(state, env)
  return { directoryRemoved, stateRemoved: true }
}

export async function loadInstalledPack(
  pluginId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentPackSnapshot> {
  const rootDir = agentInstalledDir(pluginId, env)
  const manifest = parseManifest(JSON.parse(await readFile(join(rootDir, 'plugin.json'), 'utf8')))
  const mcp = parseMcpConfig(JSON.parse(await readFile(join(rootDir, 'mcp.json'), 'utf8')))
  const skills = await loadSkills(join(rootDir, 'skills'))
  return { manifest, mcp, skills, rootDir }
}

export function applyVariablesToMcp(
  mcp: AgentMcpConfig,
  variables: Record<string, string | boolean | number>,
): AgentMcpConfig {
  const resolved = substituteDeep(mcp, variables)
  const out: AgentMcpConfig = {}
  for (const [id, server] of Object.entries(resolved)) {
    out[id] = { ...server, url: oauthResourceUrl(server.url) }
  }
  return out
}

export function defaultVariables(
  manifest: AgentPluginManifest,
): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {}
  for (const [key, spec] of Object.entries(manifest.variables ?? {})) {
    if (spec.default !== undefined) result[key] = spec.default
  }
  return result
}

async function loadSkills(skillsRoot: string): Promise<AgentSkillFile[]> {
  let entries: string[] = []
  try {
    entries = await readdir(skillsRoot)
  } catch {
    return []
  }
  const skills: AgentSkillFile[] = []
  for (const entry of entries) {
    const skillMd = join(skillsRoot, entry, 'SKILL.md')
    try {
      const markdown = await readFile(skillMd, 'utf8')
      const parsed = parseSkillMarkdown(markdown, entry)
      skills.push({
        name: parsed.name,
        description: parsed.description,
        body: parsed.body,
        relativePath: join('skills', entry, 'SKILL.md'),
      })
    } catch {
      // Skip folders without SKILL.md.
    }
  }
  return skills
}

/** List catalog folder names under a builtin catalog root. */
export async function listCatalogIds(catalogRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(catalogRoot, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch {
    return []
  }
}

export async function loadCatalogPack(catalogDir: string): Promise<AgentPackSnapshot> {
  const manifest = parseManifest(JSON.parse(await readFile(join(catalogDir, 'plugin.json'), 'utf8')))
  const mcp = parseMcpConfig(JSON.parse(await readFile(join(catalogDir, 'mcp.json'), 'utf8')))
  const skills = await loadSkills(join(catalogDir, 'skills'))
  return { manifest, mcp, skills, rootDir: catalogDir }
}

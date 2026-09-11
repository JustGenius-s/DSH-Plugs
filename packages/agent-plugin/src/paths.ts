import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentPluginStateFile } from './types.ts'

/** DSH home: `$DSH_HOME` or `~/.dsh`. */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

export function agentPluginsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHome(env), 'agent-plugins')
}

export function agentStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentPluginsRoot(env), 'state.json')
}

export function agentInstalledDir(pluginId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(agentPluginsRoot(env), 'installed', pluginId)
}

export function emptyAgentState(): AgentPluginStateFile {
  return { version: 1, plugins: {} }
}

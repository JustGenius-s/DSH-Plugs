/** Keep opaque bindings isolated to the actual driver/provider namespace. */
export function cuaTool(name: string): { provider: string; operation: string } | undefined {
  const match = /^((?:mcp__)?(?:cua[-_]driver(?:[-_](?:mcp|native))?|(?:@deepseek-ai\/)?(?:dsh-experimental-)?computer[-_]use[-_]cua(?:[-_]driver)?(?:[-_](?:mcp|native))?))(?:__|[./:_-])([a-z][a-z0-9_]*)$/i.exec(name)
  return match === null ? undefined : { provider: match[1]!.toLowerCase(), operation: match[2]!.toLowerCase() }
}

const INPUT_TOOLS = new Set([
  'click', 'type_text', 'set_value', 'press_key', 'scroll', 'drag', 'set_window_frame',
  'bring_to_front', 'invoke_menu', 'activate_app', 'focus_window',
])

export function isCuaInput(name: string): boolean {
  const tool = cuaTool(name)
  return tool !== undefined && INPUT_TOOLS.has(tool.operation)
}

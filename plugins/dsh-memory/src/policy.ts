/** Always-on guidance for when and how to write global memory. */
export const MEMORY_POLICY = `## Global memory

Stable user preferences and durable facts live in a global memory store (markdown files).
Enabled entries appear above this section as "Global memory".

### Writing memory
- Use \`memory_propose\` when the user asks to remember something, or when a durable preference / fact will clearly help future sessions.
- Do NOT store secrets (passwords, tokens), ephemeral task state, or one-off debugging notes.
- Prefer short, self-contained markdown. One topic per entry. Give a clear title.
- \`memory_propose\` waits for the user to accept, edit, or reject. Never claim a memory was saved until the tool result says so.
- There is no silent write path. Do not invent a workaround that bypasses confirmation.
`

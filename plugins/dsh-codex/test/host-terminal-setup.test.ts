import { describe, expect, it } from 'vitest'
import { setupScript } from '../src/host/terminal/server'

/**
 * These cases pin the shell bootstrap that gates the whole terminal panel.
 *
 * The pane renders only once the host sends `ready`, and `ready` is emitted
 * only when the shell's prompt hook reports a `warp-block-end` marker. On zsh
 * the hook must be PREPENDED: appended with `+=` it runs after zsh's own prompt
 * machinery, which captures the hook's output and re-emits it as prompt text —
 * losing the raw ESC bytes, so no marker ever arrives and the pane waits on
 * `ready` forever. bash writes through PROMPT_COMMAND and is unaffected.
 *
 * Only the generated text is asserted here — no PTY and no rendering, so these
 * run anywhere and fail the build the day the ordering regresses.
 */
describe('terminal setupScript', () => {
  const zsh = () => setupScript('/bin/zsh')
  const bash = () => setupScript('/bin/bash')

  it('prepends the zsh prompt hook so its marker bytes reach the terminal', () => {
    expect(zsh()).toContain('precmd_functions=(dsh_block_mark ${precmd_functions[@]})')
  })

  it('never appends the zsh prompt hook (the captured-output regression)', () => {
    expect(zsh()).not.toContain('precmd_functions+=dsh_block_mark')
  })

  it('defines the zsh marker function the hook calls', () => {
    expect(zsh()).toContain('dsh_block_mark() {')
  })

  it('keeps bash on PROMPT_COMMAND, untouched by the zsh ordering fix', () => {
    expect(bash()).toContain('PROMPT_COMMAND=')
    expect(bash()).not.toContain('precmd_functions')
  })

  it('emits the ready marker on both shells', () => {
    expect(zsh()).toContain('warp-block-end')
    expect(bash()).toContain('warp-block-end')
  })

  it('suppresses the shell prompt on both shells (the client draws its own)', () => {
    expect(zsh()).toContain("export PS1=''")
    expect(bash()).toContain("export PS1=''")
  })

  it('space-quiets later bootstrap lines so ignorespace keeps them out of HISTFILE', () => {
    // The FIRST line is deliberately not quieted: it is the ignorespace/hist
    // option itself, which must be recorded to take effect in this shell.
    for (const script of [zsh(), bash()]) {
      const lines = script.split('\n').filter(line => line.length > 0)
      const [, ...rest] = lines
      for (const line of rest) expect(line.startsWith(' ')).toBe(true)
    }
  })
})

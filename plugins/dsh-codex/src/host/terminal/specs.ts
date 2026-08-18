/** Lightweight command signatures for Warp-style argument completions. */

export interface SpecNode {
  subcommands?: Record<string, SpecNode>
  flags?: string[]
}

const GIT_STASH: SpecNode = {
  subcommands: {
    push: { flags: ['-u', '-a', '-m'] },
    pop: { flags: ['--index'] },
    apply: {},
    list: {},
    show: {},
    drop: {},
    clear: {},
  },
}

const GIT_REMOTE: SpecNode = {
  flags: ['-v'],
  subcommands: {
    add: {},
    remove: {},
    rename: {},
    show: {},
    get: { subcommands: { url: {} } },
    set: { subcommands: { url: {} } },
  },
}

export const COMMAND_SPECS: Record<string, SpecNode> = {
  git: {
    flags: ['--help', '--version', '-C', '-c'],
    subcommands: {
      add: { flags: ['-A', '-p', '-u', '-n', '-v', '--all', '--patch', '--force'] },
      blame: { flags: ['-L', '-w'] },
      branch: { flags: ['-d', '-D', '-a', '-m', '-v', '--show-current'] },
      checkout: { flags: ['-b', '-B', '-'] },
      'cherry-pick': { flags: ['-n', '-e', '--continue', '--abort'] },
      clone: { flags: ['--depth', '--recurse-submodules'] },
      commit: { flags: ['-m', '-a', '-p', '--amend', '--no-edit', '-v'] },
      config: { flags: ['--global', '--local', '--list', '-e'] },
      diff: { flags: ['--staged', '--stat', '--name-only'] },
      fetch: { flags: ['--all', '--prune', '-p'] },
      init: { flags: ['-b'] },
      log: { flags: ['--oneline', '--graph', '--all', '-p', '-n'] },
      merge: { flags: ['--no-ff', '--abort', '--continue'] },
      pull: { flags: ['--rebase', '--ff-only', '--no-ff'] },
      push: { flags: ['-u', '--force', '--force-with-lease', '--tags', '-d'] },
      rebase: { flags: ['-i', '--continue', '--abort', '--skip'] },
      remote: GIT_REMOTE,
      reset: { flags: ['--soft', '--mixed', '--hard'] },
      restore: { flags: ['--staged', '-s'] },
      revert: { flags: ['--no-edit', '--continue', '--abort'] },
      show: {},
      stash: GIT_STASH,
      status: { flags: ['-s', '-b', '--short'] },
      switch: { flags: ['-c', '-'] },
      tag: { flags: ['-a', '-d', '-l'] },
      worktree: { subcommands: { add: {}, list: {}, remove: {} } },
    },
  },
  npm: {
    flags: ['--help', '-v'],
    subcommands: {
      install: { flags: ['-D', '-g', '--save-dev', '--legacy-peer-deps'] },
      ci: {},
      run: {},
      test: {},
      exec: {},
      init: { flags: ['-y'] },
      publish: { flags: ['--access', '--dry-run'] },
      uninstall: {},
      update: {},
      ls: {},
    },
  },
  npx: { flags: ['-y', '--yes', '-p'] },
  pnpm: {
    flags: ['--help', '-r', '--filter'],
    subcommands: {
      install: { flags: ['-D', '--frozen-lockfile'] },
      add: { flags: ['-D', '-g', '-w'] },
      run: {},
      test: {},
      exec: {},
      dlx: {},
      remove: {},
      update: {},
    },
  },
  yarn: {
    flags: ['--help'],
    subcommands: {
      install: {},
      add: { flags: ['-D', '-W'] },
      run: {},
      test: {},
      remove: {},
      dlx: {},
    },
  },
  cargo: {
    flags: ['--help', '--version'],
    subcommands: {
      build: { flags: ['--release', '--all-targets'] },
      run: { flags: ['--release'] },
      test: { flags: ['--release'] },
      check: {},
      clippy: {},
      fmt: {},
      add: {},
      install: {},
      new: { flags: ['--bin', '--lib'] },
      init: {},
      publish: {},
    },
  },
  docker: {
    flags: ['--help'],
    subcommands: {
      ps: { flags: ['-a', '-q'] },
      images: { flags: ['-a', '-q'] },
      run: { flags: ['-it', '-d', '--rm', '-p', '-v', '-e', '--name'] },
      build: { flags: ['-t', '--no-cache'] },
      exec: { flags: ['-it'] },
      logs: { flags: ['-f', '--tail'] },
      compose: {
        subcommands: {
          up: { flags: ['-d', '--build'] },
          down: { flags: ['-v'] },
          ps: {},
          logs: { flags: ['-f'] },
          exec: {},
          build: {},
        },
      },
      pull: {},
      push: {},
      stop: {},
      rm: { flags: ['-f'] },
      rmi: {},
    },
  },
  kubectl: {
    flags: ['--help', '-n', '--namespace', '-A'],
    subcommands: {
      get: { flags: ['-o', '-w', '-A'] },
      apply: { flags: ['-f', '-k'] },
      delete: { flags: ['-f'] },
      describe: {},
      logs: { flags: ['-f', '--tail'] },
      exec: { flags: ['-it'] },
      'port-forward': {},
      config: { subcommands: { 'use-context': {}, 'get-contexts': {}, 'current-context': {} } },
    },
  },
  gh: {
    flags: ['--help'],
    subcommands: {
      pr: {
        subcommands: {
          list: {},
          view: {},
          create: { flags: ['-f', '-w', '--fill'] },
          checkout: {},
          merge: {},
        },
      },
      issue: { subcommands: { list: {}, view: {}, create: {} } },
      repo: { subcommands: { clone: {}, view: {}, create: {} } },
      auth: { subcommands: { login: {}, status: {} } },
      run: { subcommands: { list: {}, view: {}, watch: {} } },
    },
  },
  brew: {
    flags: ['--help'],
    subcommands: {
      install: {},
      uninstall: {},
      update: {},
      upgrade: {},
      search: {},
      info: {},
      list: {},
    },
  },
  ls: { flags: ['-l', '-a', '-h', '-R', '-1', '--color'] },
  rm: { flags: ['-r', '-f', '-rf', '-i'] },
  cp: { flags: ['-r', '-a', '-v', '-n'] },
  mv: { flags: ['-i', '-n', '-v'] },
  mkdir: { flags: ['-p'] },
  chmod: { flags: ['-R'] },
  ssh: { flags: ['-i', '-L', '-R', '-N', '-p'] },
  curl: { flags: ['-I', '-L', '-O', '-o', '-X', '-H', '-d', '-v', '-s'] },
}

const GIT_SUBCOMMAND_HELP: Record<string, string> = {
  add: 'add file contents to the index',
  branch: 'list, create, or delete branches',
  checkout: 'switch branches or restore files',
  clone: 'clone a repository into a new directory',
  commit: 'record changes to the repository',
  diff: 'show changes between commits, trees, or files',
  fetch: 'download objects and refs from another repository',
  log: 'show commit logs',
  merge: 'join two or more development histories',
  pull: 'fetch from and integrate with another repository',
  push: 'update remote refs along with associated objects',
  rebase: 'reapply commits on top of another base',
  remote: 'manage set of tracked repositories',
  reset: 'reset current HEAD to the specified state',
  stash: 'stash the changes in a dirty working directory',
  status: 'show the working tree status',
  switch: 'switch branches',
}

export function specOptions(commandTokens: string[], query: string): Array<{
  value: string
  label: string
  kind: 'flag' | 'subcommand'
  description?: string
}> {
  if (commandTokens.length === 0) return []
  let node = COMMAND_SPECS[commandTokens[0]]
  if (node === undefined) return []
  const rootCommand = commandTokens[0]

  for (const token of commandTokens.slice(1)) {
    if (token.startsWith('-')) continue
    const next = node.subcommands?.[token]
    if (next !== undefined) node = next
  }

  const options: Array<{ value: string; label: string; kind: 'flag' | 'subcommand'; description?: string }> = []
  const wantFlags = query.startsWith('-')
  if (!wantFlags && node.subcommands !== undefined) {
    for (const name of Object.keys(node.subcommands)) {
      if (!name.startsWith(query)) continue
      const description = rootCommand === 'git' && commandTokens.length === 1 ? GIT_SUBCOMMAND_HELP[name] : undefined
      options.push({ value: name, label: name, kind: 'subcommand', description })
    }
  }
  if (wantFlags && node.flags !== undefined) {
    for (const flag of node.flags) {
      if (flag.startsWith(query)) options.push({ value: flag, label: flag, kind: 'flag' })
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label))
}

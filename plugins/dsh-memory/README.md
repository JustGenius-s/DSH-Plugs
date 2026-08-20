# @just-genius/dsh-memory

Global markdown memory for DeepSeek Harness.

## Features

- **Settings → Memory** page: list / add / edit / delete / enable memories
- **AI write with confirmation**: `memory_propose` waits for Accept / Reject (title & body editable)
- **Prompt injection**: enabled entries are injected via `systemPrompt.section`
- **Storage**: `~/.dsh/memory/index.json` + `~/.dsh/memory/entries/<id>.md`

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-memory
```

Restart DSH web after install (bundle patch). Then open **Settings → Memory**.

## AI usage

The model should call `memory_propose` with `title` + `content`. A confirmation dock appears above the composer; nothing is written until the user accepts.

# @just-genius/dsh-sync

用 GitHub OAuth Device Flow + 私有 Gist 同步本机 DSH 配置，**无需自建同步服务器**。

## Features

- **Settings → 同步**：填写 OAuth Client ID、登录 GitHub、Push / Pull
- **存储落点**：用户自己的 secret Gist（文件名 `dsh-config.json`）
- **同步内容**：
  - `~/.dsh/settings.yaml`（含各插件在 settings 里的配置段）
  - web profile 插件清单（`dependencies` → 可移植的 `github:` / 版本号）+ `cordis.patch.yml`
- **冲突**：本地与云端都改过时提示，可强制用云端覆盖

## Install

```sh
dsh plugin --profile web add ./plugins/dsh-sync
```

安装后需 **重启 DSH web**（bundle patch）。然后打开 **Settings → 同步**。

## 使用步骤

1. 在 GitHub → Settings → Developer settings → **OAuth Apps** 新建应用
2. 启用 **Device Flow**；Callback URL 可填 `http://127.0.0.1`
3. 把 **Client ID**（不需要 Client Secret）填到设置页并保存
4. 点击「登录 GitHub」，在浏览器输入设备码授权（scope: `gist`）
5. **推送到云端** / **从云端拉取**

## 插件同步说明

- 本机 `link:` / 绝对路径依赖会尽量映射为 `github:JustGenius-s/DSH-Plugs#path:plugins/<folder>`
- 无法映射的本机路径（例如内网私有包）**不会写入 Gist**，Pull 时也不会删掉它们
- Pull 安装/卸载插件后需 **重启 DSH web**
- 若本机有 DSH-Plugs checkout，安装时优先用本地目录，否则用 `github:` 规格

## 数据位置

| 路径 | 用途 |
|------|------|
| `~/.dsh/sync/state.json` | Client ID、token、gistId、上次同步时间 |
| Gist `dsh-config.json` | 云端快照（settings + plugins） |

## 注意

- Secret Gist ≠ 加密；不要把明文密钥塞进会同步的配置里
- Pull 会覆盖本机 `settings.yaml` 与可移植插件清单；改完后建议先 Push
- 多机首次：一机 Push，另一机登录同一 GitHub 账号后 Pull

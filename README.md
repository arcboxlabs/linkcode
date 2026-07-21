<h4 align="right"><strong>English</strong> | <a href="docs/README.zh-CN.md">简体中文</a></h4>

<p align="center">
    <img src="./assets/icon.png" width="138" alt="LinkCode"/>
</p>

<h1 align="center">LinkCode</h1>
<p align="center"><strong>Every Code Agent in the Palm of Your Hand</strong></p>

<div align="center">
    <a href="https://github.com/arcboxlabs/linkcode/releases/latest" target="_blank">
    <img alt="GitHub release" src="https://img.shields.io/github/v/release/arcboxlabs/linkcode?style=flat"></a>
    <a href="https://github.com/arcboxlabs/linkcode/releases" target="_blank">
    <img alt="GitHub downloads" src="https://img.shields.io/github/downloads/arcboxlabs/linkcode/total.svg?style=flat"></a>
    <a href="https://github.com/arcboxlabs/linkcode/commits" target="_blank">
    <img alt="GitHub commit" src="https://img.shields.io/github/commit-activity/m/arcboxlabs/linkcode?style=flat"></a>
    <a href="LICENSE" target="_blank">
    <img alt="License" src="https://img.shields.io/badge/license-BUSL--1.1-blue?style=flat"></a>
    <a href="https://twitter.com/arcboxlabs" target="_blank">
    <img alt="twitter" src="https://img.shields.io/badge/follow-arcboxlabs-green?style=social&logo=Twitter"></a>
    <img alt="Hits" src="https://hits.aprilnea.com/hits?url=https://github.com/arcboxlabs/linkcode">
</div>

<p align="center">
    <a href="#install">Install</a> ·
    <a href="#features">Features</a> ·
    <a href="#supported-agents">Supported Agents</a> ·
    <a href="#how-it-works">How It Works</a> ·
    <a href="#development">Development</a>
</p>

LinkCode is one workspace for all your coding agents. A host on your machine takes over Claude Code, Codex, OpenCode, Pi, and Grok Build, normalizes their divergent events into a single contract, and serves the same threads to every client — start an agent at your desk, keep an eye on it from anywhere.

## Features

- **All your agents, one inbox** — run threads across five agents side by side, with the same UI and the same controls for every one of them.
- **Fully interactive** — permission approvals, plan review, questions, images, slash commands: everything an agent asks for, rendered natively instead of scrolling by in a terminal.
- **Real terminals** — PTY terminals backed by a native Rust sidecar, with multi-client attach and flow control that survives output floods.
- **Workspace at hand** — file tree, git panel, and project scripts with dev-server preview, right next to the conversation.
- **Automations** — schedule agent runs, or loop a prompt until the work is done.
- **Your history, kept in place** — sessions stay in each agent's own local history; LinkCode lists, imports, and resumes them without copying a transcript.
- **Local-first** — the host binds to loopback and your code never leaves the machine; remote access is an explicit tunnel through LinkCode Cloud (companion mobile app in active development).

## Supported Agents

| Agent | Vendor |
| --- | --- |
| [Claude Code](https://github.com/anthropics/claude-code) | Anthropic |
| [Codex](https://github.com/openai/codex) | OpenAI |
| [OpenCode](https://opencode.ai) | SST |
| [Pi](https://github.com/earendil-works/pi) | Earendil Works |
| [Grok Build](https://x.ai) | xAI |

> [!NOTE]
> Agent CLIs are not bundled with the app. The daemon picks up an existing install on your machine, or downloads a managed copy on demand — you sign in with your own agent accounts.

## How It Works

```mermaid
flowchart LR
    subgraph machine["Your machine"]
        DESKTOP["Desktop"]
        WEB["Browser"]
        DAEMON["Daemon<br/>engine · adapters · PTY"]
        AGENTS["Claude Code · Codex · OpenCode<br/>Pi · Grok Build"]
    end
    CLOUD["LinkCode Cloud<br/>relay"]
    MOBILE["Mobile"]

    DESKTOP <--> DAEMON
    WEB <--> DAEMON
    DAEMON <--> AGENTS
    DAEMON <--> CLOUD
    CLOUD <--> MOBILE
```

A local daemon hosts the engine and one adapter per agent. Adapters normalize each agent's native events into a single zod-validated data contract, carried over a versioned wire protocol; clients are thin renderers of that one normalized conversation, so desktop, browser, and mobile stay identical whether they connect directly or through the Cloud tunnel. The full picture — layers, contracts, and the data-plane/system-plane split — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Install

### macOS

```bash
brew install --cask arcboxlabs/tap/linkcode
```

Or grab the DMG (Apple silicon / Intel) from the [latest release](https://github.com/arcboxlabs/linkcode/releases/latest).

### Windows & Linux

Download the installer (`.exe`), `.AppImage`, or `.deb` from the [latest release](https://github.com/arcboxlabs/linkcode/releases/latest).

The desktop app keeps itself up to date automatically.

## Development

Prerequisites: Node.js 24+, pnpm 11, and stable Rust — or let [`devenv`](https://devenv.sh) pin all of them for you.

```bash
pnpm install
devenv shell -- app   # daemon + desktop, in dev mode
```

Without devenv, the same sequence is:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev
```

| Doc | What's inside |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, the single data contract, transport and wire protocol |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Runbook: run every surface, test, E2E, triage |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Packaging, signing, notarization, publishing |

## License

LinkCode is source-available under the [Business Source License 1.1](LICENSE); its logos and brand assets are licensed separately (see [`assets/LICENSE`](assets/LICENSE) and the [Brand Usage Terms](assets/BRAND.md)).

# Link Code

面向通用 coding agent 的**统一 GUI**：本地跑一个 **host 守护进程（`apps/daemon`）** 统一接管各家 coding agent，把风格各异的消息归一化成同一套 **zod 数据契约**；用户从 **PC / Web / Mobile** 三端经 WebSocket 连接同一个 daemon，获得一致界面。移动端经中转 `Server` 在外网远程查看与控制本地 daemon。

> 参考 Zed 的 [Agent Client Protocol](https://agentclientprotocol.com)（事件词汇）。真实 agent 会拉起 CLI 子进程并持有密钥，**无法跑在浏览器标签页里**，故 host 收敛为独立 daemon 进程；数据契约对齐 ACP 的 `session/update` 词汇。

> 完整设计与约束见 [`PLAN.md`](./PLAN.md)。本文件只覆盖工程结构与开发命令。

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript（`strict`，禁止 `any` 绕过契约） |
| 数据契约 | zod（`packages/schema` 唯一来源） |
| Monorepo | pnpm workspaces + Turborepo |
| Lint / Format | Biome |
| Host | 独立 daemon 进程（`apps/daemon`，Node），`Hub` 扇出 + WebSocket 暴露给三端 |
| Agent 接入 | 各家官方 SDK 原生接入：`@anthropic-ai/claude-agent-sdk` · `@openai/codex-sdk` · `@opencode-ai/sdk` · `@earendil-works/pi-coding-agent`；长尾经通用 ACP 适配（`@agentclientprotocol/sdk`） |
| PC | Electron（electron-vite）+ TypeSafe IPC（tRPC 默认实现）；渲染层经 WebSocket 连 daemon |
| Web | React + Vite + **Coss UI**（coss.com/ui，shadcn registry + Base UI）；经 WebSocket 连 daemon |
| Mobile | Expo + HeroUI（经 Server tunnel 连 daemon） |
| 样式 | web：Tailwind v4 + Coss UI（令牌 `src/coss.css`，组件 `src/components/ui`）；desktop：Tailwind v4 + `@linkcode/ui`；mobile：NativeWind |
| 客户端数据 | TanStack Query / SWR |
| 测试 | Vitest（adapter 归一化纯函数） |

## 目录结构

```
link-code/
├─ apps/
│  ├─ daemon/     # 本地 host 守护进程：Hub + WebSocket server + 共享 Host（真实 agent 跑这里）
│  ├─ web/        # 浏览器客户端：React + Vite（经 WebSocket 连 daemon）
│  ├─ desktop/    # Electron 壳 + 渲染层；TypeSafe IPC 走系统面；渲染层经 WebSocket 连 daemon
│  ├─ mobile/     # Expo + HeroUI（经 Server tunnel 连 daemon）
│  └─ server/     # 中转 / 隧道：tunnel · token · perm · store · realtime
├─ packages/
│  ├─ schema/        # ✅ zod 数据契约：对齐 ACP 词汇（content / tool-call / plan / permission …）
│  ├─ transport/     # 通信层：LocalTransport / WsTransport（客户端）+ Hub / createWsServer（`/server`）
│  ├─ agent-adapter/ # agent 适配层：原生 SDK（claude-code/codex/opencode/pi）+ 通用 ACP seam
│  ├─ engine/        # 本地核心：会话编排引擎 `Engine`（即「host」，驱动 agent-adapter，over transport）
│  ├─ ipc/           # TypeSafe IPC 抽象 + tRPC 实现（仅 desktop）
│  ├─ client-core/   # 三端共享：数据 hooks（TanStack Query）+ 对接 transport
│  └─ ui/            # CoSSUI 组件库（PC / Web 共享）
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
└─ biome.json
```

## 核心约束（见 PLAN §2）

1. **zod schema 是唯一数据契约**：先改 schema 再改实现；信任边界（网络 / IPC / agent 输出）一律 zod 运行时校验。
2. **数据面 / 系统面严格分离**：业务数据只走 `transport`；Electron 系统级操作只走 TypeSafe IPC，**IPC 绝不承载业务数据**。
3. **面向接口、实现可替换**：transport 与 IPC 都是接口，tRPC 只是 IPC 的默认实现之一。

## 开发

```bash
# 安装（需要 Node >= 24、pnpm 11；推荐 corepack enable）
pnpm install

# 全量类型检查 / lint / 构建 / 测试
pnpm typecheck
pnpm lint
pnpm build
pnpm test

# 先起本地 daemon（其他端连它）
pnpm --filter @linkcode/daemon dev   # ws://127.0.0.1:4317（LINKCODE_PORT / LINKCODE_HOST 可覆盖）

# 再起某一端（也可 pnpm dev 并行启动）
pnpm --filter @linkcode/web dev
pnpm --filter @linkcode/desktop dev
pnpm --filter @linkcode/mobile start
pnpm --filter @linkcode/server dev
```

> **真实运行需各 agent 的 CLI / API key 就位**（如 `ANTHROPIC_API_KEY`、`codex` / `opencode` / `pi` CLI）。某个 SDK 缺失时，对应 adapter 会发一个清晰的 `error` 事件而非拖垮 daemon。归一化逻辑由 Vitest 纯函数测试覆盖（无需密钥）。

## 状态

四家 agent 已按官方 SDK **原生接入**（claude-code / codex / opencode / pi），并保留通用 ACP 适配 seam 接长尾；host 收敛为独立 daemon。全仓 `typecheck` / `build` / `lint` / `test` 通过。`PLAN.md` 中仍标 ❓ 的项（Server 各能力的数据模型、移动端 UI、桌面端是否内嵌 daemon 等）待落地；端到端真实联调需本机具备各 agent 的凭据。

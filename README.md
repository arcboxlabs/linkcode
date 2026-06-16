# Link Code

面向通用 coding agent 的**统一 GUI**：本地跑一个 `host` 统一接管各家 coding agent，把风格各异的消息归一化成同一套 **zod 数据契约**；用户从 **PC / Web / Mobile** 三端连接同一个 host，获得一致界面。移动端经中转 `Server` 在外网远程查看与控制本地 host。

> 完整设计与约束见 [`PLAN.md`](./PLAN.md)。本文件只覆盖工程结构与开发命令。

## 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript（`strict`，禁止 `any` 绕过契约） |
| 数据契约 | zod（`packages/schema` 唯一来源） |
| Monorepo | pnpm workspaces + Turborepo |
| Lint / Format | Biome |
| PC | Electron（electron-vite）+ TypeSafe IPC（tRPC 默认实现） |
| Web | React + Vite |
| Mobile | Expo + HeroUI |
| 客户端数据 | TanStack Query / SWR |

## 目录结构

```
link-code/
├─ apps/
│  ├─ web/        # 浏览器客户端：React + Vite（本地直连 host）
│  ├─ desktop/    # Electron 壳 + 渲染层；TypeSafe IPC 走系统面
│  ├─ mobile/     # Expo + HeroUI（经 Server tunnel 远程接入）
│  └─ server/     # 中转 / 隧道：tunnel · token · perm · store · realtime
├─ packages/
│  ├─ schema/      # ✅ zod 数据契约：所有跨进程 / 跨端消息类型来源
│  ├─ transport/   # 通信协议层：LocalTransport / WsTransport
│  ├─ host/        # 本地核心：agent 适配层 + 抽象层（src/agent/*）
│  ├─ ipc/         # TypeSafe IPC 抽象 + tRPC 实现（仅 desktop）
│  ├─ client-core/ # 三端共享：数据 hooks（TanStack Query）+ 对接 transport
│  └─ ui/          # CoSSUI 组件库（PC / Web 共享）
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

# 全量类型检查 / lint / 构建
pnpm typecheck
pnpm lint
pnpm build

# 单独启动某一端（也可 pnpm dev 并行启动）
pnpm --filter @linkcode/web dev
pnpm --filter @linkcode/desktop dev
pnpm --filter @linkcode/mobile start
pnpm --filter @linkcode/server dev
```

## 状态

脚手架阶段。`PLAN.md` 中标记为 ❓ 的项（四家 agent SDK 的接入形态、Server 各能力的数据模型、CoSSUI 底层等）尚未拍板，相关代码以**接口骨架 + TODO** 形式存在，待确认后再落地实现。

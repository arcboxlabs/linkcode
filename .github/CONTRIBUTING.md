# Contributing to LinkCode

Thanks for your interest in improving LinkCode! This guide covers the practical path from idea to merged PR. For where to ask questions see [SUPPORT.md](SUPPORT.md); all participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bug fixes and small improvements** — open a PR directly. Linking an issue is appreciated but not required.
- **New features or behavior changes** — open an issue first. The architecture has deliberate boundaries and some deliberately open questions ([`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)); a short discussion up front saves you from building something that can't merge.
- LinkCode is source-available under the [Business Source License 1.1](../LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

## Toolchain

[`devenv`](https://devenv.sh) pins everything — Node.js, pnpm, the Rust toolchain from [`rust-toolchain.toml`](../rust-toolchain.toml), and the pre-commit hooks:

```bash
devenv shell
```

Without devenv, install Node.js 24+, pnpm 11, and rustup yourself — rustup reads `rust-toolchain.toml` and installs the pinned compiler, `rustfmt`, and Clippy on its own. You also need your platform's native toolchain (Xcode Command Line Tools, VS Build Tools with the C++ workload, or `build-essential`); the per-platform list is in [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md#prerequisites). Either way: **always pnpm, never npm or npx.**

## Build and run

```bash
pnpm install
devenv shell -- app   # daemon + desktop, in dev mode
```

The full runbook — running each surface on its own, the test layout, E2E procedures, and triage for a stuck daemon — is [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md).

## Checks

Run **both** commands before every commit; the first does not include the second:

```bash
pnpm check:ci   # format check (Biome) + lint (ESLint) + typecheck
pnpm test       # vitest
```

Most format/lint issues auto-fix with `pnpm format` and `pnpm lint:fix`. For Rust changes, also run what CI enforces:

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Pre-commit hooks (prek, configured in `devenv.nix`) run format, lint, and typecheck across the whole repo on every commit.

## Things to know before touching…

- **The wire protocol** — any change to any wire message in `packages/foundation/schema` must bump `WIRE_PROTOCOL_VERSION`. Mismatched peers still connect but silently discard every frame; after a bump, restart the daemon and all clients together.
- **Package boundaries** — apps never import other apps; shared client runtime belongs in `packages/client/workbench`, business-free presentation in `packages/presentation/ui`. The ownership map is in [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
- **Native dependencies** — pnpm blocks install scripts by default; a native dep must be allow-listed under `allowBuilds:` in `pnpm-workspace.yaml` or it fails at `require()` time.
- **`packages/vendor/coss-ui` is vendored** — synced from upstream and excluded from lint/format; never hand-edit or reformat it.
- **Versions and tags are CI-owned** — never hand-bump `apps/desktop/package.json` or push `v*` tags; releases go through the flow in [`docs/RELEASE.md`](../docs/RELEASE.md).

## Commits and pull requests

- Branch from `master` as `<type>/<short-description>`, e.g. `fix/reconnect-loop`.
- Commit messages follow `type(scope): summary`, e.g. `fix(transport): drop stale ack on reconnect`. Keep commits atomic — each one compiles and passes the checks.
- Fill in the PR template: what changed and why, and how you verified it. UI changes include a screenshot or short recording.
- Merges to `master` are performed by maintainers as `--no-ff` merge commits.

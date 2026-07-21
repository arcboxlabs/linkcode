# Support

## Documentation first

| Doc | What's inside |
| --- | --- |
| [`README.md`](README.md) | What LinkCode is, install, quick start |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Run every surface, test, E2E, triage a stuck daemon |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, data contract, transport and wire protocol |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Packaging, signing, publishing |

## Bugs and feature requests

Use the [issue templates](https://github.com/arcboxlabs/linkcode/issues/new/choose). Please search existing issues first, and include the version, platform, agent, and logs the bug template asks for — they cut a round trip from almost every report.

Log locations for the released desktop app:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Logs/LinkCode/main.log` |
| Windows | `%APPDATA%/LinkCode/logs/main.log` |
| Linux | `~/.config/LinkCode/logs/main.log` |

Quick daemon health check — a JSON identity reply means the local host is up:

```bash
curl http://127.0.0.1:19523/linkcode
```

## Questions

- Open a [GitHub issue](https://github.com/arcboxlabs/linkcode/issues/new/choose) — questions are welcome there too.
- Email [hello@arcbox.dev](mailto:hello@arcbox.dev).
- Reach us on X at [@arcboxlabs](https://twitter.com/arcboxlabs).

LinkCode is developed by ArcBox. Support is best-effort; bug reports with logs and clear reproduction steps get answered fastest.

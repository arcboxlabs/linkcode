## Summary

<!-- What changed and why? Link the issue if there is one: Closes #123 -->

## Verification

<!-- How did you prove it works? Commands run, surfaces launched, before/after screenshots for UI changes. -->

## Checklist

- [ ] `pnpm check:ci` and `pnpm test` both pass (plus `cargo fmt` / `clippy` / `test` for Rust changes)
- [ ] I ran the affected surface and observed the change working
- [ ] If a wire message changed: `WIRE_PROTOCOL_VERSION` is bumped
- [ ] Docs and comments are updated where behavior changed

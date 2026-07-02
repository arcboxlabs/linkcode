---
paths:
  - "apps/webview/src/**/*.{ts,tsx}"
  - "apps/desktop/src/renderer/**/*.{ts,tsx}"
  - "packages/ui/src/chat/**/*.{ts,tsx}"
  - "packages/ui/src/shell/**/*.{ts,tsx}"
  - "packages/workbench/src/**/*.{ts,tsx}"
---

# Front-end Conventions (Vite renderers)

Scope: the web renderer stack — `apps/webview`, the `apps/desktop` renderer, and the web
parts of `packages/ui` (`chat`/`shell`) and `packages/workbench`. Does **not** apply to
`apps/mobile` (Expo / React Native / HeroUI) or `apps/desktop/src/main` (Electron main).

> Both renderers are **Vite SPAs** — there is **no Next.js, no RSC, no `loading.tsx`, no file-system routing**. Where a pattern below mirrors the platform dashboard, it has been translated to CSR. **Only `apps/webview` has a router** (React Router's data-router API). The desktop renderer is deliberately router-free: it is a single-window shell whose workbench stays permanently mounted (composer drafts, scroll, panel layout survive), and full-page surfaces such as Settings overlay it, gated by explicit state that lives **above the connection gate** so they stay reachable while the daemon is down. Do not add react-router to desktop for a new surface — extend the overlay pattern; revisit only if desktop grows real multi-page navigation.

- **coss-ui first.** Reach for `Card`/`CardFrame`/`CardPanel` instead of hand-writing borders/padding; `Field`+`FieldLabel`+`FieldDescription`+`Input` instead of custom inputs; `Button`, `Sidebar`, `Tabs`, `Combobox`, `Empty`, `Skeleton`, `Badge`, etc. Compose with `render={<Link to="…" />}` where coss-ui supports it. Only hand-roll when no primitive exists.
  - **Never edit `coss-ui` source.** If you must customize, "fork" by copying the minimal needed implementation into the consuming package, reusing coss-ui exports as much as possible.
- **lucide icons: import the `Icon`-suffixed variant** (`SearchIcon`, not `Search`).
- **Routing & layout (webview).** Define routes with `createBrowserRouter` (data router) — no JSX `<Routes>` trees. Build the shell once at the layout level (sidebar/header/breadcrumb portal/content inset); pages render into the outlet and never rebuild chrome. Each page sets its title via the `usePageTitle` hook (the SPA equivalent of Next `metadata`) and portals its breadcrumb via `<BreadcrumbCurrent />` / `<BreadcrumbSegment />`.
- **Overlay surfaces (desktop).** A full-page surface layered over the workbench must hide the layer it covers (`invisible` + `inert` on the covered subtree, keeping it mounted): on macOS/Windows both shells are translucent over the native backdrop, so any painted pixels underneath ghost through.
- **Static-first, local loading boundaries.** Everything that doesn't depend on client data fetching (layout, sidebar/header, links, card titles, table column headers) renders immediately — never hidden behind a spinner. Only the exact data-dependent values branch on loading. Never defer a whole page/card/table.
- **Data layer = `sdk` + `tayori` + SWR**, mounted by the app/workbench providers. **Never re-wrap the return of `useData`/SWR** (no spreading / destructure-and-rebuild) — their re-render optimizations depend on getters; `return useData(...)` directly.
  - Prefer `isLoading` (first load) for skeletons; always render real `data` when present even if `error` exists (stale-but-fine); only show an intrusive error UI when there is no `data`. Use `mutate()` for non-intrusive revalidation, `mutate(undefined)` to force the loading state back.
  - **Don't use `useEffect` to "watch" state.** Derive during render, or remount with `key`, or expose an `onChange` callback. For genuinely async effects, use `foxact/use-abortable-effect` and honor the `signal`.
  - For subscribing to an external mutable store (e.g. the terminal session registry), use `useSyncExternalStore` — `sukka/react-no-use-effect-watching` rejects the setState-in-effect pattern.
- **React Compiler: `ref={…}` takes a plain identifier only.** A member expression there (`ref={split.setHandle}`) makes the compiler infer the whole object as a ref and reject every other render-time read of it ("Cannot access refs during render"). Destructure the ref setter into its own binding (`const { setAllotmentHandle: paneRef, ...split } = useAnimatedSplit(…)`) and pass ref callbacks between components as standalone props, never on a bag object.
- **i18n.** User-facing strings in `packages/ui`/`packages/workbench` go through `use-intl` (`useTranslations('workbench.…')`; dynamic keys within a namespace, like `t(kind)`, are fine). `packages/i18n/src/locales/zh-cn.ts` is the type source — add new keys there first; `en.ts` must `satisfies LocaleMessages`.
- **Renderer ownership boundaries.** Apps own entries and platform construction; `packages/workbench` owns data-plane runtime; `packages/ui` owns presentation.
  - `apps/desktop` may read from `SystemBridge`, integrate native chrome/window behavior, and construct desktop transport. Pass system values down as props; do not keep shared UI in desktop for a single IPC-derived value.
  - `apps/webview` may construct browser transport and browser entry/root only. It must not host shared providers or desktop-consumed shells.
  - `packages/workbench` may use `client-core`, `sdk`, `transport`, `tayori`, SWR, and runtime hooks. It must not import Electron, IPC, preload/main, or app packages.
  - `packages/ui` must stay business/runtime-free: no `client-core`, `sdk`, `transport`, `tayori`, app packages, or IPC. UI receives schema/view-model data, callbacks, and optional component adapters from workbench/apps.
  - Do not import one app from another. If desktop and webview both need it, move it to `packages/workbench` or `packages/ui` according to whether it owns runtime or presentation.
- **Forms: `react-hook-form` + `zodResolver`.** When a form maps to a request body, pass the SDK-exported zod schema straight to `zodResolver` and derive the type with `z.infer`. Use `register`/`Controller` for fields; bridge errors into coss-ui via `<Form errors={rhfErrorsToFormErrors(errors)}>` + `<Field>`/`<FieldError>` (from `@/lib/form` + `@/components/form-root-error`); use `setError('root', …)` only for submission/API failures. **Never** use `useState` for complex/validated form state, and **never** use `watch`/`useWatch`/`setValue` to wire normal fields.
- **Skeletons mirror the resolved shape exactly** (same widths/heights, no layout shift, no "Loading…" text). Repeat row/list skeletons with `foxact/create-fixed-array`. With `keepPreviousData`, keep stale rows visible (dimmed) instead of flashing skeletons.
- **Shared table/filter/pagination primitives** live in `apps/*/src/components` (`data-table` core, `pagination`, `filter-sidebar-layout`). Define table columns at module scope with `createTable` (server-safe: no hooks/browser APIs); the call site owns filter/search/sort/pagination state and the fetch key reads it. Don't spread/rebuild the getter-based pagination/sort instances.
- **Mock data** (when the daemon side isn't ready): expose `fetchX(params)` shaped like the eventual call, simulate latency with `foxts/wait`, consume via `useSWR` with realistic keys, and preserve the same loading/error/data branches so swapping in the real SDK is mechanical.

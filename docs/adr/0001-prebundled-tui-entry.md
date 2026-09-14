# Pre-bundle the TUI entry with the Solid transform

**Status**: accepted

OpenCode resolves a TUI plugin through `exports["./tui"]` and loads plugin modules from `node_modules`, where OpenTUI's Solid transform is skipped by an explicit `(?!.*[/\\]node_modules[/\\])` filter — so shipping raw TSX (`index.tsx`) means the plugin runs as generic JSX with no reactive bindings. The visible failure is that clicking a panel title or section header fires `onMouseUp` and flips the fold signal, but nothing repaints (issue #15; upstream [opencode#39986](https://github.com/anomalyco/opencode/issues/39986), whose runtime-loading PR #39983 was closed unmerged, with no accepted workaround since). We therefore emit a pre-transformed `dist/tui.js` with `@opentui/solid/bun-plugin` `createSolidTransformPlugin()` and point `exports["./tui"]` at it.

## Considered options

- **Keep the raw TSX entry** and wait for a runtime workaround. Rejected: no workaround was accepted upstream (opencode#39986 open, PR #39983 closed unmerged), and the comparable plugins that pre-bundle (`opencode-visual-cache`, `@mtayfur/opencode-cache-view`) fold correctly on the same opencode version.
- **Bundle everything into `dist/tui.js`.** Rejected: inlining `solid-js` or `@opentui/solid` creates a second runtime instance, so plugin signals never notify the host renderer — clicks fire and still nothing repaints.
- **Ship both raw TSX and a bundle behind a condition.** Rejected: `exports` cannot fall back on file existence, and two entry forms would drift.

## Consequences

- `packages: "external"` is load-bearing, not a size optimization. `tests/tui-build.test.ts` asserts the bundle keeps bare imports and contains no inlined Solid runtime.
- `dist/` is gitignored but published: `prepack` and `prepare` build it, and `files` includes it. A clean checkout therefore has no working `./tui` entry until `bun run build` runs.
- Publishing the pre-transformed entry retires the eager-JSX hazard *in production* (that is why `AGENTS.md` still describes it for tests and the remaining raw-TSX exports: `bun test` loads `src/` directly, and `exports["."]` / `exports["./tui-panel"]` are still source).
- `tests/tui-fold-runtime.test.ts` clicks a built artifact in a subprocess with `--conditions=browser`: the prebuilt `fold-probe` fixture, then the real shipped `dist/tui.js` copied into a temp `node_modules`-shaped package root — each with a raw-TSX counterpart that must *not* repaint. The negative controls are what make this a regression guard: without them a harness that silently loses reactivity looks green. Both runners assert a reactive Solid runtime up front and refuse to run otherwise; the subprocess gets a temp `HOME` *and* a temp `PLUGIN_ROOT`, so neither `~/.config/opencode/cache-hit.json` nor a repo-root `cache-hit.config.json` can alter the render.
- Corrected diagnosis: the issue claimed the click handlers were never bound. They are bound and do run; the missing Solid transform is what removes reactivity. Diagnosis, not the fix, was wrong.

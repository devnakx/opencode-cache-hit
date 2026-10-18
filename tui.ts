/**
 * OpenCode 2 TUI entrypoint for a *local directory* install.
 *
 * When the plugin root is registered as a plugin source, the 2.x loader resolves
 * entrypoints by literal path (`<root>/tui`, `<root>/server`, `<root>/rpc`) and
 * never reads `package.json` `exports` — that only applies to npm package
 * sources. `exports["./tui"]` therefore does not make `features.tui` true here,
 * and the TUI loader drops the plugin before mounting it.
 *
 * This file exists to be found by that resolver. Keep it in sync with
 * `index.tsx`; `exports["./tui"]` (used by npm installs) is the bundled build of
 * the same module. See docs/en/design.md § Version support.
 */
export { default } from "./src/plugin.tsx"
import { afterAll, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTui } from "../scripts/build-tui.ts"

/**
 * Click-to-fold regression guard for issue #15 — the only test that exercises
 * the real failure: a click that runs its handler but never repaints.
 *
 * Probes are driven in subprocesses with `--conditions=browser`, which is how
 * the reactive Solid runtime reaches both the renderer and the plugin in
 * opencode (opencode rewrites the bare `solid-js` / `@opentui/solid`
 * specifiers to its own runtime modules). Without that condition bun resolves
 * the SSR build of solid-js, where signals are inert and every click looks
 * broken; both runners therefore assert the reactive runtime up front instead
 * of silently reporting a false pass.
 *
 * Three cases, escalating fidelity:
 *  - prebuilt probe bundle  -> clicks fold, and the raw probe proves the
 *                              handler still fires without repainting (0.7.4)
 *  - the shipped artifact   -> installed into a temp package root; the
 *                              registered `sidebar_content` slot folds
 *  - the raw index.tsx entry -> the same slot does not repaint
 */

const root = join(import.meta.dir, "..")
const runner = join(import.meta.dir, "fixtures", "fold-probe-runner.ts")
const realRunner = join(import.meta.dir, "fixtures", "real-entry-runner.ts")
const rawProbe = join(import.meta.dir, "fixtures", "fold-probe.tsx")
const rawEntry = join(root, "index.tsx")
const builtEntry = join(root, "dist", "tui.js")

type ProbeResult = {
  clicks: { title: number; section: number }
  frames: {
    initial: string
    afterTitleClick: string
    afterTitleReopen: string
    afterSectionClick: string
  }
}

type RealEntryResult = { pluginId: string; before: string; after: string }

const outDir = mkdtempSync(join(tmpdir(), "cache-hit-fold-"))
// A temp HOME keeps the user's own ~/.config/opencode/cache-hit.json out of the
// render (load-config reads homedir(), not XDG_CONFIG_HOME).
const homeDir = mkdtempSync(join(tmpdir(), "cache-hit-home-"))
const siteDir = mkdtempSync(join(tmpdir(), "cache-hit-site-"))
afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  rmSync(homeDir, { recursive: true, force: true })
  rmSync(siteDir, { recursive: true, force: true })
})

// The bundle keeps its runtime imports external, so it needs node_modules
// next to it to resolve them from this temp directory.
symlinkSync(join(root, "node_modules"), join(outDir, "node_modules"), "dir")
const built = await buildTui({ entrypoints: [rawProbe], outdir: outDir })
if (!built.success) throw new Error(`fold probe build failed: ${built.logs.map(String).join("\n")}`)
const builtProbe = join(outDir, "tui.js")

// The real-entry cases need the published artifact; build it if this file runs
// before tests/tui-build.test.ts.
await buildTui()

// Install the shipped artifact into a node_modules-shaped temp package. The
// bundle derives PLUGIN_ROOT from its own URL at runtime, so this isolates the
// legacy `PLUGIN_ROOT/cache-hit.config.json` from the repo root — and exercises
// the artifact from where opencode would actually load it.
const installedPkg = join(siteDir, "node_modules", "opencode-cache-hit")
mkdirSync(join(installedPkg, "dist"), { recursive: true })
copyFileSync(builtEntry, join(installedPkg, "dist", "tui.js"))
copyFileSync(join(root, "package.json"), join(installedPkg, "package.json"))
symlinkSync(join(root, "node_modules"), join(installedPkg, "node_modules"), "dir")
const installedEntry = join(installedPkg, "dist", "tui.js")

async function runJson<T>(script: string, args: string[], env: Record<string, string> = {}): Promise<T> {
  const proc = Bun.spawn(["bun", "--conditions=browser", script, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`probe exited ${exitCode}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`)
  }
  const json = stdout.trim().split("\n").at(-1) ?? ""
  return JSON.parse(json) as T
}

const runProbe = (modulePath: string) => runJson<ProbeResult>(runner, [modulePath])
const runRealEntry = (entry: string) =>
  runJson<RealEntryResult>(realRunner, [entry], { HOME: homeDir })

describe("click-to-fold", () => {
  test("prebuilt bundle: panel title and section header fold on click", async () => {
    expect(existsSync(builtProbe)).toBe(true)
    const probe = await runProbe(builtProbe)

    expect(probe.clicks).toEqual({ title: 2, section: 1 })

    expect(probe.frames.initial).toContain("\u25bc Cache Hit")
    expect(probe.frames.initial).toContain("Detail")
    expect(probe.frames.initial).toContain("row-a")

    // First title click folds the panel: arrow flips, children disappear.
    expect(probe.frames.afterTitleClick).toContain("\u25b6 Cache Hit")
    expect(probe.frames.afterTitleClick).not.toContain("row-a")

    // Second click unfolds it again.
    expect(probe.frames.afterTitleReopen).toContain("\u25bc Cache Hit")
    expect(probe.frames.afterTitleReopen).toContain("row-a")

    // Section header folds its own section.
    expect(probe.frames.afterSectionClick).toContain("\u25b6 Detail")
    expect(probe.frames.afterSectionClick).not.toContain("row-a")
  }, 30_000)

  test("raw TSX control: the handler runs but nothing repaints", async () => {
    const probe = await runProbe(rawProbe)

    // This is the correction to issue #15: onMouseUp *is* wired, so clicks are
    // delivered — the missing Solid transform is what kills the repaint.
    expect(probe.clicks).toEqual({ title: 2, section: 1 })
    expect(probe.frames.afterTitleClick).toBe(probe.frames.initial)
    expect(probe.frames.afterSectionClick).toContain("\u25bc Detail")
    expect(probe.frames.afterSectionClick).toContain("row-a")
  }, 30_000)

  test("shipped artifact, installed shape: the registered sidebar panel folds on click", async () => {
    expect(existsSync(installedEntry)).toBe(true)
    const real = await runRealEntry(installedEntry)
    expect(real.pluginId).toBe("opencode-cache-hit")
    expect(real.before).toContain("\u25bc Cache Hit")
    expect(real.after).toContain("\u25b6 Cache Hit")
    expect(real.after).not.toBe(real.before)
  }, 30_000)

  test("raw index.tsx entry: the same sidebar panel does not repaint", async () => {
    // Assertions stay language-agnostic here: this entry runs from the repo
    // root, where a personal `cache-hit.config.json` may legitimately exist.
    const real = await runRealEntry(rawEntry)
    expect(real.pluginId).toBe("opencode-cache-hit")
    expect(real.before).toContain("\u25bc")
    // 0.7.4 shipped exactly this: the panel renders and the click does nothing.
    expect(real.after).toBe(real.before)
  }, 30_000)
})

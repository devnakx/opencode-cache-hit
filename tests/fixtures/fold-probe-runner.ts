import { createComputed, createRoot, createSignal } from "solid-js"
import { testRender } from "@opentui/solid"

/**
 * Drives tests/fixtures/fold-probe.tsx in a real opentui test renderer and
 * prints one JSON object describing what a mouse click did to the rendered
 * frame. Run as a subprocess (`bun --conditions=browser`) so the probe module
 * resolves the same reactive Solid runtime opencode hands to TUI plugins, and
 * so a module-level state shared by the probe cannot leak between tests.
 *
 * Usage: bun --conditions=browser tests/fixtures/fold-probe-runner.ts <module path>
 */
const modulePath = process.argv[2]
if (!modulePath) throw new Error("usage: fold-probe-runner.ts <module path>")

// Fail loud if the harness lost the reactive runtime: without --conditions
// browser, bun resolves solid-js to its SSR build and *every* click looks
// broken, which would make the assertions blame the plugin instead.
const reactive = createRoot(() => {
  const [value, setValue] = createSignal(0)
  let runs = 0
  createComputed(() => {
    value()
    runs++
  })
  setValue(1)
  return runs > 1
})
if (!reactive) {
  throw new Error("no reactive Solid runtime in this process: run with --conditions=browser")
}

const mod = (await import(modulePath)) as {
  FoldProbe: () => unknown
  clicks: { title: number; section: number }
}

const setup = (await testRender(() => mod.FoldProbe() as never, { width: 24, height: 6 })) as unknown as {
  mockMouse: { click: (x: number, y: number) => Promise<unknown> }
  renderOnce: () => Promise<unknown>
  captureCharFrame: () => string
}

const frame = async () => {
  await setup.renderOnce()
  return setup.captureCharFrame()
}

const initial = await frame()

await setup.mockMouse.click(3, 0) // panel title (TuiPanelTitle)
const afterTitleClick = await frame()

await setup.mockMouse.click(3, 0) // panel title again -> unfold
const afterTitleReopen = await frame()

await setup.mockMouse.click(3, 1) // section header (TuiSection)
const afterSectionClick = await frame()

console.log(
  JSON.stringify({
    module: modulePath,
    clicks: { ...mod.clicks },
    frames: { initial, afterTitleClick, afterTitleReopen, afterSectionClick },
  }),
)

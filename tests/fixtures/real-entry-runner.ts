import { isAbsolute, resolve } from "node:path"
import { createComputed, createRoot, createSignal } from "solid-js"
import { testRender } from "@opentui/solid"

/**
 * Drives the REAL published TUI entry the way opencode does: stub the TUI api,
 * call `default.tui(api)`, take the registered `sidebar_content` slot, render
 * it, and click the panel title.
 *
 * Run as a subprocess with `--conditions=browser` (see
 * tests/tui-fold-runtime.test.ts) and with HOME pointed at a temp dir so the
 * user's real cache-hit.json cannot influence the render.
 *
 * Caveat: the opentui test renderer swallows exceptions thrown while rendering
 * or inside click handlers, so a throwing handler is indistinguishable from
 * "no repaint" here. The counter-based proof that the handler really runs lives
 * in tests/fixtures/fold-probe-runner.ts; this runner asserts the user-visible
 * frame change.
 *
 * Usage: bun --conditions=browser tests/fixtures/real-entry-runner.ts <bundle path>
 */
const arg = process.argv[2]
if (!arg) throw new Error("usage: real-entry-runner.ts <bundle path>")
const bundlePath = isAbsolute(arg) ? arg : resolve(process.cwd(), arg)

// Fail loud if the harness lost the reactive runtime: without --conditions
// browser bun resolves solid-js to its SSR build, where every click looks
// broken and the assertions below would blame the plugin instead.
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

const mod = (await import(bundlePath)) as {
  default: { id: string; tui: (api: never) => Promise<void> }
}

type Slot = (ctx: unknown, props: unknown) => unknown
let slot: Slot | undefined

const api = {
  state: {
    path: { directory: process.cwd() },
    provider: [],
    session: {
      messages: () => [],
      get: () => undefined,
    },
    part: () => undefined,
  },
  client: {
    session: {
      list: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  },
  event: { on: () => () => {} },
  slots: {
    register(opts: { slots: { sidebar_content: Slot } }) {
      slot = opts.slots.sidebar_content
    },
  },
}

await mod.default.tui(api as never)
if (!slot) throw new Error("plugin did not register sidebar_content")

const setup = (await testRender(
  () => (slot as Slot)({ theme: { current: {} } }, { session_id: "ses_test" }) as never,
  { width: 32, height: 12 },
)) as unknown as {
  mockMouse: { click: (x: number, y: number) => Promise<unknown> }
  renderOnce: () => Promise<unknown>
  captureCharFrame: () => string
}

const frame = async () => {
  await setup.renderOnce()
  return setup.captureCharFrame()
}

const before = await frame()
await setup.mockMouse.click(4, 1) // panel title row (bordered panel: row 1, arrow at col 3)
const after = await frame()

console.log(JSON.stringify({ pluginId: mod.default.id, before, after }))
process.exit(0) // the host schedules polling timers; do not wait for them

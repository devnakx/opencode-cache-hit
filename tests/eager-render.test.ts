import { describe, test, expect } from "bun:test"
import { testRender } from "@opentui/solid"
import { TuiHitRow } from "../src/tui-panel/components.tsx"

/**
 * Regression guard for opencode#5/#6: bun's generic JSX (jsxDEV) eagerly
 * evaluates <Show> children before the guard runs. Since 0.7.5 the published
 * TUI entry is pre-transformed (docs/adr/0001), but tests load raw TSX the
 * same way, and the "." / "./tui-panel" exports are still raw source — so
 * rendering with an undefined optional prop must not throw.
 */
describe("eager render smoke (raw TSX load path)", () => {
  test("TuiHitRow with trend=undefined does not throw", async () => {
    await expect(
      testRender(() =>
        TuiHitRow({
          label: "Hit",
          bar: "||",
          pct: "50%",
          barColor: "blue",
          textColor: "white",
          trend: undefined,
        }),
      ),
    ).resolves.toBeDefined()
  })

  test("TuiHitRow with a trend value renders", async () => {
    await expect(
      testRender(() =>
        TuiHitRow({
          label: "Hit",
          bar: "||",
          pct: "50%",
          barColor: "blue",
          textColor: "white",
          trend: { text: "\u21932.0%", color: "green" },
        }),
      ),
    ).resolves.toBeDefined()
  })
})

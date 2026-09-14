/** @jsxImportSource @opentui/solid */
import { Show, createSignal } from "solid-js"
import { TuiPanelTitle, TuiSection } from "../../src/tui-panel/components.tsx"
import type { PanelPalette } from "../../src/tui-panel/palette.ts"
import type { PanelLayout } from "../../src/tui-panel/use-panel-layout.ts"

/**
 * Fold probe: the smallest tree that exercises both fold handlers
 * (`TuiPanelTitle` panel title and `TuiSection` section header) with the real
 * components. Loaded either raw (no Solid transform, the historical npm path)
 * or through the prebuilt bundle, and driven by tests/fixtures/fold-probe-runner.ts.
 */
export const clicks = { title: 0, section: 0 }

const pal: PanelPalette = {
  primary: "#8B9DAF",
  text: "#C5C5BB",
  muted: "#7A7A72",
  success: "#9CAF8B",
  warning: "#C5B88D",
  error: "#B08A8A",
  border: "#6B6B63",
}

const layout = { gauge: () => 20, syncWidth: () => {}, boxRef: undefined } as unknown as PanelLayout

export function FoldProbe() {
  const [open, setOpen] = createSignal(true)
  const [sections, setSections] = createSignal(true)
  return (
    <box flexDirection="column" width={24}>
      <TuiPanelTitle
        pal={pal}
        layout={layout}
        open={open()}
        title="Cache Hit"
        onToggle={() => {
          clicks.title++
          setOpen((v) => !v)
        }}
      />
      <Show when={open()}>
        <TuiSection
          pal={pal}
          layout={layout}
          open={sections()}
          title="Detail"
          onToggle={() => {
            clicks.section++
            setSections((v) => !v)
          }}
        >
          <text>row-a</text>
          <text>row-b</text>
        </TuiSection>
      </Show>
    </box>
  )
}

/** @jsxImportSource @opentui/solid */
import { createMemo, For, Show } from "solid-js"
import { TokenDetailRows } from "./cache-hit-rows.tsx"
import type { CacheHitMetrics } from "./use-cache-hit-metrics.ts"
import { aggregateSubAgents } from "./stats.ts"
import { formatTokenCount } from "./format-tokens.ts"
import { formatSubAgentLabel, modelRowColor } from "./format-model.ts"
import { TuiMetricRow, type PanelLayout } from "./tui-panel/index.ts"
import type { SubAgentSummary } from "./types.ts"

function subHasActivity(sub: SubAgentSummary): boolean {
  return sub.cost > 0 || sub.cacheRead > 0 || sub.cacheWrite > 0 || sub.input > 0
}

export function AgentsView(props: {
  m: CacheHitMetrics
  layout: PanelLayout
  formatCost: (n: number) => string
  formatSpeed: (v: number | undefined) => string
}) {
  const { m, layout } = props
  const total = () => aggregateSubAgents(m.subs())

  const subsSaved = () => m.subsSaved()

  // Sub-agent dynamic cost total: show the recomputed value (≈ prefix) when any child is dynamic.
  const shownSubCost = createMemo(() => {
    const map = m.subAgentDynamicCosts()
    let dynamic = false
    let sum = 0
    for (const sub of m.subs()) {
      const rec = map.get(sub.id)
      if (rec !== undefined && rec !== null) {
        dynamic = true
        sum += rec
      } else {
        sum += sub.cost
      }
    }
    return { value: sum, approx: dynamic }
  })

  return (
    <>
      <TokenDetailRows pal={m.pal()} layout={layout} t={m.t()} snap={total()}>
        <Show when={subsSaved() > 0}>
          <TuiMetricRow
            pal={m.pal()}
            layout={layout}
            label={m.t().saved}
            value={props.formatCost(subsSaved())}
            fg={m.pal().success}
          />
        </Show>
      </TokenDetailRows>
      <Show when={shownSubCost().value > 0}>
        <TuiMetricRow
          pal={m.pal()}
          layout={layout}
          label={m.t().cost}
          value={`${shownSubCost().approx ? m.t().approx : ""}${props.formatCost(shownSubCost().value)}`}
          fg={m.pal().success}
        />
      </Show>
      <For each={m.subs()}>
          {(sub) => (
            <Show when={subHasActivity(sub)}>
              {/* opentui 重新插入多 span text 时高度误算为 2，用 height=1 的 box 钳制 */}
              <box height={1}>
                <TuiMetricRow
                  pal={m.pal()}
                  layout={layout}
                  label={formatSubAgentLabel(sub, layout.gauge(), props.formatCost, m.t().tok)}
                  value={sub.cost > 0 ? props.formatCost(sub.cost) : formatTokenCount(sub.input)}
                  unit={sub.cost > 0 ? "" : m.t().tok}
                  labelFg={modelRowColor(sub.model, sub.providerID, m.pal())}
                  valueFg={m.pal().muted}
                />
              </box>
              <Show
                // NaN 视为无效 speed（会话无有效计时样本时可能产生）
                when={typeof sub.speed === "number" && Number.isFinite(sub.speed)}
              >
                <box height={1}>
                  <TuiMetricRow
                    pal={m.pal()}
                    layout={layout}
                    label="    "
                    value={props.formatSpeed(sub.speed as number)}
                    fg={m.pal().muted}
                  />
                </box>
              </Show>
            </Show>
          )}
        </For>
    </>
  )
}

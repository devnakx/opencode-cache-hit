import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import {
  DEFAULT_PANEL_WIDTH,
  justifyRow,
  MIN_PANEL_WIDTH,
  PANEL_GUTTER,
  separatorLine,
} from "./layout.ts"

export type PanelLayoutOptions = {
  border: Accessor<boolean>
}

/**
 * Measured sidebar width + row helpers.
 * Call once per panel instance (e.g. top of sidebar component), not per render branch.
 */
export function createPanelLayout(options: PanelLayoutOptions) {
  const [panelWidth, setPanelWidth] = createSignal(DEFAULT_PANEL_WIDTH)
  let boxEl: { width?: number } | undefined

  const gutter = createMemo(() => (options.border() ? PANEL_GUTTER : 0))
  const gauge = createMemo(() => Math.max(MIN_PANEL_WIDTH, panelWidth() - gutter()))
  const sep = createMemo(() => separatorLine(gauge()))

  const syncWidth = () => {
    // 优先读 yoga 实时布局宽度，box.width 属性仅在 updateFromLayout 后刷新
    // 挂载时序下可能滞后于真实渲染宽度
    type YogaBox = {
      getLayoutNode?: () => { getComputedWidth?: () => number }
      parent?: unknown
    }
    const el = boxEl as YogaBox | undefined
    let w: number | undefined
    const computed = el?.getLayoutNode?.().getComputedWidth?.()
    if (typeof computed === "number" && computed > 0) {
      w = computed
      // 面板 width=100% 但 yoga 可能少算 1 列，取父容器宽度补齐
      // 回退 1 列避开 scrollbox 滚动条与内容重叠
      const parentW = (el?.parent as YogaBox | undefined)?.getLayoutNode?.()?.getComputedWidth?.()
      if (typeof parentW === "number" && parentW > w && parentW - w <= 2) {
        w = parentW - 1
      }
    } else {
      w = boxEl?.width
    }
    if (typeof w === "number" && w > 0) {
      const next = Math.max(MIN_PANEL_WIDTH, Math.floor(w))
      setPanelWidth((prev) => (prev === next ? prev : next))
    }
  }

  createEffect(() => {
    options.border()
    syncWidth()
  })

  // onSizeChange 由 TuiPanel 的 box 触发，yoga 布局完成后宽度已就绪，无需轮询

  // 首帧 gauge 仍为默认值时行宽可能超限折行，opentui 的 text 高度不随宽度更新收缩
  // 宽度就绪前返回 false，调用方延迟挂载行列表避免折行残留
  const widthReady = createMemo(() => panelWidth() !== DEFAULT_PANEL_WIDTH)

  const row = (label: string, value: string, unit = "") => justifyRow(label, value, gauge(), unit)

  return {
    panelWidth,
    gutter,
    gauge,
    sep,
    row,
    syncWidth,
    widthReady,
    get boxRef() {
      return boxEl
    },
    set boxRef(el: { width?: number } | undefined) {
      boxEl = el
    },
  }
}

export type PanelLayout = ReturnType<typeof createPanelLayout>

/** Independent fold state for a collapsible section. */
export function createSectionFold(initial = true) {
  const [open, setOpen] = createSignal(initial)
  return {
    open,
    setOpen,
    toggle: () => setOpen((o) => !o),
  }
}

export type SectionFold = ReturnType<typeof createSectionFold>

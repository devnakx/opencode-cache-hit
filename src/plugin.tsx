/** @jsxImportSource @opentui/solid */
import { CacheHitSidebarHost } from "./sidebar-host.tsx"
import type { TuiApi } from "./types.ts"
import { createV2Api, isTuiContext } from "./v2/adapter.ts"
import { toThemeRecord } from "./v2/map.ts"
import { PLUGIN_ID } from "./v2/server.ts"
import { toTuiApi, type V1TuiApi } from "./v1-map.ts"

export { PLUGIN_ID }

/** Shared by both entrypoints: same host component, same source of config (the host). */
function sidebar(api: TuiApi, sessionId: string, theme: Record<string, unknown>) {
  return <CacheHitSidebarHost sessionId={sessionId} theme={theme} api={api} />
}

/** OpenCode 1: TUI slot API. This path maps legacy events onto `TuiEvent`. */
export const tui = async (api: V1TuiApi) => {
  const tuiApi = toTuiApi(api)
  api.slots.register({
    order: 56,
    slots: {
      sidebar_content(ctx, props) {
        return sidebar(tuiApi, props.session_id ?? "", ctx.theme.current)
      },
    },
  })
}

/**
 * OpenCode 2: `Plugin.define({ id, setup })`. Plain object (no
 * `@opencode/plugin` import) — V2 substitutes that specifier, V1 does not, so a
 * runtime import of it would break V1 loading.
 *
 * V2 may call this with a server context (a directory under `plugins/` is
 * activated with `role=server`, bypassing `exports["."]`). The sidebar is
 * TUI-only, so that case is a no-op: registering nothing still lets activation
 * succeed, which is what keeps the plugin at status "active" for the TUI loader.
 */
export const setup = (ctx: unknown) => {
  if (!isTuiContext(ctx)) return
  const api = createV2Api(ctx)
  // `prepend` puts the panel above the sidebar's own content and above the
  // builtins (opencode.sidebar.context / opencode.sidebar.mcp), which also claim
  // `sidebar.content` but with `append`. The host renders, in order:
  // before → replace → prepend → native children → append → after.
  const unregister = ctx.ui.slot({
    prepend: "sidebar.content",
    render: ({ sessionID }) => sidebar(api, sessionID ?? "", toThemeRecord(ctx.theme)),
  })
  return () => {
    unregister?.()
    api.dispose()
  }
}

const plugin = { id: PLUGIN_ID, tui, setup }
export default plugin

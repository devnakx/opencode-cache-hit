import { describe, test, expect } from "bun:test"
import { applyUsagePatch, mergeHistoryMessage, syncLiveMessages } from "../src/history-messages.ts"
import { findLastCacheActivityByLineage } from "../src/cache-ttl.ts"
import type { AssistantMessage } from "../src/types.ts"

const msg = (over: Partial<AssistantMessage> & { id: string }): AssistantMessage => ({
  role: "assistant",
  providerID: "deepseek",
  modelID: "deepseek-v4",
  time: { created: 0 },
  ...over,
})

describe("mergeHistoryMessage", () => {
  test("replaces in place by id and keeps created order", () => {
    const merged = mergeHistoryMessage(
      [msg({ id: "b", time: { created: 20 } }), msg({ id: "a", time: { created: 10 } })],
      msg({ id: "b", time: { created: 20 }, cost: 1 }),
    )
    expect(merged.map((m) => m.id)).toEqual(["a", "b"])
    expect(merged[1].cost).toBe(1)
  })

  test("appends when the id is unknown, then sorts by created", () => {
    const merged = mergeHistoryMessage([msg({ id: "b", time: { created: 20 } })], msg({ id: "a", time: { created: 10 } }))
    expect(merged.map((m) => m.id)).toEqual(["a", "b"])
  })

  test("does not let a streaming snapshot regress a completed row", () => {
    const history = [msg({ id: "m1", time: { created: 0, completed: 500 }, tokens: { input: 10 } })]
    expect(mergeHistoryMessage(history, msg({ id: "m1", time: { created: 0 } }))).toBe(history)
  })

  test("keeps patched usage when a later completed snapshot lacks tokens", () => {
    const history = [
      msg({ id: "m1", time: { created: 0, completed: 500 }, tokens: { input: 10, cache: { read: 90 } } }),
    ]
    const merged = mergeHistoryMessage(
      history,
      msg({ id: "m1", time: { created: 0, completed: 500 }, finish: "stop" }),
    )
    expect(merged[0]).toMatchObject({
      finish: "stop",
      tokens: { input: 10, cache: { read: 90 } },
      time: { created: 0, completed: 500 },
    })
  })
})

describe("applyUsagePatch", () => {
  test("fills tokens and completion without dropping model, agent or content", () => {
    const row = msg({
      id: "m1",
      agent: "build",
      content: [{ type: "text", text: "done" }],
      time: { created: 10 },
    })
    const next = applyUsagePatch([row], {
      messageID: "m1",
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 900, write: 0 } },
      cost: 0.25,
      finish: "stop",
      completed: 500,
    })
    expect(next[0]).toMatchObject({
      modelID: "deepseek-v4",
      agent: "build",
      content: [{ type: "text", text: "done" }],
      tokens: { input: 100, cache: { read: 900 } },
      cost: 0.25,
      finish: "stop",
      time: { created: 10, completed: 500 },
    })
  })

  test("is a no-op for unknown ids and unchanged rows", () => {
    const row = msg({ id: "m1", tokens: { input: 1 } })
    expect(applyUsagePatch([row], { messageID: "missing", tokens: { input: 2 } })).toEqual([row])
    expect(applyUsagePatch([row], { messageID: "m1" })[0]).toBe(row)
  })

  test("does not move an existing completion backwards", () => {
    const row = msg({ id: "m1", time: { created: 10, completed: 500 } })
    const next = applyUsagePatch([row], { messageID: "m1", completed: 400 })
    expect(next[0].time?.completed).toBe(500)
  })
})

describe("syncLiveMessages", () => {
  test("adds live rows that history has never seen", () => {
    const history = [msg({ id: "m1" })]
    const live = [msg({ id: "m1" }), msg({ id: "m2", time: { created: 10, completed: 99 } })]
    const next = syncLiveMessages(history, live)
    expect(next.map((m) => m.id)).toEqual(["m1", "m2"])
  })

  test("completes a row once the live snapshot reports time.completed", () => {
    const history = [msg({ id: "m1", time: { created: 0 } })]
    const live = [msg({ id: "m1", time: { created: 0, completed: 500 }, tokens: { cache: { read: 900 } } })]
    const next = syncLiveMessages(history, live)
    expect(next[0].time?.completed).toBe(500)
    expect(next[0].tokens?.cache?.read).toBe(900)
  })

  test("fills usage into a row finalised before tokens arrived", () => {
    const history = [msg({ id: "m1", time: { created: 0, completed: 500 } })]
    const live = [
      msg({
        id: "m1",
        time: { created: 0, completed: 500 },
        tokens: { input: 10, output: 20, cache: { read: 90 } },
      }),
    ]
    const next = syncLiveMessages(history, live)
    expect(next[0].tokens?.cache?.read).toBe(90)
  })

  test("never regresses a completed row to a streaming snapshot", () => {
    const history = [msg({ id: "m1", time: { created: 0, completed: 500 } })]
    const next = syncLiveMessages(history, [msg({ id: "m1", time: { created: 0 } })])
    expect(next[0].time?.completed).toBe(500)
  })

  test("returns the same reference when there is nothing to do", () => {
    const history = [msg({ id: "m1", time: { created: 0, completed: 500 } })]
    expect(syncLiveMessages(history, [msg({ id: "m1", time: { created: 0, completed: 500 } })])).toBe(history)
    expect(syncLiveMessages(history, [])).toBe(history)
  })

  test("ignores live rows without an id", () => {
    const history = [msg({ id: "m1" })]
    expect(syncLiveMessages(history, [msg({ id: "" })])).toBe(history)
  })

  // The reported symptom: TTL never resets because the finished turn never
  // reaches history, so findLastCacheActivityByLineage skips it.
  test("a finished turn becomes the cache-TTL baseline", () => {
    const history = [
      msg({ id: "old", time: { created: 0, completed: 1000 }, tokens: { cache: { read: 800 } } }),
    ]
    const live = [
      msg({ id: "old", time: { created: 0, completed: 1000 }, tokens: { cache: { read: 800 } } }),
      msg({ id: "new", time: { created: 60_000, completed: 62_000 }, tokens: { cache: { read: 1200 } } }),
    ]

    // Before syncing, history has no completed turn past `old`.
    expect(findLastCacheActivityByLineage(history).get("deepseek:deepseek-v4")?.id).toBe("old")

    const next = syncLiveMessages(history, live)
    expect(findLastCacheActivityByLineage(next).get("deepseek:deepseek-v4")?.id).toBe("new")
  })
})
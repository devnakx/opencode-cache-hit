import { describe, test, expect } from "bun:test"
import { mergeHistoryMessage, syncLiveMessages } from "../src/history-messages.ts"
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
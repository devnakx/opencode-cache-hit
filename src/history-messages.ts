/**
 * History-list merging. Pure and JSX-free so tests can import it directly
 * (see AGENTS.md).
 */
import type { AssistantMessage } from "./types.ts"

export type AssistantUsagePatch = {
  messageID: string
  tokens?: AssistantMessage["tokens"]
  cost?: number
  finish?: string
  completed?: number
}

/** A finalised row carries billable usage when any token bucket or cost is non-zero. */
export function hasMessageUsage(message: AssistantMessage): boolean {
  const tokens = message.tokens
  if (
    tokens &&
    ((tokens.input ?? 0) > 0 ||
      (tokens.output ?? 0) > 0 ||
      (tokens.reasoning ?? 0) > 0 ||
      (tokens.cache?.read ?? 0) > 0 ||
      (tokens.cache?.write ?? 0) > 0)
  ) {
    return true
  }
  return (message.cost ?? 0) > 0
}

/**
 * Fill finalised usage onto an existing row without dropping its model, agent,
 * or content. V2 step events carry tokens/cost but not the message metadata, so
 * replacing the whole row would lose the lineage key.
 */
export function applyUsagePatch(
  messages: readonly AssistantMessage[],
  patch: AssistantUsagePatch,
): AssistantMessage[] {
  const index = messages.findIndex(
    (message) => (message.id ?? message.messageID) === patch.messageID,
  )
  if (index < 0) return messages as AssistantMessage[]

  const current = messages[index]!
  const tokens = patch.tokens ?? current.tokens
  const cost = patch.cost ?? current.cost
  const finish = patch.finish ?? current.finish
  const time =
    current.time?.completed === undefined && patch.completed !== undefined
      ? { ...(current.time ?? { created: 0 }), completed: patch.completed }
      : current.time

  if (
    tokens === current.tokens &&
    cost === current.cost &&
    finish === current.finish &&
    time === current.time
  ) {
    return messages as AssistantMessage[]
  }

  const next = [...messages]
  next[index] = { ...current, tokens, cost, finish, time }
  return next
}

export const mergeHistoryMessage = (
  messages: readonly AssistantMessage[],
  update: AssistantMessage,
): AssistantMessage[] => {
  const id = update.id ?? update.messageID
  const next = [...messages]
  const index = id ? next.findIndex((message) => (message.id ?? message.messageID) === id) : -1
  if (index >= 0) {
    const existing = next[index]!
    const existingDone = existing.time?.completed !== undefined
    const updateDone = update.time?.completed !== undefined
    // A content snapshot can arrive after the turn was finalised; never let it
    // drop completion or the usage already patched onto the row.
    if (existingDone && !updateDone) return messages as AssistantMessage[]
    next[index] =
      existingDone && updateDone && !hasMessageUsage(update) && hasMessageUsage(existing)
        ? { ...update, tokens: existing.tokens, cost: existing.cost }
        : update
  } else {
    next.push(update)
  }
  next.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  return next
}

/**
 * Fold the live message list into the history list.
 *
 * History is the complete record for a session — a full HTTP read plus
 * incremental `message.updated` merges — and metrics read it. The live list is
 * only a recent window, but it is the one place a finished turn is guaranteed to
 * carry finalised `time.completed` and `tokens`. On backends that never deliver
 * a turn-end `message.updated`, folding it in is the only way a completed turn
 * reaches history at all: cache TTL reads history and skips any row without
 * `time.completed`, so without this its countdown only ever grows.
 *
 * Only ever adds or completes rows. A still-streaming snapshot must not regress
 * a row that has already been finalised, and an unchanged list is returned by
 * reference so repeated calls do not churn the signal.
 */
export function syncLiveMessages(
  history: AssistantMessage[],
  live: readonly AssistantMessage[],
): AssistantMessage[] {
  const position = new Map<string, number>()
  for (let i = 0; i < history.length; i++) {
    const id = history[i].id ?? history[i].messageID
    // Matches `mergeHistoryMessage`: a blank id cannot identify a row.
    if (id) position.set(id, i)
  }

  let next: AssistantMessage[] | undefined
  for (const message of live) {
    const id = message.id ?? message.messageID
    if (!id) continue
    const at = position.get(id)
    if (at === undefined) {
      next ??= [...history]
      next.push(message)
      continue
    }
    const existing = next ? next[at] : history[at]
    const existingDone = existing.time?.completed !== undefined
    const incomingDone = message.time?.completed !== undefined
    // A streaming snapshot never regresses a finalised row.
    if (existingDone && !incomingDone) continue
    if (!existingDone && incomingDone) {
      next ??= [...history]
      next[at] = message
      continue
    }
    // A row finalised by an early content snapshot may still lack tokens; fill
    // that in once the store reports the finished usage for the same turn.
    if (existingDone && !hasMessageUsage(existing) && hasMessageUsage(message)) {
      next ??= [...history]
      next[at] = message
    }
  }

  if (!next) return history
  return next.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
}
/**
 * History-list merging. Pure and JSX-free so tests can import it directly
 * (see AGENTS.md).
 */
import type { AssistantMessage } from "./types.ts"

export const mergeHistoryMessage = (
  messages: readonly AssistantMessage[],
  update: AssistantMessage,
): AssistantMessage[] => {
  const id = update.id ?? update.messageID
  const next = [...messages]
  const index = id ? next.findIndex((message) => (message.id ?? message.messageID) === id) : -1
  if (index >= 0) next[index] = update
  else next.push(update)
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
    }
  }

  if (!next) return history
  return next.sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
}
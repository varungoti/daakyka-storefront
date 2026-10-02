/**
 * F-055: what the /unsubscribe page's button should tell the shopper for each
 * kind of answer from POST /api/unsubscribe. Every non-OK answer used to show
 * "Something went wrong. Please try again." — including the permanent 400 for
 * a link that is invalid or was never real, which no retry can ever fix, so
 * the shopper had no way forward. Kept free of React and server-only imports
 * so a unit test can drive it directly.
 */
export type UnsubscribeOutcome = "done" | "invalid-link" | "rate-limited" | "error";

export function classifyUnsubscribeResponse(status: number): UnsubscribeOutcome {
  if (status >= 200 && status < 300) return "done";
  // The route answers 400 for a token that is missing, malformed or matches
  // no subscriber (unsubscribeByToken) — retrying the same link cannot work.
  if (status === 400) return "invalid-link";
  if (status === 429) return "rate-limited";
  return "error";
}

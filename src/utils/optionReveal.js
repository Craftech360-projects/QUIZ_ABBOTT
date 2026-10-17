export const OPTION_REVEAL_INTERVAL_MS = 500;

export function getVisibleOptionCount(quizState, now = Date.now()) {
  if (quizState.optionsRevealedAt == null) return 0;
  const count = quizState.questions[quizState.questionIndex]?.options.length || 0;
  const interval = quizState.optionRevealIntervalMs || OPTION_REVEAL_INTERVAL_MS;
  const elapsed = now - quizState.optionsRevealedAt;
  return Math.min(count, Math.max(0, Math.floor(elapsed / interval) + 1));
}

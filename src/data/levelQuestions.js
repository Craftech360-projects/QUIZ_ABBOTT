import { questions, quizConfig } from './questions.js';

export function createLevelPools(bank = questions) {
  const pools = Array.from({ length: quizConfig.questionCount }, () => []);
  const ids = new Set();

  for (const question of bank) {
    const optionIds = new Set(question.options?.map((option) => option.id));
    if (!Number.isInteger(question.level) || !pools[question.level - 1]
      || !question.id || ids.has(question.id) || !question.text?.trim()
      || question.options?.length !== 4 || optionIds.size !== 4
      || !question.options.every((option) => option.text?.trim())
      || !optionIds.has(question.correctOptionId)) {
      throw new Error(`Invalid level question: ${question.id || 'missing ID'}`);
    }
    ids.add(question.id);
    pools[question.level - 1].push(question);
  }

  pools.forEach((pool, index) => {
    if (!pool.length) throw new Error(`No questions available for Level ${index + 1}.`);
  });
  return pools;
}

const levelPools = createLevelPools();

// Select once per run, keeping levels in order. Reconnects use the saved selection.
export function selectLevelQuestions(random = Math.random) {
  return levelPools.map((pool) => pool[Math.floor(random() * pool.length)]);
}

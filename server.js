import express from 'express';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { questions as questionBank, quizConfig } from './src/data/questions.js';
import { selectLevelQuestions } from './src/data/levelQuestions.js';
import { getVisibleOptionCount, OPTION_REVEAL_INTERVAL_MS } from './src/utils/optionReveal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const configuredEnvPath = String(process.env.DOTENV_CONFIG_PATH || '').trim();
const envPaths = configuredEnvPath
  ? [path.isAbsolute(configuredEnvPath)
      ? configuredEnvPath
      : path.join(projectRoot, configuredEnvPath)]
  : [path.join(projectRoot, '.env.local'), path.join(projectRoot, '.env')];
dotenv.config({
  path: envPaths,
  quiet: true,
});

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);
const PORT = Number(process.env.PORT || 3002);
const QUESTIONS_PER_RUN = quizConfig.questionCount;
const LIFELINE_TYPES = ['audiencePoll', 'phoneAFriend', 'fiftyFifty'];
const FEEDBACK_REVEAL_DELAY_MS = Number(process.env.FEEDBACK_REVEAL_DELAY_MS || 2000);
const FEEDBACK_DELAY_MS = Number(process.env.FEEDBACK_DELAY_MS || 10000);
const optionRevealIntervalMs = Math.max(1, Number(process.env.OPTION_REVEAL_INTERVAL_MS) || OPTION_REVEAL_INTERVAL_MS);
const REGISTRATION_IDLE_TIMEOUT_MS = Number(process.env.REGISTRATION_IDLE_TIMEOUT_MS || 60000);
const isProduction = process.argv.includes('--production');
const isApiOnly = process.argv.includes('--api-only');
const resultsFilePath = path.resolve(process.env.RESULTS_FILE || path.join(__dirname, 'results.csv'));
// CSV is an explicit offline/test mode, never an automatic Supabase fallback.
const resultsStorage = process.env.RESULTS_STORAGE || 'supabase';
if (!['supabase', 'csv'].includes(resultsStorage)) throw new Error('Invalid RESULTS_STORAGE');
const pendingResultsFilePath = path.resolve(process.env.PENDING_RESULTS_FILE || path.join(__dirname, '.quiz-pending-results.json'));
const gameStateFilePath = path.resolve(
  process.env.GAME_STATE_FILE || path.join(__dirname, '.quiz-session.json'),
);
const sessionHistoryFilePath = path.resolve(
  process.env.SESSION_HISTORY_FILE || path.join(__dirname, 'quiz-sessions.jsonl'),
);
const operatorTokenFilePath = path.resolve(
  process.env.OPERATOR_TOKEN_FILE || path.join(__dirname, '.quiz-operator-token'),
);
const distPath = path.join(__dirname, 'dist');
const csvHeaders = ['entryId', 'name', 'email', 'score', 'completedAt'];
const configuredOperatorToken = String(process.env.OPERATOR_TOKEN || '').trim();

async function loadOrCreateOperatorToken() {
  if (configuredOperatorToken) return configuredOperatorToken;

  try {
    const savedToken = (await fsp.readFile(operatorTokenFilePath, 'utf8')).trim();
    if (savedToken) return savedToken;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generatedToken = crypto.randomBytes(24).toString('base64url');
  await fsp.mkdir(path.dirname(operatorTokenFilePath), { recursive: true });
  try {
    await fsp.writeFile(operatorTokenFilePath, `${generatedToken}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return generatedToken;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const savedToken = (await fsp.readFile(operatorTokenFilePath, 'utf8')).trim();
    if (!savedToken) throw new Error(`Operator token file is empty: ${operatorTokenFilePath}`);
    return savedToken;
  }
}

const operatorToken = await loadOrCreateOperatorToken();
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '');
const supabaseKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || '',
).trim();
const supabaseTable = String(
  process.env.SUPABASE_TABLE || process.env.VITE_SUPABASE_TABLE || 'ABBOTT_QUIZ',
).trim();
const supabaseEnvironmentStatus = {
  SUPABASE_URL: Boolean(String(process.env.SUPABASE_URL || '').trim()),
  SUPABASE_SERVICE_ROLE_KEY: Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
  SUPABASE_TABLE: Boolean(String(process.env.SUPABASE_TABLE || '').trim()),
};
let writeQueue = Promise.resolve();
let stateWriteQueue = Promise.resolve();
let statePersistenceError = null;
let feedbackTimer = null;
let advanceTimer = null;
let registrationIdleTimer = null;
const savedRunIds = new Set();
const pendingResults = new Map(await readPendingResults());

async function readPendingResults() {
  try {
    return JSON.parse(await fsp.readFile(pendingResultsFilePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function persistPendingResults() {
  await fsp.mkdir(path.dirname(pendingResultsFilePath), { recursive: true });
  const temporaryPath = `${pendingResultsFilePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify([...pendingResults]), { mode: 0o600 });
  await fsp.rename(temporaryPath, pendingResultsFilePath);
}

function correctOptionIds(question) {
  return Array.isArray(question?.correctOptionIds)
    ? question.correctOptionIds
    : [question?.correctOptionId].filter(Boolean);
}

function isEligibleGameQuestion(question) {
  const optionIds = new Set((question?.options || []).map((option) => option.id));
  const acceptedOptionIds = correctOptionIds(question);

  return typeof question?.id === 'string'
    && typeof question?.text === 'string'
    && question.options?.length === 4
    && optionIds.size === 4
    && acceptedOptionIds.length === 1
    && optionIds.has(acceptedOptionIds[0]);
}

const gameQuestionIds = new Set(questionBank.map((question) => question.id));

function shuffle(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function createRunQuestions() {
  return selectLevelQuestions()
    .map((question) => ({
      ...question,
      options: shuffle(question.options),
    }));
}

function createLifelineState() {
  return {
    audiencePoll: { used: false, activatedAt: null },
    phoneAFriend: { used: false, activatedAt: null },
    fiftyFifty: { used: false, activatedAt: null },
  };
}

function createIdleState() {
  return {
    version: 1,
    revision: 0,
    runId: null,
    status: 'idle',
    phase: null,
    questionIndex: 0,
    questions: [],
    selectedOption: null,
    feedbackVisible: false,
    feedbackRevealAt: null,
    feedbackEndsAt: null,
    eliminatedOptionIds: [],
    lifelines: createLifelineState(),
    activeLifeline: null,
    answers: [],
    score: 0,
    completedLevel: 0,
    outcome: null,
    playerName: '',
    questionStartedAt: null,
    optionsRevealedAt: null,
    optionRevealIntervalMs,
    questionDeadline: null,
    questionRemainingMs: null,
    registrationExpiresAt: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
    resultSavedAt: null,
    resultView: 'sequence',
  };
}

function createRegistrationState() {
  const now = Date.now();

  return {
    version: 1,
    revision: 0,
    runId: crypto.randomUUID(),
    status: 'registering',
    phase: null,
    questionIndex: 0,
    questions: createRunQuestions(),
    selectedOption: null,
    feedbackVisible: false,
    feedbackRevealAt: null,
    feedbackEndsAt: null,
    eliminatedOptionIds: [],
    lifelines: createLifelineState(),
    activeLifeline: null,
    answers: [],
    score: 0,
    completedLevel: 0,
    outcome: null,
    playerName: '',
    questionStartedAt: null,
    optionsRevealedAt: null,
    optionRevealIntervalMs,
    questionDeadline: null,
    questionRemainingMs: null,
    registrationExpiresAt: now + REGISTRATION_IDLE_TIMEOUT_MS,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: null,
    resultSavedAt: null,
    resultView: 'sequence',
  };
}

function isRestorableState(value) {
  return value
    && typeof value === 'object'
    && ['idle', 'registering', 'running', 'finished'].includes(value.status)
    && Array.isArray(value.questions)
    && Array.isArray(value.answers);
}

async function loadQuizState() {
  try {
    const saved = JSON.parse(await fsp.readFile(gameStateFilePath, 'utf8'));
    if (!isRestorableState(saved)) return createIdleState();

    const defaults = createIdleState();
    const restored = {
      ...defaults,
      ...saved,
      eliminatedOptionIds: Array.isArray(saved.eliminatedOptionIds)
        ? saved.eliminatedOptionIds
        : [],
      lifelines: {
        ...defaults.lifelines,
        ...(saved.lifelines || {}),
      },
    };

    if (
      restored.status !== 'idle'
      && (
        restored.questions.length !== QUESTIONS_PER_RUN
        || !restored.questions.every((question, index) => (
          isEligibleGameQuestion(question)
          && question.level === index + 1
          && gameQuestionIds.has(question.id)
        ))
      )
    ) {
      return createIdleState();
    }

    // Old unanswered questions need the new reveal button; preserve visible options
    // if an answer or lifeline was already in progress.
    if (restored.status === 'running' && !Object.hasOwn(saved, 'optionsRevealedAt')) {
      restored.optionsRevealedAt = restored.phase !== 'answering' || restored.eliminatedOptionIds.length > 0
        ? Date.now() - restored.questions[restored.questionIndex].options.length * optionRevealIntervalMs
        : null;
    }

    // Old saved deadlines must not expire a game after the question limit was removed.
    restored.questionDeadline = null;
    restored.questionRemainingMs = null;
    return restored;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not restore quiz session from ${gameStateFilePath}:`, error);
    }
    return createIdleState();
  }
}

async function persistQuizStateSnapshot(snapshot) {
  await fsp.mkdir(path.dirname(gameStateFilePath), { recursive: true });
  const temporaryPath = `${gameStateFilePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await fsp.rename(temporaryPath, gameStateFilePath);
}

function queueQuizStatePersistence() {
  const snapshot = structuredClone(quizState);
  stateWriteQueue = stateWriteQueue
    .then(() => persistQuizStateSnapshot(snapshot))
    .then(() => {
      statePersistenceError = null;
    })
    .catch((error) => {
      statePersistenceError = error;
      console.error(`Could not persist quiz session to ${gameStateFilePath}:`, error);
    });
}

async function awaitQuizStatePersistence() {
  await stateWriteQueue;
  if (statePersistenceError) {
    return { ok: false, message: 'The game changed in memory but could not be saved to disk.' };
  }
  return null;
}

let quizState = await loadQuizState();

if (quizState.runId && quizState.resultSavedAt) {
  savedRunIds.add(quizState.runId);
}

function clearQuizTimers() {
  clearTimeout(feedbackTimer);
  clearTimeout(advanceTimer);
  feedbackTimer = null;
  advanceTimer = null;
}

function clearRegistrationIdleTimer() {
  clearTimeout(registrationIdleTimer);
  registrationIdleTimer = null;
}

function scheduleRegistrationIdleTimer() {
  clearRegistrationIdleTimer();

  if (quizState.status !== 'registering') return;

  const remainingMs = Math.max(0, (quizState.registrationExpiresAt || 0) - Date.now());
  registrationIdleTimer = setTimeout(() => {
    if (quizState.status !== 'registering') return;

    setQuizState(createIdleState());
    registrationIdleTimer = null;
  }, remainingMs);
}

function currentQuestion() {
  return quizState.questions[quizState.questionIndex];
}

function sanitizePlayerName(value) {
  if (typeof value !== 'string') return '';

  const sanitized = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return Array.from(sanitized).slice(0, 30).join('');
}

function hasValidPlayerName(value) {
  return Array.from(value.replace(/\s/g, '')).length >= 2;
}

function createPublicQuizState() {
  const currentAnswer = quizState.answers.at(-1);
  const isWaitingForFeedback = quizState.status === 'running' && quizState.phase === 'locked';
  const publicScore = isWaitingForFeedback && currentAnswer?.isCorrect
    ? quizState.score - 1
    : quizState.score;
  const publicQuestions = quizState.questions.map((question, index) => {
    const {
      correctOptionId: _correctOptionId,
      correctOptionIds: _correctOptionIds,
      explanation: _explanation,
      ...publicQuestion
    } = question;

    if (['locked', 'feedback'].includes(quizState.phase) && index === quizState.questionIndex) {
      return {
        ...publicQuestion,
        correctOptionIds: correctOptionIds(question),
        ...(quizState.phase === 'feedback' ? {
          explanation: question.explanation || questionBank.find((entry) => entry.id === question.id)?.explanation || '',
        } : {}),
      };
    }

    return publicQuestion;
  });
  const publicAnswers = quizState.answers.map(({ isCorrect: _isCorrect, ...answer }) => answer);
  return {
    ...quizState,
    sessionId: quizState.runId,
    serverNow: Date.now(),
    runId: undefined,
    questions: publicQuestions,
    answers: publicAnswers,
    score: publicScore,
  };
}

function broadcastState() {
  io.emit('quiz_state', createPublicQuizState());
}

function setQuizState(nextState, { persist = true, broadcast = true } = {}) {
  quizState = {
    ...nextState,
    revision: Number(quizState?.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  if (persist) queueQuizStatePersistence();
  if (broadcast) broadcastState();
}

function createOutcome({ isChampion = false, failedLevel = null } = {}) {
  if (isChampion) {
    return {
      type: 'champion',
      awardedLevel: QUESTIONS_PER_RUN,
      failedLevel: null,
    };
  }

  const awardedLevel = quizState.completedLevel >= 4 ? quizState.completedLevel : 0;
  return {
    type: awardedLevel > 0 ? 'milestone' : 'eliminated',
    awardedLevel,
    failedLevel,
  };
}

function showOptions(payload = {}) {
  if (quizState.status !== 'running' || quizState.phase !== 'answering'
    || payload?.sessionId !== quizState.runId || payload?.questionId !== currentQuestion()?.id) {
    return { ok: false, message: 'This question is no longer available for revealing options.' };
  }
  if (quizState.optionsRevealedAt != null) {
    return { ok: false, message: 'The options have already been revealed.' };
  }
  setQuizState({ ...quizState, optionsRevealedAt: Date.now(), optionRevealIntervalMs });
  return { ok: true };
}

function areOptionsReady() {
  return getVisibleOptionCount(quizState) === currentQuestion()?.options.length;
}

function selectOption(optionId) {
  const question = currentQuestion();

  if (quizState.status !== 'running') {
    return { ok: false, message: 'The quiz is not currently running.' };
  }

  if (quizState.phase !== 'answering') {
    return { ok: false, message: 'An answer cannot be selected in the current game phase.' };
  }

  if (!areOptionsReady()) {
    return { ok: false, message: 'Show all options before answering or using a lifeline.' };
  }
  if (quizState.activeLifeline) {
    return { ok: false, message: 'Finish the active lifeline before selecting an answer.' };
  }

  if (
    !question?.options.some((option) => option.id === optionId)
    || quizState.eliminatedOptionIds.includes(optionId)
  ) {
    return { ok: false, message: 'That option is not valid for the current question.' };
  }

  setQuizState({
    ...quizState,
    questionRemainingMs: null,
    questionDeadline: null,
    selectedOption: optionId,
    phase: 'confirming',
    feedbackVisible: false,
  });

  return { ok: true };
}

function goBack() {
  if (quizState.status !== 'running' || quizState.phase !== 'confirming') {
    return { ok: false, message: 'Go Back is only available before an answer is locked.' };
  }

  setQuizState({
    ...quizState,
    selectedOption: null,
    phase: 'answering',
    questionDeadline: null,
  });
  return { ok: true };
}

function finishRun(outcome) {
  clearQuizTimers();
  const completedAt = new Date().toISOString();
  setQuizState({
    ...quizState,
    status: 'finished',
    phase: null,
    questionDeadline: null,
    questionRemainingMs: null,
    feedbackVisible: true,
    feedbackRevealAt: null,
    feedbackEndsAt: null,
    activeLifeline: null,
    outcome,
    resultView: 'sequence',
    completedAt,
  });
  void saveCompletedRun(quizState);
}

function showLeaderboard() {
  if (quizState.status !== 'finished') {
    return { ok: false, message: 'The leaderboard is available after the quiz finishes.' };
  }

  setQuizState({
    ...quizState,
    resultView: 'leaderboard',
  });
  return { ok: true };
}

function hideLeaderboard() {
  if (quizState.status !== 'finished' || quizState.resultView !== 'leaderboard') {
    return { ok: false, message: 'Back is only available from the leaderboard.' };
  }

  setQuizState({
    ...quizState,
    resultView: 'sequence',
  });
  return { ok: true };
}

function advanceAfterFeedback(expectedRunId, expectedQuestionIndex) {
  if (
    quizState.runId !== expectedRunId
    || quizState.questionIndex !== expectedQuestionIndex
    || quizState.status !== 'running'
  ) return;

  const answer = quizState.answers.at(-1);
  const currentLevel = quizState.questionIndex + 1;

  if (!answer?.isCorrect) {
    finishRun(createOutcome({ failedLevel: currentLevel }));
    return;
  }

  if (currentLevel >= QUESTIONS_PER_RUN) {
    finishRun(createOutcome({ isChampion: true }));
    return;
  }

  setQuizState({
    ...quizState,
    questionIndex: quizState.questionIndex + 1,
    phase: 'answering',
    selectedOption: null,
    feedbackVisible: false,
    feedbackRevealAt: null,
    feedbackEndsAt: null,
    eliminatedOptionIds: [],
    activeLifeline: null,
    questionStartedAt: Date.now(),
    optionsRevealedAt: null,
    optionRevealIntervalMs,
    questionDeadline: null,
    questionRemainingMs: null,
  });
}

function continueFeedback(payload = {}) {
  if (
    quizState.status !== 'running'
    || quizState.phase !== 'feedback'
    || payload?.sessionId !== quizState.runId
    || payload?.questionId !== currentQuestion()?.id
  ) {
    return { ok: false, message: 'This answer feedback is no longer active.' };
  }

  clearQuizTimers();
  advanceAfterFeedback(quizState.runId, quizState.questionIndex);
  return { ok: true };
}

function scheduleLockedAnswer(expectedRunId, expectedQuestionIndex) {
  clearQuizTimers();
  const revealDelay = Math.max(0, (quizState.feedbackRevealAt || Date.now()) - Date.now());
  const advanceDelay = Math.max(0, (quizState.feedbackEndsAt || Date.now()) - Date.now());

  feedbackTimer = setTimeout(() => {
    if (
      quizState.runId !== expectedRunId
      || quizState.questionIndex !== expectedQuestionIndex
      || quizState.status !== 'running'
      || quizState.phase !== 'locked'
    ) return;

    setQuizState({ ...quizState, phase: 'feedback', feedbackVisible: true });
  }, revealDelay);

  advanceTimer = setTimeout(() => {
    advanceAfterFeedback(expectedRunId, expectedQuestionIndex);
  }, advanceDelay);
}

function lockAnswer() {
  const question = currentQuestion();

  if (
    quizState.status !== 'running'
    || quizState.phase !== 'confirming'
    || !quizState.selectedOption
  ) {
    return { ok: false, message: 'Select an answer before locking it.' };
  }

  if (quizState.answers.some((answer) => answer.questionId === question?.id)) {
    return { ok: false, message: 'This level already has a locked answer.' };
  }

  const now = Date.now();
  const isCorrect = correctOptionIds(question).includes(quizState.selectedOption);
  const completedLevel = quizState.completedLevel + (isCorrect ? 1 : 0);
  setQuizState({
    ...quizState,
    phase: 'locked',
    feedbackVisible: false,
    feedbackRevealAt: now + FEEDBACK_REVEAL_DELAY_MS,
    feedbackEndsAt: now + FEEDBACK_REVEAL_DELAY_MS + FEEDBACK_DELAY_MS,
    answers: [
      ...quizState.answers,
      {
        level: quizState.questionIndex + 1,
        questionId: question.id,
        selectedOption: quizState.selectedOption,
        isCorrect,
        lockedAt: new Date(now).toISOString(),
      },
    ],
    score: completedLevel,
    completedLevel,
  });
  scheduleLockedAnswer(quizState.runId, quizState.questionIndex);

  return { ok: true };
}

function useLifeline(type) {
  const question = currentQuestion();

  if (!LIFELINE_TYPES.includes(type)) {
    return { ok: false, message: 'That lifeline is not supported.' };
  }
  if (quizState.status !== 'running' || quizState.phase !== 'answering') {
    return { ok: false, message: 'Lifelines can only be used before selecting an answer.' };
  }
  if (!areOptionsReady()) {
    return { ok: false, message: 'Show all options before answering or using a lifeline.' };
  }
  if (quizState.activeLifeline) {
    return { ok: false, message: 'Finish the active lifeline before using another one.' };
  }
  if (quizState.lifelines[type]?.used) {
    return { ok: false, message: 'That lifeline has already been used.' };
  }

  const activatedAt = new Date().toISOString();
  const lifelines = {
    ...quizState.lifelines,
    [type]: { used: true, activatedAt },
  };
  const nextState = { ...quizState, lifelines };

  if (type === 'fiftyFifty') {
    const correctId = correctOptionIds(question)[0];
    nextState.eliminatedOptionIds = shuffle(
      question.options.filter((option) => option.id !== correctId).map((option) => option.id),
    ).slice(0, 2);
  } else {
    nextState.activeLifeline = type;
  }

  setQuizState(nextState);
  return { ok: true };
}

function dismissLifeline() {
  if (quizState.status !== 'running' || !quizState.activeLifeline) {
    return { ok: false, message: 'There is no active lifeline to finish.' };
  }

  setQuizState({ ...quizState, activeLifeline: null });
  return { ok: true };
}

function restartQuiz() {
  if (quizState.status !== 'finished') {
    return { ok: false, message: 'Play Again is only available after the quiz finishes.' };
  }

  clearQuizTimers();
  clearRegistrationIdleTimer();
  setQuizState(createIdleState());
  return { ok: true };
}

function startQuiz() {
  if (quizState.status !== 'idle') {
    return { ok: false, message: 'The quiz has already started.' };
  }

  clearQuizTimers();
  clearRegistrationIdleTimer();
  setQuizState(createRegistrationState());
  scheduleRegistrationIdleTimer();
  return { ok: true };
}

function updatePlayerName(name) {
  if (quizState.status !== 'registering') {
    return { ok: false, message: 'Names can only be changed during registration.' };
  }

  setQuizState({
    ...quizState,
    playerName: sanitizePlayerName(name),
    registrationExpiresAt: Date.now() + REGISTRATION_IDLE_TIMEOUT_MS,
  });
  scheduleRegistrationIdleTimer();
  return { ok: true, name: quizState.playerName };
}

function submitPlayerName() {
  if (quizState.status !== 'registering') {
    return { ok: false, message: 'The quiz is not accepting a name right now.' };
  }

  if (!hasValidPlayerName(quizState.playerName)) {
    return { ok: false, message: 'Enter at least 2 characters to continue.' };
  }

  clearRegistrationIdleTimer();
  setQuizState({
    ...quizState,
    status: 'running',
    phase: 'answering',
    questionStartedAt: Date.now(),
    optionsRevealedAt: null,
    optionRevealIntervalMs,
    questionDeadline: null,
    questionRemainingMs: null,
    registrationExpiresAt: null,
  });
  return { ok: true };
}

function leaveRegistration() {
  if (quizState.status !== 'registering') {
    return { ok: false, message: 'Back is only available during registration.' };
  }

  clearRegistrationIdleTimer();
  setQuizState(createIdleState());
  return { ok: true };
}

function tokenMatches(value) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(operatorToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function requireOperatorSocket(socket, acknowledge, operation) {
  if (!socket.data.isOperator) {
    acknowledge?.({ ok: false, message: 'Operator authorization is required.' });
    return;
  }

  const result = operation();
  if (result.ok) {
    const persistenceFailure = await awaitQuizStatePersistence();
    if (persistenceFailure) {
      acknowledge?.(persistenceFailure);
      return;
    }
  }
  acknowledge?.(result);
}

io.on('connection', (socket) => {
  socket.data.isOperator = socket.handshake.auth?.operator === true
    || tokenMatches(socket.handshake.auth?.operatorToken);
  socket.emit('operator_access', { authorized: socket.data.isOperator });
  socket.emit('quiz_state', createPublicQuizState());

  socket.on('request_state', () => {
    socket.emit('quiz_state', createPublicQuizState());
  });

  // Reply only to the requesting operator; never broadcast the private answer.
  socket.on('get_operator_answer', (payload, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, () => {
      if (
        quizState.status !== 'running'
        || !['answering', 'confirming'].includes(quizState.phase)
        || payload?.sessionId !== quizState.runId
        || payload?.questionId !== currentQuestion()?.id
      ) return { ok: false, message: 'This question is no longer active.' };
      return {
        ok: true,
        sessionId: quizState.runId,
        questionId: currentQuestion().id,
        correctOptionIds: correctOptionIds(currentQuestion()),
      };
    });
  });

  socket.on('show_options', (payload, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, () => showOptions(payload));
  });

  socket.on('select_option', (payload, acknowledge) => {
    const optionId = typeof payload?.optionId === 'string' ? payload.optionId : '';
    requireOperatorSocket(socket, acknowledge, () => selectOption(optionId));
  });

  socket.on('start', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, startQuiz);
  });

  socket.on('name_update', (payload, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, () => updatePlayerName(payload?.name));
  });

  socket.on('name_submit', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, submitPlayerName);
  });

  socket.on('registration_back', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, leaveRegistration);
  });

  socket.on('answer_back', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, goBack);
  });

  socket.on('lock_answer', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, lockAnswer);
  });

  socket.on('continue_feedback', (payload, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, () => continueFeedback(payload));
  });

  socket.on('use_lifeline', (payload, acknowledge) => {
    const type = typeof payload?.type === 'string' ? payload.type : '';
    requireOperatorSocket(socket, acknowledge, () => useLifeline(type));
  });

  socket.on('dismiss_lifeline', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, dismissLifeline);
  });

  socket.on('restart', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, restartQuiz);
  });
  socket.on('show_leaderboard', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, showLeaderboard);
  });
  socket.on('hide_leaderboard', (_, acknowledge) => {
    requireOperatorSocket(socket, acknowledge, hideLeaderboard);
  });
});

if (quizState.status === 'registering') {
  scheduleRegistrationIdleTimer();
} else if (quizState.status === 'running' && ['locked', 'feedback'].includes(quizState.phase)) {
  scheduleLockedAnswer(quizState.runId, quizState.questionIndex);
} else if (quizState.status === 'finished' && !quizState.resultSavedAt) {
  void saveCompletedRun(quizState);
}
for (const pendingState of pendingResults.values()) void saveCompletedRun(pendingState);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: '16kb' }));
app.use('/question-images', express.static(path.join(__dirname, 'src/images')));

function requireOperatorHttp(req, res, next) {
  const authorization = String(req.get('authorization') || '');
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!tokenMatches(suppliedToken)) {
    res.status(401).json({ message: 'Operator authorization is required.' });
    return;
  }

  next();
}

function performGameAction(action, payload = {}) {
  switch (action) {
    case 'start': return startQuiz();
    case 'name_update': return updatePlayerName(payload.name);
    case 'name_submit': return submitPlayerName();
    case 'registration_back': return leaveRegistration();
    case 'show_options': return showOptions(payload);
    case 'select_option': return selectOption(payload.optionId);
    case 'answer_back': return goBack();
    case 'lock_answer': return lockAnswer();
    case 'continue_feedback': return continueFeedback(payload);
    case 'use_lifeline': return useLifeline(payload.type);
    case 'dismiss_lifeline': return dismissLifeline();
    case 'restart': return restartQuiz();
    case 'show_leaderboard': return showLeaderboard();
    case 'hide_leaderboard': return hideLeaderboard();
    default: return { ok: false, message: 'Unknown game action.' };
  }
}

app.get('/api/game', (req, res) => {
  res.json(createPublicQuizState());
});

app.get('/api/operator/game', requireOperatorHttp, (req, res) => {
  res.json(createPublicQuizState());
});

app.post('/api/operator/game/action', requireOperatorHttp, async (req, res) => {
  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const result = performGameAction(action, payload);
  if (result.ok) {
    const persistenceFailure = await awaitQuizStatePersistence();
    if (persistenceFailure) {
      res.status(500).json(persistenceFailure);
      return;
    }
  }
  res.status(result.ok ? 200 : 409).json(result);
});

app.get('/api/operator/sessions', requireOperatorHttp, async (req, res) => {
  try {
    res.json(await readSessionHistory());
  } catch (error) {
    sendStorageError(res, error);
  }
});

async function ensureResultsFile() {
  try {
    await fsp.access(resultsFilePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fsp.writeFile(resultsFilePath, `${csvHeaders.join(',')}\n`, 'utf8');
  }
}

function escapeCSVCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCSVLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }

  cells.push(cell);
  return cells;
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cells = parseCSVLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));

    return {
      entryId: row.entryId,
      name: row.name,
      email: row.email,
      score: Number(row.score),
      completedAt: row.completedAt,
    };
  });
}

async function readResults() {
  await ensureResultsFile();
  const content = await fsp.readFile(resultsFilePath, 'utf8');
  return parseCSV(content);
}

async function appendResult(result) {
  await ensureResultsFile();
  const row = csvHeaders.map((header) => escapeCSVCell(result[header])).join(',');
  await fsp.appendFile(resultsFilePath, `${row}\n`, 'utf8');
}

async function readSessionHistory() {
  try {
    const content = await fsp.readFile(sessionHistoryFilePath, 'utf8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function archiveCompletedSession(completedState) {
  const existingSessions = await readSessionHistory();
  if (existingSessions.some((session) => session.runId === completedState.runId)) return;

  const archivedSession = {
    runId: completedState.runId,
    playerName: completedState.playerName,
    status: completedState.status,
    answers: completedState.answers,
    score: completedState.score,
    completedLevel: completedState.completedLevel,
    outcome: completedState.outcome,
    lifelines: completedState.lifelines,
    createdAt: completedState.createdAt,
    completedAt: completedState.completedAt,
  };
  await fsp.mkdir(path.dirname(sessionHistoryFilePath), { recursive: true });
  await fsp.appendFile(sessionHistoryFilePath, `${JSON.stringify(archivedSession)}\n`, 'utf8');
}

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseKey && supabaseTable);
}

async function requestSupabase(pathname, options = {}) {
  if (!hasSupabaseConfig()) throw new Error('Supabase results storage is not configured.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const responseBody = await response.text();
  let payload = null;

  try {
    payload = responseBody ? JSON.parse(responseBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorDetails = [
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      payload?.code ? `code=${payload.code}` : null,
      payload?.message ? `message=${payload.message}` : null,
      payload?.details ? `details=${payload.details}` : null,
      payload?.hint ? `hint=${payload.hint}` : null,
      !payload && responseBody ? `response=${responseBody}` : null,
    ].filter(Boolean).join('; ');

    throw new Error(`Supabase request failed: ${errorDetails}`);
  }

  return payload;
}

function mapSupabaseResult(row) {
  return {
    entryId: String(row.id),
    name: row.name || '',
    email: row.email || '',
    score: Number(row.score),
    completedAt: row.created_at,
  };
}

async function readPersistentResults() {
  if (resultsStorage === 'csv') return (await readResults()).sort((a, b) => b.score - a.score || Date.parse(a.completedAt) - Date.parse(b.completedAt));

  const params = new URLSearchParams();
  params.set('select', 'id,name,email,score,created_at');
  params.set('order', 'score.desc,created_at.asc,id.asc');
  params.set('limit', '1000');
  const results = [];
  for (let offset = 0; ; offset += 1000) {
    params.set('offset', String(offset));
    const rows = await requestSupabase(`${encodeURIComponent(supabaseTable)}?${params.toString()}`);
    if (!Array.isArray(rows)) throw new Error('Invalid Supabase results response.');
    results.push(...rows.map(mapSupabaseResult));
    if (rows.length < 1000) return results;
  }
}

async function findResultByEmail(email) {
  if (resultsStorage === 'csv') {
    const existingResults = await readResults();
    return existingResults.find((entry) => entry.email === email) || null;
  }

  const params = new URLSearchParams();
  params.set('select', 'id,name,email,score,created_at');
  params.set('email', `eq.${email}`);
  params.set('limit', '1');
  const rows = await requestSupabase(`${encodeURIComponent(supabaseTable)}?${params.toString()}`);
  return Array.isArray(rows) && rows[0] ? mapSupabaseResult(rows[0]) : null;
}

async function persistResult(result, { deduplicateByEmail = false } = {}) {
  if (deduplicateByEmail) {
    const existing = await findResultByEmail(result.email);
    if (existing) return existing;
  }

  if (resultsStorage === 'csv') {
    await appendResult(result);
    return result;
  }

  const rows = await requestSupabase(
    `${encodeURIComponent(supabaseTable)}?select=id,name,email,score,created_at`,
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        name: result.name,
        email: result.email,
        score: result.score,
        created_at: result.completedAt,
      }),
    },
  );

  if (!Array.isArray(rows) || !rows[0]) throw new Error('Supabase did not confirm the saved result.');
  return mapSupabaseResult(rows[0]);
}

async function saveCompletedRun(completedState) {
  if (!completedState.runId || savedRunIds.has(completedState.runId)) return;

  savedRunIds.add(completedState.runId);
  const result = {
    entryId: crypto.randomUUID(),
    name: completedState.playerName || 'Guest',
    email: `guest+${completedState.runId}@kiosk.invalid`,
    score: completedState.score,
    completedAt: completedState.completedAt,
  };

  const destination = resultsStorage === 'supabase' ? 'Supabase' : 'results.csv';
  console.log(`Saving run ${completedState.runId} to ${destination}`);
  let saved = false;

  try {
    const savedResult = await enqueueWrite(async () => {
      pendingResults.set(completedState.runId, completedState);
      await persistPendingResults();
      await archiveCompletedSession(completedState);
      const persisted = await persistResult(result, { deduplicateByEmail: true });
      pendingResults.delete(completedState.runId);
      await persistPendingResults();
      return persisted;
    });
    const rowSuffix = destination === 'Supabase' && savedResult.entryId
      ? ` as row ${savedResult.entryId}`
      : '';
    console.log(`Saved run ${completedState.runId} to ${destination}${rowSuffix}`);
    saved = true;
  } catch (error) {
    const fullError = error instanceof Error ? (error.stack || error.message) : String(error);
    console.error(`Failed to save run ${completedState.runId} to ${destination}: ${fullError}`);

  }

  if (!saved) {
    savedRunIds.delete(completedState.runId);
    // Keep failed results in the durable outbox, including across new games/restarts.
    setTimeout(() => { void saveCompletedRun(completedState); }, 5000).unref();
    return;
  }

  if (quizState.runId === completedState.runId && !quizState.resultSavedAt) {
    setQuizState({ ...quizState, resultSavedAt: new Date().toISOString() });
  }
}

function enqueueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

function sendStorageError(res, error) {
  console.error(error);
  res.status(500).json({
    message: 'Could not read or write leaderboard results. Check the Supabase connection and try again.',
  });
}

app.get('/api/results', async (req, res) => {
  try {
    const results = await readPersistentResults();
    res.json(results.map(({ email: _email, ...publicResult }) => publicResult));
  } catch (error) {
    sendStorageError(res, error);
  }
});

app.post('/api/results', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 254) : '';
  const score = Number(req.body?.score);

  const hasControlCharacters = /[\u0000-\u001F\u007F-\u009F]/;
  const hasUnsafeSpreadsheetPrefix = /^[=+\-@]/;
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    !name
    || !email
    || hasControlCharacters.test(name)
    || hasControlCharacters.test(email)
    || hasUnsafeSpreadsheetPrefix.test(name)
    || !looksLikeEmail.test(email)
    || !Number.isInteger(score)
    || score < 0
    || score > QUESTIONS_PER_RUN
  ) {
    res.status(400).json({
      message: `Name, email, and an integer score from 0 to ${QUESTIONS_PER_RUN} are required.`,
    });
    return;
  }

  try {
    const savedResult = await enqueueWrite(async () => {
      const result = {
        entryId: crypto.randomUUID(),
        name,
        email,
        score,
        completedAt: new Date().toISOString(),
      };

      return persistResult(result);
    });

    res.status(201).json(savedResult);
  } catch (error) {
    sendStorageError(res, error);
  }
});

if (isProduction) {
  if (!fs.existsSync(distPath)) {
    throw new Error('The production build is missing. Run npm run build first.');
  }

  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
      res.sendFile(path.join(distPath, 'index.html'));
      return;
    }

    next();
  });
} else if (!isApiOnly) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    appType: 'spa',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Quiz server running at http://0.0.0.0:${PORT}`);
  console.log(`Operator: http://localhost:${PORT}/operator`);
  console.log(`Display:  http://localhost:${PORT}/display`);
  console.log(`Game state: ${gameStateFilePath}`);
  console.log(`Session history: ${sessionHistoryFilePath}`);
  if (!configuredOperatorToken) console.log(`Operator token file: ${operatorTokenFilePath}`);
  console.log(`SUPABASE_URL: ${supabaseEnvironmentStatus.SUPABASE_URL ? 'loaded' : 'MISSING'}`);
  console.log(
    `SUPABASE_SERVICE_ROLE_KEY: ${supabaseEnvironmentStatus.SUPABASE_SERVICE_ROLE_KEY ? 'loaded' : 'MISSING'}`,
  );
  console.log(`SUPABASE_TABLE: ${supabaseEnvironmentStatus.SUPABASE_TABLE ? 'loaded' : 'MISSING'}`);
  if (resultsStorage === 'csv') {
    console.warn(`Results storage: explicit offline CSV mode at ${resultsFilePath}`);
  } else if (hasSupabaseConfig()) {
    const usesLegacyEnvironment = !supabaseEnvironmentStatus.SUPABASE_URL
      || !supabaseEnvironmentStatus.SUPABASE_SERVICE_ROLE_KEY
      || !supabaseEnvironmentStatus.SUPABASE_TABLE;
    console.log(
      `Results storage: Supabase table ${supabaseTable}${usesLegacyEnvironment ? ' (legacy environment fallback)' : ''}`,
    );
  } else {
    console.error('Results storage: Supabase configuration is missing. Results will remain queued until configured.');
  }
});

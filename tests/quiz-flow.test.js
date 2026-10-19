import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { io as createSocket } from 'socket.io-client';
import { questions, quizConfig } from '../src/data/questions.js';
import { createLevelPools, selectLevelQuestions } from '../src/data/levelQuestions.js';
import { getVisibleOptionCount, OPTION_REVEAL_INTERVAL_MS } from '../src/utils/optionReveal.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, '..');
const operatorToken = 'integration-test-operator-token';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function loadCorrectAnswers() {
  return new Map(questions.map((question) => [question.id, question.correctOptionId]));
}

test('draws one question from each supplied level pool, with every row reachable', () => {
  const pools = createLevelPools();
  assert.equal(quizConfig.questionCount, 8);
  assert.deepEqual(pools.map((pool) => pool.length), [50, 50, 50, 50, 50, 43, 24, 29]);
  assert.equal(questions.length, 346);
  const selected = new Set();
  for (let sample = 0; sample < 500; sample += 1) {
    const run = selectLevelQuestions(() => (sample + 0.5) / 500);
    assert.deepEqual(run.map((question) => question.level), [1, 2, 3, 4, 5, 6, 7, 8]);
    run.forEach((question, index) => {
      assert.ok(pools[index].includes(question));
      selected.add(question.id);
    });
  }
  assert.equal(selected.size, questions.length);
  let draws = 0;
  selectLevelQuestions(() => { draws += 1; return 0; });
  assert.equal(draws, 8, 'Each level must receive an independent random draw');
  assert.deepEqual(questions.find((question) => question.id === 'umc-l7-r2').options.map((option) => option.text),
    ['5%', '10%', '20%', '35%']);
  assert.throws(() => createLevelPools(questions.filter((question) => question.level !== 8)), /Level 8/);
});

function createStateTracker(socket) {
  let current = null;
  const waiters = new Set();

  socket.on('quiz_state', (state) => {
    current = state;
    for (const waiter of [...waiters]) waiter();
  });

  return {
    get current() {
      return current;
    },
    waitFor(predicate, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        let timeoutId;
        const check = () => {
          if (!current || !predicate(current)) return;
          clearTimeout(timeoutId);
          waiters.delete(check);
          resolve(current);
        };
        timeoutId = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`Timed out waiting for quiz state. Last state: ${JSON.stringify(current)}`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
  };
}

function connectSocket(baseUrl, auth = {}) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(baseUrl, {
      auth,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    const tracker = createStateTracker(socket);
    const operatorAccess = new Promise((resolveAccess) => {
      socket.once('operator_access', resolveAccess);
    });
    const timeoutId = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out connecting to the quiz server.'));
    }, 3000);

    socket.once('connect', () => {
      clearTimeout(timeoutId);
      resolve({ socket, tracker, operatorAccess });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

function emitAction(socket, eventName, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(eventName, payload, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function startServer({
  port,
  stateFile,
  resultsFile,
  sessionHistoryFile,
  answerRevealDurationMs = 100,
  questionDurationMs = 45000,
  optionRevealIntervalMs = 5,
  resultsStorage = '',
  supabaseTestUrl = '',
}) {
  const child = spawn(process.execPath, ['server.js', '--api-only'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(path.dirname(stateFile), 'no-test-env-file'),
      PORT: String(port),
      OPERATOR_TOKEN: operatorToken,
      GAME_STATE_FILE: stateFile,
      SESSION_HISTORY_FILE: sessionHistoryFile,
      RESULTS_FILE: resultsFile,
      RESULTS_STORAGE: resultsStorage,
      PENDING_RESULTS_FILE: path.join(path.dirname(stateFile), 'pending-results.json'),
      ANSWER_REVEAL_DURATION_MS: answerRevealDurationMs == null ? '' : String(answerRevealDurationMs),
      QUESTION_DURATION_MS: String(questionDurationMs),
      OPTION_REVEAL_INTERVAL_MS: String(optionRevealIntervalMs),
      REGISTRATION_IDLE_TIMEOUT_MS: '10000',
      SUPABASE_URL: supabaseTestUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseTestUrl ? 'isolated-test-key' : '',
      SUPABASE_TABLE: 'ABBOTT_QUIZ',
      SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Quiz server exited early.\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/game`);
      if (response.ok) return { baseUrl, child, getOutput: () => output };
    } catch {
      // The process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  child.kill('SIGTERM');
  throw new Error(`Timed out starting quiz server.\n${output}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

async function startRun(operator, operatorTracker, name, { revealOptions = true } = {}) {
  assert.deepEqual(await emitAction(operator, 'start'), { ok: true });
  await operatorTracker.waitFor((state) => state.status === 'registering');
  assert.equal((await emitAction(operator, 'name_update', { name })).ok, true);
  assert.deepEqual(await emitAction(operator, 'name_submit'), { ok: true });
  await operatorTracker.waitFor((state) => state.status === 'running' && state.phase === 'answering');
  if (revealOptions) await revealCurrentOptions(operator, operatorTracker);
  return operatorTracker.current;
}

async function revealCurrentOptions(operator, tracker) {
  let state = tracker.current;
  if (state.optionsRevealedAt == null) {
    assert.equal((await emitAction(operator, 'show_options', {
      sessionId: state.sessionId,
      questionId: state.questions[state.questionIndex].id,
    })).ok, true);
    state = await tracker.waitFor((next) => next.optionsRevealedAt != null);
  }
  const readyAt = state.optionsRevealedAt
    + (state.questions[state.questionIndex].options.length - 1) * state.optionRevealIntervalMs;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, readyAt - Date.now()) + 10));
}

async function answerCurrentLevel({ correct, correctAnswers, operator, tracker }) {
  await revealCurrentOptions(operator, tracker);
  const state = tracker.current;
  const question = state.questions[state.questionIndex];
  const correctOptionId = correctAnswers.get(question.id);
  assert.ok(correctOptionId, `Missing correct answer for ${question.id}`);
  const optionId = correct
    ? correctOptionId
    : question.options.find((option) => option.id !== correctOptionId).id;
  assert.equal((await emitAction(operator, 'select_option', { optionId })).ok, true);
  await tracker.waitFor((next) => next.phase === 'confirming' && next.selectedOption === optionId);
  assert.equal((await emitAction(operator, 'lock_answer')).ok, true);
  const feedback = await tracker.waitFor((next) => next.phase === 'locked' && next.questionIndex === state.questionIndex);
  const revealedQuestion = feedback.questions[state.questionIndex];
  assert.deepEqual(revealedQuestion.correctOptionIds, [correctOptionId]);
  assert.equal(feedback.feedbackVisible, false);
  assert.ok(feedback.questions.every((entry) => !('explanation' in entry)),
    'No explanation should be sent during the colour reveal');
  return optionId;
}

async function playUntilOutcome({ correctLevels, correctAnswers, operator, tracker }) {
  for (let index = 0; index < correctLevels; index += 1) {
    const previousIndex = tracker.current.questionIndex;
    await answerCurrentLevel({ correct: true, correctAnswers, operator, tracker });
    await tracker.waitFor((state) => (
      state.status === 'running'
      && state.phase === 'answering'
      && state.questionIndex === previousIndex + 1
    ));
  }

  await answerCurrentLevel({ correct: false, correctAnswers, operator, tracker });
  return tracker.waitFor((state) => state.status === 'finished');
}

test('options appear A to D at exact half-second boundaries', () => {
  const state = { questions: [{ options: ['a', 'b', 'c', 'd'] }], questionIndex: 0, optionsRevealedAt: null };
  assert.equal(OPTION_REVEAL_INTERVAL_MS, 500);
  assert.equal(getVisibleOptionCount(state, 90000), 0);
  state.optionsRevealedAt = 10000;
  for (const [elapsed, count] of [[-1, 0], [0, 1], [499, 1], [500, 2], [999, 2], [1000, 3], [1499, 3], [1500, 4], [90000, 4]]) {
    assert.equal(getVisibleOptionCount(state, 10000 + elapsed), count);
  }
});

test('operator reveals shared options, persists progress, and each next question starts hidden', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-option-reveal-'));
  const options = {
    port: await getFreePort(), stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'), sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
    optionRevealIntervalMs: 500,
  };
  let server = await startServer(options);
  let operator = await connectSocket(server.baseUrl, { operatorToken });
  let display = await connectSocket(server.baseUrl);
  t.after(async () => {
    operator.socket.close(); display.socket.close(); await stopServer(server.child);
  });
  const state = await startRun(operator.socket, operator.tracker, 'Reveal Test', { revealOptions: false });
  const question = state.questions[0];
  const payload = { sessionId: state.sessionId, questionId: question.id };
  assert.equal(state.optionsRevealedAt, null);
  await display.tracker.waitFor((next) => next.status === 'running');
  assert.equal(display.tracker.current.optionsRevealedAt, null);
  assert.equal((await emitAction(operator.socket, 'select_option', { optionId: question.options[0].id })).ok, false);
  assert.equal((await emitAction(operator.socket, 'use_lifeline', { type: 'fiftyFifty' })).ok, false);
  assert.equal((await emitAction(display.socket, 'show_options', payload)).ok, false);
  assert.equal((await emitAction(operator.socket, 'show_options', { ...payload, questionId: 'stale' })).ok, false);
  assert.equal((await emitAction(operator.socket, 'show_options', payload)).ok, true);
  const revealing = await operator.tracker.waitFor((next) => next.optionsRevealedAt != null);
  const displayRevealing = await display.tracker.waitFor((next) => next.optionsRevealedAt != null);
  assert.equal(displayRevealing.optionsRevealedAt, revealing.optionsRevealedAt);
  assert.equal(revealing.optionRevealIntervalMs, 500);
  assert.equal(getVisibleOptionCount(revealing), 1);
  assert.equal((await emitAction(operator.socket, 'show_options', payload)).ok, false);
  assert.equal(operator.tracker.current.optionsRevealedAt, revealing.optionsRevealedAt);
  assert.equal((await emitAction(operator.socket, 'select_option', { optionId: question.options[0].id })).ok, false);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(getVisibleOptionCount(display.tracker.current), 2);
  operator.socket.close(); display.socket.close(); await stopServer(server.child);
  server = await startServer(options);
  operator = await connectSocket(server.baseUrl, { operatorToken });
  display = await connectSocket(server.baseUrl);
  await operator.tracker.waitFor((next) => next.sessionId === state.sessionId);
  await display.tracker.waitFor((next) => next.sessionId === state.sessionId);
  assert.equal(operator.tracker.current.optionsRevealedAt, revealing.optionsRevealedAt);
  assert.equal(display.tracker.current.optionsRevealedAt, revealing.optionsRevealedAt);
  await revealCurrentOptions(operator.socket, operator.tracker);
  assert.equal(getVisibleOptionCount(display.tracker.current), 4);
  assert.equal((await emitAction(operator.socket, 'select_option', { optionId: question.options[0].id })).ok, true);
  assert.equal((await emitAction(operator.socket, 'answer_back')).ok, true);
  assert.equal(operator.tracker.current.optionsRevealedAt, revealing.optionsRevealedAt);
  await answerCurrentLevel({ correct: true, correctAnswers: await loadCorrectAnswers(), operator: operator.socket, tracker: operator.tracker });
  assert.equal((await emitAction(operator.socket, 'continue_feedback', payload)).ok, false);
  const next = await operator.tracker.waitFor((entry) => entry.questionIndex === 1);
  const displayNext = await display.tracker.waitFor((entry) => entry.questionIndex === 1);
  assert.equal(next.optionsRevealedAt, null);
  assert.equal(displayNext.optionsRevealedAt, null);
  assert.equal((await emitAction(operator.socket, 'show_options', payload)).ok, false);
});

test('eight-level operator/display game flow, lifelines, outcomes, authorization, and recovery', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quiz-abbott-test-'));
  const stateFile = path.join(temporaryDirectory, 'game-state.json');
  const resultsFile = path.join(temporaryDirectory, 'results.csv');
  const sessionHistoryFile = path.join(temporaryDirectory, 'sessions.jsonl');
  const port = await getFreePort();
  const correctAnswers = await loadCorrectAnswers();
  let server = await startServer({ port, stateFile, resultsFile, sessionHistoryFile });
  let operatorConnection;
  let displayConnection;
  let unauthorizedConnection;

  t.after(async () => {
    operatorConnection?.socket.close();
    displayConnection?.socket.close();
    unauthorizedConnection?.socket.close();
    await stopServer(server.child);
  });

  unauthorizedConnection = await connectSocket(server.baseUrl);
  assert.deepEqual(await unauthorizedConnection.operatorAccess, { authorized: false });
  const unauthorizedStart = await emitAction(unauthorizedConnection.socket, 'start');
  assert.equal(unauthorizedStart.ok, false);
  assert.match(unauthorizedStart.message, /authorization/i);

  const unauthorizedHttp = await fetch(`${server.baseUrl}/api/operator/game`);
  assert.equal(unauthorizedHttp.status, 401);
  const unauthorizedHttpAction = await fetch(`${server.baseUrl}/api/operator/game/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start' }),
  });
  assert.equal(unauthorizedHttpAction.status, 401);
  const wrongTokenHttpAction = await fetch(`${server.baseUrl}/api/operator/game/action`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer definitely-not-the-operator-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'start' }),
  });
  assert.equal(wrongTokenHttpAction.status, 401);
  const invalidScore = await fetch(`${server.baseUrl}/api/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Invalid', email: 'invalid@example.test', score: 11 }),
  });
  assert.equal(invalidScore.status, 400);

  operatorConnection = await connectSocket(server.baseUrl, { operatorToken });
  assert.deepEqual(await operatorConnection.operatorAccess, { authorized: true });
  displayConnection = await connectSocket(server.baseUrl);
  const operator = operatorConnection.socket;
  const operatorTracker = operatorConnection.tracker;
  const displayTracker = displayConnection.tracker;
  await Promise.all([
    operatorTracker.waitFor((state) => state.status === 'idle'),
    displayTracker.waitFor((state) => state.status === 'idle'),
  ]);

  const httpHeaders = {
    authorization: `Bearer ${operatorToken}`,
    'content-type': 'application/json',
  };
  const httpStart = await fetch(`${server.baseUrl}/api/operator/game/action`, {
    method: 'POST',
    headers: httpHeaders,
    body: JSON.stringify({ action: 'start' }),
  });
  assert.equal(httpStart.status, 200);
  await Promise.all([
    operatorTracker.waitFor((next) => next.status === 'registering'),
    displayTracker.waitFor((next) => next.status === 'registering'),
  ]);
  const httpBack = await fetch(`${server.baseUrl}/api/operator/game/action`, {
    method: 'POST',
    headers: httpHeaders,
    body: JSON.stringify({ action: 'registration_back' }),
  });
  assert.equal(httpBack.status, 200);
  await Promise.all([
    operatorTracker.waitFor((next) => next.status === 'idle'),
    displayTracker.waitFor((next) => next.status === 'idle'),
  ]);

  let state = await startRun(operator, operatorTracker, 'Champion Test');
  await displayTracker.waitFor((next) => next.sessionId === state.sessionId && next.status === 'running');
  assert.equal(state.questions.length, 8);
  assert.deepEqual(state.questions.map((question) => question.level), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(state.questions.every((question) => question.options.length === 4));
  assert.ok(state.questions.every((question) => !('correctOptionId' in question)));
  assert.ok(state.questions.every((question) => !('explanation' in question)));

  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'audiencePoll' })).ok, true);
  await operatorTracker.waitFor((next) => next.activeLifeline === 'audiencePoll');
  assert.equal((await emitAction(operator, 'dismiss_lifeline')).ok, true);
  await operatorTracker.waitFor((next) => next.activeLifeline === null);
  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'audiencePoll' })).ok, false);

  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'phoneAFriend' })).ok, true);
  await operatorTracker.waitFor((next) => next.activeLifeline === 'phoneAFriend');
  assert.equal((await emitAction(operator, 'dismiss_lifeline')).ok, true);
  await operatorTracker.waitFor((next) => next.activeLifeline === null);
  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'phoneAFriend' })).ok, false);

  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'fiftyFifty' })).ok, true);
  state = await operatorTracker.waitFor((next) => next.eliminatedOptionIds.length === 2);
  assert.equal((await emitAction(operator, 'use_lifeline', { type: 'fiftyFifty' })).ok, false);
  const firstQuestion = state.questions[0];
  assert.ok(!state.eliminatedOptionIds.includes(correctAnswers.get(firstQuestion.id)));
  assert.equal(
    (await emitAction(operator, 'select_option', { optionId: state.eliminatedOptionIds[0] })).ok,
    false,
  );

  const firstCorrectOption = correctAnswers.get(firstQuestion.id);
  assert.equal((await emitAction(operator, 'select_option', { optionId: firstCorrectOption })).ok, true);
  await operatorTracker.waitFor((next) => next.phase === 'confirming');
  assert.equal((await emitAction(operator, 'answer_back')).ok, true);
  await operatorTracker.waitFor((next) => next.phase === 'answering' && next.selectedOption === null);
  assert.equal((await emitAction(operator, 'select_option', { optionId: firstCorrectOption })).ok, true);
  await operatorTracker.waitFor((next) => next.phase === 'confirming');
  const concurrentLocks = await Promise.all([
    emitAction(operator, 'lock_answer'),
    emitAction(operator, 'lock_answer'),
  ]);
  assert.equal(concurrentLocks.filter((result) => result.ok).length, 1);
  assert.equal(concurrentLocks.filter((result) => !result.ok).length, 1);
  await operatorTracker.waitFor((next) => next.questionIndex === 1 && next.phase === 'answering');

  for (let level = 2; level <= 8; level += 1) {
    const previousIndex = operatorTracker.current.questionIndex;
    await answerCurrentLevel({ correct: true, correctAnswers, operator, tracker: operatorTracker });
    if (level < 8) {
      await operatorTracker.waitFor((next) => (
        next.questionIndex === previousIndex + 1 && next.phase === 'answering'
      ));
    }
  }

  state = await operatorTracker.waitFor((next) => next.status === 'finished');
  const displayChampion = await displayTracker.waitFor((next) => next.status === 'finished');
  assert.deepEqual(state.outcome, { type: 'champion', awardedLevel: 8, failedLevel: null });
  assert.equal(state.completedLevel, 8);
  assert.equal(state.resultView, 'sequence');
  assert.equal(displayChampion.revision, state.revision);
  await operatorTracker.waitFor((next) => Boolean(next.resultSavedAt));

  assert.deepEqual(await emitAction(operator, 'show_leaderboard'), { ok: true });
  state = await operatorTracker.waitFor((next) => next.resultView === 'leaderboard');
  await displayTracker.waitFor((next) => next.resultView === 'leaderboard');

  assert.deepEqual(await emitAction(operator, 'hide_leaderboard'), { ok: true });
  state = await operatorTracker.waitFor((next) => next.resultView === 'sequence');
  await displayTracker.waitFor((next) => next.resultView === 'sequence');

  assert.deepEqual(await emitAction(operator, 'show_leaderboard'), { ok: true });
  await operatorTracker.waitFor((next) => next.resultView === 'leaderboard');
  await displayTracker.waitFor((next) => next.resultView === 'leaderboard');

  assert.equal((await emitAction(operator, 'restart')).ok, true);
  await operatorTracker.waitFor((next) => next.status === 'idle');
  await displayTracker.waitFor((next) => next.status === 'idle');
  await startRun(operator, operatorTracker, 'Early Exit');
  state = await playUntilOutcome({
    correctLevels: 0,
    correctAnswers,
    operator,
    tracker: operatorTracker,
  });
  assert.deepEqual(state.outcome, { type: 'eliminated', awardedLevel: 0, failedLevel: 1 });

  assert.equal((await emitAction(operator, 'restart')).ok, true);
  await operatorTracker.waitFor((next) => next.status === 'idle');
  await startRun(operator, operatorTracker, 'Level Four');
  state = await playUntilOutcome({
    correctLevels: 4,
    correctAnswers,
    operator,
    tracker: operatorTracker,
  });
  assert.deepEqual(state.outcome, { type: 'milestone', awardedLevel: 4, failedLevel: 5 });

  assert.equal((await emitAction(operator, 'restart')).ok, true);
  await operatorTracker.waitFor((next) => next.status === 'idle');
  await startRun(operator, operatorTracker, 'Level Seven');
  state = await playUntilOutcome({
    correctLevels: 7,
    correctAnswers,
    operator,
    tracker: operatorTracker,
  });
  assert.deepEqual(state.outcome, { type: 'milestone', awardedLevel: 7, failedLevel: 8 });

  assert.equal((await emitAction(operator, 'restart')).ok, true);
  await operatorTracker.waitFor((next) => next.status === 'idle');
  await startRun(operator, operatorTracker, 'Recovery Test');
  await answerCurrentLevel({ correct: true, correctAnswers, operator, tracker: operatorTracker });
  state = await operatorTracker.waitFor((next) => next.questionIndex === 1 && next.phase === 'answering');
  const restoredSessionId = state.sessionId;
  const restoredQuestions = state.questions;

  operator.close();
  displayConnection.socket.close();
  unauthorizedConnection.socket.close();
  await stopServer(server.child);
  server = await startServer({ port, stateFile, resultsFile, sessionHistoryFile });
  operatorConnection = await connectSocket(server.baseUrl, { operatorToken });
  displayConnection = await connectSocket(server.baseUrl);
  unauthorizedConnection = null;
  state = await operatorConnection.tracker.waitFor((next) => next.sessionId === restoredSessionId);
  assert.equal(state.status, 'running');
  assert.equal(state.questionIndex, 1);
  assert.equal(state.answers.length, 1);
  assert.deepEqual(state.questions, restoredQuestions, 'Restart must keep all selected questions and option orders');

  const publicResponse = await fetch(`${server.baseUrl}/api/game`);
  const publicState = await publicResponse.json();
  assert.equal(publicState.sessionId, restoredSessionId);
  assert.ok(publicState.questions.every((question) => !('correctOptionId' in question)));

  const publicResultsResponse = await fetch(`${server.baseUrl}/api/results`);
  assert.equal(publicResultsResponse.status, 200);
  const publicResults = await publicResultsResponse.json();
  assert.ok(publicResults.every((result) => !('email' in result)));

  const unsafeCsvResult = await fetch(`${server.baseUrl}/api/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '=HYPERLINK("https://example.test")', email: 'safe@example.test', score: 1 }),
  });
  assert.equal(unsafeCsvResult.status, 400);

  const resultsDeadline = Date.now() + 3000;
  let rows = [];
  while (Date.now() < resultsDeadline) {
    const csv = await readFile(resultsFile, 'utf8');
    rows = csv.trim().split(/\r?\n/);
    if (rows.length >= 5) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(rows.length, 5, 'Expected one header and four completed game results.');

  const sessionsResponse = await fetch(`${server.baseUrl}/api/operator/sessions`, {
    headers: { authorization: `Bearer ${operatorToken}` },
  });
  assert.equal(sessionsResponse.status, 200);
  const archivedSessions = await sessionsResponse.json();
  assert.equal(archivedSessions.length, 4);
  assert.ok(archivedSessions.every((session) => session.answers.length > 0));
});

test('locked answers stay coloured for two seconds, skip explanation, and then advance or end', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-colour-reveal-'));
  const server = await startServer({
    port: await getFreePort(),
    stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'),
    sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
    answerRevealDurationMs: null, // Exercise the real two-second production default.
  });
  const operator = await connectSocket(server.baseUrl, { operatorToken });
  const display = await connectSocket(server.baseUrl);
  t.after(async () => {
    operator.socket.close();
    display.socket.close();
    await stopServer(server.child);
  });
  const phases = [];
  display.socket.on('quiz_state', state => phases.push(state.phase));
  const correctAnswers = await loadCorrectAnswers();
  await startRun(operator.socket, operator.tracker, 'Colour Reveal');

  for (const correct of [true, false]) {
    await answerCurrentLevel({ correct, correctAnswers, operator: operator.socket, tracker: operator.tracker });
    const locked = operator.tracker.current;
    const questionIndex = locked.questionIndex;
    const displayLocked = await display.tracker.waitFor(state => state.phase === 'locked' && state.questionIndex === questionIndex);
    assert.equal(locked.feedbackEndsAt - Date.parse(locked.answers.at(-1).lockedAt), 2000);
    assert.equal(displayLocked.feedbackEndsAt, locked.feedbackEndsAt);
    assert.equal(locked.questions[questionIndex].correctOptionIds.includes(locked.selectedOption), correct);
    assert.equal(displayLocked.questions[questionIndex].correctOptionIds.includes(displayLocked.selectedOption), correct);
    const payload = { sessionId: locked.sessionId, questionId: locked.questions[questionIndex].id };
    assert.equal((await emitAction(operator.socket, 'continue_feedback', payload)).ok, false);
    assert.equal((await emitAction(operator.socket, 'lock_answer')).ok, false);
    assert.equal((await emitAction(operator.socket, 'answer_back')).ok, false);
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(operator.tracker.current.phase, 'locked');
    assert.equal(display.tracker.current.phase, 'locked');
    const done = correct
      ? state => state.phase === 'answering' && state.questionIndex === questionIndex + 1
      : state => state.status === 'finished' && state.outcome.type === 'eliminated';
    const next = await operator.tracker.waitFor(done, 1500);
    await display.tracker.waitFor(done, 1500);
    assert.ok(Date.now() >= locked.feedbackEndsAt, 'Must not advance before the colour reveal ends');
    if (correct) assert.equal(next.optionsRevealedAt, null);
    else {
      assert.equal(next.completedLevel, 1);
      assert.equal(next.answers.length, 2);
    }
  }
  assert.ok(!phases.includes('feedback'), 'Never enter the old explanation-popup phase');
});

test('recovers confirming and locked phases without operator/display divergence', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'quiz-abbott-recovery-test-'));
  const stateFile = path.join(temporaryDirectory, 'game-state.json');
  const resultsFile = path.join(temporaryDirectory, 'results.csv');
  const sessionHistoryFile = path.join(temporaryDirectory, 'sessions.jsonl');
  const port = await getFreePort();
  const correctAnswers = await loadCorrectAnswers();
  const serverOptions = {
    port,
    stateFile,
    resultsFile,
    sessionHistoryFile,
    answerRevealDurationMs: 1500,
  };
  let server = await startServer(serverOptions);
  let operatorConnection = await connectSocket(server.baseUrl, { operatorToken });
  let displayConnection = await connectSocket(server.baseUrl);

  t.after(async () => {
    operatorConnection?.socket.close();
    displayConnection?.socket.close();
    await stopServer(server.child);
  });

  await startRun(operatorConnection.socket, operatorConnection.tracker, 'Phase Recovery');
  const question = operatorConnection.tracker.current.questions[0];
  const optionId = correctAnswers.get(question.id);
  assert.equal((await emitAction(operatorConnection.socket, 'select_option', { optionId })).ok, true);
  let state = await operatorConnection.tracker.waitFor((next) => next.phase === 'confirming');
  const sessionId = state.sessionId;
  const pausedRemainingMs = state.questionRemainingMs;
  assert.equal(state.questionDeadline, null);

  operatorConnection.socket.close();
  displayConnection.socket.close();
  await stopServer(server.child);
  server = await startServer(serverOptions);
  operatorConnection = await connectSocket(server.baseUrl, { operatorToken });
  displayConnection = await connectSocket(server.baseUrl);
  state = await operatorConnection.tracker.waitFor((next) => next.sessionId === sessionId);
  assert.equal(state.phase, 'confirming');
  assert.equal(state.selectedOption, optionId);
  assert.equal(state.questionRemainingMs, pausedRemainingMs);
  assert.equal(state.questionDeadline, null);
  const confirmingDisplay = await displayConnection.tracker.waitFor((next) => next.sessionId === sessionId);
  assert.equal(confirmingDisplay.revision, state.revision);

  assert.equal((await emitAction(operatorConnection.socket, 'lock_answer')).ok, true);
  state = await operatorConnection.tracker.waitFor((next) => next.phase === 'locked');
  assert.equal(state.answers.length, 1);
  assert.deepEqual(state.questions[0].correctOptionIds, [optionId]);
  assert.equal(state.feedbackVisible, false);
  assert.ok(!('explanation' in state.questions[0]));
  const lockedDisplay = await displayConnection.tracker.waitFor((next) => next.phase === 'locked');
  assert.deepEqual(lockedDisplay.questions[0].correctOptionIds, [optionId]);
  assert.equal(state.feedbackRevealAt, null);
  assert.equal(state.feedbackEndsAt - Date.parse(state.answers.at(-1).lockedAt), serverOptions.answerRevealDurationMs);

  operatorConnection.socket.close();
  displayConnection.socket.close();
  await stopServer(server.child);
  // Simulate a saved session from the former explanation-popup flow.
  const legacyFeedback = JSON.parse(await readFile(stateFile, 'utf8'));
  legacyFeedback.phase = 'feedback';
  legacyFeedback.feedbackVisible = true;
  legacyFeedback.feedbackEndsAt = Date.now() + 12000;
  await writeFile(stateFile, JSON.stringify(legacyFeedback));
  server = await startServer(serverOptions);
  operatorConnection = await connectSocket(server.baseUrl, { operatorToken });
  displayConnection = await connectSocket(server.baseUrl);

  state = await operatorConnection.tracker.waitFor((next) => (
    next.sessionId === sessionId && next.questionIndex === 1 && next.phase === 'answering'
  ), 5000);
  const recoveredDisplay = await displayConnection.tracker.waitFor((next) => (
    next.sessionId === sessionId && next.questionIndex === 1 && next.phase === 'answering'
  ), 5000);
  assert.equal(state.answers.length, 1);
  assert.equal(recoveredDisplay.revision, state.revision);
});

test('questions and confirmation have no deadline, survive restart, and answer help stays private', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-untimed-test-'));
  const options = {
    port: await getFreePort(),
    stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'),
    sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
    questionDurationMs: 1000,
  };
  let server = await startServer(options);
  let operator = await connectSocket(server.baseUrl, { operatorToken });
  let display = await connectSocket(server.baseUrl);
  t.after(async () => {
    operator.socket.close();
    display.socket.close();
    await stopServer(server.child);
  });

  const initial = await startRun(operator.socket, operator.tracker, 'Untimed Player');
  const question = initial.questions[0];
  const payload = { sessionId: initial.sessionId, questionId: question.id };
  assert.equal(initial.questionRemainingMs, null);
  assert.equal(initial.questionDeadline, null);
  const correctAnswers = await loadCorrectAnswers();
  const privateAnswer = await emitAction(operator.socket, 'get_operator_answer', payload);
  assert.deepEqual(privateAnswer.correctOptionIds, [correctAnswers.get(question.id)]);
  assert.equal((await emitAction(display.socket, 'get_operator_answer', payload)).ok, false);
  assert.equal((await emitAction(operator.socket, 'get_operator_answer', { ...payload, questionId: 'stale' })).ok, false);
  const publicState = await (await fetch(`${server.baseUrl}/api/game`)).json();
  assert.equal(publicState.revision, initial.revision, 'Private help must not mutate or pause the game');
  assert.equal(publicState.questionDeadline, initial.questionDeadline);
  assert.ok(publicState.questions.every((entry) => !entry.correctOptionIds && !entry.correctOptionId));
  await display.tracker.waitFor((state) => state.sessionId === initial.sessionId);
  assert.ok(display.tracker.current.questions.every((entry) => !entry.correctOptionIds));

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(operator.tracker.current.phase, 'answering');
  assert.equal((await emitAction(operator.socket, 'select_option', { optionId: question.options[0].id })).ok, true);
  const paused = await operator.tracker.waitFor((state) => state.phase === 'confirming');
  assert.equal(paused.questionDeadline, null);
  assert.equal(paused.questionRemainingMs, null);
  operator.socket.close();
  display.socket.close();
  await stopServer(server.child);
  server = await startServer(options);
  operator = await connectSocket(server.baseUrl, { operatorToken });
  display = await connectSocket(server.baseUrl);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const restored = await operator.tracker.waitFor((state) => state.sessionId === initial.sessionId);
  assert.equal(restored.phase, 'confirming', 'Confirmation must not have a time limit');
  assert.equal(restored.questionRemainingMs, paused.questionRemainingMs);
  assert.equal(restored.questionDeadline, null);

  assert.equal((await emitAction(operator.socket, 'answer_back')).ok, true);
  const resumed = await operator.tracker.waitFor((state) => state.phase === 'answering');
  assert.equal(resumed.questionDeadline, null);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(operator.tracker.current.status, 'running');
  assert.equal(operator.tracker.current.answers.length, 0);
  assert.equal((await emitAction(operator.socket, 'use_lifeline', { type: 'audiencePoll' })).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await emitAction(operator.socket, 'dismiss_lifeline')).ok, true);
  assert.equal((await emitAction(operator.socket, 'select_option', { optionId: correctAnswers.get(question.id) })).ok, true);
  assert.equal((await emitAction(operator.socket, 'lock_answer')).ok, true);
  const next = await operator.tracker.waitFor((state) => state.questionIndex === 1);
  assert.equal(next.questionDeadline, null);
  assert.equal(next.questionRemainingMs, null);
  const displayNext = await display.tracker.waitFor((state) => state.questionIndex === 1);
  assert.equal(displayNext.phase, 'answering');
});

test('saved games with expired legacy deadlines resume without ending at any milestone', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-untimed-migration-'));
  const options = {
    port: await getFreePort(),
    stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'),
    sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
    questionDurationMs: 1000,
  };
  let server = await startServer(options);
  let operator = await connectSocket(server.baseUrl, { operatorToken });
  t.after(async () => { operator.socket.close(); await stopServer(server.child); });
  const correctAnswers = await loadCorrectAnswers();

  for (const completedLevels of [0, 4, 7]) {
    await startRun(operator.socket, operator.tracker, `Saved Level ${completedLevels}`);
    for (let index = 0; index < completedLevels; index += 1) {
      await answerCurrentLevel({ correct: true, correctAnswers, operator: operator.socket, tracker: operator.tracker });
      await operator.tracker.waitFor((state) => state.phase === 'answering' && state.questionIndex === index + 1);
    }
    const state = operator.tracker.current;
    // Persist a deadline from the old version, already more than 45 seconds overdue.
    await new Promise((resolve) => setTimeout(resolve, 100));
    operator.socket.close();
    await stopServer(server.child);
    const saved = JSON.parse(await readFile(options.stateFile, 'utf8'));
    saved.questionStartedAt = Date.now() - 90000;
    saved.questionDeadline = Date.now() - 45000;
    saved.questionRemainingMs = 0;
    delete saved.optionsRevealedAt;
    delete saved.optionRevealIntervalMs;
    await writeFile(options.stateFile, JSON.stringify(saved));
    server = await startServer(options);
    operator = await connectSocket(server.baseUrl, { operatorToken });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const restored = operator.tracker.current;
    assert.equal(restored.sessionId, state.sessionId);
    assert.equal(restored.status, 'running');
    assert.equal(restored.phase, 'answering');
    assert.equal(restored.questionIndex, completedLevels);
    assert.equal(restored.questionDeadline, null);
    assert.equal(restored.questionRemainingMs, null);
    assert.equal(restored.optionsRevealedAt, null, 'Old unanswered sessions must offer Show options');
    assert.equal(restored.answers.length, completedLevels);
    await answerCurrentLevel({ correct: false, correctAnswers, operator: operator.socket, tracker: operator.tracker });
    await operator.tracker.waitFor((next) => next.status === 'finished');
    assert.equal((await emitAction(operator.socket, 'restart')).ok, true);
  }
});

test('wrong answers show participation for levels 1–3 and congratulations for levels 4–7 on both screens', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-exact-levels-'));
  const server = await startServer({
    port: await getFreePort(),
    stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'),
    sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
  });
  const operator = await connectSocket(server.baseUrl, { operatorToken });
  const display = await connectSocket(server.baseUrl);
  t.after(async () => {
    operator.socket.close();
    display.socket.close();
    await stopServer(server.child);
  });
  const correctAnswers = await loadCorrectAnswers();
  for (let completedLevel = 1; completedLevel <= 7; completedLevel += 1) {
    const initial = await startRun(operator.socket, operator.tracker, `Completed ${completedLevel}`);
    const result = await playUntilOutcome({
      correctLevels: completedLevel, correctAnswers, operator: operator.socket, tracker: operator.tracker,
    });
    assert.deepEqual(result.outcome, {
      type: completedLevel >= 4 ? 'milestone' : 'eliminated',
      awardedLevel: completedLevel >= 4 ? completedLevel : 0,
      failedLevel: completedLevel + 1,
    });
    assert.equal(result.completedLevel, completedLevel);
    const displayed = await display.tracker.waitFor((state) => state.sessionId === initial.sessionId && state.status === 'finished');
    assert.deepEqual(displayed.outcome, result.outcome);
    assert.equal((await emitAction(operator.socket, 'restart')).ok, true);
  }
});

test('default and explicit CSV modes save locally without contacting configured Supabase', async (t) => {
  let cloudRequests = 0;
  const database = createHttpServer((req, res) => {
    cloudRequests += 1;
    res.writeHead(503);
    res.end('{}');
  });
  t.after(() => new Promise((resolve) => database.close(resolve)));
  await new Promise((resolve) => database.listen(0, '127.0.0.1', resolve));

  for (const resultsStorage of ['', 'csv']) {
    await t.test(resultsStorage || 'default storage', async (t) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-offline-test-'));
      const options = {
        port: await getFreePort(), stateFile: path.join(directory, 'state.json'),
        resultsFile: path.join(directory, 'results.csv'),
        sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
        resultsStorage, supabaseTestUrl: `http://127.0.0.1:${database.address().port}`,
      };
      let server = await startServer(options);
      t.after(async () => { await stopServer(server.child); });
      assert.deepEqual(await (await fetch(`${server.baseUrl}/api/results`)).json(), []);
      const player = { name: 'Local, "Player"', email: 'offline@example.test', score: 7 };
      const saved = await fetch(`${server.baseUrl}/api/results`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(player),
      });
      assert.equal(saved.status, 201);
      const result = await saved.json();
      assert.equal(result.name, player.name);
      assert.equal(result.email, player.email);
      assert.equal(result.score, player.score);
      assert.ok(result.entryId);
      assert.ok(result.completedAt);
      const csv = await readFile(options.resultsFile, 'utf8');
      assert.ok(csv.startsWith('entryId,name,email,score,completedAt\n'));
      assert.ok(csv.includes('"Local, ""Player""",offline@example.test,7,'));

      await stopServer(server.child);
      server = await startServer(options);
      const leaderboard = await (await fetch(`${server.baseUrl}/api/results`)).json();
      assert.deepEqual(leaderboard, [{
        entryId: result.entryId, name: player.name, score: player.score,
        completedAt: result.completedAt,
      }]);
      assert.equal(await readFile(options.resultsFile, 'utf8'), csv);
      assert.match(server.getOutput(), /Supabase disabled/);
      assert.equal(cloudRequests, 0, 'CSV reads and writes must never contact Supabase');
    });
  }
});

test('Supabase leaderboard starts empty, ranks new players, and recovers failed uploads without CSV fallback', async (t) => {
  const rows = [];
  let unavailable = false;
  const database = createHttpServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (unavailable) { res.writeHead(503); res.end(JSON.stringify({ message: 'Test outage' })); return; }
    if (req.headers.apikey !== 'isolated-test-key') { res.writeHead(401); res.end('{}'); return; }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/rest/v1/ABBOTT_QUIZ') { res.writeHead(404); res.end('{}'); return; }
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const row = { ...body, id: rows.length + 1 };
      rows.push(row);
      res.writeHead(201);
      res.end(JSON.stringify([row]));
      return;
    }
    const email = url.searchParams.get('email')?.slice(3);
    const sorted = rows.filter((row) => !email || row.email === email)
      .sort((a, b) => b.score - a.score || Date.parse(a.created_at) - Date.parse(b.created_at));
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    res.end(JSON.stringify(sorted.slice(offset, offset + limit)));
  });
  await new Promise((resolve) => database.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quiz-supabase-test-'));
  const options = {
    port: await getFreePort(), stateFile: path.join(directory, 'state.json'),
    resultsFile: path.join(directory, 'results.csv'), sessionHistoryFile: path.join(directory, 'sessions.jsonl'),
    resultsStorage: 'supabase', supabaseTestUrl: `http://127.0.0.1:${database.address().port}`,
  };
  let server = await startServer(options);
  let operator;
  t.after(async () => {
    operator?.socket.close();
    await stopServer(server.child);
    await new Promise((resolve) => database.close(resolve));
  });
  const getResults = async () => (await fetch(`${server.baseUrl}/api/results`)).json();
  assert.deepEqual(await getResults(), []);
  for (const [name, score] of [['First Player', 4], ['Highest Player', 8], ['Third Player', 6]]) {
    const response = await fetch(`${server.baseUrl}/api/results`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score, email: `${name.replaceAll(' ', '')}@example.test` }),
    });
    assert.equal(response.status, 201);
  }
  const leaderboard = await getResults();
  assert.deepEqual(leaderboard.map((row) => row.score), [8, 6, 4]);
  assert.equal(leaderboard[0].name, 'Highest Player');
  assert.ok(leaderboard.every((row) => !('email' in row)));
  unavailable = true;
  assert.equal((await fetch(`${server.baseUrl}/api/results`)).status, 500, 'Must not silently return local data');

  operator = await connectSocket(server.baseUrl, { operatorToken });
  await startRun(operator.socket, operator.tracker, 'Queued Player');
  await answerCurrentLevel({ correct: false, correctAnswers: await loadCorrectAnswers(), operator: operator.socket, tracker: operator.tracker });
  const finished = await operator.tracker.waitFor((state) => state.status === 'finished');
  const outboxFile = path.join(directory, 'pending-results.json');
  let queued = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    queued = await readFile(outboxFile, 'utf8').then(JSON.parse).catch(() => []);
    if (queued.length) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(queued[0][0], finished.sessionId);
  assert.equal(operator.tracker.current.resultSavedAt, null);
  await assert.rejects(readFile(options.resultsFile), { code: 'ENOENT' });
  operator.socket.close();
  await stopServer(server.child);
  unavailable = false;
  server = await startServer(options);
  operator = await connectSocket(server.baseUrl, { operatorToken });
  await operator.tracker.waitFor((state) => Boolean(state.resultSavedAt));
  assert.deepEqual(JSON.parse(await readFile(outboxFile, 'utf8')), []);
  assert.equal(rows.filter((row) => row.name === 'Queued Player').length, 1);
  assert.equal((await getResults()).length, 4);
  await assert.rejects(readFile(options.resultsFile), { code: 'ENOENT' });
});

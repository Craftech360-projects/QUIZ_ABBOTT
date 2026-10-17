import { useCallback, useEffect, useRef, useState } from 'react';
import { quizConfig } from '../data/questions.js';
import { getSortedLeaderboard } from '../utils/storage.js';
import { getVisibleOptionCount } from '../utils/optionReveal.js';

const PUBLIC_ASSET_ROOT = '/';
const CONFIRMATION_DIALOG_DELAY_MS = 1000;

export const FIGMA_ASSETS = {
  start: `${PUBLIC_ASSET_ROOT}Start Screen.png`,
  question: `${PUBLIC_ASSET_ROOT}base.png`,
  correct: `${PUBLIC_ASSET_ROOT}Frame 2.png`,
  selected: `${PUBLIC_ASSET_ROOT}Frame 3.png`,
  wrong: `${PUBLIC_ASSET_ROOT}Frame 4.png`,
  confirm: `${PUBLIC_ASSET_ROOT}Frame 5.png`,
  levelCelebration: `${PUBLIC_ASSET_ROOT}congratulations.png`,
  levelLabel: `${PUBLIC_ASSET_ROOT}LEVEL.png`,
  participationLabel: `${PUBLIC_ASSET_ROOT}Layer 1.png`,
  champion: `${PUBLIC_ASSET_ROOT}Frame 8.png`,
  participation: `${PUBLIC_ASSET_ROOT}Frame 9.png`,
  registration: `${PUBLIC_ASSET_ROOT}Frame 10.png`,
  explanation: `${PUBLIC_ASSET_ROOT}Frame 11.png`,
  leaderboard: `${PUBLIC_ASSET_ROOT}Frame 12.png`,
  eliminated: `${PUBLIC_ASSET_ROOT}Frame 13.png`,
};

export const FIGMA_ASSET_URLS = Object.values(FIGMA_ASSETS);

function ReferenceLayer({ src }) {
  return (
    <img
      aria-hidden="true"
      className="event-reference-layer"
      decoding="async"
      draggable="false"
      fetchPriority="high"
      loading="eager"
      src={src}
      alt=""
    />
  );
}

export function EventLoadingView({ message = 'Connecting to the quiz…' }) {
  return (
    <section className="event-screen event-static-screen" aria-live="polite">
      <ReferenceLayer src={FIGMA_ASSETS.start} />
      <div className="event-connection-card">{message}</div>
    </section>
  );
}

export function EventStartView({ disabled = true, error = '', onStart }) {
  const isInteractive = typeof onStart === 'function';

  return (
    <section className="event-screen event-static-screen" aria-label="Urban Mobility Challenge">
      <ReferenceLayer src={FIGMA_ASSETS.start} />
      {isInteractive && (
        <button
          aria-label="Start game"
          className="event-start-hotspot"
          disabled={disabled}
          onClick={onStart}
          type="button"
        >
          <span>Start game</span>
        </button>
      )}
      {error && <div className="event-error-toast" role="alert">{error}</div>}
    </section>
  );
}

function OperatorAnswerHelp({ disabled, question, remainingOptions, requestAnswer, sessionId }) {
  const [open, setOpen] = useState(false);
  const [answerIds, setAnswerIds] = useState(null);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => () => { requestVersion.current += 1; }, []);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  function close() {
    requestVersion.current += 1;
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function showAnswer() {
    const version = ++requestVersion.current;
    setOpen(true);
    setAnswerIds(null);
    setError('');
    try {
      const result = await requestAnswer({ sessionId, questionId: question.id });
      if (version !== requestVersion.current) return;
      setAnswerIds(result.correctOptionIds);
    } catch (loadError) {
      if (version === requestVersion.current) setError(loadError.message);
    }
  }

  const answer = question.options.find((option) => answerIds?.includes(option.id));
  const letter = String.fromCharCode(65 + remainingOptions.findIndex((option) => option.id === answer?.id));

  return (
    <>
      <button className="event-answer-help-trigger" type="button" ref={triggerRef}
        aria-label="Show correct answer (operator only)" disabled={disabled} onClick={showAnswer}>?</button>
      {open && (
        <div className="event-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="event-dialog event-answer-help-dialog" role="dialog" aria-modal="true"
            aria-label="Correct answer — operator only" onKeyDown={(event) => {
              if (event.key === 'Escape') close();
              if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
            }}>
            <button className="event-answer-help-close" type="button" aria-label="Close answer" ref={closeRef} onClick={close}>×</button>
            <div aria-live="polite">
              {answer ? <>
                <h2>{letter}. {answer.text}</h2>
                {answer.image && <img className="event-feedback-image" src={answer.image} alt={answer.text} />}
              </> : <h2>{error || 'Loading answer…'}</h2>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LevelLadder({ currentLevel, totalLevels }) {
  const levels = Array.from({ length: totalLevels }, (_, index) => totalLevels - index);

  return (
    <aside className="event-level-ladder" aria-label={`Current level ${currentLevel}`}>
      {levels.map((level) => {
        const classNames = ['event-level'];
        if (quizConfig.safeLevels.includes(level) || level === totalLevels) classNames.push('milestone');
        if (level === currentLevel) classNames.push('current');
        if (level < currentLevel) classNames.push('completed');
        return <div className={classNames.join(' ')} key={level}>Level - {level}</div>;
      })}
    </aside>
  );
}

const LIFELINES = [
  { label: 'Car Pool', type: 'audiencePoll' },
  { label: 'Bike Share', type: 'phoneAFriend' },
  { label: 'Solar Boost', type: 'fiftyFifty' },
];

function LifelineIcon({ type }) {
  if (type === 'fiftyFifty') {
    return <span className="event-lifeline-ratio" aria-hidden="true">50:50</span>;
  }

  if (type === 'phoneAFriend') {
    return (
      <svg aria-hidden="true" className="event-lifeline-icon" viewBox="0 0 32 32">
        <path d="M9.2 4.8 13 4l2.2 6-2.7 2.1a18.8 18.8 0 0 0 7.4 7.4L22 16.8l6 2.2-.8 3.8c-.4 2-2.2 3.4-4.3 3.2C13.8 25.1 6.9 18.2 6 9.1 5.8 7 7.2 5.2 9.2 4.8Z" />
        <path d="M20 6.8c2.8.6 4.6 2.4 5.2 5.2M20.6 2.7c4.6.9 7.8 4.1 8.7 8.7" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="event-lifeline-icon" viewBox="0 0 40 32">
      <circle cx="20" cy="8" r="5" />
      <circle cx="8.5" cy="11" r="4" />
      <circle cx="31.5" cy="11" r="4" />
      <path d="M12 27v-6.5c0-4.1 3.6-7.5 8-7.5s8 3.4 8 7.5V27H12Z" />
      <path d="M2.5 26v-5c0-3.2 2.7-5.8 6-5.8 1.8 0 3.4.7 4.5 1.8M37.5 26v-5c0-3.2-2.7-5.8-6-5.8-1.8 0-3.4.7-4.5 1.8" />
    </svg>
  );
}

function useVisibleOptionCount(quizState) {
  const [now, setNow] = useState(Date.now);
  const { optionsRevealedAt, questionIndex, sessionId, clockOffsetMs = 0 } = quizState;
  const optionCount = quizState.questions[questionIndex].options.length;
  const interval = quizState.optionRevealIntervalMs;

  useEffect(() => {
    setNow(Date.now());
    if (optionsRevealedAt == null) return undefined;
    const update = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (getVisibleOptionCount(quizState, currentTime + clockOffsetMs) >= optionCount) {
        window.clearInterval(timerId);
      }
    };
    const timerId = window.setInterval(update, 50);
    update();
    return () => window.clearInterval(timerId);
  }, [optionsRevealedAt, questionIndex, sessionId, clockOffsetMs, interval, optionCount]);

  return getVisibleOptionCount(quizState, now + clockOffsetMs);
}

export function EventQuestionView({
  dismissLifeline,
  error = '',
  goBack,
  interactive = false,
  isConnected = true,
  isPending = false,
  lockAnswer,
  quizState,
  requestOperatorAnswer,
  selectOption,
  showOptions,
  useLifeline,
}) {
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const question = quizState.questions[quizState.questionIndex];
  const correctOptionIds = question.correctOptionIds || [];
  const eliminatedOptionIds = quizState.eliminatedOptionIds || [];
  const remainingOptions = question.options.filter((option) => !eliminatedOptionIds.includes(option.id));
  const answerIsRevealed = ['locked', 'feedback'].includes(quizState.phase);
  const controlsDisabled = !interactive || !isConnected || isPending;
  const visibleOptionCount = useVisibleOptionCount(quizState);
  const allOptionsVisible = visibleOptionCount === question.options.length;

  useEffect(() => {
    if (!interactive || quizState.phase !== 'confirming') {
      setShowConfirmationDialog(false);
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setShowConfirmationDialog(true);
    }, CONFIRMATION_DIALOG_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [interactive, quizState.phase, quizState.questionIndex, quizState.selectedOption]);

  function optionClassName(option) {
    const classes = ['event-option'];
    const selected = quizState.selectedOption === option.id;
    const correct = correctOptionIds.includes(option.id);

    if (selected && !answerIsRevealed) classes.push('selected');
    if (eliminatedOptionIds.includes(option.id)) classes.push('eliminated');
    else if (eliminatedOptionIds.length > 0) classes.push('lifeline-remaining');
    if (answerIsRevealed && selected && correct) classes.push('correct');
    if (answerIsRevealed && selected && !correct) classes.push('wrong');
    if (option.image) classes.push('image-option');
    return classes.join(' ');
  }

  return (
    <section className="event-screen event-game-screen" aria-label={`Level ${quizState.questionIndex + 1}`}>
      <ReferenceLayer src={FIGMA_ASSETS.question} />

      <div className="event-question-panel" key={`question-${question.id}`}>
        <h1>{question.text}</h1>
      </div>

      <div className="event-options-grid" aria-label="Answer options" key={`options-${question.id}`}>
        {interactive && quizState.phase === 'answering' && quizState.optionsRevealedAt == null && (
          <button className="event-show-options" type="button" disabled={controlsDisabled} onClick={showOptions}>
            Show options
          </button>
        )}
        {question.options.slice(0, visibleOptionCount).map((option, index) => {
          const remainingIndex = remainingOptions.findIndex((remaining) => remaining.id === option.id);
          const eliminated = remainingIndex === -1;
          return (
          <button
            aria-hidden={eliminated || undefined}
            className={optionClassName(option)}
            disabled={
              controlsDisabled
              || !allOptionsVisible
              || quizState.phase !== 'answering'
              || Boolean(quizState.activeLifeline)
              || eliminatedOptionIds.includes(option.id)
            }
            key={option.id}
            onClick={() => selectOption?.(option.id)}
            style={{
              '--option-column': index % 2,
              '--option-row': Math.floor(index / 2),
              '--shift-columns': index % 2 - Math.max(0, remainingIndex) % 2,
              '--shift-rows': Math.floor(index / 2) - Math.floor(Math.max(0, remainingIndex) / 2),
            }}
            type="button"
          >
            <span className="event-option-letter">{String.fromCharCode(65 + (eliminated ? index : remainingIndex))}</span>
            {option.image
              ? <img src={option.image} alt={option.text} decoding="async" />
              : <strong>{option.text}</strong>}
          </button>
          );
        })}
      </div>

      <div className="event-lifelines" aria-label="Lifelines">
        {LIFELINES.map(({ label, type }) => {
          const used = Boolean(quizState.lifelines?.[type]?.used);
          return (
            <button
              className={used ? 'used' : ''}
              disabled={
                controlsDisabled
                || !allOptionsVisible
                || quizState.phase !== 'answering'
                || Boolean(quizState.activeLifeline)
                || used
              }
              key={type}
              onClick={() => useLifeline?.(type)}
              type="button"
            >
              <LifelineIcon type={type} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <LevelLadder
        currentLevel={quizState.questionIndex + 1}
        totalLevels={quizState.questions.length}
      />

      {interactive && isConnected && quizState.phase === 'answering' && (
        <OperatorAnswerHelp key={`${quizState.sessionId}-${question.id}`} disabled={controlsDisabled || !allOptionsVisible || Boolean(quizState.activeLifeline)}
          question={question} remainingOptions={remainingOptions} requestAnswer={requestOperatorAnswer} sessionId={quizState.sessionId} />
      )}

      {quizState.phase === 'confirming' && interactive && showConfirmationDialog && (
        <div className="event-modal-backdrop">
          <div className="event-dialog event-confirm-dialog" role="dialog" aria-modal="true" aria-label="Lock your answer">
            <h2>Lock your answer?</h2>
            <div className="event-dialog-actions">
              <button disabled={isPending} onClick={lockAnswer} type="button">Lock Answer</button>
              <button className="secondary" disabled={isPending} onClick={goBack} type="button">Go Back</button>
            </div>
          </div>
        </div>
      )}

      {quizState.activeLifeline && (
        <div className="event-lifeline-dialog" role="status">
          <strong>{LIFELINES.find(({ type }) => type === quizState.activeLifeline)?.label}</strong>
          <span>Use this lifeline now, then continue the question.</span>
          {interactive && (
            <button disabled={isPending} onClick={dismissLifeline} type="button">Done</button>
          )}
        </div>
      )}

      {!isConnected && <div className="event-status-toast">Reconnecting…</div>}
      {error && <div className="event-error-toast" role="alert">{error}</div>}
    </section>
  );
}

const LEVEL_CELEBRATION_MS = 6500;
const CHAMPION_CELEBRATION_MS = 6000;

function useResultStage(quizState) {
  const completedAt = Date.parse(quizState.completedAt || '') || Date.now();
  // completedAt is issued by the quiz server.  Use the socket's measured clock
  // offset so the operator and audience move from the celebration to the end
  // actions together, even when their device clocks differ.
  const clockOffsetMs = Number(quizState.clockOffsetMs) || 0;
  const getElapsed = () => Math.max(0, Date.now() + clockOffsetMs - completedAt);
  const [elapsed, setElapsed] = useState(getElapsed);

  useEffect(() => {
    if (quizState.resultView === 'leaderboard') return undefined;

    const update = () => setElapsed(getElapsed());
    update();
    const timerId = window.setInterval(update, 250);
    return () => window.clearInterval(timerId);
  }, [completedAt, clockOffsetMs, quizState.resultView]);

  if (quizState.resultView === 'leaderboard') return 'leaderboard';
  if (quizState.outcome?.type === 'champion') {
    return elapsed < CHAMPION_CELEBRATION_MS ? 'champion' : 'menu';
  }
  if (Number(quizState.completedLevel) >= 4) {
    return elapsed < LEVEL_CELEBRATION_MS ? 'level' : 'menu';
  }
  if (elapsed < LEVEL_CELEBRATION_MS) return 'eliminated';
  return 'menu';
}

function EventLeaderboardView({ disabled, onHome, quizState }) {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const loadLeaderboard = useCallback(async () => {
    try {
      setError('');
      setEntries(await getSortedLeaderboard());
    } catch (loadError) {
      setEntries([]);
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
    const timerId = window.setInterval(loadLeaderboard, 5000);
    return () => window.clearInterval(timerId);
  }, [loadLeaderboard]);

  const rows = entries.slice(0, 10);

  return (
    <section className="event-screen event-leaderboard-screen" aria-label="Leaderboard">
      <ReferenceLayer src={FIGMA_ASSETS.leaderboard} />
      <h1 className="event-leaderboard-title">Leaderboard</h1>
      <div className="event-leaderboard-board" role="table" aria-label="Top 10 players">
        <div className="event-leaderboard-head" role="row">
          <span role="columnheader">RANK</span>
          <span role="columnheader">PLAYER NAME</span>
          <span role="columnheader">LEVELS COMPLETED</span>
          <span role="columnheader">SCORE</span>
        </div>
        <div className="event-leaderboard-rows">
          {rows.length === 0 && <div className="event-leaderboard-empty" role="status">
            {error ? 'Unable to load results. Reconnecting…' : isLoading ? 'Loading results…' : 'No players yet. Completed games will appear here.'}
          </div>}
          {rows.map((entry, index) => {
            const isCurrentPlayer = entry?.name === quizState.playerName;
            return (
              <div className={`event-leaderboard-row ${isCurrentPlayer ? 'current-player' : ''}`} key={entry?.entryId || `empty-${index}`} role="row">
                <span role="cell">{String(index + 1).padStart(2, '0')}</span>
                <span role="cell">{entry.name}</span>
                <span role="cell">{`Level ${entry.score}`}</span>
                <span role="cell">{entry.score * 10}</span>
              </div>
            );
          })}
        </div>
      </div>
      <button
        className="event-leaderboard-home"
        disabled={disabled || !onHome}
        onClick={onHome}
        type="button"
        aria-label="Home — return to start page"
      >
        Home
      </button>
      {error && <div className="event-error-toast" role="alert">{error}</div>}
    </section>
  );
}

export function EventResultView({
  disabled = false,
  onRestart,
  onShowLeaderboard,
  quizState,
}) {
  const interactive = typeof onRestart === 'function';
  const stage = useResultStage(quizState);
  const completedLevel = Math.max(0, Number(quizState.completedLevel || 0));
  const displayLevel = completedLevel;

  if (stage === 'leaderboard') {
    return (
      <EventLeaderboardView
        disabled={disabled}
        onHome={onRestart}
        quizState={quizState}
      />
    );
  }

  const asset = stage === 'level'
    ? FIGMA_ASSETS.levelCelebration
    : stage === 'champion'
      ? FIGMA_ASSETS.champion
      : FIGMA_ASSETS.participation;
  const label = stage === 'level'
    ? `Congratulations, you have won Level ${displayLevel}`
    : stage === 'champion'
      ? 'Urban Mobility Champion'
      : 'Thank you for participating';

  return (
    <section className={`event-screen event-static-screen event-result-screen event-result-${stage}`} aria-label={label}>
      <ReferenceLayer key={asset} src={asset} />
      {stage === 'level' && (
        <div className="event-result-level" aria-label={`Level ${displayLevel}`}>
          <img
            aria-hidden="true"
            alt=""
            className="event-result-level-label"
            src={FIGMA_ASSETS.levelLabel}
          />
          <strong>{displayLevel}</strong>
          <img
            aria-hidden="true"
            alt=""
            className="event-result-participation"
            src={FIGMA_ASSETS.participationLabel}
          />
        </div>
      )}
      {['menu', 'eliminated'].includes(stage) && (
        <div className="event-end-actions">
          <button disabled={disabled || !interactive} onClick={onRestart} type="button"><span>END GAME</span></button>
          <button disabled={disabled || !interactive} onClick={onShowLeaderboard} type="button"><span>LEADERBOARD</span></button>
        </div>
      )}
    </section>
  );
}

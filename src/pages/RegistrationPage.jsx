import { useEffect, useRef, useState } from 'react';
import { FIGMA_ASSETS } from '../components/EventQuizViews.jsx';

function normalizeDraft(value) {
  return Array.from(String(value)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^ /, ''))
    .slice(0, 30)
    .join('');
}

function isValidName(value) {
  return Array.from(value.replace(/\s/g, '')).length >= 2;
}

export default function RegistrationPage({
  disabled = false,
  error = '',
  mode = 'display',
  onBack,
  onNameChange,
  onSubmit,
  playerName = '',
}) {
  const isOperator = mode === 'operator';
  const inputRef = useRef(null);
  const draftRef = useRef(playerName);
  const [draft, setDraft] = useState(playerName);

  useEffect(() => {
    if (!isOperator) return;
    if (normalizeDraft(draftRef.current).trim() !== playerName) {
      draftRef.current = playerName;
      setDraft(playerName);
    }
  }, [isOperator, playerName]);

  useEffect(() => {
    if (!isOperator || disabled) return undefined;
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frameId);
  }, [disabled, isOperator]);

  function updateDraft(value) {
    const nextDraft = normalizeDraft(value);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    onNameChange?.(nextDraft);
  }

  function submit(event) {
    event.preventDefault();
    if (!disabled && isValidName(draft.trim())) onSubmit?.();
  }

  return (
    <section className="event-screen event-registration-screen" aria-label="Participant registration">
      <img
        alt=""
        aria-hidden="true"
        className="event-reference-layer"
        decoding="async"
        draggable="false"
        fetchPriority="high"
        loading="eager"
        src={FIGMA_ASSETS.registration}
      />

      {isOperator && (
        <button className="event-registration-back" disabled={disabled} onClick={onBack} type="button">
          ← Back
        </button>
      )}

      <form className="event-registration-form" onSubmit={submit}>
        <label>
          <span className="sr-only">Your name</span>
          {isOperator ? (
            <input
              aria-invalid={Boolean(error)}
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              disabled={disabled}
              maxLength={30}
              onChange={(event) => updateDraft(event.target.value)}
              placeholder="Enter Your Name"
              ref={inputRef}
              spellCheck={false}
              type="text"
              value={draft}
            />
          ) : (
            <div className={`event-display-name ${playerName ? 'has-value' : ''}`}>
              {playerName || 'Enter Your Name'}
            </div>
          )}
        </label>

        {isOperator && (
          <button
            className="event-registration-submit"
            disabled={disabled || !isValidName(draft.trim())}
            type="submit"
          >
            Start Quiz
          </button>
        )}
      </form>

      {error && <div className="event-error-toast" role="alert">{error}</div>}
    </section>
  );
}

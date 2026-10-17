import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { questions } from '../data/questions.js';
import { useCurrentParticipant } from '../hooks/useCurrentParticipant.js';
import { getParticipantOptions, getParticipantQuestions, updateParticipantAnswer } from '../utils/storage.js';
import quizArtwork from '../images/fp3.png';

const ANSWER_FEEDBACK_DELAY_MS = 1000;
const OPTION_REVEAL_DELAY_MS = 3000;

export default function QuizPage() {
  const navigate = useNavigate();
  const { questionNumber } = useParams();
  const { participant, refreshParticipant } = useCurrentParticipant();
  const [feedbackOptionIds, setFeedbackOptionIds] = useState([]);
  const [revealedQuestionNumber, setRevealedQuestionNumber] = useState(null);
  const feedbackTimeoutRef = useRef(null);
  const advancedQuestionRef = useRef(null);
  const currentIndex = Number(questionNumber) - 1;
  const areOptionsVisible = revealedQuestionNumber === questionNumber;
  const quizQuestions = useMemo(() => getParticipantQuestions(participant, questions), [participant]);
  const question = quizQuestions[currentIndex];
  const totalQuestions = quizQuestions.length;
  const questionOptions = useMemo(() => {
    return getParticipantOptions(participant, question);
  }, [participant, question]);

  const correctOptionIds = useMemo(() => {
    return question?.correctOptionIds || [question?.correctOptionId].filter(Boolean);
  }, [question]);
  const selectedOptionIds = useMemo(() => {
    const answer = participant?.answers?.[question?.id];
    return Array.isArray(answer) ? answer : answer ? [answer] : [];
  }, [participant, question]);
  const isMultiAnswerQuestion = correctOptionIds.length > 1;
  const hasImageOptions = questionOptions.some((option) => option.image);

  const goNext = useCallback((fromQuestionNumber = questionNumber) => {
    if (advancedQuestionRef.current === fromQuestionNumber) return;

    advancedQuestionRef.current = fromQuestionNumber;

    const fromIndex = Number(fromQuestionNumber) - 1;

    if (fromIndex === totalQuestions - 1) {
      navigate('/score');
      return;
    }

    navigate(`/quiz/${fromIndex + 2}`);
  }, [navigate, questionNumber, totalQuestions]);

  useEffect(() => {
    advancedQuestionRef.current = null;
    setFeedbackOptionIds([]);

    return () => {
      window.clearTimeout(feedbackTimeoutRef.current);
    };
  }, [questionNumber]);

  useEffect(() => {
    const revealTimerId = window.setTimeout(() => {
      setRevealedQuestionNumber(questionNumber);
    }, OPTION_REVEAL_DELAY_MS);

    return () => window.clearTimeout(revealTimerId);
  }, [questionNumber]);

  if (!participant) {
    return <Navigate to="/" replace />;
  }

  if (!question || currentIndex < 0) {
    return <Navigate to="/quiz/1" replace />;
  }

  function selectOption(optionId) {
    if (feedbackOptionIds.length > 0) return;

    if (isMultiAnswerQuestion) {
      const nextSelectedOptionIds = selectedOptionIds.includes(optionId)
        ? selectedOptionIds.filter((selectedOptionId) => selectedOptionId !== optionId)
        : [...selectedOptionIds, optionId].slice(0, correctOptionIds.length);

      updateParticipantAnswer(question.id, nextSelectedOptionIds);
      refreshParticipant();

      if (nextSelectedOptionIds.length < correctOptionIds.length) return;

      setFeedbackOptionIds(nextSelectedOptionIds);

      if (ANSWER_FEEDBACK_DELAY_MS <= 0) {
        goNext();
        return;
      }

      feedbackTimeoutRef.current = window.setTimeout(() => {
        goNext();
      }, ANSWER_FEEDBACK_DELAY_MS);
      return;
    }

    updateParticipantAnswer(question.id, optionId);
    refreshParticipant();
    setFeedbackOptionIds([optionId]);

    if (ANSWER_FEEDBACK_DELAY_MS <= 0) {
      goNext();
      return;
    }

    feedbackTimeoutRef.current = window.setTimeout(() => {
      goNext();
    }, ANSWER_FEEDBACK_DELAY_MS);
  }

  function getOptionClassName(optionId) {
    const classNames = ['option-card'];
    const option = questionOptions.find((item) => item.id === optionId);

    if (option?.image) {
      classNames.push('image-option');
    }

    if (!option?.image && (option?.text.length || 0) > 34) {
      classNames.push('long-option');
    }

    if (selectedOptionIds.includes(optionId)) {
      classNames.push('selected');
    }

    if (feedbackOptionIds.length > 0) {
      if (correctOptionIds.includes(optionId)) {
        classNames.push('feedback-correct');
      } else if (feedbackOptionIds.includes(optionId)) {
        classNames.push('feedback-incorrect');
      }
    }

    return classNames.join(' ');
  }

  const questionClassName = question.text.length > 68 ? 'long-question' : '';

  return (
    <section className="quiz-page" aria-label={`Question ${currentIndex + 1} of ${totalQuestions}`}>
      <img
        className="quiz-artwork"
        src={quizArtwork}
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        loading="eager"
      />

      <div className="quiz-ui">
        <div className="quiz-status-row">
          <div className="question-count-chip">
            <span aria-hidden="true">?</span>
            <strong>Question {currentIndex + 1} of {totalQuestions}</strong>
          </div>

          <div
            className="quiz-progress-pills"
            aria-label={`Progress ${currentIndex + 1} of ${totalQuestions}`}
          >
            {quizQuestions.map((item, index) => (
              <span
                className={index <= currentIndex ? 'active' : ''}
                key={item.id}
              />
            ))}
          </div>

        </div>

        <div className="question-panel">
          <div className="question-icon" aria-hidden="true">?</div>
          <p className="question-index">Q{currentIndex + 1}</p>
          <div className="question-copy-wrap">
            <h1 className={questionClassName}>{question.text}</h1>
          </div>
        </div>

        <div className={`options-grid quiz-options ${hasImageOptions ? 'image-options-grid' : ''}`}>
          {areOptionsVisible && questionOptions.map((option, optionIndex) => (
            <button
              className={getOptionClassName(option.id)}
              disabled={feedbackOptionIds.length > 0}
              key={option.id}
              onClick={() => selectOption(option.id)}
              type="button"
            >
              <span>{String.fromCharCode(65 + optionIndex)}</span>
              {option.image ? (
                <img src={option.image} alt={option.text} decoding="async" />
              ) : (
                <strong>{option.text}</strong>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

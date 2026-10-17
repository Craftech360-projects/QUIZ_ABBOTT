import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL } from '../config.js';

export function useQuizSocket({ operator = false } = {}) {
  const socketRef = useRef(null);
  const pendingRef = useRef(false);
  const [quizState, setQuizState] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isOperatorAuthorized, setIsOperatorAuthorized] = useState(!operator);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = io(API_BASE_URL || undefined, {
      auth: { operator },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    function handleConnect() {
      setIsConnected(true);
      setError('');
      socket.emit('request_state');
    }

    function handleDisconnect() {
      setIsConnected(false);
    }

    function handleOperatorAccess(result) {
      const authorized = !operator || Boolean(result?.authorized);
      setIsOperatorAuthorized(authorized);
      if (!authorized) {
        setError('Operator controls are unavailable. Refresh the page and try again.');
      }
    }

    function handleState(nextState) {
      setQuizState({ ...nextState, clockOffsetMs: (nextState.serverNow || Date.now()) - Date.now() });
      pendingRef.current = false;
      setIsPending(false);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', () => setError('Reconnecting to the quiz server…'));
    socket.on('operator_access', handleOperatorAccess);
    socket.on('quiz_state', handleState);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [operator]);

  const emitAction = useCallback((eventName, payload) => {
    if (!socketRef.current?.connected || pendingRef.current) return;

    pendingRef.current = true;
    setIsPending(true);
    setError('');
    socketRef.current.timeout(5000).emit(eventName, payload, (timeoutError, result) => {
      if (!timeoutError && result?.ok) return;
      pendingRef.current = false;
      setIsPending(false);
      setError(
        timeoutError
          ? 'The quiz server did not respond. Try again.'
          : result?.message || 'The server could not complete that action.',
      );
    });
  }, []);

  const showOptions = useCallback(() => {
    emitAction('show_options', {
      sessionId: quizState?.sessionId,
      questionId: quizState?.questions?.[quizState.questionIndex]?.id,
    });
  }, [emitAction, quizState]);

  const selectOption = useCallback((optionId) => {
    emitAction('select_option', { optionId });
  }, [emitAction]);

  const goBack = useCallback(() => {
    emitAction('answer_back');
  }, [emitAction]);

  const lockAnswer = useCallback(() => {
    emitAction('lock_answer');
  }, [emitAction]);

  const requestOperatorAnswer = useCallback((payload) => new Promise((resolve, reject) => {
    if (!operator || !socketRef.current?.connected) {
      reject(new Error('Connect to the operator screen to view the answer.'));
      return;
    }
    // Private read-only reply: never merge this answer into shared quiz state.
    socketRef.current.timeout(5000).emit('get_operator_answer', payload, (timeoutError, result) => {
      if (timeoutError || !result?.ok) {
        reject(new Error(result?.message || 'Could not load the answer. Please try again.'));
        return;
      }
      resolve(result);
    });
  }), [operator]);

  const useLifeline = useCallback((type) => {
    emitAction('use_lifeline', { type });
  }, [emitAction]);

  const dismissLifeline = useCallback(() => {
    emitAction('dismiss_lifeline');
  }, [emitAction]);

  const start = useCallback(() => {
    emitAction('start');
  }, [emitAction]);

  const updateName = useCallback((name) => {
    if (!socketRef.current?.connected) return;

    socketRef.current.timeout(5000).emit('name_update', { name }, (timeoutError, result) => {
      if (!timeoutError && result?.ok) return;
      setError(
        timeoutError
          ? 'The quiz server did not respond. Try again.'
          : result?.message || 'The server could not update the name.',
      );
    });
  }, []);

  const submitName = useCallback(() => {
    emitAction('name_submit');
  }, [emitAction]);

  const registrationBack = useCallback(() => {
    emitAction('registration_back');
  }, [emitAction]);

  const restart = useCallback(() => {
    emitAction('restart');
  }, [emitAction]);

  const showLeaderboard = useCallback(() => {
    emitAction('show_leaderboard');
  }, [emitAction]);

  const hideLeaderboard = useCallback(() => {
    emitAction('hide_leaderboard');
  }, [emitAction]);

  return {
    quizState,
    isConnected,
    isOperatorAuthorized,
    isPending,
    error,
    selectOption,
    showOptions,
    goBack,
    lockAnswer,
    requestOperatorAnswer,
    useLifeline,
    dismissLifeline,
    start,
    updateName,
    submitName,
    registrationBack,
    restart,
    showLeaderboard,
    hideLeaderboard,
  };
}

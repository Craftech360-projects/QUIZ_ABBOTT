import { useEffect, useRef, useState } from 'react';
import startTrack from '../../music/Start Track.mp3';
import questionTrack from '../../music/Question tension track.mp3';
import clockTrack from '../../music/_Kbc_Clock_timer_With questions.mp3';
import audienceTrack from '../../music/Car pool_Audience Poll.mp3';
import fiftyFiftyTrack from '../../music/50_50.mp3';
import endTrack from '../../music/Game End.mp3';

export default function EventMusic({ quizState, defaultEnabled = false }) {
  const audioRef = useRef(null);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [playbackIssue, setPlaybackIssue] = useState('');
  const [introducedQuestion, setIntroducedQuestion] = useState(null);
  const [playedFiftyFiftyQuestion, setPlayedFiftyFiftyQuestion] = useState(null);
  const [playedEndSession, setPlayedEndSession] = useState(null);
  const resultKey = quizState?.status === 'finished'
    ? `${quizState.sessionId}:${quizState.completedAt}`
    : null;
  const questionKey = quizState?.status === 'running'
    ? `${quizState.sessionId}:${quizState.questions[quizState.questionIndex]?.id}`
    : null;

  let track = null;
  if (quizState?.status === 'registering'
    || quizState?.resultView === 'leaderboard') {
    track = startTrack;
  } else if (quizState?.status === 'finished') {
    if (playedEndSession !== resultKey) track = endTrack;
  } else if (questionKey && ['answering', 'confirming'].includes(quizState.phase)) {
    if (quizState.activeLifeline) track = audienceTrack;
    else if (quizState.phase === 'answering' && quizState.eliminatedOptionIds?.length
      && playedFiftyFiftyQuestion !== questionKey) track = fiftyFiftyTrack;
    else if (quizState.phase === 'answering' && introducedQuestion !== questionKey) track = questionTrack;
    else track = clockTrack;
  }

  // A lifeline or answer can interrupt the introduction; don't replay it on Go Back/Done.
  useEffect(() => {
    if (questionKey && track !== questionTrack) setIntroducedQuestion(questionKey);
  }, [questionKey, track]);

  // An interrupted 50:50 cue must not restart after Go Back or another lifeline.
  useEffect(() => {
    if (questionKey && quizState.eliminatedOptionIds?.length
      && (quizState.phase !== 'answering' || quizState.activeLifeline)) {
      setPlayedFiftyFiftyQuestion(questionKey);
    }
  }, [questionKey, quizState?.eliminatedOptionIds, quizState?.phase, quizState?.activeLifeline]);

  useEffect(() => {
    const audio = audioRef.current;
    let disposed = false;
    audio.pause();
    setPlaybackIssue('');
    if (track) {
      if (audio.getAttribute('src') !== track) {
        audio.src = track;
        audio.load();
      }
      audio.loop = track !== questionTrack && track !== fiftyFiftyTrack && track !== endTrack;
    } else {
      audio.removeAttribute('src');
      audio.load();
    }

    function play() {
      if (!enabled || !track || !audio.paused) return;
      audio.play().then(() => {
        if (!disposed) setPlaybackIssue('');
      }).catch((error) => {
        if (!disposed && error.name !== 'AbortError') {
          setPlaybackIssue(error.name === 'NotAllowedError' ? 'blocked' : 'error');
        }
      });
    }

    function retryOnInteraction(event) {
      if (!event.target.closest?.('.event-sound-toggle')) play();
    }

    play();
    // Browsers may require a local click/key press before starting audible playback.
    document.addEventListener('pointerdown', retryOnInteraction);
    document.addEventListener('keydown', retryOnInteraction);
    return () => {
      disposed = true;
      audio.pause();
      document.removeEventListener('pointerdown', retryOnInteraction);
      document.removeEventListener('keydown', retryOnInteraction);
    };
  }, [enabled, track, questionKey]);

  function toggleSound() {
    const audio = audioRef.current;
    if (enabled && !playbackIssue) {
      audio.pause();
      setEnabled(false);
      return;
    }
    setEnabled(true);
    if (!track) return;
    // Call play inside the button gesture, including when autoplay was blocked.
    audio.play().then(() => setPlaybackIssue('')).catch((error) => {
      if (error.name !== 'AbortError') setPlaybackIssue(error.name === 'NotAllowedError' ? 'blocked' : 'error');
    });
  }

  return (
    <>
      <audio ref={audioRef} preload="auto" onEnded={() => {
        if (track === questionTrack) setIntroducedQuestion(questionKey);
        if (track === fiftyFiftyTrack) setPlayedFiftyFiftyQuestion(questionKey);
        if (track === endTrack) setPlayedEndSession(resultKey);
      }} />
      {quizState && <button className="event-sound-toggle" type="button" onClick={toggleSound}
        aria-pressed={enabled && !playbackIssue}>
        {playbackIssue === 'error' ? 'Retry music' : !enabled || playbackIssue ? 'Enable sound' : 'Mute sound'}
      </button>}
    </>
  );
}

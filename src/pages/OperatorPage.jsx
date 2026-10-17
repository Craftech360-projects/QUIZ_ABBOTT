import EventMusic from '../components/EventMusic.jsx';
import {
  EventLoadingView,
  EventQuestionView,
  EventResultView,
  EventStartView,
} from '../components/EventQuizViews.jsx';
import { useQuizSocket } from '../hooks/useQuizSocket.js';
import RegistrationPage from './RegistrationPage.jsx';

export default function OperatorPage() {
  const quiz = useQuizSocket({ operator: true });
  return <>
    <EventMusic quizState={quiz.quizState} defaultEnabled />
    <OperatorView {...quiz} />
  </>;
}

function OperatorView({
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
}) {
  const canOperate = isConnected && isOperatorAuthorized;

  if (!quizState) {
    return <EventLoadingView message={isConnected ? 'Authorizing operator…' : 'Connecting to the quiz…'} />;
  }
  if (quizState.status === 'idle') {
    return (
      <EventStartView
        disabled={!canOperate || isPending}
        error={error}
        onStart={start}
      />
    );
  }
  if (quizState.status === 'registering') {
    return (
      <RegistrationPage
        disabled={!canOperate || isPending}
        error={error}
        mode="operator"
        onBack={registrationBack}
        onNameChange={updateName}
        onSubmit={submitName}
        playerName={quizState.playerName}
      />
    );
  }
  if (quizState.status === 'finished') {
    return (
      <EventResultView
        disabled={!canOperate || isPending}
        onRestart={restart}
        onShowLeaderboard={showLeaderboard}
        quizState={quizState}
      />
    );
  }

  return (
    <EventQuestionView
      dismissLifeline={dismissLifeline}
      error={error}
      goBack={goBack}
      interactive
      isConnected={canOperate}
      isPending={isPending}
      lockAnswer={lockAnswer}
      quizState={quizState}
      requestOperatorAnswer={requestOperatorAnswer}
      selectOption={selectOption}
      showOptions={showOptions}
      useLifeline={useLifeline}
    />
  );
}

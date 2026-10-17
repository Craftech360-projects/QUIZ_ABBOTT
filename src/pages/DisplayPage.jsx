import EventMusic from '../components/EventMusic.jsx';
import {
  EventLoadingView,
  EventQuestionView,
  EventResultView,
  EventStartView,
} from '../components/EventQuizViews.jsx';
import { useQuizSocket } from '../hooks/useQuizSocket.js';
import RegistrationPage from './RegistrationPage.jsx';

export default function DisplayPage() {
  const quiz = useQuizSocket();
  return <>
    <EventMusic quizState={quiz.quizState} />
    <DisplayView {...quiz} />
  </>;
}

function DisplayView({ quizState, isConnected }) {

  if (!quizState) {
    return <EventLoadingView message={isConnected ? 'Loading the game…' : 'Connecting to the quiz…'} />;
  }
  if (quizState.status === 'idle') return <EventStartView />;
  if (quizState.status === 'registering') {
    return <RegistrationPage playerName={quizState.playerName} />;
  }
  if (quizState.status === 'finished') return <EventResultView quizState={quizState} />;
  if (!quizState.questions[quizState.questionIndex]) return <EventStartView />;

  return (
    <EventQuestionView
      interactive={false}
      isConnected={isConnected}
      quizState={quizState}
    />
  );
}

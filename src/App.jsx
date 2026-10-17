import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import FullscreenToggle from './components/FullscreenToggle.jsx';
import StartPage from './pages/StartPage.jsx';
import QuizPage from './pages/QuizPage.jsx';
import ScorePage from './pages/ScorePage.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import DisplayPage from './pages/DisplayPage.jsx';
import OperatorPage from './pages/OperatorPage.jsx';
import { FIGMA_ASSET_URLS } from './components/EventQuizViews.jsx';
import congratsFrame from './images/cong.png';
import leaderboardArtwork from './images/fp5.png';
import nameField from './images/name.png';
import quizArtwork from './images/fp3.png';
import registerArtwork from './images/fp2.png';
import resultArtwork from './images/fp4.png';
import startArtwork from './images/fp1.png';
import startButton from './images/start.png';

const PRELOAD_IMAGES = [
  startArtwork,
  quizArtwork,
  resultArtwork,
  leaderboardArtwork,
  congratsFrame,
  nameField,
  registerArtwork,
  startButton,
  ...FIGMA_ASSET_URLS,
];

function preloadImages() {
  if (typeof document === 'undefined') return;

  PRELOAD_IMAGES.forEach((src) => {
    if (!document.querySelector(`link[rel="preload"][href="${src}"]`)) {
      const link = document.createElement('link');
      link.as = 'image';
      link.href = src;
      link.rel = 'preload';
      document.head.appendChild(link);
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    image.decode?.().catch(() => {});
  });
}

preloadImages();

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<StartPage />} />
        <Route path="/quiz/:questionNumber" element={<QuizPage />} />
        <Route path="/score" element={<ScorePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/operator" element={<OperatorPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="*" element={<Navigate to="/display" replace />} />
      </Routes>
      <FullscreenToggle />
    </AppShell>
  );
}

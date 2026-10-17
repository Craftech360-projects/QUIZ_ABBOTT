import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import FullscreenToggle from './components/FullscreenToggle.jsx';
import DisplayPage from './pages/DisplayPage.jsx';
import OperatorPage from './pages/OperatorPage.jsx';
import { FIGMA_ASSET_URLS } from './components/EventQuizViews.jsx';

function preloadImages() {
  if (typeof document === 'undefined') return;

  FIGMA_ASSET_URLS.forEach((src) => {
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
        <Route path="/" element={<Navigate to="/operator" replace />} />
        <Route path="/quiz/:questionNumber" element={<Navigate to="/operator" replace />} />
        <Route path="/score" element={<Navigate to="/operator" replace />} />
        <Route path="/leaderboard" element={<Navigate to="/operator" replace />} />
        <Route path="/operator" element={<OperatorPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="*" element={<Navigate to="/display" replace />} />
      </Routes>
      <FullscreenToggle />
    </AppShell>
  );
}

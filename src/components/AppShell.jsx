import { useLocation } from 'react-router-dom';

export default function AppShell({ children }) {
  const location = useLocation();
  const isStartPage = location.pathname === '/';
  const isQuizPage = location.pathname.startsWith('/quiz/');
  const isScorePage = location.pathname === '/score';
  const isLeaderboardPage = location.pathname === '/leaderboard';
  const isEventScreen = location.pathname === '/operator' || location.pathname === '/display';
  const isArtworkPage = isStartPage || isQuizPage || isScorePage || isLeaderboardPage || isEventScreen;

  return (
    <div className={`app ${isArtworkPage ? 'app-artwork' : ''} ${isEventScreen ? 'app-event' : ''}`}>
      <main className={`page-shell ${isArtworkPage ? 'artwork-shell' : ''}`}>{children}</main>
    </div>
  );
}

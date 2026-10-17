import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import leaderboardArtwork from '../images/fp5.png';
import {
  getCurrentParticipant,
  getSortedLeaderboard,
} from '../utils/storage.js';

const LEADERBOARD_DISPLAY_LIMIT = 10;

export default function LeaderboardPage() {
  const navigate = useNavigate();
  const currentParticipant = getCurrentParticipant();
  const latestEntryId = currentParticipant?.leaderboardEntryId;
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const visibleEntries = entries.slice(0, LEADERBOARD_DISPLAY_LIMIT);

  const loadLeaderboard = useCallback(async () => {
    setError('');

    try {
      const savedEntries = await getSortedLeaderboard();
      setEntries(savedEntries);
    } catch (loadError) {
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

  return (
    <section className="leaderboard-page" aria-label="Leaderboard">
      <img
        className="leaderboard-artwork"
        src={leaderboardArtwork}
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority="high"
        loading="eager"
      />

      <div className="leaderboard-board">
        <h1>Leaderboard</h1>

        {isLoading && entries.length === 0 ? (
          <div className="leaderboard-state">
            <h3>Loading results</h3>
            <p>Fetching participant scores.</p>
          </div>
        ) : error ? (
          <div className="leaderboard-state">
            <h3>Unable to load results</h3>
            <p>{error}</p>
            <button className="leaderboard-refresh" onClick={loadLeaderboard} type="button">
              Refresh
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="leaderboard-state">
            <h3>No quiz results yet</h3>
            <p>Completed participants will appear here automatically.</p>
          </div>
        ) : (
          <div className="leaderboard-table" role="table" aria-label="Top 10 scores">
            <div className="leaderboard-table-head" role="row">
              <span role="columnheader">Rank</span>
              <span role="columnheader">Name</span>
              <span role="columnheader">Point Scored</span>
            </div>

            {visibleEntries.map((entry, index) => (
              <div
                className={`leaderboard-row ${index === 0 ? 'top-row' : ''} ${entry.entryId === latestEntryId ? 'latest-row' : ''}`}
                key={entry.entryId}
                role="row"
              >
                <span role="cell">{String(index + 1).padStart(2, '0')}</span>
                <span role="cell">{entry.name}</span>
                <span role="cell">{entry.score} Points</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="leaderboard-home-button" onClick={() => navigate('/')} type="button">
        Home
      </button>
    </section>
  );
}

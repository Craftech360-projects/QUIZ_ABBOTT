# Abbott Event Quiz

The app runs one Express and Socket.IO server that owns the game state and keeps two browser routes synchronized:

- Operator controls: `http://localhost:3002/operator`
- Audience display: `http://localhost:3002/display`

The homepage `/` opens `/operator`. Legacy `/quiz/:questionNumber`, `/score`, and `/leaderboard` links also open the current operator flow instead of the retired yellow UI. Use the leaderboard button in the game result screen to view scores.

## Install and run

```bash
npm install
npm start
```

For local editing, use `npm run dev`. It automatically reloads the frontend and restarts the server when server code, question data, or reveal timing changes, restoring the saved game.

The operator screen works directly at `/operator`; no browser token is required. The server still supports an `OPERATOR_TOKEN` for programmatic access to the operator HTTP API.

The server listens on `0.0.0.0`, so another screen on the same network can use the host laptop's LAN IP. Allow incoming connections through the laptop firewall if prompted.

## Game rules implemented

- Each run contains eight levels, selecting one random question from each corresponding level pool in `UMC_Level 1_8.xlsx`. Levels remain in order; options are shuffled and selections are saved for reconnects.
- The imported bank contains 346 questions: 50 each for levels 1–5, 43 for level 6, 24 for level 7, and 29 for level 8. See [question-bank notes](docs/question-bank.md) for source counts and answer-key inconsistencies. Missing questions and explanations are not invented.
- Each question starts with a blank options area on both screens. The operator’s white **Show options** button reveals A immediately, then B, C, and D half a second apart with a fade-and-rise animation. Selection and lifelines unlock once all four are visible. The shared reveal timestamp survives reconnects and server restarts; each new question resets it.
- Selecting an option opens the confirmation step. `Go Back` clears the selection. `Lock Answer` validates it once and prevents duplicate submissions.
- Questions have no time limit or countdown. Players stay on the question until they select and lock an answer. Saved games from the old timed version resume without a deadline. Completed levels and the current level remain pale on the level ladder.
- The bottom-left `?` on the operator screen opens a private correct-answer popup matching Frame 14. It does not appear on the audience display; closing it returns to the question.
- Lock Answer immediately colours the selected option green or red on both screens and plays the matching correct or wrong answer tone. After two seconds, a correct answer advances to the next question (or the champion result after Level 8); a wrong answer ends the run. There is no explanation popup or manual Next Question button.
- An incorrect locked answer ends the run. With 0–3 correct answers, only the thank-you-for-participating screen is shown, without congratulations or a level number. With 4–7 correct answers, congratulations shows the exact number of completed levels (for example, failing Question 8 shows Level 7). Completing all 8 levels shows the existing Urban Mobility Champion screen.
- Audience Poll, Phone-A-Friend, and 50:50 are single-use per run. 50:50 removes two incorrect choices. The other two lifelines synchronize an active state for the live operator and display, but do not fabricate poll percentages, recommendations, or phone timing because the supplied specification does not define those behaviors.

Music is bundled from `music/` and `public/ANSWER-TONE/`. The start screen is silent; clicking Start begins `Start Track.mp3` during registration. The leaderboard also loops this track. Each new question plays `Question tension track.mp3` once, followed by `_Kbc_Clock_timer_With questions.mp3` looping while answering or confirming (without a countdown). Lock Answer stops the question music and plays `Correct answer.mp3` or `Wrong answer.mp3` during the two-second colour reveal. Car Pool and Bike Share loop `Car pool_Audience Poll.mp3` until Done; Solar Boost plays `50_50.mp3` once, then returns to the question music; Go Back does not replay the cue. Finished games play `Game End.mp3` once, then remain silent. Changing screens or lifelines replaces the previous track without overlapping playback.

Game music starts on the first operator screen after clicking Start. The server allows only one connected screen to supply audio: extra operator tabs and audience displays stay silent. Clicking **Enable sound** on another screen transfers audio to it and automatically silences the previous screen, including on another device. **Mute sound** or disconnecting that screen releases the output; click **Enable sound** on the desired screen to resume. If the browser blocks autoplay after a refresh, **Enable sound** starts playback. Background tracks repeat at their natural end for as long as their state remains active; the question introduction, 50:50 cue, and Game End track play once.

The application records the completed level without assigning monetary prizes or other rewards.

## Persistence

The active session is written atomically to `.quiz-session.json` by default and restored after a server restart. Completed sessions, including locked answers, lifeline usage, outcome, and timestamps, are appended to `quiz-sessions.jsonl`.

Leaderboard results are saved locally to `results.csv` by default, with columns `entryId`, `name`, `email`, `score`, and `completedAt`. The operator flow generates a run-specific kiosk email rather than collecting a player's email. Both leaderboard views read this file and show saved players ranked by score descending (earlier completion wins ties). The top ten refresh every five seconds. Supabase is disabled in CSV mode, even when its credentials are present. Failed saves remain in a local recovery outbox (`.quiz-pending-results.json`) for automatic retries, including after restarting the server. A run-specific kiosk email prevents duplicate recovery inserts. Keep one server process running and back up the CSV, session history, active session, and recovery outbox. Do not edit the live CSV while the server is running.

For offline use, install dependencies with `npm ci` and prepare the frontend with `npm run build` before the event. Leave `VITE_API_URL` empty and run `npm run server` on the event laptop. Both routes work on that laptop without Wi-Fi; separate devices need the same local Wi-Fi or LAN and access to the laptop's port 3002, but no internet connection. Questions, images, fonts, and audio are bundled locally. The Node server must remain running.

Supabase is optional and requires explicitly setting `RESULTS_STORAGE=supabase` and configuring credentials. Its existing `ABBOTT_QUIZ` schema remains unchanged. Existing cloud results are not downloaded to CSV, and CSV results are not automatically uploaded if you later enable Supabase.

The `scripts/reset-leaderboard.mjs` utility only manages the optional Supabase leaderboard; it does not reset local CSV results. It runs a read-only count by default. The explicit `--confirm-clear-current-leaderboard` flag first saves a private recovery copy in `.leaderboard-backups/`, then deletes only the snapshotted row IDs and verifies removal. Do not run this during an event. Nothing is seeded or cleared at server startup.

The checked-in `vercel.json` deploys only the static Vite frontend; it does not deploy `server.js`. The JSON/JSONL/CSV persistence is suitable only for one long-lived server process with a durable local disk. Do not use it as authoritative state on Vercel Functions or a multi-instance host: those environments require shared durable storage and cross-instance real-time fan-out.

For an online Vercel frontend with a separately hosted backend, run `node server.js --api-only` on one long-lived Node service with HTTPS, WebSocket support, and a persistent disk. Point `RESULTS_FILE`, `GAME_STATE_FILE`, `SESSION_HISTORY_FILE`, `PENDING_RESULTS_FILE`, and `OPERATOR_TOKEN_FILE` to the persistent disk. If opting into Supabase, configure its credentials on that service only. Set `VITE_API_URL` in the Vercel project to that service's public HTTPS origin (no `/api` suffix), then rebuild the frontend. Both Socket.IO game state and leaderboard HTTP requests use this same origin. Leave the value empty for local offline use. A frontend deployment alone does not start the backend.

Configure the server with `.env.local`:

```dotenv
OPERATOR_TOKEN=replace-with-a-long-random-value
OPERATOR_TOKEN_FILE=.quiz-operator-token
RESULTS_STORAGE=csv
RESULTS_FILE=results.csv
VITE_API_URL=
PENDING_RESULTS_FILE=.quiz-pending-results.json
GAME_STATE_FILE=.quiz-session.json
SESSION_HISTORY_FILE=quiz-sessions.jsonl
ANSWER_REVEAL_DURATION_MS=2000
REGISTRATION_IDLE_TIMEOUT_MS=60000
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or commit `.env.local`.

## APIs and real-time actions

- `GET /api/game`: public display-safe game state. The current correct answer is revealed after locking; no explanation popup is shown.
- `GET /api/operator/game`: authorized game state.
- `POST /api/operator/game/action`: authorized state transition endpoint.
- `GET /api/operator/sessions`: authorized completed-session history.
- `GET /api/results`: leaderboard results.
- `POST /api/results`: legacy result submission with score validation.

Operator HTTP endpoints require `Authorization: Bearer <OPERATOR_TOKEN>`. Socket operator actions use the same token during the Socket.IO handshake. Supported socket actions are `start`, `name_update`, `name_submit`, `registration_back`, `show_options`, `select_option`, `answer_back`, `lock_answer`, `use_lifeline`, `dismiss_lifeline`, and `restart`. `show_options` requires the current `sessionId` and `questionId` to reject stale clicks.

## Verification

```bash
npm test
npm run build
```

The tests verify all eight question pools and selection coverage, then start isolated servers to verify authorization, eight four-option levels, selection/back/locking, duplicate rejection, all three lifelines, correct progression, participation for 0–3 completed levels, exact-level outcomes for 4–7, champion completion at 8, operator/display synchronization, result/session persistence, and recovery after a server restart. Test results never go to the real Supabase leaderboard.

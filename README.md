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

The operator screen works directly at `/operator`; no browser token is required. The server still supports an `OPERATOR_TOKEN` for programmatic access to the operator HTTP API.

The server listens on `0.0.0.0`, so another screen on the same network can use the host laptop's LAN IP. Allow incoming connections through the laptop firewall if prompted.

## Game rules implemented

- Each run contains eight levels, selecting one random question from each corresponding level pool in `UMC_Level 1_8.xlsx`. Levels remain in order; options are shuffled and selections are saved for reconnects.
- The imported bank contains 346 questions: 50 each for levels 1–5, 43 for level 6, 24 for level 7, and 29 for level 8. See [question-bank notes](docs/question-bank.md) for source counts and answer-key inconsistencies. Missing questions and explanations are not invented.
- Selecting an option opens the confirmation step. `Go Back` clears the selection. `Lock Answer` validates it once and prevents duplicate submissions.
- Each question has a server-enforced 45-second deadline. Selecting an option pauses the remaining time indefinitely during confirmation; `Go Back` resumes that remainder. Expiry without a selection ends the run with the appropriate existing milestone/participation screen. Deadlines and paused time survive reconnects and server restarts.
- The bottom-left `?` on the operator screen opens a private correct-answer popup matching Frame 14. It does not appear on the audience display or pause the question timer; closing it returns to the question.
- A correct locked answer advances to the next level after feedback.
- During feedback, the operator can click `Next Question` or `View Result` to continue immediately. Otherwise, feedback advances automatically after 10 seconds. Both screens stay synchronized.
- An incorrect locked answer or unanswered-question timeout ends the run. With 0–3 correct answers, only the thank-you-for-participating screen is shown, without congratulations or a level number. With 4–7 correct answers, congratulations shows the exact number of completed levels (for example, failing Question 8 shows Level 7). Completing all 8 levels shows the existing Urban Mobility Champion screen.
- Audience Poll, Phone-A-Friend, and 50:50 are single-use per run. 50:50 removes two incorrect choices. The other two lifelines synchronize an active state for the live operator and display, but do not fabricate poll percentages, recommendations, or phone timing because the supplied specification does not define those behaviors.

The application records the completed level without assigning monetary prizes or other rewards.

## Persistence

The active session is written atomically to `.quiz-session.json` by default and restored after a server restart. Completed sessions, including locked answers, lifeline usage, outcome, and timestamps, are appended to `quiz-sessions.jsonl`.

Leaderboard results use the existing `ABBOTT_QUIZ` Supabase table by default. Its schema remains unchanged: `id`, `name`, `email`, `score`, and `created_at`. Both leaderboard views start empty and show only saved players, ranked by score descending (earlier completion wins ties). The top ten refresh every five seconds. There is no automatic CSV fallback. If Supabase is unavailable, the leaderboard reports an error and completed runs remain in a local recovery outbox (`.quiz-pending-results.json`) for automatic upload retries, including after restarting the server. A run-specific kiosk email prevents duplicate recovery inserts. `RESULTS_STORAGE=csv` is available only as an explicit offline/test mode; use `supabase` for the event.

To reset test leaderboard entries, run `node scripts/reset-leaderboard.mjs` for a read-only count. The explicit `--confirm-clear-current-leaderboard` flag first saves a private recovery copy in `.leaderboard-backups/`, then deletes only the snapshotted row IDs and verifies removal. Do not run this during an event. Nothing is seeded or cleared at server startup.

The checked-in `vercel.json` deploys only the static Vite frontend; it does not deploy `server.js`. The JSON/JSONL/CSV persistence is suitable only for one long-lived server process with a durable local disk. Do not use it as authoritative state on Vercel Functions or a multi-instance host: those environments require shared durable storage and cross-instance real-time fan-out.

For a Vercel frontend with a separately hosted backend, run `node server.js --api-only` on one long-lived Node service with HTTPS, WebSocket support, and a persistent disk. Configure Supabase credentials on that service only, and point `GAME_STATE_FILE`, `SESSION_HISTORY_FILE`, `PENDING_RESULTS_FILE`, and `OPERATOR_TOKEN_FILE` to the persistent disk. Set `VITE_API_URL` in the Vercel project to that service's public HTTPS origin (no `/api` suffix), then rebuild the frontend. Both Socket.IO game state and leaderboard HTTP requests use this same origin. Leave the value empty for local use. A frontend deployment alone does not start the backend.

Configure the server with `.env.local`:

```dotenv
OPERATOR_TOKEN=replace-with-a-long-random-value
OPERATOR_TOKEN_FILE=.quiz-operator-token
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_TABLE=ABBOTT_QUIZ
GAME_STATE_FILE=.quiz-session.json
SESSION_HISTORY_FILE=quiz-sessions.jsonl
FEEDBACK_REVEAL_DELAY_MS=4000
FEEDBACK_DELAY_MS=10000
QUESTION_DURATION_MS=45000
REGISTRATION_IDLE_TIMEOUT_MS=60000
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or commit `.env.local`.

## APIs and real-time actions

- `GET /api/game`: public display-safe game state. The current correct answer is revealed after locking; its explanation appears during feedback.
- `GET /api/operator/game`: authorized game state.
- `POST /api/operator/game/action`: authorized state transition endpoint.
- `GET /api/operator/sessions`: authorized completed-session history.
- `GET /api/results`: leaderboard results.
- `POST /api/results`: legacy result submission with score validation.

Operator HTTP endpoints require `Authorization: Bearer <OPERATOR_TOKEN>`. Socket operator actions use the same token during the Socket.IO handshake. Supported socket actions are `start`, `name_update`, `name_submit`, `registration_back`, `select_option`, `answer_back`, `lock_answer`, `continue_feedback`, `use_lifeline`, `dismiss_lifeline`, and `restart`. `continue_feedback` requires the current `sessionId` and `questionId` to reject stale clicks.

## Verification

```bash
npm test
npm run build
```

The tests verify all eight question pools and selection coverage, then start isolated servers to verify authorization, eight four-option levels, selection/back/locking, duplicate rejection, all three lifelines, correct progression, participation for 0–3 completed levels, exact-level outcomes for 4–7, champion completion at 8, operator/display synchronization, result/session persistence, and recovery after a server restart. Test results never go to the real Supabase leaderboard.

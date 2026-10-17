import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, watchFile, unwatchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server.js', 'src/data/questions.js', 'src/data/levelQuestions.js', 'src/utils/optionReveal.js']
  .map((file) => path.join(root, file));

function fingerprint() {
  const hash = createHash('sha256');
  for (const file of files) hash.update(readFileSync(file));
  return hash.digest('hex');
}

let signature = fingerprint();
let server;
let debounce;
let stopping = false;
let restartQueue = Promise.resolve();

function start() {
  if (stopping) return;
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: process.env, stdio: 'inherit' });
  server.on('error', (error) => console.error('Could not start quiz server:', error.message));
}

async function stopServer() {
  const previous = server;
  server = null;
  if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
  const exited = once(previous, 'exit');
  previous.kill('SIGTERM');
  await exited;
}

function queueRestart() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    restartQueue = restartQueue.then(async () => {
      if (stopping) return;
      const next = fingerprint();
      if (next === signature) return;
      signature = next;
      console.log('Server code changed — restarting the quiz server…');
      await stopServer();
      start();
    }).catch((error) => console.error('Could not reload quiz server:', error.message));
  }, 150);
}

// Watch source contents only. Runtime session writes and filesystem access events
// must never restart an active game or trigger a reload loop.
for (const file of files) watchFile(file, { interval: 500 }, queueRestart);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(debounce);
    for (const file of files) unwatchFile(file);
    await restartQueue;
    await stopServer();
    process.exit(0);
  });
}

start();

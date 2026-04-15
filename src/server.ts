import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join } from 'path';
import { PORT, IMAGES_DIR, getAuthToken } from './config.js';
import { SessionManager } from './claude/manager.js';
import authRouter from './routes/auth.js';
import { createApiRouter } from './routes/api.js';
import { setupWebSocket } from './ws/handler.js';
import { log } from './logger.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const manager = new SessionManager();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Routes
app.use(authRouter);
app.use(createApiRouter(manager));

// Service worker must never be cached — stale SW prevents frontend updates
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(join(import.meta.dirname, '..', 'public', 'sw.js'));
});

// Static files
app.use(express.static(join(import.meta.dirname, '..', 'public')));
app.use('/data/images', express.static(IMAGES_DIR));

// WebSocket
setupWebSocket(wss, manager);

// Graceful shutdown — close server cleanly. Claude processes spawned with
// detached: true survive PilotCode restarts and are reconnected on next start.
function shutdown() {
  log('server', 'Shutting down...');
  wss.close();
  server.close(() => process.exit(0));
  // Force exit after 3s if connections don't close
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle port-in-use gracefully
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log('server', `Port ${PORT} is already in use. Retrying in 2s...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT);
    }, 2000);
  } else {
    log('server', `Server error: ${err.message}`);
    process.exit(1);
  }
});

// Start
server.listen(PORT, () => {
  const token = getAuthToken();
  log('server', `PilotCode started on port ${PORT}`);
  console.log(`
  ╔══════════════════════════════════════╗
  ║         PilotCode Server             ║
  ╠══════════════════════════════════════╣
  ║  http://localhost:${PORT}              ║
  ║                                      ║
  ║  Auth token: ${token.slice(0, 8)}...${token.slice(-4)}              ║
  ╚══════════════════════════════════════╝
  `);
  console.log(`  Full token: ${token}\n`);
});

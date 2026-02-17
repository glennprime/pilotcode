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

// Static files
app.use(express.static(join(import.meta.dirname, '..', 'public')));
app.use('/data/images', express.static(IMAGES_DIR));

// WebSocket
setupWebSocket(wss, manager);

// Start
server.listen(PORT, () => {
  const token = getAuthToken();
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

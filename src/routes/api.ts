import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { DATA_DIR, IMAGES_DIR, DEFAULT_CWD } from '../config.js';
import { SessionManager } from '../claude/manager.js';
import { requireAuth } from './auth.js';

const HISTORY_DIR = join(DATA_DIR, 'history');
mkdirSync(HISTORY_DIR, { recursive: true });

export function createApiRouter(manager: SessionManager): Router {
  const router = Router();

  // Image upload
  const storage = multer.diskStorage({
    destination: IMAGES_DIR,
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname) || '.jpg';
      cb(null, `${randomBytes(8).toString('hex')}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'image/', 'application/pdf',
        'application/vnd.openxmlformats-officedocument', // docx, xlsx, pptx
        'application/vnd.ms-excel', 'application/msword',
        'application/vnd.ms-powerpoint',
        'text/', 'application/json', 'application/csv',
      ];
      if (allowed.some((t) => file.mimetype.startsWith(t))) {
        cb(null, true);
      } else {
        cb(new Error('File type not supported'));
      }
    },
  });

  router.post('/api/images', requireAuth, upload.single('image'), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const isImage = req.file.mimetype.startsWith('image/');
    res.json({ filename: req.file.filename, isImage, mimetype: req.file.mimetype });
  });

  // Sessions
  router.get('/api/sessions', requireAuth, (_req: Request, res: Response) => {
    const sessions = manager.loadSessions();
    const active = manager.listActive();
    res.json(
      sessions.map((s) => ({
        ...s,
        active: active.includes(s.id),
      }))
    );
  });

  router.patch('/api/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const sessions = manager.loadSessions();
    const session = sessions.find((s) => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (req.body.name) session.name = req.body.name;
    if (req.body.cwd) session.cwd = req.body.cwd;
    manager.saveSessions(sessions);
    res.json({ ok: true, session });
  });

  router.delete('/api/sessions/:id', requireAuth, (req: Request, res: Response) => {
    manager.killProcess(req.params.id);
    const sessions = manager.loadSessions().filter((s) => s.id !== req.params.id);
    manager.saveSessions(sessions);
    // Clean up history file
    const histFile = join(HISTORY_DIR, `${req.params.id}.json`);
    try { if (existsSync(histFile)) writeFileSync(histFile, '[]'); } catch {}
    res.json({ ok: true });
  });

  // Chat history
  router.get('/api/history/:sessionId', requireAuth, (req: Request, res: Response) => {
    const file = join(HISTORY_DIR, `${req.params.sessionId}.json`);
    if (!existsSync(file)) {
      res.json([]);
      return;
    }
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      res.json(data);
    } catch {
      res.json([]);
    }
  });

  router.post('/api/history/:sessionId', requireAuth, (req: Request, res: Response) => {
    const file = join(HISTORY_DIR, `${req.params.sessionId}.json`);
    const entries = req.body;
    if (!Array.isArray(entries)) {
      res.status(400).json({ error: 'Expected array' });
      return;
    }
    // Keep last 500 entries
    const trimmed = entries.slice(-500);
    writeFileSync(file, JSON.stringify(trimmed));
    res.json({ ok: true });
  });

  // List directories for the session CWD picker
  router.get('/api/directories', requireAuth, (req: Request, res: Response) => {
    const parentPath = typeof req.query.path === 'string' && req.query.path ? req.query.path : DEFAULT_CWD;
    try {
      const entries = readdirSync(parentPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: join(parentPath, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ parent: parentPath, directories: dirs });
    } catch {
      res.status(400).json({ error: 'Cannot read directory' });
    }
  });

  // Available models — update this list when Anthropic releases new models
  router.get('/api/models', requireAuth, (_req: Request, res: Response) => {
    res.json([
      { id: 'claude-opus-4-6', name: 'Opus 4.6', tier: 'premium' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', tier: 'standard' },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', tier: 'fast' },
    ]);
  });

  // Path completion for CWD picker
  router.get('/api/complete-path', requireAuth, (req: Request, res: Response) => {
    const partial = typeof req.query.path === 'string' ? req.query.path : '';
    if (!partial.startsWith('/')) {
      res.json({ completed: partial, matches: [] });
      return;
    }

    // Split into parent directory and prefix to match against
    const lastSlash = partial.lastIndexOf('/');
    const parentDir = partial.substring(0, lastSlash) || '/';
    const prefix = partial.substring(lastSlash + 1);

    try {
      const entries = readdirSync(parentDir, { withFileTypes: true });
      const matches = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.startsWith(prefix))
        .map((e) => e.name)
        .sort();

      if (matches.length === 1) {
        // Single match — complete it fully
        const completed = join(parentDir, matches[0]) + '/';
        res.json({ completed, matches });
      } else if (matches.length > 1) {
        // Multiple matches — complete to longest common prefix
        let common = matches[0];
        for (let i = 1; i < matches.length; i++) {
          let j = 0;
          while (j < common.length && j < matches[i].length && common[j] === matches[i][j]) j++;
          common = common.substring(0, j);
        }
        const completed = common.length > prefix.length
          ? parentDir + (parentDir === '/' ? '' : '/') + common
          : partial;
        res.json({ completed, matches });
      } else {
        // No matches
        res.json({ completed: partial, matches: [] });
      }
    } catch {
      res.json({ completed: partial, matches: [] });
    }
  });

  // Health
  router.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  return router;
}

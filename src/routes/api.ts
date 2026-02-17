import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { extname } from 'path';
import { IMAGES_DIR } from '../config.js';
import { SessionManager } from '../claude/manager.js';
import { requireAuth } from './auth.js';

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
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files allowed'));
      }
    },
  });

  router.post('/api/images', requireAuth, upload.single('image'), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No image uploaded' });
      return;
    }
    res.json({ filename: req.file.filename });
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

  router.delete('/api/sessions/:id', requireAuth, (req: Request, res: Response) => {
    manager.killProcess(req.params.id);
    res.json({ ok: true });
  });

  // Health
  router.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  return router;
}

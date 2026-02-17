import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { getAuthToken } from '../config.js';

const router = Router();

// Rate limiting state
const attempts = new Map<string, number[]>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

router.post('/api/auth', (req: Request, res: Response) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();

  // Rate limiting
  const history = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (history.length >= MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }
  history.push(now);
  attempts.set(ip, history);

  const { token } = req.body;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('pilotcode_token', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  res.json({ ok: true });
});

router.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('pilotcode_token');
  res.json({ ok: true });
});

router.get('/api/auth/check', (req: Request, res: Response) => {
  const token = req.cookies?.pilotcode_token;
  if (token && verifyToken(token)) {
    res.json({ authenticated: true });
  } else {
    res.json({ authenticated: false });
  }
});

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.pilotcode_token;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function verifyToken(token: string): boolean {
  const expected = getAuthToken();
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export default router;

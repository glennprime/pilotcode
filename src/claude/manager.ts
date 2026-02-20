import { existsSync, readFileSync, writeFileSync } from 'fs';
import { SESSIONS_FILE } from '../config.js';
import { ClaudeProcess, ClaudeProcessOptions } from './process.js';

export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  createdAt: string;
  lastUsed: string;
}

export class SessionManager {
  private processes = new Map<string, ClaudeProcess>();
  private intentionalKills = new Set<string>();

  createProcess(opts: ClaudeProcessOptions): ClaudeProcess {
    const proc = new ClaudeProcess(opts);
    proc.start();

    // Once we know the session ID, track it
    proc.once('message', (msg: any) => {
      if (msg.type === 'system' && msg.session_id) {
        this.processes.set(msg.session_id, proc);
        proc.on('close', () => {
          this.processes.delete(msg.session_id);
        });
      }
    });

    return proc;
  }

  getProcess(sessionId: string): ClaudeProcess | undefined {
    return this.processes.get(sessionId);
  }

  registerProcess(sessionId: string, proc: ClaudeProcess): void {
    this.processes.set(sessionId, proc);
  }

  killProcess(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc) {
      this.intentionalKills.add(sessionId);
      proc.kill();
      this.processes.delete(sessionId);
    }
  }

  wasIntentionalKill(sessionId: string): boolean {
    return this.intentionalKills.has(sessionId);
  }

  clearIntentionalKill(sessionId: string): void {
    this.intentionalKills.delete(sessionId);
  }

  listActive(): string[] {
    return Array.from(this.processes.keys());
  }

  // Session metadata persistence
  loadSessions(): SessionMeta[] {
    if (!existsSync(SESSIONS_FILE)) return [];
    try {
      return JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }

  saveSessions(sessions: SessionMeta[]): void {
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  }

  saveSession(meta: SessionMeta): void {
    const sessions = this.loadSessions();
    const idx = sessions.findIndex((s) => s.id === meta.id);
    if (idx >= 0) {
      sessions[idx] = meta;
    } else {
      sessions.push(meta);
    }
    this.saveSessions(sessions);
  }

  updateLastUsed(sessionId: string): void {
    const sessions = this.loadSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      session.lastUsed = new Date().toISOString();
      this.saveSessions(sessions);
    }
  }
}

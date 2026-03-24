import { existsSync, readFileSync, writeFileSync } from 'fs';
import { SESSIONS_FILE } from '../config.js';
import { ClaudeProcess, ClaudeProcessOptions } from './process.js';

export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  model?: string;
  createdAt: string;
  lastUsed: string;
}

export class SessionManager {
  private processes = new Map<string, ClaudeProcess>();
  private intentionalKills = new Set<string>();
  // Track old→new ID aliases so processes can be found by ANY past ID.
  // This is critical because `claude --resume` returns a new ID every time.
  private idAliases = new Map<string, string>();

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
    // Direct lookup first
    let proc = this.processes.get(sessionId);
    if (proc) return proc;
    // Follow alias chain (old ID → new ID → newer ID → ...)
    let aliasId = this.idAliases.get(sessionId);
    const visited = new Set<string>();
    while (aliasId && !visited.has(aliasId)) {
      visited.add(aliasId);
      proc = this.processes.get(aliasId);
      if (proc) return proc;
      aliasId = this.idAliases.get(aliasId);
    }
    return undefined;
  }

  registerProcess(sessionId: string, proc: ClaudeProcess): void {
    this.processes.set(sessionId, proc);
  }

  /** Record that oldId now maps to newId. getProcess(oldId) will find the process registered under newId. */
  registerAlias(oldId: string, newId: string): void {
    if (oldId !== newId) {
      this.idAliases.set(oldId, newId);
    }
  }

  killProcess(sessionId: string): void {
    const proc = this.getProcess(sessionId);
    if (proc) {
      this.intentionalKills.add(sessionId);
      proc.kill();
      // Remove from processes map
      for (const [id, p] of this.processes) {
        if (p === proc) this.processes.delete(id);
      }
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

  /** Return PIDs of all Claude processes managed by PilotCode. */
  listManagedPids(): Set<number> {
    const pids = new Set<number>();
    for (const proc of this.processes.values()) {
      if (proc.pid) pids.add(proc.pid);
    }
    return pids;
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

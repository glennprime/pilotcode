import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import { appendFileSync } from 'fs';
import { join } from 'path';
import type { SDKMessage, StdinMessage, ContentBlock } from './types.js';
import { log } from '../logger.js';

const DEBUG_LOG = join(import.meta.dirname, '..', '..', 'data', 'claude-debug.log');
function debugLog(msg: string): void {
  try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

export interface ClaudeProcessOptions {
  cwd?: string;
  resume?: string;
  model?: string;
}

export class ClaudeProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  sessionId: string | null = null;
  private alive = false;

  constructor(private options: ClaudeProcessOptions = {}) {
    super();
    this.setMaxListeners(50); // Prevent warnings from multiple broadcast listeners
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--permission-mode', 'bypassPermissions',
    ];

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.resume) {
      args.push('--resume', this.options.resume);
    }

    const env = this.getCleanEnv();
    env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts';

    log('claude', `Spawning: claude ${args.join(' ')} (cwd: ${this.options.cwd || process.cwd()})`);

    this.child = spawn('claude', args, {
      cwd: this.options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.alive = true;

    const rl = createInterface({ input: this.child.stdout! });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      debugLog(`[stdout] ${line.substring(0, 500)}`);
      try {
        const msg: SDKMessage = JSON.parse(line);
        if (msg.type === 'system' && msg.session_id && !this.sessionId) {
          // Only set sessionId on the FIRST system message.
          // Claude sends subsequent system messages with the original ID on resume,
          // but our broadcast loop locks to the init alias. Keep them in sync.
          this.sessionId = msg.session_id;
        }
        this.emit('message', msg);
      } catch {
        // Non-JSON output, emit as log
        this.emit('stderr', line);
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      debugLog(`[stderr] ${data.toString().substring(0, 500)}`);
      this.emit('stderr', data.toString());
    });

    this.child.on('close', (code) => {
      log('claude', `Process exited with code ${code} (session: ${this.sessionId})`);
      this.alive = false;
      this.emit('close', code);
    });

    this.child.on('error', (err) => {
      log('claude', `Process error: ${err.message} (session: ${this.sessionId})`, 'error');
      this.alive = false;
      this.emit('error', err);
    });
  }

  write(msg: StdinMessage): void {
    if (!this.child?.stdin?.writable) {
      console.error('[claude] stdin not writable, dropping message:', msg.type);
      return;
    }
    const line = JSON.stringify(msg) + '\n';
    debugLog(`[stdin] ${line.substring(0, 500)}`);
    this.child.stdin.write(line);
  }

  sendMessage(content: string | ContentBlock[]): void {
    this.write({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  respondToPermission(requestId: string, allow: boolean, originalInput?: unknown): void {
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allow
          ? { behavior: 'allow' as const, updatedInput: (originalInput || {}) as Record<string, unknown> }
          : { behavior: 'deny', message: 'User denied permission' },
      },
    });
  }

  interrupt(): void {
    this.write({
      request_id: Math.random().toString(36).substring(2, 15),
      type: 'control_request',
      request: { subtype: 'interrupt' },
    });
  }

  kill(): void {
    if (this.child && this.alive) {
      this.child.kill('SIGTERM');
      this.alive = false;
    }
  }

  get isAlive(): boolean {
    return this.alive;
  }

  private getCleanEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const cwd = process.cwd();
    const pathKey = 'PATH';
    if (env[pathKey]) {
      env[pathKey] = env[pathKey]!
        .split(':')
        .filter((p) => !p.toLowerCase().startsWith(cwd.toLowerCase()))
        .join(':');
    }
    // Allow spawning Claude from within another Claude session
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    // Remove any other internal Claude env vars that could interfere
    for (const key of Object.keys(env)) {
      if (key.startsWith('CLAUDE_CODE_') || key === 'CLAUDECODE') {
        delete env[key];
      }
    }
    return env;
  }
}

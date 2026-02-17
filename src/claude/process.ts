import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import type { SDKMessage, StdinMessage, ContentBlock } from './types.js';

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
  }

  start(): void {
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--input-format', 'stream-json',
      '--permission-prompt-tool', 'stdio',
    ];

    if (this.options.model) {
      args.push('--model', this.options.model);
    }

    if (this.options.resume) {
      args.push('--resume', this.options.resume);
    }

    const env = this.getCleanEnv();
    env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts';

    this.child = spawn('claude', args, {
      cwd: this.options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.alive = true;

    const rl = createInterface({ input: this.child.stdout! });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg: SDKMessage = JSON.parse(line);
        if (msg.type === 'system' && msg.session_id) {
          this.sessionId = msg.session_id;
        }
        this.emit('message', msg);
      } catch {
        // Non-JSON output, emit as log
        this.emit('stderr', line);
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      this.emit('stderr', data.toString());
    });

    this.child.on('close', (code) => {
      this.alive = false;
      this.emit('close', code);
    });

    this.child.on('error', (err) => {
      this.alive = false;
      this.emit('error', err);
    });
  }

  write(msg: StdinMessage): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  sendMessage(content: string | ContentBlock[]): void {
    this.write({
      type: 'user',
      message: { role: 'user', content },
    });
  }

  respondToPermission(requestId: string, allow: boolean): void {
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allow
          ? { behavior: 'allow' }
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
    return env;
  }
}

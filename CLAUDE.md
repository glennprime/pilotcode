# PilotCode — Project Context for Claude

## What This Is

PilotCode is a self-hosted web UI that lets users control Claude Code from any browser (especially mobile). It runs a Node.js server on the user's Mac that spawns Claude CLI processes, streams output over WebSocket, and serves a mobile-first PWA chat interface.

## Architecture

- **Backend**: Express + `ws` WebSocket server (TypeScript, port 3456)
- **Frontend**: Vanilla HTML/CSS/JS (no build step, no framework)
- **Claude Integration**: Spawns `claude` CLI with `--output-format stream-json --input-format stream-json --permission-prompt-tool stdio`
- **Storage**: File-based (JSON files in `data/`), no database
- **Auth**: Random token generated on first run, stored in `data/config.json`, validated via HTTP-only cookie
- **Remote Access**: Cloudflare Tunnel (optional) for HTTPS access from anywhere

## Key Files

- `src/server.ts` — Express + WebSocket server entry point
- `src/config.ts` — Configuration (port, paths, auth token)
- `src/claude/process.ts` — Spawns Claude CLI, reads/writes JSON lines over stdin/stdout
- `src/claude/manager.ts` — Session lifecycle management
- `src/claude/types.ts` — SDK message type definitions
- `src/ws/handler.ts` — WebSocket message routing, cross-device broadcasting
- `src/routes/auth.ts` — Token auth + cookie session
- `src/routes/api.ts` — REST endpoints (sessions, uploads, history)
- `public/` — Frontend (index.html, js/, css/)

## How Claude CLI Integration Works

The server spawns `claude` as a child process with JSON streaming:
- **User messages** are written to stdin as `{ type: 'user', message: { role: 'user', content: ... } }`
- **Claude responses** are read from stdout as JSON lines (assistant messages, tool use, results)
- **Permission requests**: Claude sends `control_request` → server forwards to browser via WebSocket → user taps Allow/Deny → server writes `control_response` to stdin
- **Important**: `CLAUDECODE` env var must be deleted from the child process environment to allow spawning Claude from within a Claude session

### Permission Response Protocol (critical)

When responding to a `control_request` with `behavior: 'allow'`, the response **must** include `updatedInput` containing the original tool input from the request. Without this, Claude CLI throws a ZodError (`Cannot read properties of undefined (reading 'match')`). The server caches pending permission request inputs in `pendingPermissionInputs` map and passes them back as `updatedInput` in the allow response.

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "...",
    "response": {
      "behavior": "allow",
      "updatedInput": { "command": "git clone ...", "timeout": 120000 }
    }
  }
}
```

## Setup Instructions (for new users)

1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once to authenticate with your Anthropic account
3. Clone this repo and run `npm install`
4. Run `npm start` — save the auth token it prints
5. Open `http://localhost:3456` and enter the token
6. See README.md for remote access setup via Cloudflare Tunnel

## Development

- `npm run dev` — start with file watching (auto-restart on changes)
- `npm start` — start normally
- `npm run tunnel` — start server + Cloudflare Tunnel together

## Known Issues & Fixes (changelog)

These were discovered during development and are now resolved:

1. **ZodError on permission Allow** — Claude CLI requires `updatedInput` with the original tool input in allow responses. Fixed by caching `control_request` inputs server-side and passing them back.
2. **Service worker caching chrome-extension:// URLs** — Added `if (!e.request.url.startsWith('http')) return;` guard.
3. **Auth cookie not setting on localhost** — Made `secure` flag dynamic based on request protocol; `sameSite` is `strict` on HTTPS, `lax` on HTTP.
4. **highlight.js CDN 404** — Updated from dead nicehash fork to official `highlight.js@11`.
5. **Claude CLI refusing to spawn** — `CLAUDECODE` env var must be deleted in `getCleanEnv()`.
6. **Duplicate sessions on resume** — Claude returns a new session ID on resume. Fixed to update existing entry instead of creating duplicate.
7. **Tool use labels cluttering chat** — Hidden via CSS; spinner shows friendly labels instead (e.g. "Running command..." for Bash).
8. **Chat history not syncing across devices** — Moved from localStorage to server-side `data/history/<sessionId>.json`.

## Important Notes

- This is a single-user application. One server = one person's Claude sessions.
- The `data/` directory is gitignored. It contains sessions, chat history, uploaded files, and the auth token.
- Environment variables can be set in `.env` (see `.env.example`).
- The frontend uses CDN-loaded `marked` and `highlight.js` for markdown rendering. If CDN is unavailable, the app still works (just no syntax highlighting).
- Debug logging writes to `data/claude-debug.log` — useful for diagnosing permission or CLI communication issues.

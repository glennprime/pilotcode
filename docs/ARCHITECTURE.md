# PilotCode Architecture

## Overview

PilotCode is a self-hosted web UI for controlling Claude Code from your phone. It runs a Node.js server on your Mac, spawns Claude CLI processes, streams output over WebSocket, and serves a mobile-first PWA chat interface — accessible from anywhere via Cloudflare Tunnel.

Each session is a fully independent Claude CLI process — like having multiple terminal tabs open.

## System Diagram

```
Your phone (anywhere, on cellular)
    |
    | HTTPS (Cloudflare Tunnel)
    |
Your Mac at home
    |
PilotCode Server (Express + WebSocket, port 3456)
    |
    |--- Session A: claude --output-format stream-json (child process)
    |--- Session B: claude --output-format stream-json (child process)
    |--- Session C: claude --output-format stream-json (child process)
    |
    | stdin/stdout JSON lines
    |
Claude CLI → Anthropic API
```

## Tech Stack

- **Backend**: Express + `ws` WebSocket server (TypeScript)
- **Frontend**: Vanilla HTML/CSS/JS (no build step, no framework)
- **Claude Integration**: Spawns `claude` CLI with `--output-format stream-json --input-format stream-json`
- **Storage**: File-based (JSON files in `data/`), no database
- **Auth**: Random token generated on first run, HTTP-only cookie
- **Remote Access**: Cloudflare Tunnel (optional) for HTTPS from anywhere
- **Process Manager**: launchd for auto-start on boot

## Key Directories

```
pilotcode/
├── src/                    # TypeScript backend
│   ├── server.ts           # Express + WebSocket server entry
│   ├── config.ts           # Configuration (port, paths, auth token)
│   ├── logger.ts           # Logging utility
│   ├── claude/
│   │   ├── process.ts      # Spawns Claude CLI, reads/writes JSON lines
│   │   ├── manager.ts      # Session lifecycle management
│   │   ├── types.ts        # SDK message type definitions
│   │   └── sessions.ts     # Session validation utilities
│   ├── ws/
│   │   └── handler.ts      # WebSocket message routing, broadcasting
│   └── routes/
│       ├── auth.ts         # Token auth + cookie session
│       └── api.ts          # REST endpoints (sessions, uploads, history)
├── public/                 # Frontend (served statically)
│   ├── index.html          # Single-page app shell
│   ├── sw.js               # Service worker for PWA caching
│   ├── manifest.json       # PWA manifest
│   ├── js/
│   │   ├── app.js          # Main app controller + message routing
│   │   ├── chat.js         # Chat message rendering
│   │   ├── sessions.js     # Session list, create, delete, switch
│   │   ├── ws-client.js    # WebSocket client with reconnect + heartbeat
│   │   ├── permissions.js  # Permission, plan, question card rendering
│   │   ├── markdown.js     # Markdown rendering (marked + highlight.js)
│   │   └── images.js       # Image upload + preview
│   └── css/
│       └── app.css         # All styles
└── data/                   # Runtime data (gitignored)
    ├── config.json          # Auth token
    ├── sessions.json        # Session metadata
    ├── history/             # Per-session chat history
    ├── images/              # Uploaded images
    └── claude-debug.log     # Claude stdin/stdout debug log
```

## Session Lifecycle

### Creation
1. User fills modal (name, cwd, model) → clicks Create
2. Client sends `create_session` WebSocket message
3. Server spawns `claude` child process with `--output-format stream-json`
4. Server sends "hello" to Claude's stdin to trigger system init
5. Claude emits `system` message with session ID
6. Server sends `session_created` directly to client
7. Client shows chat UI with "Thinking..." spinner
8. Claude responds → server broadcasts → client renders

### Switching (Resume)
1. User taps session in sidebar
2. Client sends `resume_session` with session ID
3. Server checks if process is still alive
   - **Alive**: adds client to session, replays buffered messages
   - **Dead**: spawns new process with `--resume <sessionId>`
4. Client receives `session_rejoined` + buffered messages

### Deletion
1. User taps delete button in sidebar
2. Client clears chat UI immediately
3. Server kills the Claude process
4. Server removes session from sessions.json

### Page Reload
1. Client checks localStorage for last session ID
2. Loads chat history from server (`/api/history/<sessionId>`)
3. Connects WebSocket, sends `rejoin_session`
4. Server replays buffered messages (chat is cleared first to prevent duplicates)

## Message Flow

### User → Claude
```
Browser input → sendMessage() → WebSocket → handler.ts → proc.sendMessage() → Claude stdin
```

### Claude → User
```
Claude stdout → process.ts readline → handler.ts broadcast → WebSocket → chat.js render
```

### Message Types (Claude CLI → Server)
| Type | Purpose |
|------|---------|
| `system` | Session init (session_id, model, cwd, tools) |
| `assistant` | Claude's text + tool_use blocks |
| `user` | Tool results flowing back |
| `result` | Turn complete (usage, cost, duration) |
| `control_request` | Permission prompt (auto-approved) |
| `log` | Debug logs |

### Message Types (Server → Client)
| Type | Purpose |
|------|---------|
| `session_created` | New session initialized |
| `session_rejoined` | Reconnected to existing session |
| `session_id_update` | Session ID changed (drift) |
| `session_status` | Busy/idle indicator |
| `plan_approval` | Plan mode card |
| `user_question` | Question card |
| `process_exit` | Session ended |

## Broadcasting

Messages from Claude are broadcast to all WebSocket clients registered for that session.

- **`broadcastAll(sessionId, data)`**: Tags with `_sid`, buffers, sends to session clients
- **`broadcastGlobal(data)`**: Sends to ALL connected clients (for session_status)
- **`broadcast(sessionId, data, exclude)`**: Like broadcastAll but excludes one client

Client-side filtering: `ws-client.js` drops messages where `_sid !== activeSessionId`.

## Session ID Drift

Claude CLI sometimes returns a different session ID on resume. The server:
1. Detects drift via `ID_DRIFT_IGNORED` log
2. Registers an alias so the process can be found by either ID
3. Continues broadcasting on the canonical (original) ID
4. Sends `session_id_update` on both old and new IDs

## Service Worker (PWA)

- Cache version: `pilotcode-v52`
- Strategy: network-first with cache fallback
- Caches all static assets (HTML, CSS, JS)
- Skips API calls and WebSocket
- Bump version in `sw.js` to force cache invalidation

## Launchd Services

```
~/Library/LaunchAgents/com.pilotcode.server.plist  → Node.js server
```

The Cloudflare Tunnel connector is installed as a system service by `cloudflared service install` during setup.

Management:
```bash
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist    # Start
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist  # Stop
```

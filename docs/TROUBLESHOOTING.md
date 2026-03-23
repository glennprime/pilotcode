# PilotCode Troubleshooting

## Common Issues

### Session stuck on "Thinking..." spinner

**Cause**: Session ID drift — Claude CLI returned a different session ID on resume, and the client's filter is rejecting messages tagged with the canonical ID.

**Fix**:
1. Open sidebar, tap the session to re-join it
2. If that doesn't work, delete the session and create a new one
3. Check `data/server.log` for `ID_DRIFT_IGNORED` entries

**Prevention**: The server now broadcasts `session_id_update` on both old and new IDs and migrates client connections automatically.

---

### Duplicate messages in chat

**Cause**: History was loaded from server, then buffer replay sent the same messages again.

**Fix**:
1. Hard refresh the page (clears the DOM)
2. Delete the session and start fresh

**Prevention**: The `session_rejoined` handler now clears the chat before buffer replay to prevent stacking.

---

### Double greeting on session creation

**Cause**: Server sends a kick-start "hello" to trigger Claude's system init. Client was also sending a pending message or auto-greet.

**Fix**: Fixed in code — server sends exactly one kick-start, client no longer auto-greets.

---

### Chat doesn't clear when deleting session

**Cause**: Service worker serving cached old JavaScript.

**Fix**:
1. Bump `CACHE_NAME` version in `public/sw.js`
2. Restart the server
3. On mobile: close ALL tabs, wait 5 seconds, reopen
4. Nuclear option: clear site data in browser settings

---

### Session created but screen stays on "Start a conversation"

**Cause**: The `session_created` message from the server was filtered by the client.

**Fix**: Fixed in code — the server now broadcasts `session_created` globally (to all clients) AND sends it directly to the originating WebSocket.

---

### WebSocket disconnects frequently

**Symptoms**: Connection dot turns red, messages don't arrive.

**Possible causes**:
1. **Cloudflare Tunnel timeout**: Tunnel drops idle connections
2. **Mobile background**: iOS/Android kill WebSocket when app is backgrounded
3. **Network switch**: WiFi → cellular transition kills the connection

**Fix**:
- The client has automatic reconnect with exponential backoff (1s → 10s max)
- Stale connection detection: if no messages for 60s, forces reconnect
- `visibilitychange` listener forces reconnect when returning to the app
- Server has protocol-level ping/pong every 30s to keep connections alive

---

### Can't send messages — input appears disabled

**Cause**: `sessionUI.currentSessionId` is stuck on `'__creating__'` because the session creation never completed.

**Fix**:
1. Refresh the page
2. Create a new session

---

### Claude process won't start

**Symptoms**: "No active session" error when sending messages.

**Check**:
```bash
# Is Claude CLI installed?
which claude

# Is Claude authenticated?
claude --version

# Check server logs
tail -50 data/server.log

# Check Claude debug log
tail -50 data/claude-debug.log
```

**Common causes**:
- Claude CLI not in PATH (check launchd plist for PATH)
- Node.js needs Full Disk Access (System Settings → Privacy & Security)
- `CLAUDECODE` env var not cleaned (prevents spawning Claude from Claude)

---

### Session resumes but Claude "forgets" context

**Cause**: `--resume` with an expired session ID creates a new session instead of resuming.

**Details**: Claude CLI session IDs expire after a period of inactivity. When the server tries to `--resume` an expired ID, Claude starts fresh but returns a different session ID. This triggers `ID_CHANGED` in the logs.

**Fix**: This is expected behavior. The conversation context is managed by Claude CLI — if it expires, a fresh start is the only option.

---

### "Session ended" appears unexpectedly

**Cause**: Claude process crashed or was killed.

**Check**:
```bash
# Check for crash info
grep "PROCESS_EXIT\|CRASH" data/server.log | tail -10

# Check Claude's stderr
grep "stderr" data/claude-debug.log | tail -10
```

**Common causes**:
- Anthropic API error (500, rate limit)
- Process killed by OOM
- macOS TCC permission denied

---

## Debugging

### Server Logs

```bash
# Live server log
tail -f data/server.log

# Claude stdin/stdout debug log
tail -f data/claude-debug.log

# Server error log (launchd stderr)
tail -f data/server.error.log
```

### Key Log Patterns

| Pattern | Meaning |
|---------|---------|
| `CREATE name=...` | New session being created |
| `INIT newId=...` | Claude process initialized with session ID |
| `ID_DRIFT_IGNORED` | Claude returned different ID on resume (handled) |
| `ID_CHANGED` | Session ID changed — old session replaced |
| `RESUME_FOUND_ALIVE` | Reconnected to existing running process |
| `RESUME_UNKNOWN` | Tried to resume deleted/expired session |
| `RESUME_SPAWN` | Spawning new process for resumed session |
| `MESSAGE_SENT` | User message forwarded to Claude |
| `MESSAGE_DROPPED` | Message couldn't be delivered (no process) |
| `BUFFER_REPLAY` | Sending buffered messages to reconnecting client |
| `PROCESS_EXIT` | Claude process exited |

### Checking Session State

```bash
# List active sessions
curl -s -b "pilotcode_token=YOUR_TOKEN" http://localhost:3456/api/sessions | python3 -m json.tool

# Check session history
curl -s -b "pilotcode_token=YOUR_TOKEN" http://localhost:3456/api/history/SESSION_ID | python3 -m json.tool
```

### Service Worker Issues

If the browser is serving stale code:

1. Bump version in `public/sw.js`: `const CACHE_NAME = 'pilotcode-vXX';`
2. Restart the server
3. On mobile, close and reopen the browser
4. If stuck, clear site data in browser settings

### Restarting the Server

```bash
# Stop and start (launchd)
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist

# Manual run (for debugging)
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist
cd ~/Dev/pilotcode && npm start

# Check if running
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456
```

### macOS Permissions

Node.js needs **Full Disk Access** in System Settings → Privacy & Security. The binary path is version-specific:

```bash
# Find your node binary
which node
# e.g., ~/.nvm/versions/node/v22.20.0/bin/node
```

Add this exact path in System Settings. Must be re-added after Node version changes.

## Known Limitations

1. **Single user**: One server = one person's Claude sessions
2. **Buffer size**: Only 100 most recent messages are buffered for replay
3. **No offline mode**: Requires server connection (PWA caches static assets only)
4. **Session expiry**: Claude CLI sessions can expire after inactivity — resume creates a new session
5. **Image support**: Images are uploaded to server, not sent inline to Claude (documents are sent as file paths)
6. **Auto-compact**: Controlled by `~/.claude/settings.json`, not PilotCode — set `autoCompact: true` there

# Session Flow Reference

## State Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `sessionUI.currentSessionId` | sessions.js | Which session the UI is showing. `null` = none, `'__creating__'` = waiting for server |
| `chat.sessionId` | chat.js | Which session the chat is rendering messages for |
| `wsClient.activeSessionId` | ws-client.js | Which session's messages to accept (client-side filter) |
| `creatingSession` | app.js | Boolean — is a session creation in progress? |
| `sessionGreeted` | app.js | Boolean — has this session shown its initial greeting? |
| `pendingMessage` | app.js | Message queued while session was being created |

## Create Session (from modal)

```
User clicks Create
    │
    ▼
sessions.js: createSession()
    ├─ currentSessionId = '__creating__'
    ├─ wsClient.setActiveSession(null)     ← accept all messages
    ├─ send { type: 'create_session', name, cwd, model }
    └─ onSessionChange(name, '__creating__', cwd)
           │
           ▼
    app.js callback:
        ├─ chat.switchSession(null)        ← clear chat
        ├─ creatingSession = true
        ├─ hideNoSessionPrompt()           ← show chat area
        └─ chat.showThinking('Starting session...')
                                            │
                                            ▼
                                    Server: handleCreateSession()
                                        ├─ spawn claude process
                                        ├─ ensureBroadcastWired()
                                        └─ proc.sendMessage('hello')  ← kick-start
                                            │
                                            ▼
                                    Claude: emits system message
                                        │
                                        ▼
                                    Server: session_created sent to client
                                        ├─ direct to originWs
                                        ├─ broadcastAll(sessionId)
                                        └─ broadcastGlobal()
                                            │
                                            ▼
app.js: handleMessage('session_created')
    ├─ sessionUI.setCurrentSession(sessionId)
    ├─ chat.setSession(sessionId)
    ├─ wsClient.setActiveSession(sessionId) ← filter active
    ├─ creatingSession = false
    ├─ hideNoSessionPrompt()
    ├─ if pendingMessage: show + send it
    └─ else: chat.showThinking()
                                            │
                                            ▼
                                    Claude: emits assistant response
                                        │
                                        ▼
                                    Server: broadcastAll(sessionId, msg)
                                        │
                                        ▼
app.js → chat.handleSDKMessage(msg)
    └─ renderAssistantMessage() → shows in chat
```

## Resume Session (switch from sidebar)

```
User taps session in sidebar
    │
    ▼
sessions.js: resumeSession(sessionId, name, cwd)
    ├─ currentSessionId = sessionId
    ├─ wsClient.setActiveSession(sessionId)
    ├─ send { type: 'resume_session', sessionId }
    └─ onSessionChange(name, sessionId, cwd)
           │
           ▼
    app.js callback:
        ├─ chat.switchSession(sessionId)   ← clear + load history
        └─ hideNoSessionPrompt()
                                            │
                                            ▼
                                    Server: handleResumeSession()
                                        ├─ Process alive?
                                        │   ├─ YES: addClient, replay buffer
                                        │   └─ NO: spawn with --resume
                                        └─ send session_rejoined
                                            │
                                            ▼
app.js: handleMessage('session_rejoined')
    ├─ clear messages div (prevent history+replay duplicates)
    ├─ clear renderedMessageIds
    └─ set busy if session is working
                                            │
                                            ▼
                                    Server: replayBufferedMessages()
                                        ├─ sends last 100 messages
                                        └─ sends session_busy if still working
                                            │
                                            ▼
app.js → chat.handleSDKMessage() for each replayed message
    └─ renders messages fresh (chat was cleared)
```

## Page Reload

```
Browser reloads
    │
    ▼
app.js: showApp()
    ├─ lastSessionId = localStorage.get('pilotcode_session')
    ├─ chat.loadHistory(lastSessionId)     ← fetch + render history
    ├─ wsClient.setActiveSession(lastSessionId)
    └─ wsClient.connect()
           │
           ▼
    ws-client.js: onopen
        └─ send { type: 'rejoin_session', sessionId: activeSessionId }
                                            │
                                            ▼
                                    Server: handleRejoinSession()
                                        └─ replayBufferedMessages()
                                            │
                                            ▼
app.js: handleMessage('session_rejoined')
    ├─ CLEARS messages div                 ← prevents duplicates
    └─ buffer replay renders messages fresh
```

## Delete Session

```
User taps delete in sidebar
    │
    ▼
sessions.js: deleteSession(sessionId)
    ├─ currentSessionId = null
    ├─ wsClient.setActiveSession(null)
    ├─ localStorage.removeItem('pilotcode_session')
    ├─ messages.innerHTML = ''             ← clear chat immediately
    ├─ show no-session-prompt
    ├─ onSessionChange(null, null)
    └─ fetch DELETE /api/sessions/{id}     ← server cleanup in background
```

## Session ID Drift

When Claude CLI returns a different session ID on resume:

```
Server sees: system message with different session_id
    │
    ▼
handler.ts: ID_DRIFT_IGNORED
    ├─ registers alias (driftedId → canonicalId)
    ├─ continues broadcasting on canonicalId
    └─ client stays on canonicalId (no disruption)

If drift happens on INIT (replacesSessionId set):
    ├─ broadcasts session_id_update on BOTH IDs
    ├─ migrates clients from old to new session set
    └─ client updates via session_id_update handler
```

# PilotCode

Control Claude Code from your phone. PilotCode is a self-hosted web app that runs on your Mac and gives you a mobile-friendly chat interface to Claude Code — create sessions, stream responses, handle permissions, upload files, and bounce between projects from anywhere.

![PilotCode](https://img.shields.io/badge/Claude_Code-Remote_UI-blueviolet)

## What It Does

- Chat with Claude Code from any browser (phone, tablet, laptop)
- Create separate sessions per project with different models (Opus, Sonnet, Haiku)
- Stream responses in real-time with tool use visibility
- Allow/Deny tool permissions from the UI (same as the CLI)
- Upload images, screenshots, PDFs, and documents
- Multi-device sync — open on phone and laptop simultaneously
- Sessions persist across server restarts
- PWA — add to your iPhone home screen for a native-app feel

---

## Setup Guide

### Prerequisites

| Requirement | How to check | How to install |
|---|---|---|
| **macOS** (Apple Silicon or Intel) | You're on a Mac | — |
| **Node.js 20+** | `node -v` | `brew install node` or [nvm](https://github.com/nvm-sh/nvm) |
| **Claude Code CLI** | `claude --version` | `npm install -g @anthropic-ai/claude-code` |
| **Anthropic account** | — | [console.anthropic.com](https://console.anthropic.com) with a Max plan or API key |

### Step 1: Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

Run `claude` once in your terminal to log in. It'll open a browser for authentication. Once Claude responds to a message, you're good — press `Ctrl+C` to exit.

### Step 2: Clone and install PilotCode

```bash
git clone https://github.com/glennprime/pilotcode.git
cd pilotcode
npm install
```

### Step 3: Configure (optional)

```bash
cp .env.example .env
```

Edit `.env` if you want to customize:

| Variable | Default | Description |
|---|---|---|
| `PILOTCODE_TOKEN` | auto-generated | Auth token for the web UI |
| `PILOTCODE_CWD` | home directory | Default working directory for new sessions |
| `PILOTCODE_PORT` | 3456 | Server port |
| `CLOUDFLARE_TUNNEL` | pilotcode | Tunnel name (for remote access) |

### Step 4: Start the server

```bash
npm start
```

First run prints an **auth token**:

```
  ╔══════════════════════════════════════╗
  ║         PilotCode Server             ║
  ╠══════════════════════════════════════╣
  ║  http://localhost:3456               ║
  ║                                      ║
  ║  Auth token: a1b2c3d4...e5f6         ║
  ╚══════════════════════════════════════╝

  Full token: a1b2c3d4e5f67890abcdef1234567890
```

**Copy the full token.** You need it to log in.

### Step 5: Open in your browser

Go to `http://localhost:3456`, paste the token, and you're in.

Send a message or tap the hamburger menu → **+ New** to create a session with a specific project directory and model.

---

## Remote Access (Cloudflare Tunnel)

This lets you use PilotCode from anywhere — your phone on cellular, a coffee shop, etc. It creates a permanent HTTPS URL without opening ports on your router.

### 1. Install cloudflared

```bash
brew install cloudflared
```

### 2. Set up a Cloudflare account and domain

You need a domain managed by Cloudflare. The free tier works fine.

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Add your domain (or buy one cheap — `.dev` domains are ~$12/yr)
3. Point your domain's nameservers to Cloudflare (they'll walk you through it)

### 3. Authenticate cloudflared

```bash
cloudflared tunnel login
```

This opens a browser — select your domain and authorize.

### 4. Create the tunnel

```bash
cloudflared tunnel create pilotcode
```

It prints a tunnel ID like `ada21ecf-69d8-4179-bed2-c894dbdb974e`. You'll need this.

### 5. Route DNS

```bash
cloudflared tunnel route dns pilotcode pilot.yourdomain.com
```

Replace `pilot.yourdomain.com` with whatever subdomain you want.

### 6. Create the tunnel config

Create the file `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID_HERE
credentials-file: /Users/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_ID_HERE.json

ingress:
  - hostname: pilot.yourdomain.com
    service: http://localhost:3456
  - service: http_status:404
```

Replace the placeholders with your actual values. Find the credentials file:

```bash
ls ~/.cloudflared/*.json
```

### 7. Test it

```bash
# Start both server + tunnel in one command:
npm run tunnel
```

Or run them separately:

```bash
# Terminal 1
npm start

# Terminal 2
cloudflared tunnel run pilotcode
```

Now open `https://pilot.yourdomain.com` from any device, anywhere.

---

## Auto-Start on Boot (launchd)

So PilotCode runs automatically when your Mac starts up, and restarts if it crashes.

### Find your paths first

```bash
which npx        # e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/npx
which node       # e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/node
which cloudflared  # e.g. /opt/homebrew/bin/cloudflared
echo $HOME       # e.g. /Users/you
pwd              # run this inside the pilotcode directory
```

### Server plist

Save as `~/Library/LaunchAgents/com.pilotcode.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pilotcode.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/FULL/PATH/TO/npx</string>
        <string>tsx</string>
        <string>/FULL/PATH/TO/pilotcode/src/server.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/FULL/PATH/TO/pilotcode</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/FULL/PATH/TO/pilotcode/data/server.log</string>
    <key>StandardErrorPath</key>
    <string>/FULL/PATH/TO/pilotcode/data/server.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/FULL/PATH/TO/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/YOUR_USERNAME</string>
    </dict>
</dict>
</plist>
```

### Tunnel plist (if using Cloudflare)

Save as `~/Library/LaunchAgents/com.pilotcode.tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pilotcode.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>pilotcode</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/FULL/PATH/TO/pilotcode/data/tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>/FULL/PATH/TO/pilotcode/data/tunnel.error.log</string>
</dict>
</plist>
```

### Load them

```bash
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
launchctl load ~/Library/LaunchAgents/com.pilotcode.tunnel.plist
```

### Managing the services

```bash
# Check if running
launchctl list | grep pilotcode

# View logs
tail -f ~/Dev/pilotcode/data/server.log
tail -f ~/Dev/pilotcode/data/server.error.log

# Stop (temporarily — KeepAlive will restart it)
launchctl stop com.pilotcode.server

# Fully stop (won't auto-restart)
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist

# Restart after code changes
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
```

---

## macOS Permissions (Important)

Node.js needs **Full Disk Access** so Claude Code can read/write files without macOS blocking it (especially important for headless/remote operation).

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add your `node` binary

Find the exact path:
```bash
which node
# e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/node
```

> If you update Node.js, the path changes and you'll need to re-add it.

---

## Install as PWA (iPhone)

1. Open PilotCode in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Tap **"Add to Home Screen"**
4. Name it "PilotCode" and tap Add

It opens full-screen like a native app.

---

## Using PilotCode

### Sessions

Sessions are separate Claude conversations, each tied to a project directory.

- **Create from chat**: Just type a message — a session is auto-created using your default directory
- **Create from menu**: Tap hamburger (☰) → **+ New** to pick a name, model, and working directory
- **Switch sessions**: Tap hamburger → tap any session to switch
- **Resume**: Sessions survive server restarts. Switch back anytime and pick up where you left off.

### Models

When creating a session, pick your model:

| Model | Best for |
|---|---|
| **Opus 4.6** | Complex tasks, architecture, multi-file changes |
| **Sonnet 4.6** | Fast, capable, good default |
| **Haiku 4.5** | Quick questions, simple edits, cheapest |

### Permissions

When Claude wants to run a command, edit a file, or access the web, you'll see an Allow/Deny card — same as the regular CLI. Tap Allow to proceed or Deny to block.

### Uploads

Tap the camera/paperclip button to attach:
- Screenshots and photos
- PDFs and documents
- Any file Claude can analyze

### Multi-device

Open PilotCode on multiple devices at once. Messages sync in real-time — start a conversation on your laptop, continue it from your phone.

---

## Troubleshooting

### "Process exited (code 1)" when starting a session
- Run `claude` in your terminal to make sure the CLI works
- Check that your Anthropic account has an active Max plan or API credits

### Stuck on "Thinking..." forever
- Check the server log: `tail -20 data/server.error.log`
- Try a hard refresh (`Cmd+Shift+R` or clear browser cache)
- Delete the session and create a new one

### Can't connect from phone
- Verify the server is running: `curl http://localhost:3456/api/auth/check`
- Verify the tunnel is running: `pgrep -f cloudflared`
- Make sure your Mac isn't in full sleep (display sleep is fine)

### Auth token lost
```bash
cat data/config.json
```
Or set a custom one in `.env`:
```
PILOTCODE_TOKEN=my-custom-token-here
```

### Debug logs
```bash
# Detailed Claude CLI communication
tail -50 data/claude-debug.log

# Server logs
tail -50 data/server.log
tail -50 data/server.error.log
```

---

## Development

```bash
npm run dev    # start with auto-reload on file changes
npm start      # start normally
npm run tunnel # start server + Cloudflare Tunnel together
```

The frontend is vanilla HTML/CSS/JS in `public/` — no build step. Edit and refresh.

---

## Architecture

```
Browser (phone/laptop)
    ↕ WebSocket + REST
PilotCode Server (Node.js/Express, port 3456)
    ↕ stdin/stdout JSON streaming
Claude CLI (claude --output-format stream-json)
    ↕ Anthropic API
Claude (Opus/Sonnet/Haiku)
```

- **Backend**: Express + `ws` WebSocket server (TypeScript)
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build)
- **Storage**: JSON files in `data/` (sessions, history, config)
- **Auth**: Random token + HTTP-only cookie
- **Remote**: Cloudflare Tunnel for HTTPS from anywhere

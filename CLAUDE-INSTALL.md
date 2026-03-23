# PilotCode — Claude Code Installation Guide

**This document is for Claude Code.** If a user asks you to install PilotCode, follow these instructions step by step. Ask the user for input when needed.

## What You're Installing

PilotCode is a self-hosted web UI that lets the user control Claude Code from their phone. It runs a Node.js server on their computer that spawns Claude CLI processes and serves a mobile-friendly chat interface, accessible from anywhere via Cloudflare Tunnel.

## Pre-Installation Checklist

Before starting, verify these prerequisites. Check each one and report the results to the user.

### 1. Detect the platform

```bash
uname -s
# Darwin = macOS, Linux = Linux
# If Windows: the user must be running inside WSL
```

### 2. Check Node.js (version 20+ required)

```bash
node -v
```

If not installed or below v20, tell the user:
- **macOS**: `brew install node` or install via [nvm](https://github.com/nvm-sh/nvm)
- **Linux**: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash` then `nvm install 22`
- **Windows (WSL)**: Same as Linux

### 3. Check Claude Code CLI

```bash
claude --version
```

If not installed, tell the user:
```bash
npm install -g @anthropic-ai/claude-code
```

Then they must run `claude` once in their terminal to authenticate with their Anthropic account. This requires a browser — you cannot do this for them.

### 4. Check cloudflared (needed for remote access)

```bash
cloudflared --version
```

If not installed:
- **macOS**: `brew install cloudflared`
- **Linux (Debian/Ubuntu)**: Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- **Linux (other)**: Same URL, pick the right package

## Installation Steps

### Step 1: Clone the repository

```bash
cd ~
git clone https://github.com/glennprime/pilotcode.git
cd pilotcode
npm install
```

### Step 2: Configure the environment

Ask the user these questions:

1. **"What directory do you want Claude to work in by default?"**
   - This is the default working directory for new sessions
   - Common answers: `~/Dev`, `~/projects`, `~/code`, home directory
   - Resolve the path to absolute (e.g. `~/Dev` → `/Users/them/Dev`)

2. **"Do you want to set a custom auth token, or should I generate one?"**
   - The auth token is the password they'll enter on their phone
   - If custom: use what they provide (warn if less than 8 characters)
   - If auto-generate: use `openssl rand -hex 16` or `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`

3. **"What port should PilotCode run on?"**
   - Default: 3456
   - Only change if something else is using that port

Write the `.env` file:

```bash
cat > ~/pilotcode/.env << EOF
# PilotCode Configuration
PILOTCODE_CWD=/absolute/path/to/their/directory
PILOTCODE_TOKEN=their-token-here
PILOTCODE_PORT=3456
EOF
```

### Step 3: Create the data directory

```bash
mkdir -p ~/pilotcode/data
```

### Step 4: Test the server

Start the server and verify it responds:

```bash
cd ~/pilotcode && npm start &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456
```

If it returns 200 or 302, the server works. Kill the test process:

```bash
kill %1 2>/dev/null
```

Tell the user: "Server works. Your auth token is: [TOKEN]. Save this — you'll need it to log in from your phone."

### Step 5: Set up auto-start on boot

Ask the user: **"Do you want PilotCode to start automatically when your computer boots?"**

If yes, set up the appropriate service:

#### macOS (launchd)

Get the paths:
```bash
NPX_PATH=$(which npx)
NODE_PATH=$(which node)
NODE_BIN_DIR=$(dirname "$NODE_PATH")
PROJECT_DIR=$(cd ~/pilotcode && pwd)
USER_HOME=$HOME
```

Create the plist:
```bash
cat > ~/Library/LaunchAgents/com.pilotcode.server.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pilotcode.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NPX_PATH}</string>
        <string>tsx</string>
        <string>${PROJECT_DIR}/src/server.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${PROJECT_DIR}/data/server.log</string>
    <key>StandardErrorPath</key>
    <string>${PROJECT_DIR}/data/server.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${NODE_BIN_DIR}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${USER_HOME}</string>
    </dict>
</dict>
</plist>
EOF
```

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
```

Verify:
```bash
launchctl list | grep pilotcode
```

Tell the user: "PilotCode will now auto-start when your Mac boots and auto-restart if it crashes."

**Important macOS step:** Tell the user they need to add Node.js to Full Disk Access:
- System Settings → Privacy & Security → Full Disk Access → click + → add the node binary
- Show them the path: `which node`

#### Linux (systemd)

```bash
mkdir -p ~/.config/systemd/user

NPX_PATH=$(which npx)
NODE_BIN_DIR=$(dirname $(which node))
PROJECT_DIR=$(cd ~/pilotcode && pwd)

cat > ~/.config/systemd/user/pilotcode.service << EOF
[Unit]
Description=PilotCode Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NPX_PATH} tsx src/server.ts
Restart=always
RestartSec=5
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
Environment=HOME=${HOME}

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable pilotcode
systemctl --user start pilotcode
sudo loginctl enable-linger $USER
```

Verify:
```bash
systemctl --user status pilotcode
```

#### Windows (WSL)

Create startup script:
```bash
cat > ~/start-pilotcode.sh << 'EOF'
#!/bin/bash
cd ~/pilotcode
source ~/.nvm/nvm.sh 2>/dev/null
npm start >> data/server.log 2>> data/server.error.log &
EOF
chmod +x ~/start-pilotcode.sh
```

Tell the user to run this in PowerShell as Admin (they need to do this part themselves):
```powershell
$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu -u USERNAME -- bash -c '/home/USERNAME/start-pilotcode.sh'"
$trigger = New-ScheduledTaskTrigger -AtLogon
Register-ScheduledTask -TaskName "PilotCode" -Action $action -Trigger $trigger
```

### Step 6: Remote access guidance

At this point, the server is installed and running. Tell the user:

---

**PilotCode is installed and running on your computer!**

**Your auth token is: `[TOKEN]` — save this somewhere safe.**

**To access PilotCode from your phone, you need to set up a Cloudflare Tunnel. This requires a few manual steps in the Cloudflare web dashboard that I can't do for you:**

1. **Create a Cloudflare account** (free) at https://dash.cloudflare.com
2. **Buy a cheap domain** — In the Cloudflare dashboard, go to Domain Registration → Register Domains. Search for any name you like. Cheapest domains are around $5/year. You're not making a website — you just need the domain so Cloudflare can route traffic to your computer.
3. **Create a tunnel** — In the dashboard, go to Zero Trust → Networks → Tunnels → Create a tunnel → Choose "Cloudflared" → Name it "pilotcode" → It will give you a command to run — run it in your terminal.
4. **Route your domain** — In the tunnel config, add a public hostname: subdomain `pilot`, select your domain, type `HTTP`, URL `localhost:3456`.
5. **Open on your phone** — Go to `https://pilot.yourdomain.com` and enter your auth token.

**See the full walkthrough with screenshots in README.md (Part 3).**

---

## Troubleshooting

If the server won't start:
- Check `claude --version` works
- Check `data/server.error.log` for errors
- Make sure port 3456 isn't in use: `lsof -i :3456`

If the service won't load (macOS):
- Check the plist file syntax: `plutil ~/Library/LaunchAgents/com.pilotcode.server.plist`
- Check logs: `tail -50 ~/pilotcode/data/server.error.log`

If the service won't start (Linux):
- Check status: `systemctl --user status pilotcode`
- Check logs: `journalctl --user -u pilotcode`

## Summary of Files Created

| File | Purpose |
|------|---------|
| `~/pilotcode/` | The PilotCode project |
| `~/pilotcode/.env` | Configuration (token, working dir, port) |
| `~/pilotcode/data/` | Runtime data (sessions, history, logs) |
| `~/Library/LaunchAgents/com.pilotcode.server.plist` | macOS auto-start service |
| `~/.config/systemd/user/pilotcode.service` | Linux auto-start service |
| `~/start-pilotcode.sh` | Windows/WSL startup script |

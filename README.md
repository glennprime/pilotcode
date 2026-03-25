# PilotCode

Control Claude Code from your phone. PilotCode is a self-hosted web app that gives you a mobile-friendly chat interface to Claude Code — create sessions, stream responses, handle permissions, upload files, and manage multiple projects from anywhere on your phone.

Claude Code's built-in `/remote-control` drops sessions and isn't reliable. PilotCode gives you a stable, multi-session interface that works from any browser, anywhere.

![PilotCode](https://img.shields.io/badge/Claude_Code-Remote_UI-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)

## Why PilotCode?

I'm an airline pilot. I spend a lot of time in hotels during layovers, and I wanted to use Claude Code from my phone instead of lugging a laptop everywhere. Claude's built-in `/remote-control` wasn't cutting it — sessions would drop, there was no way to manage multiple projects, and it wasn't built for mobile. So I built PilotCode: a stable, multi-session interface that runs on your Mac at home and lets you control Claude Code from anywhere on your phone. Yes, the name is on purpose.

## What It Does

- Chat with Claude Code from your phone, tablet, or any browser
- Create separate sessions per project with different models (Opus, Sonnet, Haiku)
- Stream responses in real-time with tool use visibility
- Allow/Deny tool permissions from the UI (same as the CLI)
- Upload images, screenshots, PDFs, and documents
- Multi-device sync — open on phone and laptop simultaneously
- Sessions persist across server restarts
- PWA — add to your iPhone home screen for a native-app feel

## How It Works

```
Your phone (anywhere, on cellular)
    ↕ HTTPS (Cloudflare Tunnel)
Your Mac at home (PilotCode server, port 3456)
    ↕ stdin/stdout JSON streaming
Claude CLI (spawned as child process)
    ↕ Anthropic API
Claude (Opus/Sonnet/Haiku)
```

PilotCode runs on your Mac and spawns the Claude Code CLI as a child process. Your phone connects to it through a Cloudflare Tunnel, which gives you a permanent HTTPS URL without opening ports or exposing your IP. You control Claude from your phone exactly like you would from the terminal — but from anywhere.

---

## What You Need

| Requirement | Cost | How to get it |
|---|---|---|
| **macOS, Linux, or Windows (WSL)** | — | Your computer that runs Claude Code |
| **Node.js 20+** | Free | `brew install node` or [nvm](https://github.com/nvm-sh/nvm) |
| **Claude Code CLI** | Free with Max plan / or API credits | `npm install -g @anthropic-ai/claude-code` |
| **Anthropic account** | $20/mo (Max) or pay-per-use API | [console.anthropic.com](https://console.anthropic.com) |
| **Cloudflare account** | Free | [dash.cloudflare.com](https://dash.cloudflare.com) |
| **A domain name** | ~$5–10/year | Buy directly from Cloudflare (cheapest registrar) |

> **About the domain:** You're not building a website. You just need a domain name so Cloudflare can route traffic to your Mac through their tunnel. That's it. Cloudflare sells domains at cost with no markup — cheapest ones start around $4–5/year, `.com` is about $10/year. You'll set up a subdomain like `pilot.yourdomain.com` that points to your PilotCode server.

---

## Setup Guide

This guide walks you through everything from zero to using PilotCode on your phone. Takes about 15–20 minutes.

> **Already using Claude Code?** You can have Claude install PilotCode for you. Open Claude Code and say: *"Read CLAUDE-INSTALL.md from the pilotcode repo and install PilotCode on this machine."* It will walk you through the whole process.

### Part 1: Install Claude Code

**1. Install the CLI**

```bash
npm install -g @anthropic-ai/claude-code
```

**2. Log in**

```bash
claude
```

This opens a browser to authenticate with your Anthropic account. Once Claude responds to a message in the terminal, you're good — press `Ctrl+C` to exit.

---

### Part 2: Install PilotCode

**3. Clone and install**

```bash
git clone https://github.com/glennprime/pilotcode.git
cd pilotcode
npm install
```

**4. Run the setup wizard**

```bash
npm run setup
```

The setup wizard walks you through:
- Checking that Node.js, Claude CLI, and cloudflared are installed
- Setting your default working directory (where Claude will work)
- Creating your auth token (the password you'll use to log in from your phone)
- Choosing a port
- Testing that the server starts

At the end it prints your auth token — **save it**, you'll need it to log in from your phone.

> **Prefer to configure manually?** Copy `.env.example` to `.env` and edit it. See the table below:
>
> | Variable | Default | Description |
> |---|---|---|
> | `PILOTCODE_TOKEN` | auto-generated | Auth token for the web UI |
> | `PILOTCODE_CWD` | home directory | Default working directory for new sessions |
> | `PILOTCODE_PORT` | 3456 | Server port |

**5. Verify it works**

```bash
npm start
```

Open `http://localhost:3456` in a browser on your computer to verify it works. Send a test message. If Claude responds, the server is working.

Stop the server with `Ctrl+C` — we'll set it up to run permanently after configuring remote access.

---

### Part 3: Set Up Remote Access (Cloudflare Tunnel)

This is the part that lets you use PilotCode from your phone when you're away from home. Cloudflare Tunnel creates a secure HTTPS connection from the internet to your Mac — **no port forwarding, no router configuration, no exposing your IP address**. The tunnel works by making an outbound connection from your Mac to Cloudflare, so your router doesn't need any changes at all.

#### Step 1: Create a Cloudflare account

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (free)
2. Verify your email

#### Step 2: Buy a domain

You need a domain so Cloudflare can create a URL for your tunnel. You're not making a website — you just need the domain name.

1. In the Cloudflare dashboard, go to **Domain Registration → Register Domains**
2. Search for a domain name you like (e.g., `mytools.xyz`, `mycode.site`, `whatever.com`)
3. Pick the cheapest TLD — some are as low as $4–5/year, `.com` is about $10/year
4. Complete the purchase

> **Tip:** Pick something short and easy to type on your phone. You'll be typing `pilot.yourdomain.com` into Safari.

Once purchased, the domain is automatically managed by Cloudflare — no extra DNS setup needed.

#### Step 3: Install cloudflared on your Mac

```bash
brew install cloudflared
```

#### Step 4: Create the tunnel from the Cloudflare dashboard

1. In the Cloudflare dashboard, go to **Zero Trust** (left sidebar) → **Networks** → **Tunnels**
   - If this is your first time in Zero Trust, it will ask you to set up a team name. Pick anything — this is just an internal label.
2. Click **Create a tunnel**
3. Select **Cloudflared** as the connector type → **Next**
4. Name your tunnel (e.g., `pilotcode`) → **Save tunnel**
5. Under **Install and run a connector**, select your OS (**macOS**)
6. It will show you a command like:

```bash
cloudflared service install eyJhIGxvbmcgdG9rZW4gc3RyaW5nIn0=
```

**Run this command in your terminal.** This installs cloudflared as a system service and connects it to your Cloudflare account.

7. Wait a moment — you should see the connector appear as **Connected** in the dashboard
8. Click **Next**

#### Step 5: Route your domain to PilotCode

Still in the tunnel setup wizard:

1. Under **Public Hostnames**, fill in:
   - **Subdomain**: `pilot` (or whatever you want)
   - **Domain**: select your domain from the dropdown
   - **Type**: `HTTP`
   - **URL**: `localhost:3456`
2. Click **Save tunnel**

That's it. Your PilotCode server is now available at `https://pilot.yourdomain.com`.

#### Step 6: Open PilotCode on your phone

1. Make sure PilotCode is running on your Mac (`npm start` in the pilotcode directory)
2. On your phone, open Safari (or any browser)
3. Go to `https://pilot.yourdomain.com`
4. Enter your auth token
5. You're in — send a message to Claude

---

### Part 4: Make It Permanent (Auto-Start on Boot)

PilotCode needs to be running for you to access it from your phone. Set it up to start automatically when your computer boots and restart if it crashes.

> **Note:** If you used the Cloudflare dashboard method in Step 4 above, the `cloudflared service install` command already set up the tunnel as a system service — it will auto-start on boot. You only need to set up auto-start for the PilotCode server itself.

Pick your platform:

- [macOS (launchd)](#macos-launchd)
- [Linux (systemd)](#linux-systemd)
- [Windows WSL](#windows-wsl)

---

#### macOS (launchd)

**Find your paths first:**

```bash
which npx        # e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/npx
which node       # e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/node
echo $HOME       # e.g. /Users/you
pwd              # run this inside the pilotcode directory
```

**Create the plist file.** Save as `~/Library/LaunchAgents/com.pilotcode.server.plist`:

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

Replace all `/FULL/PATH/TO/` placeholders with your actual paths.

**Load it:**

```bash
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
```

**Verify:**

```bash
# Check it's running
launchctl list | grep pilotcode

# Check the server responds
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456
# Should print: 200
```

**Managing the service:**

```bash
# View logs
tail -f data/server.log

# Fully stop (won't auto-restart)
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist

# Restart after code changes
launchctl unload ~/Library/LaunchAgents/com.pilotcode.server.plist
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
```

> **Important:** Because `KeepAlive` is set to true, you can't stop the server by killing the process — launchd will just restart it. Always use `launchctl unload` to fully stop it.

---

#### Linux (systemd)

**Find your paths first:**

```bash
which npx        # e.g. /home/you/.nvm/versions/node/v22.20.0/bin/npx
echo $HOME       # e.g. /home/you
pwd              # run this inside the pilotcode directory
```

**Create the service file.** Save as `~/.config/systemd/user/pilotcode.service`:

```bash
mkdir -p ~/.config/systemd/user
```

```ini
[Unit]
Description=PilotCode Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/FULL/PATH/TO/pilotcode
ExecStart=/FULL/PATH/TO/npx tsx src/server.ts
Restart=always
RestartSec=5
Environment=PATH=/FULL/PATH/TO/node/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=/home/YOUR_USERNAME

[Install]
WantedBy=default.target
```

Replace all `/FULL/PATH/TO/` and `YOUR_USERNAME` placeholders with your actual paths.

**Enable and start:**

```bash
# Reload systemd to pick up the new service
systemctl --user daemon-reload

# Enable auto-start on boot
systemctl --user enable pilotcode

# Start it now
systemctl --user start pilotcode

# Allow user services to run without being logged in
sudo loginctl enable-linger $USER
```

> The `enable-linger` command is important — without it, systemd kills your services when you log out, and PilotCode would stop working when you close your SSH session.

**Verify:**

```bash
# Check status
systemctl --user status pilotcode

# Check the server responds
curl -s -o /dev/null -w "%{http_code}" http://localhost:3456
# Should print: 200
```

**Managing the service:**

```bash
# View logs
journalctl --user -u pilotcode -f

# Stop temporarily
systemctl --user stop pilotcode

# Restart after code changes
systemctl --user restart pilotcode

# Disable auto-start
systemctl --user disable pilotcode
```

---

#### Windows (WSL)

PilotCode runs inside WSL (Windows Subsystem for Linux). To make it start automatically:

**1. Create a startup script** inside WSL at `~/start-pilotcode.sh`:

```bash
#!/bin/bash
cd ~/pilotcode
source ~/.nvm/nvm.sh  # if using nvm
npm start >> data/server.log 2>> data/server.error.log &
```

```bash
chmod +x ~/start-pilotcode.sh
```

**2. Set WSL to start on Windows boot.** Create a scheduled task in PowerShell (run as Administrator):

```powershell
$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu -u YOUR_WSL_USERNAME -- bash -c '/home/YOUR_WSL_USERNAME/start-pilotcode.sh'"
$trigger = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "PilotCode" -Action $action -Trigger $trigger -Settings $settings -Description "Start PilotCode server in WSL"
```

Replace `YOUR_WSL_USERNAME` with your WSL username.

**3. Make sure WSL doesn't shut down** when you close the terminal. In PowerShell:

```powershell
wsl --set-default-version 2
```

Add to your `%USERPROFILE%/.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```

> **Note:** The `networkingMode=mirrored` setting makes WSL share your Windows network, so the Cloudflare Tunnel works properly.

**Verify:**

```powershell
# From PowerShell
curl http://localhost:3456
```

**Managing the service:**

```bash
# Inside WSL — check if running
pgrep -f "tsx src/server.ts"

# Stop
pkill -f "tsx src/server.ts"

# View logs
tail -f ~/pilotcode/data/server.log
```

---

### Part 5: macOS Permissions

Node.js needs **Full Disk Access** so Claude Code can read/write files without macOS blocking it. This is especially important for headless/remote operation.

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add your `node` binary:

```bash
which node
# e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/node
```

> If you update Node.js (e.g. via nvm), the path changes and you'll need to re-add it.

---

## Install as PWA (iPhone)

For the best experience, add PilotCode to your home screen:

1. Open `https://pilot.yourdomain.com` in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Tap **"Add to Home Screen"**
4. Name it "PilotCode" and tap Add

It opens full-screen like a native app — no browser bar, no tabs.

---

## Using PilotCode

### Sessions

Sessions are separate Claude conversations, each tied to a project directory.

- **Create from chat**: Just type a message — a session is auto-created using your default directory
- **Create from menu**: Tap hamburger (☰) → **+ New** to pick a name, model, and working directory
- **Switch sessions**: Tap hamburger → tap any session to switch
- **Resume**: Sessions survive server restarts. Switch back anytime and pick up where you left off.

### Connect to Existing Sessions

The **Connect** button in the sidebar lets you pick up Claude Code sessions that were started outside of PilotCode — for example, a session you started in your terminal.

PilotCode scans your `~/.claude/projects/` directory and finds any existing sessions, grouped by project directory. You can browse them, see when they were last active and how large they are, then connect to continue the conversation from your phone.

You can also enter a session ID manually if you know it (the **Manual ID** tab).

This is useful when:
- You started a long-running Claude session in your terminal and want to continue it from your phone
- You want to check on or resume a session you started earlier on your computer
- You're switching between your terminal and PilotCode and want to pick up where you left off

### Models

When creating a session, pick your model:

| Model | Best for |
|---|---|
| **Opus** | Complex tasks, architecture, multi-file changes |
| **Sonnet** | Fast, capable, good default |
| **Haiku** | Quick questions, simple edits, cheapest |

### Permissions

When Claude wants to run a command, edit a file, or access the web, you'll see an Allow/Deny card — same as the regular CLI. Tap Allow to proceed or Deny to block it.

### Uploads

Tap the paperclip button to attach screenshots, photos, PDFs, or any file Claude can analyze.

### Multi-device

Open PilotCode on multiple devices at once. Messages sync in real-time — start a conversation on your laptop, continue it from your phone.

---

## Security

PilotCode is designed for **single-user, self-hosted** use.

- **Auth token**: A random token is generated on first run. Anyone with this token can control Claude Code on your machine. Treat it like a password.
- **HTTPS**: Cloudflare Tunnel encrypts all traffic between your phone and your Mac.
- **Permissions**: PilotCode spawns Claude with `--dangerously-skip-permissions`, which means Claude will attempt tool calls (file edits, bash commands, etc.) and forward them to **you** for approval via the Allow/Deny UI. This flag is required for non-interactive operation — without it, Claude would prompt in a terminal that doesn't exist. **You are the permission gate.** Every tool call appears in the UI for your approval.
- **File access**: Claude has access to your filesystem, scoped to the working directory you choose per session.
- **No telemetry**: PilotCode doesn't phone home or collect data. Everything stays on your Mac.

---

## Alternative: Local Network Only (Free, No Domain)

If you only want to use PilotCode on the same WiFi network (e.g., your phone and Mac are at home), you don't need Cloudflare or a domain at all.

1. Find your Mac's local IP:
```bash
ipconfig getifaddr en0
# e.g. 192.168.1.42
```

2. Start PilotCode:
```bash
npm start
```

3. On your phone (connected to the same WiFi), open:
```
http://192.168.1.42:3456
```

4. Enter your auth token and you're in.

**Limitations:** This only works on your local network. It won't work on cellular or from outside your home. Traffic is unencrypted (HTTP). Your Mac's IP may change if you don't set a static IP on your router.

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
- Make sure your Mac isn't in full sleep (display sleep is fine — close the lid is fine if sleep is disabled)
- Check PilotCode is running: `curl http://localhost:3456/api/auth/check`
- Check the tunnel is connected: look in Cloudflare dashboard → Zero Trust → Tunnels — status should say "Healthy"

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

For more detailed troubleshooting, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## Development

```bash
npm run dev    # start with auto-reload on file changes
npm start      # start normally
```

The frontend is vanilla HTML/CSS/JS in `public/` — no build step. Edit and refresh.

For architecture details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## License

[MIT](LICENSE)

---

Created by [Glenn Prime](https://github.com/glennprime)

[jpatriotic](https://github.com/jpatriotic) — session resilience, drag-to-reorder, smart auto-scroll, interactive tool cards, file downloads, Linux support, and iOS polish

# PilotCode

Self-hosted web UI for Claude Code — control it from your phone, tablet, or any browser.

PilotCode runs on your Mac and gives you a mobile-friendly chat interface to Claude Code. It spawns real Claude CLI sessions, streams responses in real-time, handles tool permissions (Allow/Deny), and syncs across all your devices.

## What You Need

- **macOS** (tested on Apple Silicon)
- **Node.js 20+** (`node -v` to check)
- **Claude Code CLI** installed and logged in with your Anthropic account
- **An Anthropic Max plan or API key** (Claude Code requires one)

## Quick Start

### 1. Install Claude Code CLI (if you don't have it)

```bash
npm install -g @anthropic-ai/claude-code
```

Then run `claude` once in your terminal to log in with your Anthropic account. Follow the prompts — it'll open a browser for authentication. Once you see Claude responding, you're good. Press `Ctrl+C` to exit.

### 2. Clone and install PilotCode

```bash
git clone https://github.com/glennprime/pilotcode.git
cd pilotcode
npm install
```

### 3. Start the server

```bash
npm start
```

On first run, it will print an **auth token** like this:

```
  Auth token generated: a1b2c3d4e5f6...

  PilotCode running at http://localhost:3456
```

**Save that token** — you'll need it to log in from your browser.

### 4. Open in your browser

Go to `http://localhost:3456` and enter the auth token.

That's it! Send a message and Claude will respond. You can:
- Create sessions for different projects
- Upload images, PDFs, and documents
- Allow/Deny tool permissions from the UI
- Use it from multiple devices at once (messages sync in real-time)

## Remote Access (Optional)

To access PilotCode from outside your home network (e.g., from your phone on cellular), use a **Cloudflare Tunnel**. This gives you a permanent HTTPS URL without opening ports on your router.

### 1. Install cloudflared

```bash
brew install cloudflared
```

### 2. Authenticate with Cloudflare

You need a domain on Cloudflare (free tier works). Then:

```bash
cloudflared tunnel login
```

This opens a browser — select your domain and authorize.

### 3. Create a tunnel

```bash
cloudflared tunnel create pilotcode
```

Note the tunnel ID it prints (something like `ada21ecf-69d8-4179-bed2-c894dbdb974e`).

### 4. Route DNS

```bash
cloudflared tunnel route dns pilotcode pilotcode.yourdomain.com
```

Replace `yourdomain.com` with your actual domain.

### 5. Create the config

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /Users/YOU/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: pilotcode.yourdomain.com
    service: http://localhost:3456
  - service: http_status:404
```

### 6. Start the tunnel

```bash
cloudflared tunnel run pilotcode
```

Now open `https://pilotcode.yourdomain.com` from anywhere in the world.

### Auto-start on boot (macOS)

To keep PilotCode and the tunnel running after restarts, create Launch Agents:

**Server** — save as `~/Library/LaunchAgents/com.pilotcode.server.plist`:
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
        <string>/path/to/npx</string>
        <string>tsx</string>
        <string>/path/to/pilotcode/src/server.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/pilotcode</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/path/to/pilotcode/data/server.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/pilotcode/data/server.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/path/to/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Replace `/path/to/` with your actual paths. Find them with:
```bash
which npx          # e.g. /Users/you/.nvm/versions/node/v22.20.0/bin/npx
pwd                # in the pilotcode directory
```

**Tunnel** — save as `~/Library/LaunchAgents/com.pilotcode.tunnel.plist`:
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
    <string>/path/to/pilotcode/data/tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/pilotcode/data/tunnel.error.log</string>
</dict>
</plist>
```

Load them:
```bash
launchctl load ~/Library/LaunchAgents/com.pilotcode.server.plist
launchctl load ~/Library/LaunchAgents/com.pilotcode.tunnel.plist
```

## Configuration

Copy `.env.example` to `.env` to customize:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PILOTCODE_TOKEN` | auto-generated | Auth token for the web UI |
| `PILOTCODE_CWD` | home directory | Default working directory for new sessions |
| `PILOTCODE_PORT` | 3456 | Server port |
| `CLOUDFLARE_TUNNEL` | pilotcode | Tunnel name for `npm run tunnel` |

## PWA (Add to Home Screen)

On your iPhone, open the PilotCode URL in Safari, tap the share button, and select **"Add to Home Screen"**. It will look and feel like a native app.

## Tips

- **Sessions** are like separate Claude conversations. Create one per project.
- **Permissions**: When Claude wants to run a command or read a file, you'll see an Allow/Deny card. This is the same permission system as the regular Claude CLI.
- **Multi-device**: Open PilotCode on your phone and laptop at the same time — messages sync instantly.
- **Uploads**: Tap the camera button to send screenshots, photos, PDFs, or documents to Claude.
- **Abort**: Tap the stop button to interrupt Claude mid-response.

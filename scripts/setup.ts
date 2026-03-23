#!/usr/bin/env npx tsx
/**
 * PilotCode Setup Wizard
 * Interactive setup for first-time users.
 * Works on macOS, Linux, and Windows (WSL).
 */

import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { randomBytes } from 'crypto';
import { homedir, platform } from 'os';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const warn = (msg: string) => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
const fail = (msg: string) => console.log(`  ${RED}✗${RESET} ${msg}`);
const info = (msg: string) => console.log(`  ${DIM}${msg}${RESET}`);

function commandExists(cmd: string): boolean {
  try {
    const check = platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getCommandVersion(cmd: string): string {
  try {
    return execSync(`${cmd} --version`, { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

function getNodeMajor(): number {
  const match = process.version.match(/^v(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

async function main() {
  const os = platform();
  const osName = os === 'darwin' ? 'macOS' : os === 'linux' ? 'Linux' : os === 'win32' ? 'Windows' : os;

  console.log(`
${BOLD}╔══════════════════════════════════════╗
║       PilotCode Setup Wizard         ║
╚══════════════════════════════════════╝${RESET}

  Detected platform: ${CYAN}${osName}${RESET}
`);

  // --- Windows WSL check ---
  if (os === 'win32') {
    console.log(`
  ${YELLOW}Note for Windows users:${RESET}
  Claude Code CLI requires a Unix-like environment.
  You need Windows Subsystem for Linux (WSL) to run PilotCode.

  If you're already in WSL, you're good — this script will work.
  If you're in PowerShell/CMD, run this instead:

    ${CYAN}wsl bash -c "cd ~/pilotcode && npm run setup"${RESET}

  To install WSL: ${CYAN}wsl --install${RESET} (from PowerShell as admin)
`);
    const cont = await ask('  Are you running inside WSL? (y/n): ');
    if (cont.toLowerCase() !== 'y') {
      console.log('\n  Please set up WSL first, then run this setup again from inside WSL.\n');
      rl.close();
      process.exit(0);
    }
  }

  // ─── Step 1: Check prerequisites ───
  console.log(`${BOLD}  Step 1: Checking prerequisites${RESET}\n`);

  let hasErrors = false;

  // Node.js
  const nodeMajor = getNodeMajor();
  if (nodeMajor >= 20) {
    ok(`Node.js ${process.version}`);
  } else {
    fail(`Node.js 20+ required (found ${process.version})`);
    info('Install via: brew install node  OR  https://github.com/nvm-sh/nvm');
    hasErrors = true;
  }

  // npm
  if (commandExists('npm')) {
    ok(`npm ${getCommandVersion('npm')}`);
  } else {
    fail('npm not found');
    hasErrors = true;
  }

  // Claude Code CLI
  if (commandExists('claude')) {
    ok(`Claude Code CLI ${getCommandVersion('claude')}`);
  } else {
    fail('Claude Code CLI not found');
    if (os === 'darwin') {
      info('Install: npm install -g @anthropic-ai/claude-code');
    } else {
      info('Install: npm install -g @anthropic-ai/claude-code');
    }
    info('Then run: claude    (to log in and authenticate)');
    hasErrors = true;
  }

  // Check Claude is authenticated (try to get version without error)
  if (commandExists('claude')) {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      ok('Claude CLI is accessible');
    } catch {
      warn('Claude CLI found but may not be authenticated');
      info('Run: claude    (in your terminal to log in)');
    }
  }

  // cloudflared (optional at this stage)
  if (commandExists('cloudflared')) {
    ok(`cloudflared installed ${getCommandVersion('cloudflared')}`);
  } else {
    warn('cloudflared not installed (needed for remote access)');
    if (os === 'darwin') {
      info('Install later: brew install cloudflared');
    } else {
      info('Install later: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    }
  }

  console.log('');

  if (hasErrors) {
    const cont = await ask('  Some prerequisites are missing. Continue anyway? (y/n): ');
    if (cont.toLowerCase() !== 'y') {
      console.log('\n  Fix the issues above and run npm run setup again.\n');
      rl.close();
      process.exit(1);
    }
    console.log('');
  }

  // ─── Step 2: Working directory ───
  console.log(`${BOLD}  Step 2: Default working directory${RESET}\n`);
  console.log(`  This is the default folder Claude will work in when you create a new session.`);
  console.log(`  You can always change it per-session later.\n`);

  const defaultDir = join(homedir(), os === 'darwin' ? 'Dev' : 'projects');
  const cwdInput = await ask(`  Working directory (${DIM}Enter for ${defaultDir}${RESET}): `);
  const cwd = cwdInput.trim() || defaultDir;
  const resolvedCwd = resolve(cwd.replace(/^~/, homedir()));

  if (existsSync(resolvedCwd)) {
    ok(`Directory exists: ${resolvedCwd}`);
  } else {
    warn(`Directory doesn't exist: ${resolvedCwd}`);
    const create = await ask('  Create it? (y/n): ');
    if (create.toLowerCase() === 'y') {
      mkdirSync(resolvedCwd, { recursive: true });
      ok(`Created: ${resolvedCwd}`);
    }
  }
  console.log('');

  // ─── Step 3: Auth token ───
  console.log(`${BOLD}  Step 3: Auth token${RESET}\n`);
  console.log(`  This is the password you'll enter on your phone to access PilotCode.`);
  console.log(`  You can set something memorable or let us generate a random one.\n`);

  const tokenInput = await ask(`  Auth token (${DIM}Enter to auto-generate${RESET}): `);
  let token: string;

  if (tokenInput.trim()) {
    token = tokenInput.trim();
    if (token.length < 8) {
      warn('Token is very short — consider using something longer for security');
    }
    ok(`Using your custom token`);
  } else {
    token = randomBytes(16).toString('hex');
    ok(`Generated token: ${CYAN}${token}${RESET}`);
  }
  console.log('');

  // ─── Step 4: Port ───
  console.log(`${BOLD}  Step 4: Server port${RESET}\n`);

  const portInput = await ask(`  Port (${DIM}Enter for 3456${RESET}): `);
  const port = portInput.trim() || '3456';
  ok(`Server will run on port ${port}`);
  console.log('');

  // ─── Step 5: Write .env ───
  console.log(`${BOLD}  Step 5: Saving configuration${RESET}\n`);

  const projectDir = join(import.meta.dirname, '..');
  const envPath = join(projectDir, '.env');

  let envContent = `# PilotCode Configuration (generated by setup wizard)\n`;
  envContent += `PILOTCODE_CWD=${resolvedCwd}\n`;
  envContent += `PILOTCODE_TOKEN=${token}\n`;
  envContent += `PILOTCODE_PORT=${port}\n`;

  if (existsSync(envPath)) {
    const overwrite = await ask('  .env file already exists. Overwrite? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      warn('Keeping existing .env file');
      console.log('');
    } else {
      writeFileSync(envPath, envContent);
      ok('Wrote .env file');
      console.log('');
    }
  } else {
    writeFileSync(envPath, envContent);
    ok('Created .env file');
    console.log('');
  }

  // Ensure data directory exists
  const dataDir = join(projectDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  ok('Data directory ready');
  console.log('');

  // ─── Step 6: Auto-start on boot ───
  console.log(`${BOLD}  Step 6: Auto-start on boot${RESET}\n`);
  console.log(`  Want PilotCode to start automatically when your computer boots?`);
  console.log(`  This means you don't have to manually run "npm start" every time.\n`);

  const autoStart = await ask('  Set up auto-start? (y/n): ');

  if (autoStart.toLowerCase() === 'y') {
    const npxPath = (() => { try { return execSync(os === 'win32' ? 'where npx' : 'which npx', { encoding: 'utf-8' }).trim().split('\n')[0]; } catch { return 'npx'; } })();
    const nodePath = process.execPath;
    const nodeBinDir = join(nodePath, '..');

    if (os === 'darwin') {
      // macOS — launchd
      const plistDir = join(homedir(), 'Library', 'LaunchAgents');
      const plistPath = join(plistDir, 'com.pilotcode.server.plist');
      mkdirSync(plistDir, { recursive: true });

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pilotcode.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${npxPath}</string>
        <string>tsx</string>
        <string>${join(projectDir, 'src', 'server.ts')}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(projectDir, 'data', 'server.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(projectDir, 'data', 'server.error.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${homedir()}</string>
    </dict>
</dict>
</plist>`;

      if (existsSync(plistPath)) {
        const overwrite = await ask('  launchd plist already exists. Overwrite? (y/n): ');
        if (overwrite.toLowerCase() !== 'y') {
          warn('Keeping existing plist');
        } else {
          writeFileSync(plistPath, plist);
          ok(`Wrote ${plistPath}`);
          try {
            execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'ignore' });
            ok('Service loaded — PilotCode will auto-start on boot');
          } catch {
            warn('Could not load service — you may need to run:');
            info(`  launchctl load "${plistPath}"`);
          }
        }
      } else {
        writeFileSync(plistPath, plist);
        ok(`Created ${plistPath}`);
        try {
          execSync(`launchctl load "${plistPath}"`, { stdio: 'ignore' });
          ok('Service loaded — PilotCode will auto-start on boot');
        } catch {
          warn('Could not load service — you may need to run:');
          info(`  launchctl load "${plistPath}"`);
        }
      }
    } else if (os === 'linux') {
      // Linux — systemd user service
      const systemdDir = join(homedir(), '.config', 'systemd', 'user');
      const servicePath = join(systemdDir, 'pilotcode.service');
      mkdirSync(systemdDir, { recursive: true });

      const service = `[Unit]
Description=PilotCode Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${projectDir}
ExecStart=${npxPath} tsx src/server.ts
Restart=always
RestartSec=5
Environment=PATH=${nodeBinDir}:/usr/local/bin:/usr/bin:/bin
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target`;

      if (existsSync(servicePath)) {
        const overwrite = await ask('  systemd service already exists. Overwrite? (y/n): ');
        if (overwrite.toLowerCase() !== 'y') {
          warn('Keeping existing service file');
        } else {
          writeFileSync(servicePath, service);
          ok(`Wrote ${servicePath}`);
        }
      } else {
        writeFileSync(servicePath, service);
        ok(`Created ${servicePath}`);
      }

      try {
        execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
        execSync('systemctl --user enable pilotcode', { stdio: 'ignore' });
        execSync('systemctl --user start pilotcode', { stdio: 'ignore' });
        ok('Service enabled and started');
      } catch {
        warn('Could not start service automatically. Run these commands:');
        info('  systemctl --user daemon-reload');
        info('  systemctl --user enable pilotcode');
        info('  systemctl --user start pilotcode');
      }

      // enable-linger so service runs without login
      try {
        execSync(`sudo loginctl enable-linger ${process.env.USER || ''}`, { stdio: 'ignore' });
        ok('Enabled linger (service runs even when logged out)');
      } catch {
        warn('Could not enable linger. Run:');
        info(`  sudo loginctl enable-linger $USER`);
        info('  (Without this, PilotCode stops when you log out)');
      }
    } else {
      // Windows/WSL
      const scriptPath = join(homedir(), 'start-pilotcode.sh');
      const startScript = `#!/bin/bash
# PilotCode auto-start script
cd "${projectDir}"
source ~/.nvm/nvm.sh 2>/dev/null  # if using nvm
npm start >> data/server.log 2>> data/server.error.log &
`;
      writeFileSync(scriptPath, startScript, { mode: 0o755 });
      ok(`Created ${scriptPath}`);
      console.log('');
      info('To make it start on Windows boot, run in PowerShell (as Admin):');
      console.log('');
      const wslUser = process.env.USER || 'YOUR_USERNAME';
      console.log(`  ${CYAN}$action = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu -u ${wslUser} -- bash -c '${scriptPath}'"${RESET}`);
      console.log(`  ${CYAN}$trigger = New-ScheduledTaskTrigger -AtLogon${RESET}`);
      console.log(`  ${CYAN}Register-ScheduledTask -TaskName "PilotCode" -Action $action -Trigger $trigger${RESET}`);
    }
  } else {
    ok('Skipped auto-start — you can set this up later (see README.md Part 4)');
  }
  console.log('');

  // ─── Step 7: macOS permissions reminder ───
  if (os === 'darwin') {
    console.log(`${BOLD}  Step 7: macOS permissions${RESET}\n`);
    console.log(`  Node.js needs ${BOLD}Full Disk Access${RESET} for Claude to read/write files properly.`);
    console.log(`  This is especially important for remote/headless operation.\n`);
    console.log(`  ${CYAN}System Settings → Privacy & Security → Full Disk Access${RESET}`);
    console.log(`  Click + and add: ${CYAN}${process.execPath}${RESET}\n`);
    info('If you update Node.js later, you\'ll need to re-add the new path.');
    console.log('');
  }

  // ─── Done ───
  const hasCloudfared = commandExists('cloudflared');

  console.log(`${BOLD}${GREEN}╔══════════════════════════════════════╗
║          Setup Complete!             ║
╚══════════════════════════════════════╝${RESET}
`);

  console.log(`  ${BOLD}Your auth token:${RESET} ${CYAN}${token}${RESET}`);
  console.log(`  ${DIM}(save this — you'll need it to log in from your phone)${RESET}`);
  console.log('');

  if (autoStart.toLowerCase() === 'y' && os !== 'win32') {
    console.log(`  ${BOLD}PilotCode is running!${RESET} Test it at: ${CYAN}http://localhost:${port}${RESET}`);
  } else {
    console.log(`  ${BOLD}To start PilotCode:${RESET}  ${CYAN}npm start${RESET}`);
  }
  console.log('');

  console.log(`  ${BOLD}Next step — set up remote access so you can use it from your phone:${RESET}`);
  if (!hasCloudfared) {
    if (os === 'darwin') {
      console.log(`    1. Install cloudflared:  ${CYAN}brew install cloudflared${RESET}`);
    } else if (os === 'linux') {
      console.log(`    1. Install cloudflared:  ${CYAN}See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/${RESET}`);
    } else {
      console.log(`    1. Install cloudflared in WSL:  ${CYAN}See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/${RESET}`);
    }
    console.log(`    2. Follow the Cloudflare Tunnel guide in README.md (Part 3)`);
  } else {
    console.log(`    cloudflared is installed — follow the Cloudflare Tunnel guide in README.md (Part 3)`);
  }
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error(`\n  ${RED}Setup failed:${RESET}`, err.message);
  rl.close();
  process.exit(1);
});

# Contributing to PilotCode

Thanks for your interest in contributing! PilotCode is a simple project and contributions are welcome.

## Getting Started

1. Fork the repo and clone your fork
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Make your changes and test them

## Project Structure

- `src/` — TypeScript backend (Express + WebSocket server)
- `public/` — Frontend (vanilla HTML/CSS/JS, no build step)
- `data/` — Runtime data (gitignored, created automatically)
- `docs/` — Architecture and troubleshooting docs

The frontend has no build step — edit files in `public/` and refresh your browser.

## Guidelines

- **Keep it simple.** PilotCode is intentionally minimal. No frameworks on the frontend, no ORM on the backend.
- **Test manually.** There's no test suite yet. Verify your changes work by using the app — create a session, send messages, try permissions, test on mobile.
- **One thing per PR.** Small, focused pull requests are easier to review.
- **Don't break the protocol.** The Claude CLI stdin/stdout JSON protocol is specific and fragile. If you're changing `src/claude/process.ts`, test thoroughly.

## Reporting Bugs

Open an issue with:
- What you did
- What you expected
- What happened instead
- Server logs if relevant (`data/server.log`, `data/claude-debug.log`)

## Feature Ideas

Open an issue to discuss before building. This helps avoid duplicate work and ensures the feature fits the project's direction.

## Code Style

- TypeScript on the backend, vanilla JS on the frontend
- No semicolons (the codebase doesn't use them consistently — just match what's around you)
- Prefer simple, readable code over clever abstractions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

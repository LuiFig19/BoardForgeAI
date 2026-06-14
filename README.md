# BoardForge AI

BoardForge AI is the web command center for AI-assisted KiCad hardware design. The product is now explicitly plugin-first:

```text
User in Codex
↓
BoardForge Codex Plugin
↓
BoardForge local MCP/tool server or CLI helper
↓
Whitelisted KiCad automation tools
↓
Real local KiCad project files
↓
DRC/ERC/export reports
↓
Gerbers, BOM, CPL, KiCad ZIP, JLCPCB package
```

The website handles marketing, accounts, project libraries, board templates, saved specs, plugin onboarding, dashboards, reports, pricing, docs, and board/outline libraries. The BoardForge Codex Plugin and local helper are the execution engine for real KiCad file edits and manufacturing exports.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Copy `.env.example` to `.env.local` for local development, then add your own rotated keys:

```bash
OPENROUTER_API_KEY=
OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite

NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SITE_NAME=BoardForge AI
```

Never commit `.env.local` or raw API keys. Keys must be configured in Vercel as environment variables for production.

## AI API

The app exposes a server-only route at:

```text
POST /api/ai/board-plan
```

The browser sends project requirements to this route. The route calls either OpenRouter or Gemini from the server so provider API keys never ship to the client.

Default provider/model:

- OpenRouter: `deepseek/deepseek-chat-v3.1`
- Gemini fallback/intake: `gemini-2.5-flash-lite`

## BoardForge Plugin MVP

The Codex plugin source lives in:

```text
plugins/boardforge-plugin
```

The CLI MVP accepts structured JSON jobs and currently implements outline-only KiCad project generation:

```bash
node plugins/boardforge-plugin/bin/boardforge-plugin.mjs \
  --job plugins/boardforge-plugin/examples/outline-job.json \
  --workspace plugins/boardforge-plugin/tmp
```

This writes:

- `.kicad_pro`
- `.kicad_pcb`
- `README.md`

Safety rules:

- no arbitrary shell commands from AI
- writes stay inside the approved workspace
- job input is structured JSON
- MVP only supports line-based Edge.Cuts outline generation
- human review is required before manufacturing

Future phases add the local MCP/tool server, KiCad CLI detection, DRC/ERC, Gerbers, drill, BOM, CPL, and JLCPCB packaging.

## Vercel

Import `LuiFig19/BoardForgeAI` into Vercel as a Next.js project.

Use:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank

Set production environment variables in Vercel:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `NEXT_PUBLIC_SITE_URL=https://boardforge-ai.com`
- `NEXT_PUBLIC_SITE_NAME=BoardForge AI`

Then add the domains:

- `boardforge-ai.com`
- `www.boardforge-ai.com`

Vercel will show the exact DNS records to place in Porkbun.

## Commands

```bash
npm run lint
npm run build
```

# BoardForge AI

BoardForge AI is a Next.js hardware generation cockpit for AI-assisted KiCad PCB planning, board shape capture, realistic PCB previews, validation tracking, and fab package review.

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

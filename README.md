# Spectre One

A minimal Discord bot that generates replies with the OpenAI `Responses API` and exposes Dosu to the model as a remote MCP tool for retrieving team docs or internal knowledge.

## Features

- Built on `discord.js`, with automatic replies to channel messages or `@mentions`
- Powered by the OpenAI `Responses API`
- Built-in Dosu MCP remote tool configuration
- Includes timeouts, retries, logging, and graceful shutdown by default
- Can start from a clean repo without extra framework overhead

## Prerequisites

- Node.js 20+
- A Discord bot token
- `MESSAGE CONTENT INTENT` enabled in the Discord Developer Portal
- OpenAI API Key
- A Dosu deployment

## Installation

```bash
npm install
cp .env.example .env
```

## Dosu Configuration

This project uses only Dosu's HTTP MCP endpoint and does not depend on local CLI configuration.

Per the Dosu docs, the recommended setup is the path-based endpoint:

```env
DOSU_MCP_DEPLOYMENT_ID=your-deployment-id
DOSU_MCP_API_KEY=dosu_your_api_key
```

The app will automatically construct:

```text
https://api.dosu.dev/v1/mcp/deployments/<your-deployment-id>
```

If you already have the full endpoint, you can also set it directly:

```env
DOSU_MCP_SERVER_URL=https://api.dosu.dev/v1/mcp/deployments/<your-deployment-id>
DOSU_MCP_API_KEY=dosu_your_api_key
```

See the Dosu docs:
- [Dosu MCP](https://app.dosu.dev/9affd04a-e6a9-452c-b927-c639e979994c/documents/8c21ef6e-14b7-4fa1-949e-d256af54bad1)

## Environment Variables

```env
DISCORD_BOT_TOKEN=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
DOSU_MCP_DEPLOYMENT_ID=...
DOSU_MCP_API_KEY=...

# Comma-separated. When set, these channels will automatically reply to all user messages.
DISCORD_ALLOWED_CHANNEL_IDS=123,456

# Default behavior when left empty:
# - If DISCORD_ALLOWED_CHANNEL_IDS is configured, those channels auto-reply and all other channels reply only when the bot is mentioned
# - If no channels are configured, the bot replies only when mentioned
DISCORD_REQUIRE_MENTION=
```

## Run

Development mode:

```bash
npm run dev
```

Build and run:

```bash
npm run build
npm start
```

## Structure

```text
src/
  config/      Environment config and Dosu loading
  discord/     Discord events and prompt context assembly
  openai/      OpenAI reply pipeline
  shared/      Logging, retries, and text utilities
  index.ts     Entry point
```

## Notes

- Replies use the most recent channel messages as context so the bot stays grounded in the conversation.
- The bot performs a Dosu lookup before every final reply, then uses that retrieved context in the OpenAI response. If Dosu does not return enough relevant information, it says so instead of guessing.
- The default model is `gpt-5-mini`. If you care more about quality, switch to `gpt-5.4`.
- The current Dosu integration uses HTTP MCP: `server_url + X-Dosu-API-Key`, not the CLI.

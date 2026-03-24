# Spectre One

A Hono app for Cloudflare Workers that serves two integration styles:

- A generic HTTP reply API at `/v1/reply`
- A Discord Interactions endpoint at `/interactions`

Replies are generated with the OpenAI `Responses API`. Before the final answer is written, the worker forces a Dosu MCP lookup so the model can ground its answer in team docs and internal knowledge.

## Features

- Built on `hono` and deployable to Cloudflare Workers
- Discord slash-command support through Interactions webhooks
- Discord message context menu support
- Ed25519 signature verification for Discord requests
- Deferred Discord responses with edit-original and follow-up messages
- Incident intake persisted in Cloudflare D1
- Multi-model OpenAI configuration with per-request override and fallback
- Dosu MCP integration with required pre-answer lookup

## Prerequisites

- Node.js 20+
- A Cloudflare account with Workers enabled
- An OpenAI API key
- A Dosu deployment
- A Discord application

## Install

```bash
npm install
cp .dev.vars.example .dev.vars
```

## Step-by-Step Configuration

### 1. Fill `.dev.vars`

Start from [.dev.vars.example](/Users/minibanana/Program/POC/spectre-one/.dev.vars.example) and fill these values:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODELS=gpt-5-mini,gpt-5.4
OPENAI_BASE_URL=
OPENAI_REQUEST_TIMEOUT_MS=45000
MAX_CONTEXT_MESSAGES=8

DISCORD_APPLICATION_ID=123456789012345678
DISCORD_PUBLIC_KEY=your_discord_public_key
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=123456789012345678

SYSTEM_PROMPT=
BOT_SYSTEM_PROMPT=

DOSU_MCP_DEPLOYMENT_ID=your-deployment-id
DOSU_MCP_API_KEY=dosu_your_api_key
DOSU_MCP_SERVER_URL=
DOSU_MCP_BASE_URL=https://api.dosu.dev/v1/mcp
```

How to fill each one:

1. `OPENAI_API_KEY`
   Use your OpenAI API key.
2. `OPENAI_MODELS`
   Put one or more comma-separated models in priority order, for example `gpt-5-mini,gpt-5.4`.
   The worker tries the requested model first, then falls back through this list.
3. `OPENAI_BASE_URL`
   Leave empty for the default OpenAI endpoint.
   Only fill this if you intentionally use a compatible gateway.
4. `OPENAI_REQUEST_TIMEOUT_MS`
   Per-request timeout for OpenAI calls.
   `45000` is a reasonable default for Discord slash commands plus Dosu lookup.
5. `MAX_CONTEXT_MESSAGES`
   Maximum conversation items from API input that get folded into the prompt.
6. `DISCORD_APPLICATION_ID`
   In Discord Developer Portal, open your application and copy the `Application ID`.
7. `DISCORD_PUBLIC_KEY`
   In the same page, copy the `Public Key`.
   The worker uses this to verify Discord signatures on `/interactions`.
8. `DISCORD_BOT_TOKEN`
   In `Bot`, click `Reset Token` or `Copy`.
   This token is used by the command registration script.
9. `DISCORD_GUILD_ID`
   Optional but strongly recommended while testing.
   If you fill it, `npm run discord:register` registers guild commands for that server and changes appear quickly.
   If you leave it empty, the script registers global commands instead.
10. `SYSTEM_PROMPT`
    Optional top-level custom prompt.
    Leave empty unless you intentionally want to override the default behavior.
11. `BOT_SYSTEM_PROMPT`
    Backward-compatible alias for old deployments.
    Prefer `SYSTEM_PROMPT` for new setups.
12. `DOSU_MCP_DEPLOYMENT_ID`
    Recommended Dosu config input if you use the standard deployment-based MCP URL.
13. `DOSU_MCP_API_KEY`
    Your Dosu MCP API key.
14. `DOSU_MCP_SERVER_URL`
    Optional full Dosu MCP URL.
    Leave it empty if you use `DOSU_MCP_DEPLOYMENT_ID`.
15. `DOSU_MCP_BASE_URL`
    Normally keep the default `https://api.dosu.dev/v1/mcp`.

### 2. Create the Discord app

1. Open the Discord Developer Portal.
2. Click `New Application`.
3. Give it a name.
4. Open `Bot` and create a bot user if you have not done so already.
5. Copy `Application ID`, `Public Key`, and `Bot Token` into `.dev.vars`.

### 3. Install the bot into your server

1. In Developer Portal, open `OAuth2` -> `URL Generator`.
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions as needed.
   - For slash commands only, minimal permissions are often enough.
   - If you want the bot to send normal messages in channels, give it `Send Messages`.
4. Open the generated URL and install the app into your target server.

### 4. Run locally

```bash
npm run dev
```

By default, Wrangler serves the worker locally. After it starts, note the local URL, usually something like:

```text
http://127.0.0.1:8787
```

### 5. Register slash commands

For a test guild:

```bash
npm run discord:register
```

To preview what will be sent without changing Discord:

```bash
npm run discord:register -- --dry-run
```

To force global registration:

```bash
npm run discord:register -- --global
```

To force a specific guild:

```bash
npm run discord:register -- --guild 123456789012345678
```

Registered commands come from [src/discord/commands.json](/Users/minibanana/Program/POC/spectre-one/src/discord/commands.json):

- Message context menu: `Ask Spectre about this`
- `/ask prompt:<text> model:<optional> private:<optional>`
- `/incident`
- `/health check_upstream:<optional> model:<optional>`

### 6. Configure the Interactions endpoint

1. Deploy the worker or expose local dev with a public HTTPS URL.
   Discord requires HTTPS for the endpoint URL.
2. In Developer Portal, open `General Information`.
3. Set `Interactions Endpoint URL` to:

```text
https://<your-worker-domain>/interactions
```

Examples:

```text
https://spectre-one.<your-subdomain>.workers.dev/interactions
https://your-tunnel-domain.example.com/interactions
```

Discord will validate the endpoint by sending a `PING`.
This worker responds to `PING` and verifies the request signature using `DISCORD_PUBLIC_KEY`.

### 7. Apply the D1 migration

The incident intake flow stores reports in the `incident_reports` table in Cloudflare D1.
This repository already includes the migration file in [migrations/0001_create_incident_reports.sql](/Users/minibanana/Program/POC/spectre-one/migrations/0001_create_incident_reports.sql) and the Worker binding in [wrangler.jsonc](/Users/minibanana/Program/POC/spectre-one/wrangler.jsonc).

Apply it before the first production deploy:

```bash
npm run db:migrate
```

### 8. Deploy to Cloudflare Workers

```bash
npm run deploy
```

After deployment:

1. Copy the final Workers URL.
2. Put that URL into Discord's `Interactions Endpoint URL`.
3. Re-run `npm run discord:register` if you changed app scope or command definitions.

## Discord Behavior

- The message context menu `Ask Spectre about this` appears when you right-click a Discord message under `Apps`.
- `/incident` opens a modal that collects:
  - deployment type as a single choice: `cloud` or `self-hosted`
  - cloud subscription plan for cloud incidents: `TEAM`, `PRO`, or `FREE`
  - account email
  - version number
  - failure description
- The `/incident` failure description must be at least 50 words. The worker validates this on modal submission.
- Successful and failed `/incident` submissions are stored in Cloudflare D1 with the original intake fields plus response status and reply metadata.
- `/ask` defers immediately, then the worker edits the original interaction response after OpenAI + Dosu complete.
- Long replies are split into multiple Discord messages automatically.
- `private:true` makes the response ephemeral.
- `/health check_upstream:true` performs a real Dosu tool verification against the selected model.

## Generic API

### `GET /health`

Returns worker status.

Add `?check=upstream` to verify the default model can load the Dosu MCP tools.

### `POST /v1/reply`

```json
{
  "prompt": "How should we handle incident rollback?",
  "conversation": [
    { "role": "user", "author": "alice", "content": "The deployment is failing." },
    { "role": "assistant", "author": "spectre", "content": "What changed in this release?" }
  ],
  "metadata": {
    "source": "slack",
    "workspace": "platform",
    "channel": "deployments",
    "user": "alice"
  },
  "model": "gpt-5.4"
}
```

## Notes

- `OPENAI_MODELS` is the canonical model configuration.
- `OPENAI_MODEL` is still accepted as a backward-compatible single-model alias.
- The current Dosu integration uses HTTP MCP: `server_url + X-Dosu-API-Key`, not the CLI.

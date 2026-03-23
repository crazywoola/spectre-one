import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEFAULT_SYSTEM_PROMPT = [
  'You are Spectre One, a Discord bot assistant.',
  'Reply in the user\'s language when it is clear; otherwise default to concise Simplified Chinese.',
  'Be direct, helpful, and brief.',
  'Use the Dosu MCP server when the answer depends on team docs, internal architecture, runbooks, or product knowledge.',
  'If Dosu does not provide enough information, say so plainly instead of guessing.',
  'Return only the message content that should be sent back to Discord.'
].join(' ');

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  DISCORD_ALLOWED_CHANNEL_IDS: z.string().optional().default(''),
  DISCORD_REQUIRE_MENTION: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(1).max(20).default(8),
  BOT_SYSTEM_PROMPT: z.string().optional(),
  DOSU_MCP_DEPLOYMENT_ID: z.string().uuid().optional(),
  DOSU_MCP_SERVER_URL: z.string().url().optional(),
  DOSU_MCP_BASE_URL: z.string().url().default('https://api.dosu.dev/v1/mcp'),
  DOSU_MCP_API_KEY: z.string().optional()
});

export interface AppConfig {
  discord: {
    token: string;
    allowedChannelIds: string[];
    requireMention: boolean;
  };
  openai: {
    apiKey: string;
    model: string;
    baseURL?: string;
    requestTimeoutMs: number;
  };
  dosu: {
    serverUrl: string;
    apiKey: string;
    source: 'env';
  };
  bot: {
    maxContextMessages: number;
    systemPrompt: string;
  };
}

interface DosuConfig {
  serverUrl: string;
  apiKey: string;
  source: 'env';
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const allowedChannelIds = parseCsv(parsed.DISCORD_ALLOWED_CHANNEL_IDS);

  return {
    discord: {
      token: parsed.DISCORD_BOT_TOKEN,
      allowedChannelIds,
      requireMention: resolveRequireMention(parsed.DISCORD_REQUIRE_MENTION, allowedChannelIds)
    },
    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL,
      baseURL: parsed.OPENAI_BASE_URL,
      requestTimeoutMs: parsed.OPENAI_REQUEST_TIMEOUT_MS
    },
    dosu: resolveDosuConfig({
      deploymentId: parsed.DOSU_MCP_DEPLOYMENT_ID,
      serverUrl: parsed.DOSU_MCP_SERVER_URL,
      baseUrl: parsed.DOSU_MCP_BASE_URL,
      apiKey: parsed.DOSU_MCP_API_KEY
    }),
    bot: {
      maxContextMessages: parsed.MAX_CONTEXT_MESSAGES,
      systemPrompt: parsed.BOT_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT
    }
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRequireMention(rawValue: string | undefined, allowedChannelIds: string[]): boolean {
  if (rawValue === undefined || rawValue.trim() === '') {
    return allowedChannelIds.length === 0;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error('DISCORD_REQUIRE_MENTION must be "true" or "false" when provided.');
}

function resolveDosuConfig(input: {
  deploymentId?: string;
  serverUrl?: string;
  baseUrl: string;
  apiKey?: string;
}): DosuConfig {
  if (input.serverUrl && input.apiKey) {
    return {
      serverUrl: input.serverUrl,
      apiKey: input.apiKey,
      source: 'env'
    };
  }

  if (input.deploymentId && input.apiKey) {
    return {
      serverUrl: buildDeploymentEndpoint(input.baseUrl, input.deploymentId),
      apiKey: input.apiKey,
      source: 'env'
    };
  }

  throw new Error(
    'Dosu HTTP MCP configuration not found. Set DOSU_MCP_DEPLOYMENT_ID and DOSU_MCP_API_KEY, or provide DOSU_MCP_SERVER_URL and DOSU_MCP_API_KEY.'
  );
}

function buildDeploymentEndpoint(baseUrl: string, deploymentId: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  return `${trimmedBaseUrl}/deployments/${deploymentId}`;
}

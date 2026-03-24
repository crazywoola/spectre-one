import { z } from 'zod';

const DEFAULT_SYSTEM_PROMPT = [
  'You are Spectre One, an assistant behind an HTTP API.',
  'Reply in the user\'s language when it is clear; otherwise default to concise Simplified Chinese.',
  'Be direct, helpful, and brief.',
  'A Dosu MCP lookup runs before the final answer is written.',
  'Use the retrieved Dosu context when the answer depends on team docs, internal architecture, runbooks, or product knowledge.',
  'If Dosu does not provide enough information, say so plainly instead of guessing.',
  'Return only the final reply text.'
].join(' ');

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().trim().optional(),
  OPENAI_MODELS: z.string().trim().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(1).max(50).default(8),
  SYSTEM_PROMPT: z.string().trim().optional(),
  BOT_SYSTEM_PROMPT: z.string().optional(),
  DOSU_MCP_DEPLOYMENT_ID: z.string().uuid().optional(),
  DOSU_MCP_SERVER_URL: z.string().url().optional(),
  DOSU_MCP_BASE_URL: z.string().url().default('https://api.dosu.dev/v1/mcp'),
  DOSU_MCP_API_KEY: z.string().optional()
});

const discordEnvSchema = z.object({
  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/, 'DISCORD_APPLICATION_ID must be a Discord snowflake.').optional(),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'DISCORD_PUBLIC_KEY must be a 64-character hex string.'),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/, 'DISCORD_GUILD_ID must be a Discord snowflake.').optional()
});

export interface WorkerBindings {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODELS?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_REQUEST_TIMEOUT_MS?: string;
  MAX_CONTEXT_MESSAGES?: string;
  SYSTEM_PROMPT?: string;
  BOT_SYSTEM_PROMPT?: string;
  DOSU_MCP_DEPLOYMENT_ID?: string;
  DOSU_MCP_SERVER_URL?: string;
  DOSU_MCP_BASE_URL?: string;
  DOSU_MCP_API_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
}

export interface DiscordConfig {
  applicationId?: string;
  publicKey: string;
  botToken?: string;
  guildId?: string;
}

export interface AppConfig {
  openai: {
    apiKey: string;
    models: string[];
    baseURL?: string;
    requestTimeoutMs: number;
  };
  dosu: {
    serverUrl: string;
    apiKey: string;
    source: 'server_url' | 'deployment_id';
  };
  app: {
    maxContextMessages: number;
    systemPrompt: string;
  };
}

interface DosuConfig {
  serverUrl: string;
  apiKey: string;
  source: 'server_url' | 'deployment_id';
}

export function loadConfig(env: WorkerBindings): AppConfig {
  const parsed = envSchema.parse(env);
  const models = resolveModelList(parsed.OPENAI_MODELS, parsed.OPENAI_MODEL);

  return {
    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      models,
      baseURL: parsed.OPENAI_BASE_URL,
      requestTimeoutMs: parsed.OPENAI_REQUEST_TIMEOUT_MS
    },
    dosu: resolveDosuConfig({
      deploymentId: parsed.DOSU_MCP_DEPLOYMENT_ID,
      serverUrl: parsed.DOSU_MCP_SERVER_URL,
      baseUrl: parsed.DOSU_MCP_BASE_URL,
      apiKey: parsed.DOSU_MCP_API_KEY
    }),
    app: {
      maxContextMessages: parsed.MAX_CONTEXT_MESSAGES,
      systemPrompt:
        parsed.SYSTEM_PROMPT?.trim() ||
        parsed.BOT_SYSTEM_PROMPT?.trim() ||
        DEFAULT_SYSTEM_PROMPT
    }
  };
}

export function loadDiscordConfig(env: WorkerBindings): DiscordConfig {
  const parsed = discordEnvSchema.parse(env);

  return {
    applicationId: parsed.DISCORD_APPLICATION_ID,
    publicKey: parsed.DISCORD_PUBLIC_KEY,
    botToken: parsed.DISCORD_BOT_TOKEN,
    guildId: parsed.DISCORD_GUILD_ID
  };
}

function resolveModelList(rawList?: string, rawSingle?: string): string[] {
  const values = [rawSingle, rawList]
    .filter(Boolean)
    .flatMap((value) => value!.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const uniqueModels = [...new Set(values)];
  if (uniqueModels.length > 0) {
    return uniqueModels;
  }

  return ['gpt-5-mini'];
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
      source: 'server_url'
    };
  }

  if (input.deploymentId && input.apiKey) {
    return {
      serverUrl: buildDeploymentEndpoint(input.baseUrl, input.deploymentId),
      apiKey: input.apiKey,
      source: 'deployment_id'
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

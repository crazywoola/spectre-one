import nacl from 'tweetnacl';
import { z } from 'zod';

import type { WorkerBindings } from '../config/env.js';
import { loadConfig, loadDiscordConfig } from '../config/env.js';
import { ReplyService } from '../openai/reply-service.js';
import { buildPrompt } from '../reply/request.js';
import { logger } from '../shared/logger.js';
import { splitDiscordMessage } from '../shared/messages.js';

const GENERIC_FAILURE_MESSAGE = 'I ran into a problem while processing that request. Please try again in a moment.';
const MESSAGE_FLAG_EPHEMERAL = 1 << 6;

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5
} as const;

const interactionOptionSchema: z.ZodType<DiscordInteractionOption> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.number(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(interactionOptionSchema).optional()
  })
);

const interactionSchema = z.object({
  id: z.string().optional(),
  type: z.number(),
  application_id: z.string().optional(),
  token: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  channel: z
    .object({
      id: z.string().optional(),
      name: z.string().optional()
    })
    .optional(),
  data: z
    .object({
      name: z.string(),
      options: z.array(interactionOptionSchema).optional()
    })
    .optional(),
  member: z
    .object({
      user: z
        .object({
          id: z.string(),
          username: z.string(),
          global_name: z.string().nullable().optional()
        })
        .optional()
    })
    .optional(),
  user: z
    .object({
      id: z.string(),
      username: z.string(),
      global_name: z.string().nullable().optional()
    })
    .optional()
}).passthrough();

type DiscordInteractionOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
};

type DiscordInteraction = z.infer<typeof interactionSchema>;

interface DiscordWebhookMessage {
  content: string;
  flags?: number;
  allowed_mentions?: {
    parse: string[];
  };
}

export async function handleDiscordInteraction(
  request: Request,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Promise<Response> {
  const discordConfig = loadDiscordConfig(env);
  const rawBody = await request.text();
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');

  if (!signature || !timestamp) {
    return json({ error: 'Missing Discord signature headers.' }, { status: 401 });
  }

  if (!verifyDiscordRequest(signature, timestamp, rawBody, discordConfig.publicKey)) {
    return json({ error: 'Invalid request signature.' }, { status: 401 });
  }

  const interaction = interactionSchema.parse(parseJson(rawBody));

  if (interaction.type === InteractionType.PING) {
    return json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND || !interaction.data?.name) {
    return json(ephemeralMessage('Unsupported interaction type.'));
  }

  switch (interaction.data.name) {
    case 'ask':
      return handleAskInteraction(interaction, env, executionCtx);
    case 'health':
      return handleHealthInteraction(interaction, env, executionCtx);
    default:
      return json(ephemeralMessage(`Unknown command: ${interaction.data.name}`));
  }
}

function handleAskInteraction(
  interaction: DiscordInteraction,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Response {
  const prompt = getStringOption(interaction, 'prompt');
  if (!prompt) {
    return json(ephemeralMessage('The `prompt` option is required.'));
  }

  const requestedModel = getStringOption(interaction, 'model');
  const isPrivate = getBooleanOption(interaction, 'private') ?? true;

  executionCtx.waitUntil(
    processAskInteraction({
      interaction,
      env,
      prompt,
      requestedModel,
      isPrivate
    })
  );

  return json(deferredMessage(isPrivate));
}

function handleHealthInteraction(
  interaction: DiscordInteraction,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Response {
  const checkUpstream = getBooleanOption(interaction, 'check_upstream') ?? false;
  const requestedModel = getStringOption(interaction, 'model');

  if (!checkUpstream) {
    return json(
      ephemeralMessage(
        [
          'Spectre One is online.',
          `Configured models: ${env.OPENAI_MODELS || env.OPENAI_MODEL || '(not configured)'}`,
          `Dosu source: ${resolveDosuSource(env)}`,
          'Run `/health check_upstream:true` for an end-to-end OpenAI + Dosu check.'
        ].join('\n')
      )
    );
  }

  executionCtx.waitUntil(
    processUpstreamHealthCheck({
      interaction,
      env,
      requestedModel
    })
  );

  return json(deferredMessage(true));
}

async function processAskInteraction(input: {
  interaction: DiscordInteraction;
  env: WorkerBindings;
  prompt: string;
  requestedModel?: string;
  isPrivate: boolean;
}): Promise<void> {
  const { interaction, env, prompt, requestedModel, isPrivate } = input;

  try {
    const config = loadConfig(env);
    const replyService = new ReplyService(config);
    const result = await replyService.generateReply(
      buildPrompt(
        {
          prompt,
          conversation: [],
          metadata: {
            source: 'discord',
            workspace: interaction.guild_id ? `guild:${interaction.guild_id}` : 'discord-dm',
            channel: interaction.channel?.name ?? interaction.channel_id ?? 'unknown-channel',
            user: getInteractionUserName(interaction)
          }
        },
        config.app.maxContextMessages
      ),
      {
        model: requestedModel
      }
    );

    const chunks = splitDiscordMessage(result.reply);
    if (chunks.length === 0) {
      throw new Error('The generated Discord reply was empty after chunking.');
    }

    const [firstChunk, ...restChunks] = chunks;
    if (!firstChunk) {
      throw new Error('The generated Discord reply did not contain a first chunk.');
    }

    await editOriginalInteractionResponse(interaction, {
      content: firstChunk,
      allowed_mentions: { parse: [] }
    });

    for (const chunk of restChunks) {
      await createFollowupInteractionResponse(interaction, {
        content: chunk,
        allowed_mentions: { parse: [] },
        flags: isPrivate ? MESSAGE_FLAG_EPHEMERAL : undefined
      });
    }

    logger.info('discord_interaction_replied', {
      interactionId: interaction.id,
      command: interaction.data?.name,
      model: result.model,
      attemptedModels: result.attemptedModels,
      private: isPrivate
    });
  } catch (error) {
    logger.error('discord_interaction_reply_failed', {
      interactionId: interaction.id,
      command: interaction.data?.name,
      error
    });

    await safeEditOriginalInteractionResponse(interaction, {
      content: GENERIC_FAILURE_MESSAGE,
      allowed_mentions: { parse: [] }
    });
  }
}

async function processUpstreamHealthCheck(input: {
  interaction: DiscordInteraction;
  env: WorkerBindings;
  requestedModel?: string;
}): Promise<void> {
  const { interaction, env, requestedModel } = input;

  try {
    const config = loadConfig(env);
    const replyService = new ReplyService(config);
    const verifiedModel = await replyService.verifyDosuTools(requestedModel);

    await editOriginalInteractionResponse(interaction, {
      content: [
        'Upstream check passed.',
        `Verified model: ${verifiedModel}`,
        `Configured models: ${config.openai.models.join(', ')}`,
        `Dosu source: ${config.dosu.source}`
      ].join('\n'),
      allowed_mentions: { parse: [] }
    });
  } catch (error) {
    logger.error('discord_interaction_health_check_failed', {
      interactionId: interaction.id,
      error
    });

    await safeEditOriginalInteractionResponse(interaction, {
      content:
        error instanceof Error
          ? `Upstream check failed: ${error.message}`
          : 'Upstream check failed.',
      allowed_mentions: { parse: [] }
    });
  }
}

function verifyDiscordRequest(signatureHex: string, timestamp: string, rawBody: string, publicKeyHex: string): boolean {
  try {
    const message = new TextEncoder().encode(`${timestamp}${rawBody}`);
    const signature = hexToUint8Array(signatureHex);
    const publicKey = hexToUint8Array(publicKeyHex);

    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

async function editOriginalInteractionResponse(
  interaction: DiscordInteraction,
  body: DiscordWebhookMessage
): Promise<void> {
  await discordWebhookRequest(interaction, 'messages/@original', 'PATCH', body);
}

async function safeEditOriginalInteractionResponse(
  interaction: DiscordInteraction,
  body: DiscordWebhookMessage
): Promise<void> {
  try {
    await editOriginalInteractionResponse(interaction, body);
  } catch (error) {
    logger.warn('discord_safe_edit_failed', {
      interactionId: interaction.id,
      error
    });
  }
}

async function createFollowupInteractionResponse(
  interaction: DiscordInteraction,
  body: DiscordWebhookMessage
): Promise<void> {
  await discordWebhookRequest(interaction, '', 'POST', body);
}

async function discordWebhookRequest(
  interaction: DiscordInteraction,
  suffix: string,
  method: 'PATCH' | 'POST',
  body: DiscordWebhookMessage
): Promise<void> {
  if (!interaction.application_id || !interaction.token) {
    throw new Error('Interaction payload is missing application_id or token.');
  }

  const baseUrl = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`;
  const url = suffix ? `${baseUrl}/${suffix}` : baseUrl;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Discord webhook request failed with ${response.status}: ${await response.text()}`);
  }
}

function getStringOption(interaction: DiscordInteraction, name: string): string | undefined {
  const option = interaction.data?.options?.find((entry) => entry.name === name);
  return typeof option?.value === 'string' ? option.value.trim() : undefined;
}

function getBooleanOption(interaction: DiscordInteraction, name: string): boolean | undefined {
  const option = interaction.data?.options?.find((entry) => entry.name === name);
  return typeof option?.value === 'boolean' ? option.value : undefined;
}

function getInteractionUserName(interaction: DiscordInteraction): string {
  const user = interaction.member?.user ?? interaction.user;
  return user?.global_name ?? user?.username ?? 'discord-user';
}

function resolveDosuSource(env: WorkerBindings): string {
  if (env.DOSU_MCP_SERVER_URL) {
    return 'server_url';
  }

  if (env.DOSU_MCP_DEPLOYMENT_ID) {
    return 'deployment_id';
  }

  return 'not configured';
}

function deferredMessage(isPrivate: boolean): { type: number; data?: { flags?: number } } {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: isPrivate ? { flags: MESSAGE_FLAG_EPHEMERAL } : undefined
  };
}

function ephemeralMessage(content: string): {
  type: number;
  data: {
    content: string;
    flags: number;
    allowed_mentions: { parse: [] };
  };
} {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: MESSAGE_FLAG_EPHEMERAL,
      allowed_mentions: {
        parse: []
      }
    }
  };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return Response.json(value, init);
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Discord request body was not valid JSON.');
  }
}

function hexToUint8Array(value: string): Uint8Array {
  if (value.length % 2 !== 0) {
    throw new Error('Hex string must have an even length.');
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}

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
const ASK_MESSAGE_COMMAND_NAME = 'Ask Spectre about this';
const INCIDENT_MODAL_CUSTOM_ID = 'incident_report_modal_v1';
const INCIDENT_DEPLOYMENT_TYPE_FIELD_ID = 'incident_deployment_type';
const INCIDENT_VERSION_FIELD_ID = 'incident_version';
const INCIDENT_DESCRIPTION_FIELD_ID = 'incident_description';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MODAL_SUBMIT: 5
} as const;

const ApplicationCommandType = {
  CHAT_INPUT: 1,
  USER: 2,
  MESSAGE: 3
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  MODAL: 9
} as const;

const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2
} as const;

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable().optional()
});

const attachmentSchema = z
  .object({
    filename: z.string().optional(),
    url: z.string().optional(),
    content_type: z.string().optional()
  })
  .passthrough();

const resolvedMessageSchema = z
  .object({
    id: z.string().optional(),
    content: z.string().optional(),
    author: userSchema.optional(),
    attachments: z.union([z.array(attachmentSchema), z.record(z.string(), attachmentSchema)]).optional()
  })
  .passthrough();

const interactionOptionSchema: z.ZodType<DiscordInteractionOption> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.number(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(interactionOptionSchema).optional()
  })
);

const interactionComponentSchema: z.ZodType<DiscordInteractionComponent> = z.lazy(() =>
  z
    .object({
      type: z.number(),
      custom_id: z.string().optional(),
      value: z.string().optional(),
      components: z.array(interactionComponentSchema).optional(),
      component: interactionComponentSchema.optional()
    })
    .passthrough()
);

const interactionSchema = z
  .object({
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
        name: z.string().optional(),
        type: z.number().optional(),
        options: z.array(interactionOptionSchema).optional(),
        target_id: z.string().optional(),
        custom_id: z.string().optional(),
        components: z.array(interactionComponentSchema).optional(),
        resolved: z
          .object({
            messages: z.record(z.string(), resolvedMessageSchema).optional()
          })
          .optional()
      })
      .passthrough()
      .optional(),
    member: z
      .object({
        user: userSchema.optional()
      })
      .optional(),
    user: userSchema.optional()
  })
  .passthrough();

type DiscordInteractionOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
};

type DiscordInteractionComponent = {
  type: number;
  custom_id?: string;
  value?: string;
  components?: DiscordInteractionComponent[];
  component?: DiscordInteractionComponent;
};

type DiscordInteraction = z.infer<typeof interactionSchema>;
type ResolvedMessage = z.infer<typeof resolvedMessageSchema>;

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

  switch (interaction.type) {
    case InteractionType.PING:
      return json({ type: InteractionResponseType.PONG });
    case InteractionType.APPLICATION_COMMAND:
      return handleApplicationCommandInteraction(interaction, env, executionCtx);
    case InteractionType.MODAL_SUBMIT:
      return handleModalSubmitInteraction(interaction, env, executionCtx);
    default:
      return json(ephemeralMessage('Unsupported interaction type.'));
  }
}

function handleApplicationCommandInteraction(
  interaction: DiscordInteraction,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Response {
  const commandName = interaction.data?.name;
  const commandType = interaction.data?.type;

  if (commandType === ApplicationCommandType.MESSAGE || commandName === ASK_MESSAGE_COMMAND_NAME) {
    return handleAskMessageCommandInteraction(interaction, env, executionCtx);
  }

  if (commandType !== ApplicationCommandType.CHAT_INPUT || !commandName) {
    return json(ephemeralMessage('Unsupported application command.'));
  }

  switch (commandName) {
    case 'ask':
      return handleAskInteraction(interaction, env, executionCtx);
    case 'health':
      return handleHealthInteraction(interaction, env, executionCtx);
    case 'incident':
      return json(buildIncidentModalResponse());
    default:
      return json(ephemeralMessage(`Unknown command: ${commandName}`));
  }
}

function handleModalSubmitInteraction(
  interaction: DiscordInteraction,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Response {
  if (interaction.data?.custom_id !== INCIDENT_MODAL_CUSTOM_ID) {
    return json(ephemeralMessage('Unsupported modal submission.'));
  }

  const modalValues = getModalTextValues(interaction);
  const deploymentType = modalValues[INCIDENT_DEPLOYMENT_TYPE_FIELD_ID]?.trim();
  const version = modalValues[INCIDENT_VERSION_FIELD_ID]?.trim();
  const description = modalValues[INCIDENT_DESCRIPTION_FIELD_ID]?.trim();

  if (!deploymentType || !version || !description) {
    return json(ephemeralMessage('All incident fields are required.'));
  }

  const descriptionWordCount = countWords(description);
  if (descriptionWordCount < 50) {
    return json(
      ephemeralMessage(
        `The incident description must be at least 50 words. You provided ${descriptionWordCount} word(s). Please run \`/incident\` again and add more detail.`
      )
    );
  }

  executionCtx.waitUntil(
    processReplyInteraction({
      interaction,
      env,
      prompt: buildIncidentPrompt({
        deploymentType,
        version,
        description
      }),
      isPrivate: true,
      commandName: 'incident'
    })
  );

  return json(deferredMessage(true));
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
    processReplyInteraction({
      interaction,
      env,
      prompt,
      requestedModel,
      isPrivate,
      commandName: 'ask'
    })
  );

  return json(deferredMessage(isPrivate));
}

function handleAskMessageCommandInteraction(
  interaction: DiscordInteraction,
  env: WorkerBindings,
  executionCtx: ExecutionContext
): Response {
  const targetMessage = getTargetMessage(interaction);
  if (!targetMessage) {
    return json(ephemeralMessage('Discord did not include the selected message in the interaction payload.'));
  }

  const selectedMessage = renderTargetMessage(targetMessage);
  if (!selectedMessage.trim()) {
    return json(
      ephemeralMessage(
        'The selected message did not include readable content. If this keeps happening, check the app permissions and try again.'
      )
    );
  }

  executionCtx.waitUntil(
    processReplyInteraction({
      interaction,
      env,
      prompt: buildMessageContextPrompt(selectedMessage),
      isPrivate: true,
      commandName: ASK_MESSAGE_COMMAND_NAME
    })
  );

  return json(deferredMessage(true));
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

async function processReplyInteraction(input: {
  interaction: DiscordInteraction;
  env: WorkerBindings;
  prompt: string;
  requestedModel?: string;
  isPrivate: boolean;
  commandName: string;
}): Promise<void> {
  const { interaction, env, prompt, requestedModel, isPrivate, commandName } = input;

  try {
    const config = loadConfig(env);
    const replyService = new ReplyService(config);
    const result = await replyService.generateReply(
      buildDiscordPromptForInteraction(interaction, prompt, config.app.maxContextMessages),
      {
        model: requestedModel
      }
    );

    await deliverDiscordTextResponse(interaction, result.reply, isPrivate);

    logger.info('discord_interaction_replied', {
      interactionId: interaction.id,
      command: commandName,
      model: result.model,
      attemptedModels: result.attemptedModels,
      private: isPrivate
    });
  } catch (error) {
    logger.error('discord_interaction_reply_failed', {
      interactionId: interaction.id,
      command: commandName,
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

async function deliverDiscordTextResponse(
  interaction: DiscordInteraction,
  content: string,
  isPrivate: boolean
): Promise<void> {
  const chunks = splitDiscordMessage(content);
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
}

function buildDiscordPromptForInteraction(
  interaction: DiscordInteraction,
  prompt: string,
  maxContextMessages: number
): string {
  return buildPrompt(
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
    maxContextMessages
  );
}

function buildMessageContextPrompt(selectedMessage: string): string {
  return [
    `The user invoked the Discord message command "${ASK_MESSAGE_COMMAND_NAME}" on a selected message.`,
    'Analyze the selected message and help the user with it.',
    'If it asks a question, answer it directly.',
    'If it describes a problem, explain likely causes and suggest the most useful next steps.',
    'If the message is ambiguous, say what information is still missing.',
    '',
    'Selected message:',
    selectedMessage
  ].join('\n');
}

function buildIncidentPrompt(input: {
  deploymentType: string;
  version: string;
  description: string;
}): string {
  return [
    'The user submitted an incident report through the `/incident` modal.',
    `Deployment type: ${input.deploymentType}`,
    `Version: ${input.version}`,
    '',
    'Incident description:',
    input.description,
    '',
    'Provide a concise but practical triage response with:',
    '1. A short summary of the incident.',
    '2. The most likely causes.',
    '3. Immediate checks to run next.',
    '4. Recommended mitigation or rollback steps.',
    '5. Any missing information needed to continue troubleshooting.'
  ].join('\n');
}

function buildIncidentModalResponse(): {
  type: number;
  data: {
    custom_id: string;
    title: string;
    components: Array<{
      type: number;
      components: Array<{
        type: number;
        custom_id: string;
        label: string;
        style: number;
        min_length?: number;
        max_length?: number;
        placeholder?: string;
        required: boolean;
      }>;
    }>;
  };
} {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: INCIDENT_MODAL_CUSTOM_ID,
      title: 'Report an Incident',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: INCIDENT_DEPLOYMENT_TYPE_FIELD_ID,
              label: 'Deployment Type',
              style: TextInputStyle.SHORT,
              min_length: 5,
              max_length: 32,
              placeholder: 'cloud or self-hosted',
              required: true
            }
          ]
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: INCIDENT_VERSION_FIELD_ID,
              label: 'Version',
              style: TextInputStyle.SHORT,
              min_length: 2,
              max_length: 128,
              placeholder: 'For example 1.2.3 or a cloud build identifier',
              required: true
            }
          ]
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: INCIDENT_DESCRIPTION_FIELD_ID,
              label: 'Failure Description (50+ words)',
              style: TextInputStyle.PARAGRAPH,
              min_length: 50,
              max_length: 4000,
              placeholder: 'Describe the symptoms, affected scope, recent changes, and what you have already checked.',
              required: true
            }
          ]
        }
      ]
    }
  };
}

function getTargetMessage(interaction: DiscordInteraction): ResolvedMessage | null {
  const targetId = interaction.data?.target_id;
  if (!targetId) {
    return null;
  }

  return interaction.data?.resolved?.messages?.[targetId] ?? null;
}

function renderTargetMessage(message: ResolvedMessage): string {
  const authorName = message.author?.global_name ?? message.author?.username ?? 'unknown-user';
  const attachmentLines = getAttachmentLines(message.attachments);
  const sections = [`Author: ${authorName}`];

  if (message.content?.trim()) {
    sections.push('Content:', message.content.trim());
  }

  if (attachmentLines.length > 0) {
    sections.push('Attachments:', attachmentLines.join('\n'));
  }

  return sections.join('\n');
}

function getAttachmentLines(
  attachments: ResolvedMessage['attachments']
): string[] {
  if (!attachments) {
    return [];
  }

  const list = Array.isArray(attachments) ? attachments : Object.values(attachments);

  return list.map((attachment) => {
    const kind = attachment.content_type ? ` (${attachment.content_type})` : '';
    return `- ${attachment.filename ?? 'attachment'}${kind}${attachment.url ? `: ${attachment.url}` : ''}`;
  });
}

function getModalTextValues(interaction: DiscordInteraction): Record<string, string> {
  const values: Record<string, string> = {};
  const components = interaction.data?.components ?? [];
  collectModalTextValues(components, values);
  return values;
}

function collectModalTextValues(
  components: DiscordInteractionComponent[],
  values: Record<string, string>
): void {
  for (const component of components) {
    if (component.custom_id && typeof component.value === 'string') {
      values[component.custom_id] = component.value;
    }

    if (component.component) {
      collectModalTextValues([component.component], values);
    }

    if (component.components) {
      collectModalTextValues(component.components, values);
    }
  }
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
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

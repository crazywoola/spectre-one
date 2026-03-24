import { z } from 'zod';

const conversationItemSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1, 'conversation item content is required'),
  author: z.string().trim().min(1).optional()
});

const metadataSchema = z.object({
  source: z.string().trim().min(1).optional(),
  workspace: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  user: z.string().trim().min(1).optional()
});

const replyRequestSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required'),
  conversation: z.array(conversationItemSchema).max(100).optional().default([]),
  metadata: metadataSchema.optional().default({}),
  model: z.string().trim().min(1).optional(),
  max_output_tokens: z.coerce.number().int().min(1).max(4_000).optional()
});

export type ReplyRequest = z.infer<typeof replyRequestSchema>;

export function parseReplyRequest(input: unknown): ReplyRequest {
  return replyRequestSchema.parse(input);
}

export function buildPrompt(input: ReplyRequest, maxContextMessages: number): string {
  const conversation = input.conversation
    .slice(-maxContextMessages)
    .map((item) => formatConversationLine(item))
    .filter(Boolean)
    .join('\n');

  return [
    `Source: ${input.metadata.source ?? 'api'}`,
    `Workspace: ${input.metadata.workspace ?? 'unknown-workspace'}`,
    `Channel: ${input.metadata.channel ?? 'unknown-channel'}`,
    `Current user: ${input.metadata.user ?? 'unknown-user'}`,
    '',
    'Recent conversation:',
    conversation || '(no recent context)',
    '',
    'Current message:',
    input.prompt,
    '',
    'Write the reply only.'
  ].join('\n');
}

function formatConversationLine(item: ReplyRequest['conversation'][number]): string {
  const author = item.author?.trim() || defaultAuthor(item.role);
  const content = truncate(item.content.trim(), 500);

  if (!content) {
    return '';
  }

  return `[${item.role}] ${author}: ${content}`;
}

function defaultAuthor(role: ReplyRequest['conversation'][number]['role']): string {
  switch (role) {
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'user';
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

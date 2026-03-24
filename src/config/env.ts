import { z } from 'zod';

const BASE_SYSTEM_PROMPT = [
  'You are Spectre One, an assistant behind an HTTP API.',
  'Reply in the user\'s language when it is clear; otherwise default to concise Simplified Chinese.',
  'Be direct, helpful, and brief.',
  'A Dosu MCP lookup runs before the final answer is written.',
  'Use the retrieved Dosu context when the answer depends on team docs, internal architecture, runbooks, or product knowledge.',
  'If Dosu does not provide enough information, say so plainly instead of guessing.',
  'Return only the final reply text.'
].join(' ');

const DIFY_ISSUE_MODERATION_STANDARDS = `# Dify Issue Moderation Standards

## Source Documents
- Bug report template:
  - https://github.com/langgenius/dify/blob/3aecceff27c6b712628ad463c6e6ac15b8527ebe/.github/ISSUE_TEMPLATE/bug_report.yml
- Code of Conduct (includes language policy):
  - https://github.com/langgenius/dify/blob/4c1ad40f8e8a6ee58a958330558f2178b7e47fa7/.github/CODE_OF_CONDUCT.md
- Contributing guide:
  - https://github.com/langgenius/dify/blob/25ac69afc5ac9324079be5f0d02b2a2b03dcc784/CONTRIBUTING.md

## Repositories Covered
- \`langgenius/dify-plugins\`
- \`langgenius/dify-official-plugins\`
- \`langgenius/dify\`

## Plugin Repositories Rules
Close the issue with a polite markdown comment when any of these is true:

1. Title or description has CJK ratio **>= 20%**.
   - Exception: Ignore Chinese text in the **Self Checks** section when it is only one of these template phrases:
     - \`I confirm that I am using English to submit this report (我已阅读并同意 Language Policy).\`
     - \`[FOR CHINESE USERS] 请务必使用英文提交 Issue，否则会被关闭。谢谢！:)\`
2. Issue is a usage/support question instead of an actionable issue.
3. Issue is unclear (too short, placeholder content, or insufficient context for triage).

For question issues, redirect users to:
- https://forum.dify.ai/
- https://discord.com/invite/FngNHpbcY7

## Core Repository Rules (\`langgenius/dify\`)

### Skip Conditions
Do not moderate when issue author association is:
- \`OWNER\`
- \`MEMBER\`
- \`COLLABORATOR\`
- \`CONTRIBUTOR\`
Do not moderate when the issue has a linked PR (closing reference attached to the issue).

### Enforced Baseline
For other authors, close with a polite comment when any of the following applies:

1. Non-English issue content (CJK ratio **>= 20%**).
   - Exception: Ignore Chinese text in the **Self Checks** section when it is only one of these template phrases:
     - \`I confirm that I am using English to submit this report (我已阅读并同意 Language Policy).\`
     - \`[FOR CHINESE USERS] 请务必使用英文提交 Issue，否则会被关闭。谢谢！:)\`
2. Question-style issue (not actionable bug/task report).
3. Reported Dify version in the description is below \`v1.10.0\`. Ask the reporter to upgrade to the latest release and retest.
4. Issue is about plugin-specific code/package behavior rather than the core repository. Close and redirect:
   - \`langgenius/dify-plugins\` for custom/community plugins, plugin SDK, \`.difypkg\`, \`manifest.yaml\`, plugin daemon, or plugin packaging/development issues.
   - \`langgenius/dify-official-plugins\` for Dify-maintained model/tool/provider plugin issues.
   - If it is clearly plugin-related but the destination is ambiguous, close in \`langgenius/dify\` and provide both repo links.
5. Missing essential issue quality information.

Do not close feature requests that match these accepted patterns (even if they do not contain explicit "use case" keywords):
- Feature request template is filled with a substantive story under the "Is this request related to a challenge you're experiencing?" section (not \`_No response_\`).
- Includes concrete example input/output or expected behavior.
- Clearly asks to add/support/allow/enable/expose/visualize/customize a feature and provides a detailed description.

### Plugin Routing Signals in \`langgenius/dify\`
Use plugin routing when the issue clearly points to plugin/package scope instead of the core app. Common signals include:
- Explicit mention of a plugin/provider together with package/runtime scope such as \`model provider\`, \`tool provider\`, \`plugin install\`, or \`marketplace\`
- Plugin package/runtime files or terms such as \`.difypkg\`, \`manifest.yaml\`, \`dify_plugin\`
- Plugin infrastructure terms such as \`plugin daemon\`
- Plugin development or packaging language such as "custom plugin", "community plugin", "build plugin", "develop plugin"

### Essential Quality Information
For bug-like reports, verify presence of:
- Dify version
- Deployment mode (Cloud or Self Hosted)
- Steps to reproduce
- Expected behavior
- Actual behavior and logs/error details (strongly expected)

Also verify:
- Title is descriptive (not generic like "bug" or "help")
- Description is detailed enough to reproduce or assess
- Language and tone are respectful and professional

For feature-like reports, verify:
- Clear use case/scenario and expected value

## Comment Style
Every close comment should:
- Start with appreciation (\`Hi @user, thanks...\`)
- Use short sections (\`### Why this is being closed\`, \`### Next steps\`)
- Explain exactly what is missing/wrong in neutral language
- Provide actionable next steps and destination links when needed

## Get Your Hands Dirty
Want to dive in and contribute? Here is how to get started:

- Read the contributing guide: https://github.com/langgenius/dify/blob/main/CONTRIBUTING.md
- Browse good first issues: https://github.com/langgenius/dify/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22good%20first%20issue%22
- Add a new model runtime or tool by opening a PR in: https://github.com/langgenius/dify-plugins
- Update existing runtimes/tools or fix plugin bugs in: https://github.com/langgenius/dify-official-plugins
- Link an existing issue or open a new issue in the PR description.`;

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
  INCIDENTS_DB?: D1Database;
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
      systemPrompt: buildSystemPrompt(parsed.SYSTEM_PROMPT?.trim(), parsed.BOT_SYSTEM_PROMPT?.trim())
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

function buildSystemPrompt(systemPrompt?: string, legacyPrompt?: string): string {
  const customPrompt = systemPrompt || legacyPrompt;

  return [BASE_SYSTEM_PROMPT, customPrompt, DIFY_ISSUE_MODERATION_STANDARDS]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

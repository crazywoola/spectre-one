import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

await loadDevVars(path.join(rootDir, '.dev.vars'));

const args = parseArgs(process.argv.slice(2));
const applicationId = requiredEnv('DISCORD_APPLICATION_ID');
const botToken = requiredEnv('DISCORD_BOT_TOKEN');
const guildId = args.guildId ?? process.env.DISCORD_GUILD_ID;
const scope = args.scope ?? (guildId ? 'guild' : 'global');
const manifest = await loadCommandManifest(path.join(rootDir, 'src', 'discord', 'commands.json'));

if (scope === 'guild' && !guildId) {
  throw new Error('Guild scope requires DISCORD_GUILD_ID or --guild <id>.');
}

const url =
  scope === 'guild'
    ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${applicationId}/commands`;

if (args.dryRun) {
  console.log(
    JSON.stringify(
      {
        scope,
        url,
        commands: manifest.commands
      },
      null,
      2
    )
  );
  process.exit(0);
}

const response = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(manifest.commands)
});

if (!response.ok) {
  throw new Error(`Discord command registration failed with ${response.status}: ${await response.text()}`);
}

const data = await response.json();
console.log(`Registered ${Array.isArray(data) ? data.length : 0} ${scope} command(s).`);

async function loadCommandManifest(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function loadDevVars(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = stripQuotes(value);
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    scope: undefined,
    guildId: undefined,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (arg === '--global') {
      args.scope = 'global';
      continue;
    }

    if (arg === '--guild') {
      args.scope = 'guild';
      args.guildId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--guild=')) {
      args.scope = 'guild';
      args.guildId = arg.slice('--guild='.length);
      continue;
    }
  }

  return args;
}

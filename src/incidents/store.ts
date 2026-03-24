import type { WorkerBindings } from '../config/env.js';

export interface IncidentRecordInput {
  interactionId: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  userName: string;
  deploymentType: 'cloud' | 'self-hosted';
  cloudPlan?: 'TEAM' | 'PRO' | 'FREE';
  accountEmail: string;
  version: string;
  description: string;
  descriptionWordCount: number;
}

export async function insertIncidentReport(
  env: WorkerBindings,
  input: IncidentRecordInput
): Promise<string> {
  const db = requireIncidentsDb(env);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  await db
    .prepare(
      `
        INSERT INTO incident_reports (
          id,
          interaction_id,
          guild_id,
          channel_id,
          user_id,
          user_name,
          deployment_type,
          cloud_plan,
          account_email,
          version,
          description,
          description_word_count,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
      `
    )
    .bind(
      id,
      input.interactionId,
      input.guildId ?? null,
      input.channelId ?? null,
      input.userId ?? null,
      input.userName,
      input.deploymentType,
      input.cloudPlan ?? null,
      input.accountEmail,
      input.version,
      input.description,
      input.descriptionWordCount,
      timestamp,
      timestamp
    )
    .run();

  return id;
}

export async function markIncidentReportCompleted(
  env: WorkerBindings,
  reportId: string,
  responseModel: string,
  responseText: string
): Promise<void> {
  const db = requireIncidentsDb(env);
  await db
    .prepare(
      `
        UPDATE incident_reports
        SET status = 'completed',
            response_model = ?,
            response_text = ?,
            response_error = NULL,
            updated_at = ?
        WHERE id = ?
      `
    )
    .bind(responseModel, responseText, new Date().toISOString(), reportId)
    .run();
}

export async function markIncidentReportFailed(
  env: WorkerBindings,
  reportId: string,
  errorMessage: string
): Promise<void> {
  const db = requireIncidentsDb(env);
  await db
    .prepare(
      `
        UPDATE incident_reports
        SET status = 'failed',
            response_error = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .bind(errorMessage, new Date().toISOString(), reportId)
    .run();
}

function requireIncidentsDb(env: WorkerBindings): D1Database {
  if (!env.INCIDENTS_DB) {
    throw new Error('INCIDENTS_DB binding is not configured.');
  }

  return env.INCIDENTS_DB;
}

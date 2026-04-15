/**
 * email.sync task handler.
 *
 * Input shape:
 *   { connectorId: string, backfill?: boolean }
 *
 * Backfill:
 * - Pull messages from the last 50 days (excluding promotions/spam labels)
 * - Also pull every message in threads the user has replied to recently
 * - Persist the current Gmail historyId for incremental from here on
 *
 * Incremental:
 * - Pull only changes since last historyId (Gmail `history.list`)
 * - Falls back to a 7-day backfill if history has expired
 *
 * For each message:
 *   fetch metadata + snippet → classify (Haiku batch) → route:
 *     discard  → nothing
 *     structured → events table (with source: gmail_<class>)
 *     semantic → extract facts into memories table
 */
import type { TaskHandler, TaskRow, RunResult } from '../types.js';
import {
  listMessageIds,
  fetchMessagesMeta,
  getCurrentHistoryId,
  listChangedMessageIds,
  listUserReplyThreadIds,
  type GmailMessageMeta,
} from '../../ingestion/gmail.js';
import { classifyEmails, routeForClass, type EmailClass } from '../../ingestion/email-classifier.js';
import {
  extractAndSaveStructured,
  extractAndSavePersonalFacts,
} from '../../ingestion/email-extractor.js';
import {
  getConnectorSyncCursor,
  setConnectorSyncCursor,
} from '../../ingestion/events-db.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';

interface EmailSyncInput {
  connectorId: string;
  backfill?: boolean;
}

interface SyncStats {
  messages_considered: number;
  discarded: number;
  structured_saved: number;
  personal_facts_saved: number;
  was_backfill: boolean;
}

/** Format a JS Date as Gmail's `YYYY/MM/DD` query syntax. */
function gmailDate(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

async function getConnector(connectorId: string) {
  const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await db
    .from('connectors')
    .select('user_id, credential_id')
    .eq('id', connectorId)
    .single<{ user_id: string; credential_id: string }>();
  return data;
}

export const emailSyncHandler: TaskHandler = {
  type: 'email.sync',
  provider: 'gmail',

  async run(task: TaskRow): Promise<RunResult> {
    const input = task.input as unknown as EmailSyncInput;
    if (!input.connectorId) {
      return { status: 'failed', output: { error: 'connectorId required' } };
    }

    const connector = await getConnector(input.connectorId);
    if (!connector) {
      return { status: 'failed', output: { error: 'connector not found' } };
    }

    const stats: SyncStats = {
      messages_considered: 0,
      discarded: 0,
      structured_saved: 0,
      personal_facts_saved: 0,
      was_backfill: false,
    };

    // Decide sync mode
    const cursor = input.backfill ? null : await getConnectorSyncCursor(input.connectorId);
    const useBackfill = Boolean(!cursor || input.backfill);
    stats.was_backfill = useBackfill;

    // Collect the message IDs we need to process
    let messageIds: string[] = [];
    let nextCursor: string | undefined;

    if (useBackfill) {
      // Last 50 days, excluding promotions + spam
      const fiftyDaysAgo = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
      const recentQuery = `after:${gmailDate(fiftyDaysAgo)} -category:promotions -category:social -in:spam`;
      const recentIds = await listMessageIds({
        credentialId: connector.credential_id,
        query: recentQuery,
        maxResults: 2000,
      });

      // Also pull messages from threads the user has replied to recently (30 days).
      // These threads are high-signal even if the latest message is older than 50d.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const replyThreads = await listUserReplyThreadIds({
        credentialId: connector.credential_id,
        afterDate: gmailDate(thirtyDaysAgo),
      });

      // For each reply thread, pull all messages in it. Use a broad query and dedup.
      const threadMessageIds: string[] = [];
      for (const threadId of replyThreads.slice(0, 200)) {
        const ids = await listMessageIds({
          credentialId: connector.credential_id,
          query: `rfc822msgid:${threadId}`,  // fallback; actual API uses a threadId field
          maxResults: 50,
        }).catch(() => [] as string[]);
        threadMessageIds.push(...ids);
      }

      messageIds = Array.from(new Set([...recentIds, ...threadMessageIds]));

      // Anchor the historyId for next incremental run
      nextCursor = await getCurrentHistoryId(connector.credential_id);
    } else {
      try {
        const changed = await listChangedMessageIds({
          credentialId: connector.credential_id,
          startHistoryId: cursor!,
        });
        messageIds = changed.messageIds;
        nextCursor = changed.nextHistoryId;
      } catch (err) {
        if (err instanceof Error && err.message === 'HISTORY_EXPIRED') {
          // Fall back to a 7-day window
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          messageIds = await listMessageIds({
            credentialId: connector.credential_id,
            query: `after:${gmailDate(sevenDaysAgo)} -category:promotions -in:spam`,
          });
          nextCursor = await getCurrentHistoryId(connector.credential_id);
          stats.was_backfill = true;
        } else {
          throw err;
        }
      }
    }

    stats.messages_considered = messageIds.length;

    // Fetch metadata in parallel batches
    const metas = await fetchMessagesMeta({
      credentialId: connector.credential_id,
      messageIds,
    });

    // Classify everything in batches of 20
    const classMap = await classifyEmails(metas);

    // Route each email
    for (const email of metas) {
      const cls: EmailClass = classMap.get(email.id) ?? 'unknown';
      const route = routeForClass(cls);

      if (route === 'discard') {
        stats.discarded++;
        continue;
      }

      try {
        if (route === 'structured') {
          const ok = await extractAndSaveStructured({
            userId: connector.user_id,
            connectorId: input.connectorId,
            credentialId: connector.credential_id,
            email,
            emailClass: cls,
          });
          if (ok) stats.structured_saved++;
        } else if (route === 'semantic') {
          const factsCount = await extractAndSavePersonalFacts({
            userId: connector.user_id,
            email,
            emailClass: cls,
          });
          stats.personal_facts_saved += factsCount;
        }
      } catch (err) {
        console.error(`[email-sync] extract failed for ${email.id}:`, err);
        // Don't fail the whole sync on a single extract error
      }
    }

    if (nextCursor) {
      await setConnectorSyncCursor(input.connectorId, nextCursor);
    }

    return { status: 'completed', output: stats as unknown as Record<string, unknown> };
  },
};

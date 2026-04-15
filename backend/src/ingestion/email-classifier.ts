/**
 * Email classifier.
 *
 * Claude Haiku classifies each email into one of a small set of categories.
 * We batch 20 emails per Haiku call to keep costs and latency low — classifier
 * only sees subject + sender + first 200 chars of snippet, never the full body.
 *
 * Categories are chosen so each one has a clear downstream action:
 * - discard (promo/notification/newsletter/social) — no storage
 * - structured (receipt/bill/travel/appointment) — events table
 * - semantic (personal/work_important) — memory extraction like chat
 * - unknown — log and default to discard
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { langfuse } from '../telemetry.js';
import type { GmailMessageMeta } from './gmail.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export type EmailClass =
  | 'promo'          // marketing, sales, newsletters we don't want
  | 'notification'   // social media pings, password resets, "your order shipped"
  | 'newsletter'    // subscribed content (news, blogs)
  | 'social'         // LinkedIn/Twitter/etc.
  | 'receipt'        // purchase confirmations with line items
  | 'bill'           // invoices, statements, payment due
  | 'travel'         // flight/hotel/rental confirmations
  | 'appointment'    // healthcare, service appointments
  | 'personal'       // from a real person, not automated
  | 'work'           // work-related from a real person
  | 'unknown';

export type EmailRoute = 'discard' | 'structured' | 'semantic';

export function routeForClass(c: EmailClass): EmailRoute {
  if (c === 'personal' || c === 'work') return 'semantic';
  if (c === 'receipt' || c === 'bill' || c === 'travel' || c === 'appointment') return 'structured';
  return 'discard';
}

const SYSTEM = `You classify emails into categories so a personal AI assistant can decide what to store.

Categories:
- promo: marketing, sales offers, product launches
- notification: automated pings (password resets, order shipped, social media, app alerts)
- newsletter: subscribed content like news/blogs/digests
- social: LinkedIn/Twitter/Facebook/etc. notifications
- receipt: purchase confirmation with an itemized charge
- bill: invoice, statement, payment due
- travel: flight, hotel, rental car confirmation
- appointment: doctor/dentist/service/meeting confirmation with a date
- personal: from a real person, not automated (friends, family)
- work: work correspondence from a real person (not a tool)
- unknown: doesn't fit anywhere

Bias toward discard. When in doubt between personal/notification, pick notification.
When in doubt between work/promo, pick promo.

Respond with a JSON array, one object per email, in the same order as input:
[{"id": "...", "class": "..."}]

Only the JSON — no preamble, no commentary.`;

export async function classifyEmails(emails: GmailMessageMeta[]): Promise<Map<string, EmailClass>> {
  const result = new Map<string, EmailClass>();
  if (emails.length === 0) return result;

  // Batch 20 at a time
  const batches: GmailMessageMeta[][] = [];
  for (let i = 0; i < emails.length; i += 20) {
    batches.push(emails.slice(i, i + 20));
  }

  for (const batch of batches) {
    const trace = langfuse.trace({
      name: 'email-classify',
      tags: ['ingestion', 'email'],
      input: { count: batch.length },
    });

    const userMessage = batch.map((e) => ({
      id: e.id,
      from: e.from.slice(0, 100),
      subject: e.subject.slice(0, 200),
      snippet: e.snippet.slice(0, 200),
    }));

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(userMessage) }],
      });

      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.type === 'text' ? b.text : '')
        .join('');

      // Parse — tolerate code-fence wrapping
      const match = text.match(/\[[\s\S]*\]/);
      const parsed = match ? JSON.parse(match[0]) : [];
      for (const item of parsed as Array<{ id: string; class: string }>) {
        if (item.id && item.class) {
          result.set(item.id, item.class as EmailClass);
        }
      }

      trace.update({ output: `Classified ${parsed.length} of ${batch.length}` });
    } catch (err) {
      console.error('[email-classifier] batch failed:', err);
      trace.update({
        output: err instanceof Error ? err.message : 'unknown error',
        tags: ['ingestion', 'email', 'error'],
      });
      // On failure, default unclassified to 'unknown' (routed to discard)
      for (const e of batch) {
        if (!result.has(e.id)) result.set(e.id, 'unknown');
      }
    }
  }

  // Anything not classified defaults to unknown
  for (const e of emails) {
    if (!result.has(e.id)) result.set(e.id, 'unknown');
  }
  return result;
}

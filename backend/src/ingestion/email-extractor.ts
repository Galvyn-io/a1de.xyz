/**
 * Email extractors.
 *
 * Two flavors:
 * - `extractStructured` — for receipts/bills/travel/appointments. Pulls date,
 *   amount, vendor, title/description so we can store a structured event row.
 * - `extractPersonal` — for personal/work emails, extract durable facts about
 *   the user (like memory extraction from chat, but scoped to one email).
 *
 * Both operate on metadata + snippet only — we don't fetch full bodies.
 * Lower fidelity but massively cheaper and avoids privacy concerns.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { langfuse } from '../telemetry.js';
import { addMemory } from '../memory/db.js';
import { upsertEvents } from './events-db.js';
import { fetchAttachment, type GmailMessageMeta } from './gmail.js';
import type { EmailClass } from './email-classifier.js';

// Only try to parse the first PDF we find, and only if it's under this size.
// Haiku supports up to 32 MB / 100 pages but extraction cost scales with size.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ──────────────────────────────────────────────────────────────────────────
// Structured extraction (receipts, bills, travel, appointments)
// ──────────────────────────────────────────────────────────────────────────

interface StructuredFields {
  title: string;
  date: string | null;         // ISO or null
  end_date: string | null;
  location: string | null;
  description: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
}

const STRUCTURED_SYSTEM = `Extract structured fields from this email. Return JSON:

{
  "title": "short human-readable title, e.g. 'Amazon order #123' or 'Bellevue Golf Course tee time'",
  "date": "ISO datetime for the relevant event (due date for bill, travel date, appointment time), or null",
  "end_date": "ISO for travel end / appointment end, or null",
  "location": "venue, city, or null",
  "description": "one-sentence summary",
  "vendor": "merchant/company/clinic name, or null",
  "amount": "numeric amount as a number (e.g. 42.50), or null",
  "currency": "ISO currency code (USD, EUR, ...), or null"
}

Only the JSON — no commentary.`;

/**
 * If the email has an attached PDF under the size cap, fetch and return it
 * as base64 suitable for Anthropic's document block. Returns null if none.
 */
async function fetchPrimaryPdf(params: {
  credentialId: string;
  email: GmailMessageMeta;
}): Promise<{ base64: string; filename: string } | null> {
  const pdfs = params.email.attachments.filter(
    (a) => a.mimeType === 'application/pdf' && a.size > 0 && a.size <= MAX_PDF_BYTES,
  );
  if (pdfs.length === 0) return null;
  // Take the first (usually the receipt/invoice/itinerary)
  const att = pdfs[0]!;
  const base64 = await fetchAttachment({
    credentialId: params.credentialId,
    messageId: params.email.id,
    attachmentId: att.attachmentId,
  });
  if (!base64) return null;
  return { base64, filename: att.filename };
}

export async function extractStructuredFromEmail(params: {
  email: GmailMessageMeta;
  emailClass: EmailClass;
  credentialId: string;
}): Promise<StructuredFields | null> {
  const { email, emailClass, credentialId } = params;
  const trace = langfuse.trace({
    name: 'email-extract-structured',
    tags: ['ingestion', 'email', emailClass],
    input: { subject: email.subject, from: email.from, attachment_count: email.attachments.length },
  });

  const textPart = `From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Date: ${email.date}
Category: ${emailClass}

Snippet:
${email.snippet.slice(0, 800)}`;

  // Try to attach the primary PDF for richer extraction
  let pdf: { base64: string; filename: string } | null = null;
  try {
    pdf = await fetchPrimaryPdf({ credentialId, email });
  } catch (err) {
    console.warn('[email-extractor] PDF fetch failed (continuing without):', err);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [{ type: 'text', text: textPart }];
  if (pdf) {
    contentBlocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf.base64,
      },
    });
    contentBlocks.push({
      type: 'text',
      text: `The attached PDF is named "${pdf.filename}". Use it for accurate dates, amounts, and line items when extracting.`,
    });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: STRUCTURED_SYSTEM,
      messages: [{ role: 'user', content: contentBlocks }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.type === 'text' ? b.text : '')
      .join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      trace.update({ output: 'no JSON found' });
      return null;
    }
    const parsed = JSON.parse(match[0]) as StructuredFields;
    trace.update({ output: parsed.title, tags: pdf ? ['ingestion', 'email', emailClass, 'pdf'] : undefined });
    return parsed;
  } catch (err) {
    console.error('[email-extractor] structured failed:', err);
    trace.update({ output: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Personal / work: extract memory-worthy facts
// ──────────────────────────────────────────────────────────────────────────

interface ExtractedFact {
  content: string;
  category: string;
  always_inject?: boolean;
  entities?: string[];
}

const PERSONAL_SYSTEM = `Extract durable facts about the user from this email. Return a JSON array.

Extract ONLY:
- Facts about the user (not about others)
- Enduring information (preferences, relationships, ongoing projects)
- Relationships (who is this person? friend, family, coworker, service provider?)

Do NOT extract:
- One-off status updates ("running 5 min late")
- Information about third parties
- Greetings, signatures, pleasantries

For each fact:
{
  "content": "clear statement of the fact about the user",
  "category": "preference | person | project | finance | health | habit",
  "always_inject": boolean (true only for core identity — allergies, key relationships, recurring habits),
  "entities": ["names of people, companies, or places mentioned"]
}

Return just the JSON array, no commentary. [] if nothing worth extracting.`;

/**
 * Extract facts from a personal/work email and save them to memory.
 * Returns the number of facts saved.
 */
export async function extractAndSavePersonalFacts(params: {
  userId: string;
  email: GmailMessageMeta;
  emailClass: EmailClass;
}): Promise<number> {
  const trace = langfuse.trace({
    name: 'email-extract-personal',
    userId: params.userId,
    tags: ['ingestion', 'email', 'personal'],
    input: { subject: params.email.subject, from: params.email.from },
  });

  const userContent = `From: ${params.email.from}
Subject: ${params.email.subject}
Date: ${params.email.date}

Snippet:
${params.email.snippet.slice(0, 800)}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: PERSONAL_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.type === 'text' ? b.text : '')
      .join('');
    const match = text.match(/\[[\s\S]*\]/);
    const facts: ExtractedFact[] = match ? JSON.parse(match[0]) : [];

    for (const f of facts) {
      if (!f.content || !f.category) continue;
      await addMemory({
        userId: params.userId,
        content: f.content,
        source: 'gmail',
        sourceId: params.email.id,
        category: f.category,
        alwaysInject: f.always_inject ?? false,
        entities: f.entities,
      });
    }
    trace.update({ output: `Saved ${facts.length} facts` });
    return facts.length;
  } catch (err) {
    console.error('[email-extractor] personal failed:', err);
    trace.update({ output: err instanceof Error ? err.message : 'unknown' });
    return 0;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Structured: extract + upsert into events table
// ──────────────────────────────────────────────────────────────────────────

export async function extractAndSaveStructured(params: {
  userId: string;
  connectorId: string;
  credentialId: string;
  email: GmailMessageMeta;
  emailClass: EmailClass;
}): Promise<boolean> {
  const fields = await extractStructuredFromEmail({
    email: params.email,
    emailClass: params.emailClass,
    credentialId: params.credentialId,
  });
  if (!fields) return false;

  await upsertEvents([
    {
      userId: params.userId,
      connectorId: params.connectorId,
      // Prefix keeps it easy to filter: events WHERE source LIKE 'gmail_%'
      source: `gmail_${params.emailClass}`,
      sourceId: params.email.id,
      title: fields.title,
      description: fields.description,
      location: fields.location,
      organizer: fields.vendor,
      startAt: fields.date,
      endAt: fields.end_date,
      status: 'confirmed',
      raw: {
        email_from: params.email.from,
        email_subject: params.email.subject,
        amount: fields.amount,
        currency: fields.currency,
        vendor: fields.vendor,
      },
    },
  ]);
  return true;
}

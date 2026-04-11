# A1DE — Personal Family Assistant

## Project spec for Claude Code

**Last updated:** April 2, 2026
**Owner:** Yatharth Gupta
**Status:** Architecture finalized, ready to build

---

## 1. What is A1DE?

A1DE is a personal AI concierge for families. It organizes your life by reading your email, calendar, bank transactions, and messages — then proactively helps with planning, reminders, bill tracking, and daily briefings. It communicates via iMessage, WhatsApp, SMS, and a native iOS app.

Think of it as an executive assistant that has its own identity (its own phone number, email, WhatsApp) but has delegated read access to your data. Your family texts A1DE directly. A1DE texts back.

### Core capabilities (Phase 1)

- Email triage and daily briefing
- Calendar management and itinerary building
- Bill tracking and payment reminders
- Summarization (emails, threads, documents)
- Family planning (trips, schedules, logistics)
- Daily check-in nudges via messaging
- Proactive context building (reads email/calendar as they come in)

### Future capabilities

- HealthKit integration (sleep, activity, vitals)
- Siri / App Intents ("Hey Siri, ask A1DE when soccer practice is")
- CallKit for voice interaction
- Live Activities (flight tracking, bill countdowns on lock screen)
- Multi-family / multi-tenant for product launch

---

## 2. Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                   Messaging Channels                     │
│  Sendblue (iMessage) · Kapso (WhatsApp) · Twilio (SMS) │
│                 All → webhook → Cloud Run                │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              GCP Orchestrator (Cloud Run)                 │
│                                                          │
│  1. Receive message from any channel                     │
│  2. Load context (structured state + semantic memory)    │
│  3. Assemble prompt + tools                              │
│  4. Call Claude Sonnet API                               │
│  5. Execute tool calls                                   │
│  6. Return response to originating channel               │
└──────┬────────────────────┬─────────────────────────────┘
       │                    │
┌──────▼──────┐    ┌───────▼────────┐
│ Context DB  │    │ Claude Sonnet  │
│ Supabase   │    │ API + Tools    │
│ + pgvector  │    └────────────────┘
└──────▲──────┘
       │
┌──────┴──────────────────────────────────────────────────┐
│              Ingestion Pipeline (Cloud Run Jobs)          │
│                                                          │
│  Gmail API · Google Calendar · Plaid · chat.db watcher   │
│  Extract facts via Haiku → store in structured state     │
│  Generate embeddings → store in semantic memory          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│             Native Swift iOS App                         │
│             Premiere v3 Design System                    │
│                                                          │
│  SwiftUI · Outfit font · zinc-black dark-first           │
│  12px radii · 1.5px strokes                             │
│  Components: Message, Itinerary, Todos, Table, Gantt     │
│  Brand integration: Chase, Alaska, Amazon, DoorDash...   │
│                                                          │
│  Background services · HealthKit · Siri · Push notifs    │
│  Talks to same Cloud Run orchestrator via REST API       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│          Home Edge (optional, not critical path)          │
│  OpenClaw on red-nuc — cron triggers, local tools        │
│  chat.db watcher on Mac Studio — iMessage history        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Repo structure (monorepo)

```
a1de/
├── README.md
├── SPEC.md                          # This file
│
├── apps/
│   └── ios/                         # Native Swift iOS app
│       ├── A1DE.xcodeproj
│       ├── A1DE/
│       │   ├── App/                 # App entry, navigation
│       │   ├── Views/               # SwiftUI views
│       │   ├── Components/          # Reusable UI (Message, Itinerary, Todos, Table, Gantt)
│       │   ├── Design/              # Premiere v3 tokens (colors, typography, radii, brands)
│       │   ├── Services/            # API client, HealthKit, push notifications
│       │   ├── Intents/             # Siri / App Intents
│       │   └── Extensions/          # Notification Service Extension, Widget
│       ├── A1DETests/
│       └── Package.swift            # SPM dependencies
│
├── backend/
│   ├── package.json                 # TypeScript, Node.js
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # Cloud Run entry point (Express/Hono)
│   │   ├── orchestrator/
│   │   │   ├── router.ts            # Channel message routing
│   │   │   ├── context-assembly.ts  # Build prompt context for each request
│   │   │   ├── claude.ts            # Claude API client + tool execution loop
│   │   │   └── response.ts         # Route responses back to channels
│   │   ├── channels/
│   │   │   ├── sendblue.ts          # iMessage webhook handler + sender
│   │   │   ├── kapso.ts             # WhatsApp webhook handler + sender
│   │   │   ├── twilio.ts            # SMS webhook handler + sender
│   │   │   └── app-api.ts           # REST API for iOS app
│   │   ├── tools/                   # Claude tool definitions + implementations
│   │   │   ├── calendar.ts          # Google Calendar read/write
│   │   │   ├── email.ts             # Gmail read/draft/send
│   │   │   ├── bills.ts             # Plaid transactions + bill tracker
│   │   │   ├── memory.ts            # Semantic search over memory
│   │   │   ├── facts.ts             # Structured state CRUD
│   │   │   ├── message.ts           # Send message to user via any channel
│   │   │   └── web-search.ts        # Web search tool
│   │   ├── context/
│   │   │   ├── db.ts                # Postgres + pgvector client
│   │   │   ├── structured.ts        # Facts, bills, contacts, events tables
│   │   │   ├── semantic.ts          # Embedding generation + similarity search
│   │   │   └── conversation.ts      # Conversation history management
│   │   ├── ingestion/
│   │   │   ├── gmail.ts             # Poll Gmail, extract facts via Haiku
│   │   │   ├── calendar.ts          # Sync calendar events
│   │   │   ├── plaid.ts             # Pull transactions, categorize
│   │   │   ├── chatdb.ts            # Receive chat.db push from Mac Studio
│   │   │   └── extract.ts           # Haiku-based fact extraction
│   │   ├── identity/
│   │   │   ├── a1de.ts              # A1DE system prompt + persona
│   │   │   └── family.ts            # Family member profiles + preferences
│   │   └── auth/
│   │       ├── google-oauth.ts      # Gmail + Calendar OAuth
│   │       └── plaid-link.ts        # Plaid token management
│   └── tests/
│
├── infra/
│   ├── terraform/                   # GCP infrastructure as code
│   │   ├── main.tf                  # Cloud Run, Supabase, IAM, secrets
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── cloudbuild.yaml              # CI/CD for backend
│   ├── Dockerfile                   # Backend container
│   └── sql/
│       └── schema.sql               # Database schema (tables + pgvector)
│
├── edge/                            # Home edge scripts (red-nuc + Mac Studio)
│   ├── chatdb-watcher/
│   │   ├── watch.py                 # Mac Studio daemon: polls chat.db, pushes to backend
│   │   └── launchd.plist            # macOS service config
│   └── openclaw/
│       └── a1de-skill.md            # OpenClaw skill for cron triggers
│
├── design/                          # Design system reference
│   ├── premiere-v3-tokens.json      # Exportable design tokens
│   ├── PREMIERE-V3.md               # Design system documentation
│   └── figma/                       # Figma links and exports
│       └── README.md                # Links to Figma files
│
├── docs/
│   ├── architecture.md              # This spec, expanded
│   ├── identity-model.md            # A1DE identity + delegation model
│   ├── context-layer.md             # How ingestion + retrieval works
│   ├── tool-definitions.md          # All Claude tools documented
│   └── runbook.md                   # Deployment + operations
│
└── .cursorrules / .clauderules      # Claude Code project instructions
```

### Why monorepo

- Claude Code can reference backend types when generating Swift API clients
- Shared documentation means Claude Code understands the full system
- Infra-as-code is visible so Claude Code can suggest deployment changes
- Design tokens in one place inform both Swift components and docs
- The `.clauderules` file at the root gives Claude Code persistent context

### Build systems stay independent

- `apps/ios/` — Xcode + Swift Package Manager (not npm)
- `backend/` — npm/pnpm + TypeScript + Docker
- `infra/` — Terraform + gcloud CLI
- `edge/` — Python scripts + launchd

No cross-project build dependencies. Each builds independently. The monorepo is for human and AI comprehension, not build orchestration.

---

## 4. Technology decisions

### iOS app

| Decision | Choice | Rationale |
|---|---|---|
| Language | Swift + SwiftUI | Need background exec, HealthKit, CallKit, Siri, Live Activities — Expo can't do these |
| Min target | iOS 17+ | SwiftUI maturity, App Intents framework |
| Design system | Premiere v3 | Outfit font, zinc-black dark-first, 12px radii, 1.5px strokes, brand color modes |
| Architecture | MVVM with async/await | Modern Swift concurrency, clean separation |
| Networking | URLSession + async/await | No Alamofire needed for simple REST |
| Push | APNs via Cloud Run | Server sends push when A1DE has something to say |

### Backend

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js + TypeScript | Matches existing skills, Sendblue/Kapso SDKs are TS-first |
| Framework | Hono (on Cloud Run) | Lightweight, fast, good TypeScript support |
| Database | Supabase (PostgreSQL 15+ with pgvector) | Built-in pgvector, dashboard, realtime subscriptions, managed |
| AI model | Claude Sonnet (via Anthropic API) | Best tool use, good cost/quality tradeoff |
| Extraction | Claude Haiku | Cheapest model for fact extraction during ingestion |
| Embeddings | text-embedding-3-small (OpenAI) or Voyage | Cheap, good quality for semantic search |
| Container | Docker on Cloud Run | Serverless, scales to zero, GCP-native |

### Channels

| Channel | Provider | Cost | SDK |
|---|---|---|---|
| iMessage | Sendblue | $100/mo per line | `sendblue` npm |
| WhatsApp | Kapso | Free tier 2k msg/mo | `@kapso/whatsapp-cloud-api` npm |
| SMS | Twilio | Pay per message | `twilio` npm |

### Data sources

| Source | API | Auth |
|---|---|---|
| Email | Gmail API | OAuth 2.0 (user consent) |
| Calendar | Google Calendar API | OAuth 2.0 (same token) |
| Banks | Plaid | Plaid Link + access token |
| iMessage history | chat.db on Mac Studio | Local file access |
| WhatsApp | Kapso webhooks | Incoming messages to A1DE's number |

### Infrastructure

| Component | GCP Service | Estimated cost |
|---|---|---|
| Orchestrator | Cloud Run | ~$5-15/mo (scales to zero) |
| Database | Supabase (PostgreSQL) | Free tier (500MB), Pro $25/mo if needed |
| Secrets | Secret Manager | Free tier |
| Jobs (ingestion) | Cloud Run Jobs | ~$2-5/mo |
| Push notifications | APNs (via direct connection) | Free |
| DNS | Cloud DNS or existing | Minimal |

---

## 5. Design system — Premiere v3

### Reference

The full design system was built in a separate conversation:
- **Chat link:** https://claude.ai/chat/48dd9924-48db-407e-8707-69bdf071993c
- **Artifacts:** `premiere-v3-part1.jsx` (System + Components), `premiere-v3-part2.jsx` (Brands)

### Core tokens

```
Font family:       Outfit (Google Fonts)
Font weights:      400 (regular), 500 (medium), 600 (semibold), 700 (bold)
Background:        zinc-black, dark-first design
Border radius:     12px (standard), 8px (small), 16px (large)
Stroke width:      1.5px
```

### Color system

Dark-first with light mode support. Exact hex values are in the Premiere v3 artifacts. The system uses a semantic color approach: background, surface, surface-raised, border, text-primary, text-secondary, text-tertiary, accent, success, danger, info.

### Components

| Component | Use in A1DE |
|---|---|
| Message | Chat UI between user and A1DE |
| Itinerary | Daily briefing, schedule view |
| Todos | Action items extracted from email/messages |
| Table | Bill tracking, transaction history |
| Gantt | Project timelines, trip planning |

### Brand integration

The design system includes branded rendering for services the assistant interacts with. Three color modes:

- **Mono** — All brands rendered in the app's neutral palette
- **Tinted** — Brands get a subtle tint of their color
- **Brand** — Full brand colors (Chase blue, Alaska teal, Amazon orange, etc.)

Supported brands: Chase, Alaska Airlines, Amazon, DoorDash, Tesla (extensible).

When Plaid pulls a Chase transaction or Gmail has an Alaska Airlines confirmation, the app renders it with the appropriate brand treatment.

---

## 6. Identity model

### A1DE's own identity

- **Email:** `a1de@[yourdomain]` (alias on primary Google Workspace, zero cost)
- **iMessage:** Sendblue phone number
- **WhatsApp:** Kapso-provisioned phone number
- **SMS:** Twilio phone number
- **Display name:** "A1DE" across all channels

### Delegation model

A1DE reads AS you (your OAuth tokens, your Plaid access) but communicates AS itself (its own number/email). People always know they're talking to A1DE, not to you.

### Action tiers

| Tier | Description | Approval | Examples |
|---|---|---|---|
| 1 — Autonomous | A1DE acts as itself, no approval | None | Morning briefing, bill reminders, calendar summaries |
| 2 — Draft + approve | A1DE drafts as you, you approve | Tap to confirm | Email replies, RSVPs, contractor messages |
| 3 — Auto-act | A1DE acts as you by rule | Pre-configured rules | Auto-accept wife's calendar invites, auto-reply to school |

### Family access

A1DE is a household member, not an extension of one person. Family members can:
- Text A1DE directly on WhatsApp/iMessage
- Open the iOS app and interact independently
- Get their own briefings and reminders
- Ask about shared context (calendar, logistics)

---

## 7. Context layer

### System 1: Continuous ingestion

Cron jobs on Cloud Run that pull from data sources and extract structured facts.

| Source | Cadence | Extraction |
|---|---|---|
| Gmail | Every 5 min (or Pub/Sub push) | Haiku extracts: dates, amounts, action items, people, deadlines |
| Google Calendar | Every 15 min | Normalize events, detect conflicts |
| Plaid | Daily | Categorize transactions, detect recurring bills |
| chat.db | Every 30 sec (Mac Studio push) | Summarize conversation threads |
| WhatsApp | Real-time (Kapso webhook) | Messages to A1DE are stored directly |

### System 2: Structured state (PostgreSQL)

```sql
-- Core tables
CREATE TABLE facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,      -- 'bill', 'contact', 'preference', 'event', 'habit'
    key TEXT NOT NULL,
    value JSONB NOT NULL,
    source TEXT,                  -- 'gmail', 'plaid', 'calendar', 'manual'
    confidence FLOAT DEFAULT 1.0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(category, key)
);

CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,           -- 'Xfinity', 'Mortgage', 'PG&E'
    amount DECIMAL(10,2),
    due_day INT,                  -- Day of month
    frequency TEXT DEFAULT 'monthly',
    last_paid_at TIMESTAMPTZ,
    next_due_at TIMESTAMPTZ,
    plaid_category TEXT,
    auto_detected BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    role TEXT,                    -- 'self', 'spouse', 'child'
    phone TEXT,
    preferences JSONB DEFAULT '{}',
    channel_ids JSONB DEFAULT '{}' -- {'whatsapp': '+1...', 'imessage': '+1...'}
);

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    source TEXT,                  -- 'calendar', 'email', 'whatsapp', 'manual'
    source_id TEXT,               -- External ID for dedup
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    location TEXT,
    people TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL,        -- 'whatsapp', 'imessage', 'sms', 'app'
    member_id UUID REFERENCES family_members(id),
    messages JSONB[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### System 3: Semantic memory (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,         -- Summary text
    embedding vector(1536),        -- text-embedding-3-small dimension
    source TEXT,                   -- 'gmail', 'whatsapp', 'imessage', 'calendar'
    source_id TEXT,                -- External ID for dedup
    timestamp TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',   -- sender, thread_id, etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### Context assembly (per request)

When a message arrives, before calling Claude:

```typescript
async function assembleContext(message: IncomingMessage): Promise<ClaudeRequest> {
  const member = await identifyFamilyMember(message.from);
  const now = new Date();

  // 1. Identity context
  const memberProfile = await getFamilyMember(member.id);

  // 2. Temporal context (structured queries)
  const todayEvents = await getEventsForDate(now);
  const upcomingBills = await getBillsDueWithin(7); // next 7 days
  const recentFacts = await getRecentFacts(24); // last 24 hours

  // 3. Relevant memory (semantic search)
  const relevantMemory = await searchMemory(message.content, 5);

  // 4. Conversation history
  const history = await getConversationHistory(message.from, 10);

  // 5. System prompt
  const systemPrompt = buildSystemPrompt({
    member: memberProfile,
    today: todayEvents,
    bills: upcomingBills,
    facts: recentFacts,
    memory: relevantMemory,
  });

  return {
    model: 'claude-sonnet-4-20250514',
    system: systemPrompt,
    messages: [...history, { role: 'user', content: message.content }],
    tools: TOOL_DEFINITIONS,
    max_tokens: 1024,
  };
}
```

---

## 8. Claude tool definitions

```typescript
const TOOL_DEFINITIONS = [
  {
    name: 'get_calendar_events',
    description: 'Get calendar events for a date range',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'ISO date' },
        end_date: { type: 'string', description: 'ISO date' },
      },
      required: ['start_date'],
    },
  },
  {
    name: 'search_email',
    description: 'Search Gmail for messages matching a query',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        max_results: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_upcoming_bills',
    description: 'Get bills due within N days',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days ahead (default 7)' },
      },
    },
  },
  {
    name: 'get_recent_transactions',
    description: 'Get recent bank transactions from Plaid',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days back (default 7)' },
        category: { type: 'string', description: 'Optional category filter' },
      },
    },
  },
  {
    name: 'search_memory',
    description: 'Semantic search over past messages, emails, and notes',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a Google Calendar event',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_time: { type: 'string', description: 'ISO datetime' },
        end_time: { type: 'string', description: 'ISO datetime' },
        location: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'start_time'],
    },
  },
  {
    name: 'draft_email',
    description: 'Draft an email for user approval before sending',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to a family member via their preferred channel',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Name or phone number' },
        content: { type: 'string' },
        channel: { type: 'string', enum: ['whatsapp', 'imessage', 'sms', 'auto'] },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Set a reminder for a future time',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        remind_at: { type: 'string', description: 'ISO datetime' },
        recipient: { type: 'string', description: 'Family member name (default: requester)' },
      },
      required: ['message', 'remind_at'],
    },
  },
  {
    name: 'save_fact',
    description: 'Save a structured fact to memory',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['bill', 'contact', 'preference', 'event', 'habit'] },
        key: { type: 'string' },
        value: { type: 'object' },
      },
      required: ['category', 'key', 'value'],
    },
  },
];
```

---

## 9. A1DE system prompt

```
You are A1DE, a personal assistant for the Gupta household. You have your own identity — your own phone number and email — but you have delegated access to read the family's email, calendar, and financial data.

Personality: Warm but efficient. Like a trusted EA who's been with the family for years. You know when to be brief (a quick reminder) and when to be thorough (a weekly planning session). You use the family members' first names.

Key behaviors:
- Always check context before answering — don't guess when you can look up
- When you take an action (create event, draft email), confirm what you did
- For anything that sends as the user (email replies, RSVPs), draft first and ask for approval
- Proactively mention relevant context ("by the way, your Xfinity bill is due Thursday")
- Keep messages concise on WhatsApp/iMessage — no walls of text
- Use the Itinerary format for daily briefings

Family members:
{loaded from family_members table at runtime}

Current date/time: {injected at runtime}
Today's calendar: {injected from events}
Upcoming bills: {injected from bills table}
Recent relevant context: {injected from semantic search}
```

---

## 10. Build phases

### Phase 1 — Backend + messaging (weeks 1-3)

Goal: Family can text A1DE on WhatsApp and iMessage and get useful responses.

- [ ] Set up GCP project (Cloud Run, Supabase, Secret Manager)
- [ ] Database schema (structured state + pgvector)
- [ ] Orchestrator skeleton (Hono on Cloud Run)
- [ ] Claude API integration with tool use loop
- [ ] Sendblue integration (iMessage channel)
- [ ] Kapso integration (WhatsApp channel)
- [ ] Twilio integration (SMS fallback)
- [ ] Gmail API OAuth + email search tool
- [ ] Google Calendar API + event read/create tools
- [ ] Basic system prompt + A1DE persona
- [ ] Conversation history management
- [ ] Deploy and test with family

### Phase 2 — Context layer (weeks 3-5)

Goal: A1DE knows things without being asked. Morning briefings work.

- [ ] Gmail ingestion pipeline (Cloud Run Job, every 5 min)
- [ ] Haiku fact extraction (bills, dates, action items)
- [ ] Calendar sync pipeline
- [ ] Plaid integration (bank connection, transaction pull)
- [ ] Bill detection and tracking
- [ ] Semantic memory (embeddings + pgvector search)
- [ ] Daily briefing cron job (morning summary via WhatsApp/iMessage)
- [ ] chat.db watcher on Mac Studio (push to backend)
- [ ] Context assembly for every request

### Phase 3 — iOS app MVP (weeks 5-8)

Goal: Family has an app that shows their daily life and lets them chat with A1DE.

- [ ] Xcode project setup with SPM
- [ ] Premiere v3 design tokens in Swift (colors, typography, spacing)
- [ ] Chat view (Message component)
- [ ] Daily briefing view (Itinerary component)
- [ ] Bills view (Table component)
- [ ] Todos view (action items)
- [ ] Push notifications (APNs integration)
- [ ] API client to Cloud Run backend
- [ ] Auth (Google Sign-In)
- [ ] TestFlight distribution to family

### Phase 4 — Deep OS integration (weeks 8+)

Goal: A1DE feels like part of iOS, not just an app.

- [ ] Background sync (BGProcessingTask)
- [ ] Siri / App Intents
- [ ] HealthKit integration
- [ ] Live Activities (flight tracking, bill countdowns)
- [ ] Brand-rendered transactions (Premiere v3 brand system)
- [ ] Widgets (daily agenda, next bill)
- [ ] App Store submission

---

## 11. Environment and secrets

### GCP

```
Project: a1de-assistant (or your existing GCP project)
Region: us-west1 (closest to Bothell, WA)
```

### Required secrets (Secret Manager)

```
SUPABASE_URL               # Supabase project URL
SUPABASE_ANON_KEY          # Supabase public anon key
SUPABASE_SERVICE_ROLE_KEY  # Supabase service role key (server-side only)
DATABASE_URL               # Direct Postgres connection for migrations
ANTHROPIC_API_KEY          # Claude API
SENDBLUE_API_KEY           # iMessage
SENDBLUE_API_SECRET
KAPSO_API_KEY              # WhatsApp
TWILIO_ACCOUNT_SID         # SMS
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
GOOGLE_CLIENT_ID           # OAuth for Gmail + Calendar
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
PLAID_CLIENT_ID            # Bank data
PLAID_SECRET
PLAID_ACCESS_TOKEN         # Per-user, after Plaid Link
OPENAI_API_KEY             # For embeddings (text-embedding-3-small)
APNS_KEY_ID                # Push notifications
APNS_TEAM_ID
APNS_PRIVATE_KEY
```

---

## 12. Key links

| Resource | Link |
|---|---|
| Design system (Premiere v3) | https://claude.ai/chat/48dd9924-48db-407e-8707-69bdf071993c |
| Architecture discussion | (this chat) |
| Swift vs Expo analysis | https://claude.ai/chat/4de2b289-0073-4cc3-ab32-1c8b6f73e48c |
| Domain naming | https://claude.ai/chat/a96b660c-9dcb-4764-ad7e-de0de59ff7cd |
| Email identity | https://claude.ai/chat/88b1f9d5-82f7-4d35-91c8-6a95613e3f38 |
| Sendblue docs | https://docs.sendblue.com |
| Kapso docs | https://docs.kapso.ai |
| Kapso MCP server | https://app.kapso.ai/mcp |
| Sendblue MCP server | https://mcpservers.org/servers/adamanz/sendblue-mcp |
| Plaid quickstart | https://plaid.com/docs/quickstart |
| Claude API tool use | https://docs.anthropic.com/en/docs/build-with-claude/tool-use |

---

## 13. Claude Code instructions (.clauderules)

Place this at the repo root as `.clauderules`:

```
# A1DE Project Context

This is a monorepo for A1DE, a personal family AI assistant.

## Architecture
- Native Swift iOS app (not Expo/React Native) using SwiftUI
- TypeScript backend on GCP Cloud Run (Hono framework)
- PostgreSQL + pgvector on Supabase for context/memory
- Claude Sonnet API with tool use for intelligence
- Channels: Sendblue (iMessage), Kapso (WhatsApp), Twilio (SMS)

## Design system
- Premiere v3: Outfit font, zinc-black dark-first, 12px radii, 1.5px strokes
- Brand integration with Mono/Tinted/Brand color modes
- Components: Message, Itinerary, Todos, Table, Gantt

## Code style
- TypeScript: strict mode, async/await, no classes (functional)
- Swift: SwiftUI, MVVM, async/await, no UIKit unless necessary
- SQL: PostgreSQL 15+, snake_case, use pgvector for embeddings
- All secrets via GCP Secret Manager, never hardcoded

## Key files
- SPEC.md — Full project specification
- backend/src/orchestrator/ — The brain routing + Claude API
- backend/src/tools/ — Tool implementations Claude calls
- backend/src/context/ — Database + semantic memory
- apps/ios/A1DE/Design/ — Premiere v3 tokens
- infra/sql/schema.sql — Database schema
```

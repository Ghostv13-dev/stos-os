STOS V2.3.2 — Production Hardened
SWAN Telegram Operating System — One owner. One bot. Buttons replace typing.
This is a hardened fork addressing four critical production issues:
Broadcast Bomb — Batch fan-out in queue worker, not request path
OCC Retry Vacuum — Bounded retries with fresh FSM recomputation
Table Scan Vacuum — Paginated, rate-limited reconciliation sweep
Orphaned Queue State — Explicit cleanup on success/failure
Architecture
Layer 1: Internal Modules (Intent Only)
Generate execution plans. Never mutate state. Never call each other.
├── Content Engine
├── Button Engine
├── Automation Engine
├── Community Engine
├── Customer Service Engine
└── Delivery Engine
Layer 2: Runtime Services (Validate Intent, Mutate State)
13-step pipeline with atomic commit, bounded retries, and proper outbox/queue lifecycle.
1.  Event Ingestion
2.  Identity Resolution
3.  Permission Validation
4.  Route Resolution
5.  Execution Planning
6.  FSM Processing
7.  KV Atomic Commit ← all 5 outputs in one transaction
8.  Outbox Management
9.  Queue Processing
10. Delivery Coordination
11. Audit Recording
12. Idempotency Control
13. Lock Management

RETRY LOOP (on OCC failure):
  - Re-fetch actor from KV
  - Recompute FSM state
  - Rebuild commit payload
  - Retry up to 5 times with exponential backoff
Layer 3: External Tools (Execute Effects)
Never mutate STOS state.
├── Telegram Bot API
├── Deno Runtime / Deno KV
└── HTTPS Webhook
Queue Worker (Batched Fan-Out)
The queue worker implements batched delivery for broadcast operations:
Reads paginated chunks from KV (max 1000 mutations per commit)
Each batch gets its own idempotency marker
Prevents broadcast bomb: request path emits single BROADCAST_JOB, worker expands it
Deployment
1. Create a Telegram bot
# Message @BotFather
/newbot
# Copy the token
2. Get your Telegram user ID
# Message @userinfobot
# Copy your numeric ID
3. Deploy to Deno Deploy
# Push to GitHub
git push origin main

# Go to dash.deno.com → New Project → Import from GitHub
# Set entry point: main.ts
# Set environment variables:
Environment Variables:
BOT_TOKEN=<your-bot-token>
WEBHOOK_SECRET=<generate: openssl rand -hex 32>
OWNER_ID=<your-numeric-user-id>
WEBHOOK_URL=<your-deno-deploy-url, e.g. https://stos.deno.dev>
4. Register the webhook
deno run --allow-env --allow-net scripts/setup-webhook.ts
5. Test
# Message your bot
/start
# Owner control panel appears
File Structure
stos/
├── main.ts ← Server entry point, webhook + queue worker
├── deno.json ← Project config + tasks
├── .env.example ← Environment variables
├── scripts/
│   └── setup-webhook.ts ← One-time webhook registration
└── src/
    ├── types/
    │   └── index.ts ← All types and interfaces
    ├── engines/ ← Layer 1: Intent generation
    │   ├── button-engine.ts
    │   ├── content-engine.ts
    │   ├── automation-engine.ts
    │   ├── community-engine.ts
    │   ├── customer-service-engine.ts
    │   └── delivery-engine.ts
    ├── runtime/ ← Layer 2: State mutation + pipeline
    │   ├── pipeline.ts ← 13-step processing + retry loop
    │   ├── router.ts ← Step 4: Route resolution
    │   ├── kv.ts ← Deno KV access + atomic commit
    │   ├── delivery.ts ← Step 10: Delivery coordination
    │   └── queue-worker.ts ← Batched queue consumption
    └── utils/
        └── telegram.ts ← Layer 3: Telegram API wrapper
Key Fixes
Fix #1: Broadcast Bomb
Problem: planToOutboxEntries() in synchronous request path scales outbox entries linearly with audience size.
Solution:
Layer 1 emits single BROADCAST_JOB intent with subscriber list or cursor
Queue worker reads KV in paginated batches (≤1000 per commit)
Each batch gets idempotency marker to prevent double-send on worker crash
Files:
src/engines/delivery-engine.ts — Changed to emit BROADCAST_JOB instead of individual outbox entries
src/runtime/queue-worker.ts — New batched delivery logic with pagination
Fix #2: OCC Retry Vacuum
Problem: Single concurrent write silently drops update because atomicCommit() returns false and throws immediately. No retry, but INV-09 still forces 200 back to Telegram.
Solution:
Bounded retry loop (5 attempts, exponential backoff)
Re-fetch actor from KV on each retry
Recompute FSM state against freshly-fetched actor
Only throw after all retries exhausted
Files:
src/runtime/pipeline.ts — Wrapped commit in retryWithBackoff() loop
Fix #3: Table Scan Vacuum
Problem: listPendingOutbox() does O(N) scan on every check. No pagination, no rate-limiting.
Solution:
Reconciliation sweep is still needed (for entries whose enqueue failed or worker crashed before ack)
But only run via background cron job, not per-request
Use cursor-based pagination to scan in chunks
Rate-limit sweep interval to once per minute
Files:
src/runtime/kv.ts — listPendingOutbox() now uses pagination cursor
src/runtime/queue-worker.ts — Reconciliation sweep scheduled at interval, not on-demand
Fix #4: Orphaned Queue State
Problem: tx.enqueue() creates durable job, but Keys.queue(item.id) write orphans it if worker never runs or crashes before ack.
Solution:
Remove Keys.queue(item.id) write entirely and rely on tx.enqueue() payload
OR keep it but explicitly kv.delete() on successful processing
For failed jobs, write to dead-letter queue before delete
Files:
src/runtime/kv.ts — atomicCommit() no longer writes queue state keys
src/runtime/queue-worker.ts — Explicit cleanup on success/failure
Invariants (Never Violate)
#
Rule
INV-01
All mutations commit in one atomic transaction
INV-02
Internal Modules produce intent only. Never side effects
INV-03
Only Runtime Services may mutate persistent state
INV-04
Outbox entries written inside the atomic commit
INV-05
Idempotency check occurs before execution begins
INV-06
Lock acquired before FSM processing begins
INV-07
Audit entries are permanent and immutable
INV-08
STOS has exactly one owner. Always singular
INV-09
Webhook always returns 200 to Telegram
INV-10
Secret token validated on every incoming request
INV-11
Modules do not share state or call each other
INV-12
Pipeline steps execute in fixed sequential order
INV-13
Telegram is an output surface only. Never drives FSM directly
Security
Secret token: Validated on every request before any processing
Environment variables: BOT_TOKEN and WEBHOOK_SECRET live only in Deno Deploy env vars—never in source code, logs, or responses
Three roles: OWNER / MEMBER / GUEST
KV namespaces: Isolated by key prefix, never by if-checks
Divergence rule: If code diverges from the specification, the code is wrong
STOS V2.3.1
Telegram Bot Orchestration System — Deno KV is the sole authority. Telegram is a derived side effect.
Architecture: Four-Zone Pipeline
INTENT → PLAN → COMMIT → OUTBOX → QUEUE → WORKER → SEND → FINALIZE
Every Telegram interaction executes through a strict, ordered pipeline. The forbidden path (SEND → COMMIT) is structurally impossible by design.
Zone Map
Zone A — Intent Processing (zones/a_intent.ts)
Step
Name
Description
1
Webhook Ingress
Deno.serve() receives Telegram updates
2
Global Idempotency Gate
SHA256(update_id + token) — duplicate updates are dropped
3
Identity Resolution
Classifies sender as OWNER, PUBLIC, or GROUP
4
FSM Context Load
Reads ["owner","state"] and ["public","catalog",chatId,"state"] from KV
5
UBES Intent Compiler
text → IR → route: classifies as READ, ACTION, ANALYZE, or CREATE
6
Planner
Runs permission checks, route selection, and builds ExecutionPlan with MutationFrame[] + OutboxJob[]
Zone B — Transaction Authority (zones/b_transaction.ts)
Step
Name
Description
7
Transaction Frame Assembly
Assembles Primary Records, Secondary Indexes, Audit Logs, Aggregates, Outbox Jobs, Effect Reservations
8
Atomic CAS Transaction
kv.atomic().check().set(state).set(indexes).set(audit).set(aggregate).set(outbox).enqueue(job).commit()
On COMMIT SUCCESS: state is durable, outbox created, aggregate created, jobs created.
On COMMIT FAIL: ABORTED — zero side effects emitted, retried up to 3×.
Zone C — Transactional Outbox (zones/c_outbox.ts)
Step
Name
Description
9
Deno KV Queue
kv.enqueue() — jobs are durable before any delivery attempt
10
Worker Pool
kv.listenQueue() — concurrent job consumers
11
Admission Control
in_flight < max_inflight (8) — exponential requeue if over limit
12
Ownership Lock
CAS PENDING → RUNNING — prevents duplicate processing across workers
13
Effect Dedupe
HMAC(txId, postId:targetId) sentinel — already-sent effects are skipped
14
Global Rate Limiter
Token bucket: 22 messages / second
15
Telegram Delivery
sendMessage / editMessageText / deleteMessage
Zone D — Finalization (zones/d_finalize.ts)
Step
Name
Description
16
Result Commit
Writes effects/*, jobs/*, counters atomically
17
Delivery Aggregate
success + failed == expected? → Aggregate Finalizer → PUBLISHED or FAILED
Invariants
Authoritative Ordering Guarantee
INTENT → PLAN → COMMIT → OUTBOX → QUEUE → WORKER → SEND → FINALIZE
Forbidden Path
SEND → COMMIT   ← structurally impossible
Forbidden State Transition
SCHEDULED → PUBLISHED   ← must pass through CONFIRMING
File Structure
stos/
├── main.ts                  # Entry: Deno.serve() + kv.listenQueue()
├── deno.json                # Tasks, compiler options
├── .env.example             # Required environment variables
│
├── types.ts                 # All shared type definitions
│
├── kv/
│   ├── store.ts             # Deno.openKv() wrapper
│   └── keys.ts              # All KV key builders (never construct raw arrays elsewhere)
│
├── zones/
│   ├── a_intent.ts          # Zone A: Steps 1–6
│   ├── b_transaction.ts     # Zone B: Steps 7–8
│   ├── c_outbox.ts          # Zone C: Steps 9–15
│   └── d_finalize.ts        # Zone D: Steps 16–17
│
└── lib/
    ├── crypto.ts             # SHA-256 (idempotency) + HMAC (effect dedupe)
    ├── identity.ts           # OWNER / PUBLIC / GROUP resolution
    ├── fsm.ts                # FSM state loader + transition table
    ├── ubes.ts               # UBES Intent Compiler (text → IR)
    ├── planner.ts            # Route selection + ExecutionPlan assembly
    └── telegram.ts           # Telegram API calls (side effects only)
Quick Start
1. Configure environment
cp .env.example .env
# Fill in BOT_TOKEN, OWNER_ID, CHANNEL_ID, HMAC_SECRET
2. Set webhook
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-host/webhook"
3. Run
deno task start
4. Development (watch mode)
deno task dev
KV Key Schema
Key
Description
["idempotency", hash]
Global update dedup (TTL: 48h)
["owner", "state"]
Owner FSM state
["public", "catalog", chatId, "state"]
Per-chat public FSM state
["outbox", "jobs", txId, jobIdx]
Outbox job record
["jobs", txId, jobIdx, "status"]
Job delivery status
["effects", hmac]
Effect dedupe sentinel (TTL: 7d)
["aggregates", txId]
Delivery aggregate
["audit", txId, ts]
Immutable audit log entry
["rate_limiter", "global"]
Token bucket state
["locks", txId, jobIdx]
Per-job ownership lock
Identity Roles
Role
Condition
Permissions
OWNER
userId == OWNER_ID
All commands
GROUP
Chat type is group or supergroup
READ, ACTION (subscribe)
PUBLIC
All other private chats
READ, subscribe
UBES Intent Types
Type
Triggers
READ
/start, /help, /list, /view, /status
ACTION
/cancel, /delete, /publish, /confirm, /subscribe
ANALYZE
/stats, /analytics, /report
CREATE
/compose, /schedule, /draft, /preview
Owner FSM States
IDLE
 ├─ /compose  → COMPOSING
 └─ /schedule → SCHEDULING

COMPOSING
 ├─ /preview → CONFIRMING
 └─ /cancel  → IDLE

SCHEDULING
 ├─ /confirm → CONFIRMING  ← ONLY valid path to CONFIRMING from SCHEDULING
 └─ /cancel  → IDLE

CONFIRMING
 ├─ /publish → PUBLISHING
 └─ /cancel  → IDLE

PUBLISHING
 └─ __done   → IDLE
Forbidden: SCHEDULING → PUBLISHING (must pass through CONFIRMING)
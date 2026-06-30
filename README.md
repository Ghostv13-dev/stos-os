STOS V2.3.2 is a production-hardened version of the SWAN Telegram Operating System designed around a strict principle: one owner, one bot, with button-driven operation instead of text commands. The architecture separates intent generation from state mutation and execution. 

Core Architecture

The system is divided into three layers:

1. Internal Modules (Layer 1)



Content Engine

Button Engine

Automation Engine

Community Engine

Customer Service Engine

Delivery Engine


These modules only generate execution intent. They never modify state and never call one another directly. 

2. Runtime Services (Layer 2) A 13-step processing pipeline handles:



Event ingestion

Permission validation

Routing

FSM processing

Atomic state commits

Queue management

Delivery

Auditing

Idempotency

Lock management


All persistent changes occur here. Atomic commits ensure consistency, while retries handle concurrent update conflicts. 

3. External Tools (Layer 3)



Telegram Bot API

Deno Runtime / Deno KV

HTTPS Webhooks


These execute effects but never modify STOS state directly. 

Major Production Fixes

Version 2.3.2 addresses four critical scalability and reliability issues:

1. Broadcast Bomb Broadcasts are converted into a single broadcast job and expanded by a queue worker in batches rather than creating massive synchronous fan-outs. This prevents request-path overload. 


2. OCC Retry Vacuum Concurrent write conflicts now trigger up to five retries with exponential backoff, reloading state and recomputing the FSM each attempt. 


3. Table Scan Vacuum Outbox reconciliation now uses paginated, rate-limited background sweeps instead of expensive full-table scans during requests. 


4. Orphaned Queue State Queue jobs are explicitly cleaned up after success or failure, preventing durable orphan records. 



Deployment Model

Deployment targets Deno Deploy:

Create a Telegram bot through BotFather.

Obtain the owner's Telegram ID.

Push the repository to GitHub.

Import the repository into Deno Deploy.

Configure BOT_TOKEN, WEBHOOK_SECRET, OWNER_ID, and WEBHOOK_URL.

Register the Telegram webhook.

Start interacting with the bot. 


Key Design Rules

The system enforces several non-negotiable invariants:

All state mutations occur in one atomic transaction.

Only Runtime Services may change persistent state.

Internal Modules never perform side effects.

Outbox writes occur within atomic commits.

Webhooks always return HTTP 200 to Telegram.

There is exactly one owner.

Modules cannot call each other.

Pipeline execution order is fixed.

Telegram is only an output surface and does not drive state transitions directly. 


Overall Assessment

STOS V2.3.2 is essentially a single-owner Telegram operating system built around event sourcing, FSM-driven workflows, Deno KV atomic transactions, queue-based delivery, and strict architectural separation. Its primary improvements over earlier versions focus on scalability, concurrency safety, queue durability, and operational reliability. The architecture is considerably more production-ready than the earlier blueprints because it explicitly addresses broadcast scaling, optimistic concurrency conflicts, reconciliation efficiency, and queue cleanup.  
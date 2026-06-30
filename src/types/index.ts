// ========================================================================
// STOS V2.3.2 — TYPE DEFINITIONS
// Authoritative schema for all persistent and transient data structures
// ========================================================================

// ----------------------------------------------------------------------- 
// TELEGRAM API TYPES (Layer 3)
// -----------------------------------------------------------------------

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_markup?: unknown;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

export interface TelegramChatMember {
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  new_chat_member: {
    status: "member" | "restricted" | "left" | "kicked";
  };
}

export interface TelegramChatJoinRequest {
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  user_chat_id: number;
  bio?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMember;
  chat_join_request?: TelegramChatJoinRequest;
}

// -----------------------------------------------------------------------
// IDENTITY & CONTEXT (Layer 2, Step 2-3)
// -----------------------------------------------------------------------

export type UserRole = "OWNER" | "MEMBER" | "GUEST";
export type ChatType = "user" | "group" | "channel";

export interface ResolvedContext {
  updateId: number;
  actorId: number;
  actorRole: UserRole;
  chatId: number;
  chatType: ChatType;
  isOwner: boolean;
  messageId?: number;
  text?: string;
  callbackQueryId?: string;
  callbackData?: string;
  rawUpdate: TelegramUpdate;
}

// -----------------------------------------------------------------------
// USER RECORD (Persistent State)
// -----------------------------------------------------------------------

export interface UserRecord {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  role: UserRole;
  fsmState: FSMState;
  fsmContext: Record<string, unknown>;
  joinedAt: number;
  updatedAt: number;
}

// -----------------------------------------------------------------------
// FSM STATE MACHINE
// -----------------------------------------------------------------------

export type FSMState =
  | "IDLE"
  | "COMPOSING"
  | "SCHEDULING"
  | "CONFIRMING"
  | "PUBLISHING"
  | "TICKET_OPEN"
  | "TICKET_CLOSED"
  | "TICKET_RESOLVED";

// -----------------------------------------------------------------------
// ACTION & EXECUTION PLAN (Layer 1 → Layer 2)
// -----------------------------------------------------------------------

export type ActionType =
  | "READ_START"
  | "CREATE_TICKET"
  | "CLOSE_TICKET"
  | "RESOLVE_TICKET"
  | "COMPOSE_POST"
  | "SCHEDULE_POST"
  | "PUBLISH_POST"
  | "BROADCAST_SEND"
  | "BROADCAST_JOB"
  | "SEND_REMINDER"
  | "NOOP";

export interface ExecutionPlan {
  action: ActionType;
  metadata: Record<string, unknown>;
  requiredPermissions: UserRole[];
  outboxJobs?: OutboxJob[];
}

export interface OutboxJob {
  type: "SEND" | "EDIT" | "DELETE" | "BROADCAST";
  targetChatId: number;
  content: string;
  markup?: unknown;
  broadcastJobId?: string;
}

// -----------------------------------------------------------------------
// OUTBOX & DELIVERY (Layer 2, Steps 8-10)
// -----------------------------------------------------------------------

export interface OutboxEntry {
  id: string;
  createdAt: number;
  nextAttemptAt: number;
  attemptCount: number;
  maxAttempts: number;
  targetChatId: number;
  action: "SEND" | "EDIT" | "DELETE";
  content: string;
  markup?: unknown;
  idempotencyKey?: string;
}

export interface BroadcastJob {
  id: string;
  createdAt: number;
  broadcasterId: number;
  targetRoles: UserRole[];
  content: string;
  markup?: unknown;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  cursor?: string; // For pagination
  batchSize: number;
  processedCount: number;
  failedCount: number;
}

export type QueueItem = OutboxFlushJob | BroadcastProcessJob;

export interface OutboxFlushJob {
  id: string;
  type: "OUTBOX_FLUSH";
  scheduledAt: number;
  payload: {
    entryIds: string[];
  };
}

export interface BroadcastProcessJob {
  id: string;
  type: "BROADCAST_JOB";
  scheduledAt: number;
  payload: {
    broadcastJobId: string;
    cursor?: string;
  };
}

// -----------------------------------------------------------------------
// PERSISTENT RECORDS
// -----------------------------------------------------------------------

export interface GroupRecord {
  id: number;
  title: string;
  memberCount: number;
  joinedAt: number;
  updatedAt: number;
}

export interface ChannelRecord {
  id: number;
  title: string;
  username?: string;
  joinedAt: number;
  updatedAt: number;
}

export interface PostRecord {
  id: string;
  createdById: number;
  content: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  scheduledAt?: number;
  publishedAt?: number;
  markup?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface TicketRecord {
  id: string;
  userId: number;
  status: "OPEN" | "CLOSED" | "RESOLVED";
  subject: string;
  messages: Array<{
    authorId: number;
    text: string;
    timestamp: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface PollRecord {
  id: string;
  createdById: number;
  question: string;
  options: Array<{
    text: string;
    votes: number;
  }>;
  status: "OPEN" | "CLOSED";
  createdAt: number;
  updatedAt: number;
}

export interface TopicRecord {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface BroadcastRecord {
  id: string;
  createdById: number;
  content: string;
  targetRoles: UserRole[];
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: number;
  updatedAt: number;
}

export interface ReminderRecord {
  id: string;
  userId: number;
  message: string;
  scheduledAt: number;
  sent: boolean;
  createdAt: number;
  updatedAt: number;
}

// -----------------------------------------------------------------------
// AUDIT & AGGREGATES (Layer 2, Steps 11)
// -----------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  timestamp: number;
  actorId: number;
  action: ActionType;
  details: {
    chatId: number;
    callbackData?: string;
    text?: string;
    metadata?: Record<string, unknown>;
  };
  chatId: number;
}

// -----------------------------------------------------------------------
// ATOMIC COMMIT PAYLOAD (Layer 2, Step 7)
// -----------------------------------------------------------------------

export interface KVEntry {
  key: Deno.KvKey;
  value: unknown;
  versionstamp?: string;
}

export interface AggregateUpdate {
  key: Deno.KvKey;
  delta: number;
}

export interface AtomicCommitPayload {
  stateUpdates: KVEntry[];
  auditEntry: AuditEntry;
  aggregateUpdates: AggregateUpdate[];
  outboxEntries: OutboxEntry[];
  queueItems: QueueItem[];
}

// -----------------------------------------------------------------------
// PIPELINE RESULT
// -----------------------------------------------------------------------

export interface PipelineResult {
  success: boolean;
  httpStatus: number;
  error?: string;
}

// -----------------------------------------------------------------------
// RETRY CONFIGURATION (Fix #2: OCC Retry Vacuum)
// -----------------------------------------------------------------------

export interface RetryConfig {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffMultiplier: number;
}

export interface RetryContext {
  attempt: number;
  lastError?: Error;
  nextBackoffMs: number;
}

// -----------------------------------------------------------------------
// PAGINATION CURSOR (Fix #3: Table Scan Vacuum)
// -----------------------------------------------------------------------

export interface PaginationCursor {
  offset: number;
  limit: number;
  startKey?: Deno.KvKey;
}

// -----------------------------------------------------------------------
// BATCH IDEMPOTENCY (Fix #1: Broadcast Bomb)
// -----------------------------------------------------------------------

export interface BatchIdempotencyMarker {
  broadcastJobId: string;
  batchIndex: number;
  processingStartedAt: number;
  markedAt: number;
}

// -----------------------------------------------------------------------
// QUEUE WORKER STATE
// -----------------------------------------------------------------------

export interface QueueWorkerStats {
  processed: number;
  failed: number;
  inFlight: number;
  lastSweepAt: number;
}

mkdir -p stos-os/src/engines
cd stos-os

# 1. Project Config
cat << 'EOF' > deno.json
{
  "tasks": {
    "start": "deno run --allow-net --allow-env --unstable-kv main.ts"
  }
}
EOF

# 2. Environment Variables
cat << 'EOF' > src/config.ts
export const CONFIG = {
  BOT_TOKEN: Deno.env.get("TELEGRAM_BOT_TOKEN") || "YOUR_TOKEN",
  API_URL: `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}`,
  OWNER_ID: Number(Deno.env.get("OWNER_TELEGRAM_ID") || "0"),
  WEBHOOK_SECRET: Deno.env.get("WEBHOOK_SECRET") || "stos_secure_gateway",
};
EOF

# 3. Global Types & FSM States
cat << 'EOF' > src/types.ts
export interface TelegramUpdate {
  update_id: number;
  message?: any;
  callback_query?: any;
  chat_join_request?: any;
}

export type UserState = "IDLE" | "BROWSING_FAQ" | "AWAITING_SUPPORT_INPUT" | "TICKET_OPEN" | "ADMIN_COMPOSING_POST" | "ADMIN_TICKET_REPLY";
export type TicketState = "OPEN" | "PENDING" | "WAITING_USER" | "RESOLVED" | "CLOSED";
export type PostState = "DRAFT" | "PREVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

export interface UserSession {
  userId: number;
  chatId: number;
  state: UserState;
  role: "OWNER" | "MEMBER" | "GUEST";
  currentTicketId?: string;
  currentDraftId?: string;
  history: string[];
}

export interface SupportTicket {
  ticketId: string;
  userId: number;
  state: TicketState;
  messages: Array<{ sender: "user" | "owner"; text: string; timestamp: number }>;
}

export interface ContentPost {
  postId: string;
  state: PostState;
  text: string;
  scheduledFor?: number;
}

export interface OutboundPayload {
  chat_id: number | string;
  method: string;
  body: Record<string, any>;
  retryCount: number;
}
EOF

# 4. Atomic Database & Ledger (Matrix 5)
cat << 'EOF' > src/db.ts
import { UserSession, SupportTicket, OutboundPayload, ContentPost } from "./types.ts";

export const kv = await Deno.openKv();

export interface AtomicCommitPayload {
  updateId: number;
  session?: UserSession;
  ticket?: SupportTicket;
  post?: ContentPost;
  outbox?: OutboundPayload[];
  auditLog?: { action: string; actor: number; timestamp: number };
}

export async function commitAtomic(userId: number, payload: AtomicCommitPayload): Promise<boolean> {
  const idempotencyKey = ["idempotency", payload.updateId];
  
  let transaction = kv.atomic()
    .check({ key: idempotencyKey, versionstamp: null })
    .set(idempotencyKey, true, { expireIn: 86400 * 1000 }); 

  if (payload.session) transaction = transaction.set(["users", userId, "state"], payload.session);
  if (payload.ticket) transaction = transaction.set(["tickets", payload.ticket.ticketId], payload.ticket);
  if (payload.post) transaction = transaction.set(["posts", payload.post.state.toLowerCase(), payload.post.postId], payload.post);
  
  if (payload.auditLog) {
    transaction = transaction.set(["audit", crypto.randomUUID()], payload.auditLog);
  }

  if (payload.outbox) {
    for (const msg of payload.outbox) {
      transaction = transaction.set(["outbox", crypto.randomUUID()], msg);
      transaction = transaction.enqueue(msg);
    }
  }

  const result = await transaction.commit();
  return result.ok;
}
EOF

# 5. Button Engine (Matrix 1)
cat << 'EOF' > src/engines/button.ts
export function buildInlineMenu(buttons: Array<Array<{text: string, callback_data?: string, url?: string}>>) {
  return { inline_keyboard: buttons };
}
EOF

# 6. Content Engine (Matrix 1 & 8)
cat << 'EOF' > src/engines/content.ts
import { UserSession, TelegramUpdate, ContentPost } from "../types.ts";
import { AtomicCommitPayload } from "../db.ts";
import { buildInlineMenu } from "./button.ts";

export function processContentFSM(update: TelegramUpdate, session: UserSession, commitPack: AtomicCommitPayload) {
  const text = update.message?.text;
  
  if (session.state === "ADMIN_COMPOSING_POST" && text) {
    const post: ContentPost = {
      postId: crypto.randomUUID(),
      state: "DRAFT",
      text: text
    };
    
    commitPack.post = post;
    commitPack.session = { ...session, state: "IDLE" };
    commitPack.outbox?.push({
      chat_id: session.chatId,
      method: "sendMessage",
      body: {
        text: `✅ Draft Saved:\n\n${text}`,
        reply_markup: buildInlineMenu([
          [{ text: "🚀 Publish", callback_data: `pub_${post.postId}` }, { text: "⏰ Schedule", callback_data: `sch_${post.postId}` }]
        ])
      },
      retryCount: 0
    });
  }
}
EOF

# 7. Automation Engine (Matrix 2)
cat << 'EOF' > src/engines/automation.ts
import { kv } from "../db.ts";
import { ContentPost } from "../types.ts";

export function startScheduler() {
  setInterval(async () => {
    const now = Date.now();
    const scheduled = kv.list({ prefix: ["posts", "scheduled"] });

    for await (const entry of scheduled) {
      const post = entry.value as ContentPost;
      if (post.scheduledFor && post.scheduledFor <= now) {
        const payload = { chat_id: "@YourBroadcastChannel", method: "sendMessage", body: { text: post.text }, retryCount: 0 };
        
        await kv.atomic()
          .delete(entry.key)
          .set(["posts", "published", post.postId], { ...post, state: "PUBLISHED" })
          .enqueue(payload)
          .commit();
      }
    }
  }, 60000);
}
EOF

# 8. Community Engine (Matrix 3)
cat << 'EOF' > src/engines/community.ts
import { TelegramUpdate, UserSession } from "../types.ts";
import { AtomicCommitPayload } from "../db.ts";
import { buildInlineMenu } from "./button.ts";

export function processCommunityFSM(update: TelegramUpdate, commitPack: AtomicCommitPayload) {
  if (update.chat_join_request) {
    commitPack.outbox?.push({
      chat_id: update.chat_join_request.chat.id,
      method: "approveChatJoinRequest",
      body: { user_id: update.chat_join_request.from.id },
      retryCount: 0
    });
    
    commitPack.outbox?.push({
      chat_id: update.chat_join_request.from.id,
      method: "sendMessage",
      body: { 
        text: "👋 Welcome! Please read our rules.",
        reply_markup: buildInlineMenu([[{ text: "📜 Read Rules", callback_data: "view_rules" }]])
      },
      retryCount: 0
    });
  }
}
EOF

# 9. Customer Service Engine (Matrix 4 & 7)
cat << 'EOF' > src/engines/support.ts
import { TelegramUpdate, UserSession, SupportTicket } from "../types.ts";
import { AtomicCommitPayload, kv } from "../db.ts";
import { CONFIG } from "../config.ts";

export function processSupportFSM(update: TelegramUpdate, session: UserSession, commitPack: AtomicCommitPayload) {
  const text = update.message?.text;
  
  if (session.state === "AWAITING_SUPPORT_INPUT" && text) {
    const ticketId = crypto.randomUUID();
    const ticket: SupportTicket = {
      ticketId, userId: session.userId, state: "OPEN",
      messages: [{ sender: "user", text, timestamp: Date.now() }]
    };

    commitPack.ticket = ticket;
    commitPack.session = { ...session, state: "TICKET_OPEN", currentTicketId: ticketId };
    
    // Alert User
    commitPack.outbox?.push({
      chat_id: session.chatId, method: "sendMessage", body: { text: `✅ Ticket #${ticketId.slice(0,8)} opened.` }, retryCount: 0
    });
    
    // Alert Owner
    commitPack.outbox?.push({
      chat_id: CONFIG.OWNER_ID, method: "sendMessage", body: { text: `🚨 New Ticket from ${session.userId}:\n\n${text}` }, retryCount: 0
    });
  }
}
EOF

# 10. Control Panel Engine (Matrix 1 & 9)
cat << 'EOF' > src/engines/control_panel.ts
import { TelegramUpdate, UserSession } from "../types.ts";
import { AtomicCommitPayload } from "../db.ts";
import { buildInlineMenu } from "./button.ts";

export function processControlPanel(update: TelegramUpdate, session: UserSession, commitPack: AtomicCommitPayload) {
  const cb = update.callback_query?.data;
  
  if (cb === "admin_new_post") {
    commitPack.session = { ...session, state: "ADMIN_COMPOSING_POST" };
    commitPack.outbox?.push({
      chat_id: session.chatId, method: "sendMessage", body: { text: "Send the text for the new post:" }, retryCount: 0
    });
  }
}
EOF

# 11. Delivery Engine (Matrix 5)
cat << 'EOF' > src/engines/delivery.ts
import { kv } from "../db.ts";
import { OutboundPayload } from "../types.ts";
import { CONFIG } from "../config.ts";

export function startDeliveryWorker() {
  kv.listenQueue(async (msg: unknown) => {
    const payload = msg as OutboundPayload;
    try {
      const res = await fetch(`${CONFIG.API_URL}/${payload.method}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.body)
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      if (payload.retryCount < 3) {
        payload.retryCount++;
        await kv.enqueue(payload, { delay: Math.pow(2, payload.retryCount) * 1000 });
      }
    }
  });
}
EOF

# 12. Main Pipeline Routing
cat << 'EOF' > src/pipeline.ts
import { TelegramUpdate, UserSession } from "./types.ts";
import { commitAtomic, AtomicCommitPayload, kv } from "./db.ts";
import { CONFIG } from "./config.ts";
import { processContentFSM } from "./engines/content.ts";
import { processSupportFSM } from "./engines/support.ts";
import { processCommunityFSM } from "./engines/community.ts";
import { processControlPanel } from "./engines/control_panel.ts";

export async function processUpdate(update: TelegramUpdate) {
  const actor = update.message?.from || update.callback_query?.from || update.chat_join_request?.from;
  if (!actor) return;

  const sessionDoc = await kv.get<UserSession>(["users", actor.id, "state"]);
  const isOwner = actor.id === CONFIG.OWNER_ID;
  
  const session: UserSession = sessionDoc.value || {
    userId: actor.id, chatId: actor.id, state: "IDLE", role: isOwner ? "OWNER" : "GUEST", history: []
  };

  const commitPack: AtomicCommitPayload = { updateId: update.update_id, outbox: [] };

  if (isOwner) {
    processControlPanel(update, session, commitPack);
    processContentFSM(update, session, commitPack);
  } else {
    processCommunityFSM(update, commitPack);
    processSupportFSM(update, session, commitPack);
  }

  if (!commitPack.session) commitPack.session = session;
  await commitAtomic(actor.id, commitPack);
}
EOF

# 13. Webhook Entrypoint
cat << 'EOF' > main.ts
import { processUpdate } from "./src/pipeline.ts";
import { startDeliveryWorker } from "./src/engines/delivery.ts";
import { startScheduler } from "./src/engines/automation.ts";
import { CONFIG } from "./src/config.ts";

startDeliveryWorker();
startScheduler();

Deno.serve({ port: 8080 }, async (req: Request) => {
  if (req.method === "POST" && req.url.includes(CONFIG.WEBHOOK_SECRET)) {
    try {
      await processUpdate(await req.json());
    } catch (e) {
      console.error(e);
    }
    return new Response("OK", { status: 200 });
  }
  return new Response("Unauthorized", { status: 403 });
});
EOF

echo "✅ STOS V2.3.2 Full Operating System generated successfully."

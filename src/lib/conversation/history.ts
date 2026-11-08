/**
 * Tenant-scoped chat history and learned facts stored in the persistence DB.
 */
import * as fs from "fs";
import * as path from "path";
import { getOutputHome, getOutputLayout } from "../outputHome.js";
import { loadDoc, saveDoc } from "../db/index.js";
import { getActiveTenantId } from "../tenant/context.js";
import type { IntentRoute } from "../intentRouter/types.js";

export type ConversationRole = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  content: string;
  at: string;
  route?: IntentRoute;
  sources?: Array<{ title: string; url: string }>;
  notePath?: string;
  /** True when this turn did not create report packs / task.ts. */
  noArtifacts?: boolean;
};

export type ConversationSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

export type ChatInsight = {
  id: string;
  fact: string;
  createdAt: string;
  sourceConversationId: string;
};

type ConversationStore = {
  conversations: ConversationSession[];
  insights: ChatInsight[];
};

const EMPTY_STORE: ConversationStore = { conversations: [], insights: [] };
const STORE_KIND = "chat-conversations";
const MAX_CONVERSATIONS = 100;
const MAX_INSIGHTS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 400;

function isConversationSession(value: unknown): value is ConversationSession {
  const session = value as ConversationSession | null;
  return Boolean(session?.id && Array.isArray(session.messages));
}

function legacyConversationPath(sessionId: string, home?: string): string {
  const safe = String(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getOutputLayout(home || getOutputHome()).conversations, `${safe}.json`);
}

function loadLegacyConversations(home?: string): ConversationSession[] {
  const dir = getOutputLayout(home || getOutputHome()).conversations;
  if (!fs.existsSync(dir)) return [];
  const sessions: ConversationSession[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (isConversationSession(value)) sessions.push(value);
    } catch {
      // Ignore malformed legacy chat exports during one-time import.
    }
  }
  return sessions;
}

function loadStore(home?: string): ConversationStore {
  const tenantId = getActiveTenantId();
  const stored = loadDoc<ConversationStore>(STORE_KIND, tenantId);
  if (stored && Array.isArray(stored.conversations) && Array.isArray(stored.insights)) {
    return stored;
  }
  const legacy = loadLegacyConversations(home);
  if (!legacy.length) return { ...EMPTY_STORE };
  const migrated: ConversationStore = { conversations: legacy, insights: [] };
  saveDoc(STORE_KIND, migrated, tenantId);
  return migrated;
}

export function newConversationId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadConversation(
  sessionId: string,
  home?: string
): ConversationSession {
  const store = loadStore(home);
  const existing = store.conversations.find((session) => session.id === sessionId);
  if (existing) return existing;

  const legacyPath = legacyConversationPath(sessionId, home);
  try {
    if (fs.existsSync(legacyPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf-8"));
      if (isConversationSession(legacy)) {
        store.conversations.push(legacy);
        saveDoc(STORE_KIND, store, getActiveTenantId());
        return legacy;
      }
    }
  } catch {
    // Keep serving an empty thread if an old on-disk conversation is corrupt.
  }
  const now = new Date().toISOString();
  return { id: sessionId, createdAt: now, updatedAt: now, messages: [] };
}

export function saveConversation(
  session: ConversationSession,
  home?: string
): string {
  session.updatedAt = new Date().toISOString();
  const store = loadStore(home);
  const index = store.conversations.findIndex((item) => item.id === session.id);
  if (index >= 0) store.conversations[index] = session;
  else store.conversations.push(session);
  store.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  store.conversations.length = Math.min(store.conversations.length, MAX_CONVERSATIONS);
  saveDoc(STORE_KIND, store, getActiveTenantId());
  return session.id;
}

export function appendMessage(
  sessionId: string,
  message: Omit<ConversationMessage, "id" | "at"> & { id?: string; at?: string },
  home?: string
): ConversationSession {
  const session = loadConversation(sessionId, home);
  session.messages.push({
    id: message.id || `msg-${Date.now().toString(36)}-${session.messages.length}`,
    at: message.at || new Date().toISOString(),
    role: message.role,
    content: message.content,
    route: message.route,
    sources: message.sources,
    notePath: message.notePath,
    noArtifacts: message.noArtifacts,
  });
  if (session.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }
  saveConversation(session, home);
  return session;
}

export function resetConversation(
  sessionId: string,
  home?: string
): ConversationSession {
  const now = new Date().toISOString();
  const session: ConversationSession = {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  saveConversation(session, home);
  return session;
}

export function listConversations(home?: string): string[] {
  return loadStore(home).conversations.map((session) => session.id);
}

export function buildChatMemoryContext(
  currentConversationId: string,
  home?: string,
  maxChars = 3_000
): string {
  const store = loadStore(home);
  const sections: string[] = [];
  const insights = store.insights.slice(-MAX_INSIGHTS);
  if (insights.length) {
    sections.push(
      `Remembered user details:\n${insights.map((item) => `- ${item.fact}`).join("\n")}`
    );
  }

  const recent = store.conversations
    .filter((session) => session.id !== currentConversationId && session.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3)
    .reverse();
  for (const session of recent) {
    const turns = session.messages
      .filter((message) => message.role !== "system")
      .slice(-4)
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`);
    if (turns.length) sections.push(`Earlier conversation:\n${turns.join("\n")}`);
  }

  const context = sections.join("\n\n");
  return context.length > maxChars ? context.slice(-maxChars) : context;
}

export function parseRememberRequest(prompt: string): string | null {
  const match = String(prompt || "").trim().match(
    /^(?:تذكّر|تذكر|احفظ(?:\s+في\s+ذاكرتك)?|remember(?:\s+that)?|save\s+to\s+memory)\s*[:：]?\s+(.+)$/iu
  );
  const fact = match?.[1]?.trim();
  return fact ? fact.slice(0, 500) : null;
}

export function rememberChatFact(
  fact: string,
  sourceConversationId: string,
  home?: string
): ChatInsight {
  const cleaned = String(fact || "").trim().slice(0, 500);
  if (!cleaned) throw new Error("Chat memory fact cannot be empty.");
  const store = loadStore(home);
  const key = cleaned.toLocaleLowerCase();
  const existing = store.insights.find(
    (item) => item.fact.toLocaleLowerCase() === key
  );
  if (existing) return existing;
  const insight: ChatInsight = {
    id: `insight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fact: cleaned,
    createdAt: new Date().toISOString(),
    sourceConversationId,
  };
  store.insights.push(insight);
  store.insights = store.insights.slice(-MAX_INSIGHTS);
  saveDoc(STORE_KIND, store, getActiveTenantId());
  return insight;
}

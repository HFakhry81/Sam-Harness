/**
 * Per-session conversation history under SAM_OUTPUT_HOME/conversations/.
 */
import * as fs from "fs";
import * as path from "path";
import { ensureOutputHome, getOutputHome } from "../outputHome.js";
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

function conversationsDir(home: string = getOutputHome()): string {
  return ensureOutputHome(home).conversations;
}

function sessionPath(sessionId: string, home?: string): string {
  const safe = String(sessionId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(conversationsDir(home), `${safe}.json`);
}

export function newConversationId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadConversation(
  sessionId: string,
  home?: string
): ConversationSession {
  const p = sessionPath(sessionId, home);
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as ConversationSession;
      if (j?.id && Array.isArray(j.messages)) return j;
    }
  } catch {
    /* fall through */
  }
  const now = new Date().toISOString();
  return { id: sessionId, createdAt: now, updatedAt: now, messages: [] };
}

export function saveConversation(
  session: ConversationSession,
  home?: string
): string {
  const dir = conversationsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  session.updatedAt = new Date().toISOString();
  const p = sessionPath(session.id, home);
  fs.writeFileSync(p, JSON.stringify(session, null, 2), "utf-8");
  // Lightweight markdown mirror for humans
  try {
    const mdPath = p.replace(/\.json$/i, ".md");
    const lines = [
      `# Conversation ${session.id}`,
      "",
      `- Updated: ${session.updatedAt}`,
      `- Messages: ${session.messages.length}`,
      "",
    ];
    for (const m of session.messages) {
      const route = m.route ? ` · ${m.route}` : "";
      lines.push(`## ${m.role}${route}`);
      lines.push("");
      lines.push(m.content);
      lines.push("");
    }
    fs.writeFileSync(mdPath, lines.join("\n"), "utf-8");
  } catch {
    /* ignore */
  }
  return p;
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
  // Cap history to keep files small
  if (session.messages.length > 400) {
    session.messages = session.messages.slice(-400);
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
  const dir = conversationsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/i, ""));
}

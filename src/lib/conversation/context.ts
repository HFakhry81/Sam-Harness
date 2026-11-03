/**
 * Bounded chat-context replay for local models.
 *
 * A 27B model on CPU is memory-bandwidth bound: replaying a long thread raises
 * prompt-processing time and can overflow `num_ctx`, which silently drops the
 * oldest tokens. Instead we replay only the newest turns inside a hard
 * character budget and trim individual long messages head+tail.
 *
 * Override with:
 *   SAM_CHAT_HISTORY_ENABLED, SAM_CHAT_HISTORY_MESSAGES,
 *   SAM_CHAT_HISTORY_CHARS, SAM_CHAT_HISTORY_MESSAGE_CHARS
 */
import type { ConversationMessage } from "./history.js";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export const DEFAULT_CHAT_HISTORY_MESSAGES = 12;
export const DEFAULT_CHAT_HISTORY_CHARS = 6_000;
export const DEFAULT_CHAT_HISTORY_MESSAGE_CHARS = 2_000;

function envBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return fallback;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function chatHistoryEnabled(): boolean {
  return envBool("SAM_CHAT_HISTORY_ENABLED", true);
}

export function chatHistoryMaxMessages(): number {
  return envInt(
    "SAM_CHAT_HISTORY_MESSAGES",
    DEFAULT_CHAT_HISTORY_MESSAGES,
    0,
    200
  );
}

export function chatHistoryMaxChars(): number {
  return envInt("SAM_CHAT_HISTORY_CHARS", DEFAULT_CHAT_HISTORY_CHARS, 0, 100_000);
}

export function chatHistoryMessageChars(): number {
  return envInt(
    "SAM_CHAT_HISTORY_MESSAGE_CHARS",
    DEFAULT_CHAT_HISTORY_MESSAGE_CHARS,
    200,
    20_000
  );
}

/**
 * Split the model window between system instructions, the current user turn,
 * reserved output, and replayed history. Returns how many chars history may
 * use (never more than `desiredChars`).
 */
export function historyBudgetForContext(input: {
  numCtx: number;
  systemChars?: number;
  promptChars?: number;
  numPredict?: number;
  desiredChars?: number;
}): number {
  const numCtx = Math.max(512, Math.floor(input.numCtx || 0));
  // ~3 chars/token is conservative for mixed Arabic/English + code.
  const windowChars = Math.max(2_000, Math.floor(numCtx * 3));
  const outputReserve = Math.max(800, Math.floor((input.numPredict ?? 768) * 4));
  const fixed =
    Math.max(0, input.systemChars ?? 600) +
    Math.max(0, input.promptChars ?? 0) +
    256;
  const desired = Math.max(0, input.desiredChars ?? DEFAULT_CHAT_HISTORY_CHARS);
  return Math.max(0, Math.min(desired, windowChars - outputReserve - fixed));
}

export type TrimChatOptions = {
  /** Hard character budget for the whole transcript. 0 disables replay. */
  maxChars: number;
  /** Max turns to keep (newest first). Default: unlimited. */
  maxMessages?: number;
  /** Per-message cap before head/tail trimming. */
  maxMessageChars?: number;
};

export type TrimmedChatHistory = {
  turns: ChatTurn[];
  chars: number;
  dropped: number;
  truncated: number;
};

function trimMessage(
  text: string,
  max: number
): { text: string; wasTruncated: boolean } {
  if (max <= 0) return { text: "", wasTruncated: true };
  if (text.length <= max) return { text, wasTruncated: false };
  const marker = "\n…[trimmed]…\n";
  if (max <= marker.length + 120) {
    // Not enough room for a head window — keep the newest tail.
    return { text: text.slice(-max), wasTruncated: true };
  }
  const body = max - marker.length;
  const head = Math.max(60, Math.floor(body * 0.45));
  const tail = Math.max(60, body - head);
  return { text: text.slice(0, head) + marker + text.slice(-tail), wasTruncated: true };
}

/**
 * Keep the newest turns that fit the budget, in chronological order.
 * Long individual messages are trimmed head+tail instead of dropped.
 */
export function trimChatTurns(
  turns: ReadonlyArray<ChatTurn>,
  opts: TrimChatOptions
): TrimmedChatHistory {
  const maxMessages = Math.max(0, opts.maxMessages ?? Number.MAX_SAFE_INTEGER);
  const perMessage = Math.max(
    200,
    opts.maxMessageChars ?? chatHistoryMessageChars()
  );
  const budget = Math.max(0, opts.maxChars);
  const selected: ChatTurn[] = [];
  let chars = 0;
  let truncated = 0;

  if (budget > 0 && maxMessages > 0) {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (selected.length >= maxMessages) break;
      const raw = String(turns[i]?.content ?? "").trim();
      if (!raw) continue;
      // Account for the role label and the "\n\n" separator so the rendered
      // transcript never exceeds the advertised budget.
      const labelLen = turns[i].role === "assistant" ? 11 : 6;
      const sepLen = selected.length > 0 ? 2 : 0;
      const remaining = budget - chars - labelLen - sepLen;
      if (remaining <= 0) break;
      const cap = Math.min(perMessage, remaining);
      const { text, wasTruncated } = trimMessage(raw, cap);
      if (!text) continue;
      selected.push({ role: turns[i].role, content: text });
      chars += labelLen + sepLen + text.length;
      if (wasTruncated) truncated++;
    }
  }

  selected.reverse();
  const rendered = renderChatHistory(selected);
  return {
    turns: selected,
    chars: rendered.length,
    dropped: Math.max(0, turns.length - selected.length),
    truncated,
  };
}

/** Render turns as a compact transcript for prompt-only providers. */
export function renderChatHistory(turns: ReadonlyArray<ChatTurn>): string {
  return turns
    .map(
      (turn) =>
        `${turn.role === "assistant" ? "Assistant" : "User"}: ${String(
          turn.content ?? ""
        ).trim()}`
    )
    .join("\n\n");
}

export type ChatContextOptions = {
  /** Drop a trailing user message that duplicates the current prompt. */
  currentPrompt?: string;
  /** Max turns to replay (default: SAM_CHAT_HISTORY_MESSAGES). */
  maxMessages?: number;
  /** Desired char budget (default: SAM_CHAT_HISTORY_CHARS). */
  maxChars?: number;
  /** Per-message cap (default: SAM_CHAT_HISTORY_MESSAGE_CHARS). */
  maxMessageChars?: number;
  /**
   * Clamp the history budget so system + prompt + output fit the model window.
   * Callers that know the local model size should pass this.
   */
  contextWindow?: {
    numCtx: number;
    systemChars?: number;
    promptChars?: number;
    numPredict?: number;
  };
};

export type ChatContext = {
  enabled: boolean;
  turns: ChatTurn[];
  text: string;
  chars: number;
  budgetChars: number;
  dropped: number;
  truncated: number;
};

function normalizePrompt(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Build the bounded history block for one chat/research turn.
 * Returns an empty context when disabled or when nothing fits.
 */
export function buildChatContext(
  messages: ReadonlyArray<
    Pick<ConversationMessage, "role" | "content"> | ChatTurn
  >,
  opts: ChatContextOptions = {}
): ChatContext {
  const enabled = chatHistoryEnabled();
  const desiredChars = Math.max(0, opts.maxChars ?? chatHistoryMaxChars());
  const maxMessages = Math.max(0, opts.maxMessages ?? chatHistoryMaxMessages());
  const budgetChars = opts.contextWindow
    ? historyBudgetForContext({
        ...opts.contextWindow,
        desiredChars,
      })
    : desiredChars;

  const empty: ChatContext = {
    enabled,
    turns: [],
    text: "",
    chars: 0,
    budgetChars,
    dropped: 0,
    truncated: 0,
  };
  if (!enabled || maxMessages === 0 || budgetChars === 0) return empty;

  let source: ChatTurn[] = [];
  for (const message of messages) {
    const role = message?.role;
    // Only real turns are replayed; stored system notes are not chat memory.
    if (role !== "user" && role !== "assistant") continue;
    const content = String(message.content ?? "").trim();
    if (!content) continue;
    source.push({ role, content });
  }

  if (source.length > 0 && opts.currentPrompt) {
    const last = source[source.length - 1];
    if (
      last.role === "user" &&
      normalizePrompt(last.content) === normalizePrompt(opts.currentPrompt)
    ) {
      source = source.slice(0, -1);
    }
  }

  const trimmed = trimChatTurns(source, {
    maxChars: budgetChars,
    maxMessages,
    maxMessageChars: opts.maxMessageChars,
  });
  return {
    enabled,
    turns: trimmed.turns,
    text: renderChatHistory(trimmed.turns),
    chars: trimmed.chars,
    budgetChars,
    dropped: trimmed.dropped,
    truncated: trimmed.truncated,
  };
}

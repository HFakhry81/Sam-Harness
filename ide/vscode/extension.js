/**
 * Sam-Harness IDE Bridge (VS Code / Cursor / any VS Code-compatible editor).
 *
 * Thin client: it polls the Control Plane for commands and reports results.
 * No build step, no dependencies, CommonJS.
 */
"use strict";

const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { applyUnifiedDiff } = require("../shared/unifiedDiff.cjs");

let timer = null;
let running = false;
const handled = new Map(); // id -> timestamp (dedupe repeated polls)

function cfg() {
  const c = vscode.workspace.getConfiguration("samHarness");
  return {
    baseUrl: String(c.get("baseUrl") || "http://127.0.0.1:8787").replace(/\/+$/, ""),
    token: String(c.get("token") || "").trim(),
    autoConnect: c.get("autoConnect") !== false,
    pollMs: Math.max(500, Number(c.get("pollMs") || 1500)),
  };
}

function ownerToken() {
  const { token } = cfg();
  if (token) return token;
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) return "";
  try {
    return fs.readFileSync(path.join(folder.uri.fsPath, ".controlplane-token"), "utf8").trim();
  } catch {
    return "";
  }
}

async function request(pathname, init) {
  const { baseUrl } = cfg();
  const token = ownerToken();
  if (!token) throw new Error("missing owner token (.controlplane-token or samHarness.token)");
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      Authorization: `Bearer ${token}`,
      ...(init && init.headers ? init.headers : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json && json.error) || text.slice(0, 160)}`);
  return json;
}

function remember(id) {
  handled.set(id, Date.now());
  if (handled.size > 500) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, at] of handled) if (at < cutoff) handled.delete(key);
  }
}

async function handleCommand(cmd) {
  const p = cmd.params || {};
  if (cmd.kind === "openFile") {
    const uri = vscode.Uri.file(p.path);
    const pos =
      p.line != null
        ? new vscode.Position(Math.max(0, Number(p.line) - 1), Math.max(0, Number(p.column || 1) - 1))
        : new vscode.Position(0, 0);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: false });
    return { path: p.path };
  }

  if (cmd.kind === "applyDiff") {
    const uri = vscode.Uri.file(p.path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const before = doc.getText();
    const after = applyUnifiedDiff(before, String(p.diff || ""));
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(before.length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, full, after);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error("editor rejected the workspace edit");
    await doc.save();
    return { path: p.path, bytes: after.length };
  }

  if (cmd.kind === "diagnostics") {
    const uri = vscode.Uri.file(p.path);
    const list = vscode.languages.getDiagnostics(uri).map((d) => ({
      severity: ["error", "warning", "info", "hint"][d.severity] || "info",
      message: d.message,
      source: d.source || "",
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
    }));
    return { path: p.path, diagnostics: list };
  }

  if (cmd.kind === "showMessage") {
    const level = String(p.level || "info");
    const text = String(p.message || "");
    if (level === "error") vscode.window.showErrorMessage(text);
    else if (level === "warn") vscode.window.showWarningMessage(text);
    else vscode.window.showInformationMessage(text);
    return { shown: true };
  }

  throw new Error(`unsupported command: ${cmd.kind}`);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const res = await request("/api/ide/poll", { method: "GET" });
    const commands = Array.isArray(res && res.commands) ? res.commands : [];
    for (const cmd of commands) {
      if (!cmd || !cmd.id || handled.has(cmd.id)) continue;
      remember(cmd.id);
      try {
        const result = await handleCommand(cmd);
        await request("/api/ide/result", {
          method: "POST",
          body: JSON.stringify({ id: cmd.id, ok: true, result }),
        });
      } catch (e) {
        await request("/api/ide/result", {
          method: "POST",
          body: JSON.stringify({ id: cmd.id, ok: false, error: String((e && e.message) || e) }),
        }).catch(() => undefined);
      }
    }
  } catch {
    /* Control Plane down or token rotated — retry on next tick silently. */
  } finally {
    running = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await tick();
    if (timer !== null) schedule();
  }, cfg().pollMs);
}

function connect() {
  schedule();
  vscode.window.setStatusBarMessage("Sam-Harness: IDE bridge connected", 3000);
}

function disconnect() {
  if (timer) clearTimeout(timer);
  timer = null;
  vscode.window.setStatusBarMessage("Sam-Harness: IDE bridge disconnected", 3000);
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("samHarness.connect", connect),
    vscode.commands.registerCommand("samHarness.disconnect", disconnect)
  );
  if (cfg().autoConnect) connect();
}

function deactivate() {
  disconnect();
}

module.exports = { activate, deactivate };

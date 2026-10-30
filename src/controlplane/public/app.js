const $ = (id) => document.getElementById(id);

/** Session CSRF after /api/login — required on mutating requests */
let csrfToken = sessionStorage.getItem("sh_csrf") || "";
let authed = false;

async function api(url, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  const headers = new Headers(opts.headers || {});
  const method = String(opts.method || "GET").toUpperCase();
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  opts.headers = headers;
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.authRequired || res.status === 401) {
      showLogin(data.error || "يلزم تسجيل الدخول");
    }
  }
  return res;
}

function showLogin(errMsg) {
  authed = false;
  const gate = $("loginGate");
  const shell = $("appShell");
  if (gate) gate.hidden = false;
  if (shell) shell.dataset.locked = "1";
  if (errMsg && $("loginError")) {
    $("loginError").hidden = false;
    $("loginError").textContent = errMsg;
  }
}

function hideLogin() {
  authed = true;
  const gate = $("loginGate");
  const shell = $("appShell");
  if (gate) gate.hidden = true;
  if (shell) delete shell.dataset.locked;
  if ($("loginError")) $("loginError").hidden = true;
}

async function doLogin(token) {
  const res = await fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "فشل الدخول");
  }
  csrfToken = data.csrfToken || "";
  sessionStorage.setItem("sh_csrf", csrfToken);
  hideLogin();
  return data;
}

async function ensureAuth() {
  const res = await fetch("/api/auth/status", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (data.authenticated) {
    if (data.csrfToken) {
      csrfToken = data.csrfToken;
      sessionStorage.setItem("sh_csrf", csrfToken);
    }
    hideLogin();
    return true;
  }
  showLogin();
  return false;
}

const els = {
  prompt: $("prompt"),
  title: $("title"),
  route: $("route"),
  targetRepo: $("targetRepo"),
  packDir: $("packDir"),
  allowCode: $("allowCode"),
  allowCodeWrap: $("allowCodeWrap"),
  codeWorkspaceFields: $("codeWorkspaceFields"),
  operatorWorkspacePanel: $("operatorWorkspacePanel"),
  allowlistRoots: $("allowlistRoots"),
  taskRoots: $("taskRoots"),
  planStepsPreview: $("planStepsPreview"),
  previewBox: $("previewBox"),
  previewBody: $("previewBody"),
  stageCompose: $("stageCompose"),
  stageRun: $("stageRun"),
  stageDone: $("stageDone"),
  runSummary: $("runSummary"),
  log: $("log"),
  runState: $("runState"),
  healthMeta: $("healthMeta"),
  btnPreview: $("btnPreview"),
  btnSave: $("btnSave"),
  btnSaveRun: $("btnSaveRun"),
  btnBack: $("btnBack"),
  btnStop: $("btnStop"),
  btnNewTask: $("btnNewTask"),
  btnNewTaskTop: $("btnNewTaskTop"),
  btnRerun: $("btnRerun"),
  btnViewLog: $("btnViewLog"),
  btnClearSession: $("btnClearSession"),
  sessionList: $("sessionList"),
  sessionMeta: $("sessionMeta"),
  doneTitle: $("doneTitle"),
  doneMeta: $("doneMeta"),
  doneSummary: $("doneSummary"),
  doneArtifacts: $("doneArtifacts"),
  runGrid: $("runGrid"),
  reportCard: $("reportCard"),
  reportBadge: $("reportBadge"),
  reportHeadline: $("reportHeadline"),
  reportBullets: $("reportBullets"),
  reportNext: $("reportNext"),
  badgeAudit: $("badgeAudit"),
  badgeGoal: $("badgeGoal"),
  artifactGrid: $("artifactGrid"),
  artifactPackMeta: $("artifactPackMeta"),
  artifactViewer: $("artifactViewer"),
  viewerTitle: $("viewerTitle"),
  viewerPath: $("viewerPath"),
  viewerBody: $("viewerBody"),
  btnViewerClose: $("btnViewerClose"),
  btnViewerOsOpen: $("btnViewerOsOpen"),
  btnViewerFolder: $("btnViewerFolder"),
  btnOpenPackFolder: $("btnOpenPackFolder"),
};

let lastDraft = null;
let lastEntry = null;
let busy = false;
let lastFailed = false;
let pendingQuestions = [];
let artifactCache = { items: [], packDir: null };
let viewerRelPath = null;

const KIND_LABEL = {
  report: "تقرير",
  plan: "خطة",
  evidence: "أدلة",
  delivery: "تسليم",
  pack: "حزمة",
  log: "سجل",
  other: "ملف",
};

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const DRAFT_KEY = "samHarness.composeDraft.v1";

function saveLocalDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        prompt: els.prompt.value,
        title: els.title.value,
        route: els.route.value,
        targetRepo: els.targetRepo.value,
        packDir: els.packDir.value,
        allowCode: els.allowCode.checked,
        savedAt: Date.now(),
      })
    );
  } catch {
    /* ignore quota */
  }
}

function loadLocalDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearLocalDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function applyDraftFields(d) {
  if (!d) return;
  if (d.prompt != null && String(d.prompt).trim()) els.prompt.value = d.prompt;
  if (d.title) els.title.value = d.title;
  if (d.route) els.route.value = d.route;
  if (d.targetRepo) els.targetRepo.value = d.targetRepo;
  if (d.packDir) els.packDir.value = d.packDir;
  if (typeof d.allowCode === "boolean") els.allowCode.checked = d.allowCode;
}

function payload(save, extra = {}) {
  saveLocalDraft();
  return {
    prompt: els.prompt.value,
    title: els.title.value || undefined,
    route: els.route.value,
    targetRepo: els.targetRepo.value,
    packDir: els.packDir.value,
    allowClientCodeEdits: els.allowCode.checked,
    save,
    ...extra,
  };
}

function collectClarifyAnswers() {
  const answers = {};
  document.querySelectorAll("#clarifyFields input").forEach((inp) => {
    answers[inp.dataset.q] = inp.value;
  });
  return answers;
}

function showClarify(data) {
  const box = $("clarifyBox");
  const fields = $("clarifyFields");
  const meta = $("clarifyMeta");
  pendingQuestions = data.needsClarification || [];
  box.classList.remove("hidden");
  meta.textContent = `confidence=${Number(data.confidence || 0).toFixed(2)} · intent=${
    data.spec?.intent || "?"
  } · route=${data.spec?.route || data.draft?.route || "?"}`;
  fields.innerHTML = "";
  pendingQuestions.forEach((q, i) => {
    const wrap = document.createElement("div");
    wrap.className = "clarify-q";
    wrap.innerHTML = `<label for="cq${i}">${escapeHtml(q)}</label>
      <input id="cq${i}" data-q="${escapeHtml(q)}" type="text" />`;
    fields.appendChild(wrap);
  });
  if (data.draft?.body || data.spec) {
    els.previewBody.textContent = JSON.stringify(data.spec || data.draft, null, 2);
    els.previewBox.hidden = false;
    els.previewBox.open = true;
  }
}

function hideClarify() {
  $("clarifyBox").classList.add("hidden");
  pendingQuestions = [];
}

function resolveUiMode(routeHint) {
  const r = routeHint || els.route.value;
  if (r === "operational") return "operator";
  if (r === "architecture" || r === "implement") return "code";
  if (lastDraft?.spec?.workspaceMode) return lastDraft.spec.workspaceMode;
  if (lastDraft?.route === "operational") return "operator";
  if (lastDraft?.route === "architecture" || lastDraft?.route === "implement") return "code";
  return "operator"; // default PC operator until Spec says otherwise
}

function renderRootsList(el, items, emptyText) {
  if (!el) return;
  el.innerHTML = "";
  if (!items?.length) {
    const li = document.createElement("li");
    li.className = "dim";
    li.textContent = emptyText || "—";
    el.appendChild(li);
    return;
  }
  items.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    el.appendChild(li);
  });
}

function renderPlanSteps(steps) {
  if (!els.planStepsPreview) return;
  els.planStepsPreview.innerHTML = "";
  (steps || []).forEach((s, i) => {
    const li = document.createElement("li");
    const pathHint =
      s.params?.path || s.params?.destination || s.params?.source || "";
    li.textContent = `${i + 1}. ${s.tool}${pathHint ? ` → ${pathHint}` : ""} — ${
      s.summary || ""
    }`;
    els.planStepsPreview.appendChild(li);
  });
}

function syncWorkspacePanels(routeHint, spec) {
  const route = spec?.route || routeHint || els.route.value;
  // auto + no spec yet → operator UI (PC tasks); code fields only for analysis/implement
  const mode =
    spec?.workspaceMode ||
    (route === "operational" || route === "auto"
      ? "operator"
      : route === "architecture" || route === "implement"
        ? "code"
        : resolveUiMode(routeHint));
  const isOps = mode === "operator";
  els.codeWorkspaceFields?.classList.toggle("hidden", isOps);
  els.operatorWorkspacePanel?.classList.toggle("hidden", !isOps);
  els.allowCodeWrap?.classList.toggle("hidden", isOps);
  // Spec may override UI defaults (e.g. self-report → Sam-Harness, not Maw3ed)
  if (spec?.targetRepo && els.targetRepo) {
    els.targetRepo.value = spec.targetRepo;
  }
  if (spec?.packDir && els.packDir) {
    els.packDir.value = spec.packDir;
    delete els.packDir.dataset.touched;
  }
  if (spec?.roots) renderRootsList(els.taskRoots, spec.roots, "لا جذور بعد");
  if (spec?.planSteps) renderPlanSteps(spec.planSteps);
}

async function loadOperatorContext() {
  try {
    const data = await api("/api/operator-context").then((r) => r.json());
    renderRootsList(els.allowlistRoots, data.allowlistRoots || [], "—");
    if (data.taskRoots?.length) renderRootsList(els.taskRoots, data.taskRoots);
    if (data.planSteps?.length) renderPlanSteps(data.planSteps);
  } catch {
    /* ignore */
  }
}

const PLATFORM_STAGES = {
  compose: "stageCompose",
  daily: "stageDaily",
  profiles: "stageProfiles",
  memory: "stageMemory",
  rollback: "stageRollback",
};

function hideAllMainPanels() {
  [
    els.stageCompose,
    els.stageRun,
    els.stageDone,
    $("stageDaily"),
    $("stageProfiles"),
    $("stageMemory"),
    $("stageRollback"),
  ].forEach((el) => el?.classList.add("hidden"));
}

function showStage(name) {
  hideAllMainPanels();
  if (name === "compose") els.stageCompose.classList.remove("hidden");
  if (name === "run") els.stageRun.classList.remove("hidden");
  if (name === "done") els.stageDone.classList.remove("hidden");
  document.querySelectorAll("#platformNav button").forEach((b) => {
    b.classList.toggle("active", name === "compose" && b.dataset.view === "compose");
  });
}

function showPlatformPanel(view) {
  hideAllMainPanels();
  document.querySelectorAll("#platformNav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "compose") {
    els.stageCompose.classList.remove("hidden");
    return;
  }
  const id = PLATFORM_STAGES[view];
  if (id) $(id)?.classList.remove("hidden");
  if (view === "daily") loadDailyOps();
  if (view === "profiles") loadProfiles();
  if (view === "memory") loadMemoryUi();
  if (view === "rollback") loadRollback();
}

async function loadDailyOps() {
  const body = $("dailyOpsBody");
  if (!body) return;
  try {
    const data = await api("/api/daily-ops").then((r) => r.json());
    body.innerHTML = "";
    (data.jobs || []).forEach((j) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(j.title || j.prompt)}</td>
        <td class="mono">${escapeHtml(j.schedule)}</td>
        <td><span class="chip ${j.enabled ? "on" : "off"}">${j.enabled ? "ON" : "OFF"}</span></td>
        <td class="mono">${escapeHtml(j.lastResult || "—")}${j.lastRunAt ? " · " + escapeHtml(String(j.lastRunAt).slice(0, 16)) : ""}</td>
        <td>
          <button type="button" class="linkish" data-act="toggle" data-id="${j.id}">تبديل</button>
          ·
          <button type="button" class="linkish" data-act="remove" data-id="${j.id}">حذف</button>
        </td>`;
      body.appendChild(tr);
    });
    if (!(data.jobs || []).length) {
      body.innerHTML = `<tr><td colspan="5" class="dim">لا مهام مجدولة بعد</td></tr>`;
    }
    const ledger = $("dailyLedgerList");
    const meta = $("dailyLedgerMeta");
    if (ledger) {
      ledger.innerHTML = "";
      (data.ledger || []).slice(0, 8).forEach((e) => {
        const li = document.createElement("li");
        li.innerHTML = `<div class="k">${e.success ? "OK" : "FAIL"} · ${escapeHtml(String(e.at || "").slice(0, 19))}</div>
          <div class="v">${escapeHtml(e.prompt || "")} — ${escapeHtml((e.summary || "").slice(0, 160))}</div>`;
        ledger.appendChild(li);
      });
    }
    if (meta) {
      meta.textContent = (data.ledger || []).length
        ? `${data.ledger.length} نتيجة في الدفتر`
        : "دفتر النتائج فارغ";
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="5">${escapeHtml(e.message || String(e))}</td></tr>`;
  }
}

function renderCostUsage(cost) {
  const el = $("costUsageStatus");
  if (!el || !cost) return;
  const models = Object.entries(cost.byModel || {})
    .map(([m, v]) => `${m}: $${v.costUsd}`)
    .slice(0, 4)
    .join(" · ");
  el.textContent = cost.blocked
    ? `⛔ السقف مستنفد — مصروف $${cost.spentUsd} / $${cost.capUsd} (${cost.day})`
    : `التكلفة اليوم: $${cost.spentUsd} / سقف $${cost.capUsd} · متبقي $${cost.remainingUsd}` +
      (models ? ` · ${models}` : "");
}

async function loadProfiles() {
  try {
    const data = await api("/api/hybrid-profile").then((r) => r.json());
    const mode = data.profile?.mode || "auto";
    selectedProfile = mode;
    document.querySelectorAll(".profile-card").forEach((c) => {
      c.classList.toggle("selected", c.dataset.profile === mode);
    });
    if ($("costCap")) $("costCap").value = data.profile?.costCapUsd ?? 0;
    if ($("profileStatus")) {
      $("profileStatus").textContent = `الوضع الحالي: ${mode} · سقف $${data.profile?.costCapUsd ?? 0} · حُفظ ${data.profile?.updatedAt || "—"}`;
    }
    renderCostUsage(data.cost);
  } catch (e) {
    if ($("profileStatus")) $("profileStatus").textContent = e.message || String(e);
  }
}

async function loadMemoryUi() {
  const list = $("memoryList");
  if (!list) return;
  try {
    const data = await api("/api/memory").then((r) => r.json());
    list.innerHTML = "";
    (data.entries || []).forEach((e) => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="k">${escapeHtml(e.key)}</div><div class="v">${escapeHtml(e.value)}</div>`;
      list.appendChild(li);
    });
    if (!(data.entries || []).length) {
      list.innerHTML = `<li class="dim">الذاكرة فارغة</li>`;
    }
  } catch (e) {
    list.innerHTML = `<li>${escapeHtml(e.message || String(e))}</li>`;
  }
}

async function loadRollback() {
  const body = $("rollbackBody");
  const table = $("rollbackTable");
  const empty = $("rollbackEmpty");
  if (!body) return;
  try {
    const data = await api("/api/rollback").then((r) => r.json());
    const entries = data.entries || [];
    if (!entries.length) {
      if (empty) empty.classList.remove("hidden");
      if (table) table.classList.add("hidden");
      if (empty) empty.textContent = "لا إدخالات بعد — تظهر بعد تنفيذ Level-3 بموافقة GO.";
      return;
    }
    if (empty) empty.classList.add("hidden");
    if (table) table.classList.remove("hidden");
    body.innerHTML = entries
      .map(
        (e) => `<tr>
        <td class="mono">${escapeHtml(String(e.at || "").slice(0, 19))}</td>
        <td class="mono">${escapeHtml(e.filePath || e.targetRepo || "")}</td>
        <td>${escapeHtml(e.action || "write")}</td>
        <td class="mono">${escapeHtml(e.note || e.backupPath || "—")}</td>
      </tr>`
      )
      .join("");
  } catch (e) {
    if (empty) {
      empty.classList.remove("hidden");
      empty.textContent = e.message || String(e);
    }
  }
}

/** ANSI + launcher-style highlighting for the in-browser terminal */
function formatTermHtml(text) {
  let s = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Strip common ANSI then colorize semantics
  s = s.replace(/\u001b\[[0-9;]*m/g, "");
  s = s.replace(
    /(\[OK\][^\n]*)/g,
    '<span class="c-ok">$1</span>'
  );
  s = s.replace(
    /(\[Error\][^\n]*|\[X\][^\n]*)/g,
    '<span class="c-err">$1</span>'
  );
  s = s.replace(
    /(\[![^\]]*\][^\n]*|\[WARN\][^\n]*)/g,
    '<span class="c-warn">$1</span>'
  );
  s = s.replace(
    /(\[System\][^\n]*)/g,
    '<span class="c-sys">$1</span>'
  );
  s = s.replace(
    /(\[LIVE[^\]]*\][^\n]*|LIVE @[^\n]*)/g,
    '<span class="c-live">$1</span>'
  );
  s = s.replace(
    /(tool=[^\n]+)/g,
    '<span class="c-dim">$1</span>'
  );
  s = s.replace(
    /(={10,})/g,
    '<span class="c-live">$1</span>'
  );
  return s;
}

function setLog(text) {
  els.log.innerHTML = formatTermHtml(text);
  els.log.scrollTop = els.log.scrollHeight;
}

function appendLog(text) {
  const next = (els.log.textContent || "") + text;
  setLog(next);
}

async function compose(save, answers) {
  const res = await api("/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload(save, answers ? { answers } : {})),
  });
  const data = await res.json();
  if (!res.ok && !data.clarify) throw new Error(data.error || "compose failed");
  if (data.clarify || (data.needsClarification && data.needsClarification.length && !data.saved)) {
    showClarify(data);
    lastDraft = data.draft || null;
    syncWorkspacePanels(data.spec?.route || data.draft?.route, data.spec);
    return { ...data, blocked: true };
  }
  if (!data.ok) throw new Error(data.error || "compose failed");
  hideClarify();
  lastDraft = data.draft;
  lastFailed = false;
  syncWorkspacePanels(data.spec?.route || data.draft?.route, data.spec);
  const rootsLine = (data.spec?.roots || []).join(" · ") || "—";
  const stepsLine = (data.spec?.planSteps || [])
    .map((s) => s.summary)
    .join(" → ");
  els.previewBody.textContent =
    `mode=${data.spec?.workspaceMode || "?"}\nconfidence=${data.confidence}\nintent=${data.spec?.intent}\nroots=${rootsLine}\nsteps=${stepsLine || "—"}\n\n` +
    (data.draft?.body || "");
  els.previewBox.hidden = false;
  els.previewBox.open = true;
  return data;
}

function configureRunOptions(draft) {
  const roots =
    draft.spec?.roots?.length
      ? draft.spec.roots.join(" · ")
      : draft.route === "operational"
        ? "multi-root operator"
        : draft.targetRepo;
  els.runSummary.textContent = `${draft.title} · route=${draft.route} · ${roots}`;
  const label = $("primaryRunLabel");
  const hint = $("primaryRunHint");
  if (draft.route === "operational") {
    if (label) label.textContent = "تشغيل المشغّل (مسارات متعددة)";
    if (hint)
      hint.textContent =
        "كل خطوة بمسارها · Allowlist · بدون مستودع واحد";
  } else if (draft.route === "implement") {
    if (label) label.textContent = "تحليل المسار";
    if (hint) hint.textContent = "للتنفيذ استخدم زر Level-3";
  } else {
    if (label) label.textContent = "تحليل الوكالة (تقارير)";
    if (hint) hint.textContent = "LangGraph · أدلة · تقارير · مستودع واحد";
  }
  document.querySelectorAll(".run-opt[data-for]").forEach((btn) => {
    const allow = (btn.dataset.for || "").split(",");
    btn.style.display = allow.includes(draft.route) ? "" : "none";
  });
}

function showRun(draft) {
  configureRunOptions(draft);
  showStage("run");
  els.runGrid?.classList.remove("is-busy");
  els.btnStop.disabled = true;
  els.runState.textContent = "ready";
}

function fillReport(entry) {
  const report = entry.report || {
    tone: entry.success ? "ok" : "fail",
    headline: entry.success ? "اكتملت المهمة بنجاح" : "فشل التنفيذ",
    bullets: [entry.summary || "—"],
    nextSteps: entry.success
      ? ["اكتب مهمة جديدة"]
      : ["راجع السجل وأعد المحاولة"],
  };
  els.reportCard.classList.toggle("ok", report.tone === "ok");
  els.reportCard.classList.toggle("fail", report.tone === "fail");
  els.reportBadge.textContent = report.tone === "ok" ? "SUCCESS" : "FAILED";
  els.reportHeadline.textContent = report.headline;
  const setQ = (el, label, val) => {
    if (!el) return;
    el.classList.remove("ok", "fail", "muted");
    if (val === true) {
      el.textContent = `${label}=true`;
      el.classList.add("ok");
    } else if (val === false) {
      el.textContent = `${label}=false`;
      el.classList.add("fail");
    } else {
      el.textContent = `${label}=—`;
      el.classList.add("muted");
    }
  };
  setQ(els.badgeAudit, "auditPassed", entry.auditPassed);
  const goalLabel =
    entry.goalFidelityScore != null && !Number.isNaN(Number(entry.goalFidelityScore))
      ? `goalPassed(${Number(entry.goalFidelityScore).toFixed(2)})`
      : "goalPassed";
  setQ(els.badgeGoal, goalLabel, entry.goalPassed);
  els.reportBullets.innerHTML = "";
  (report.bullets || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    els.reportBullets.appendChild(li);
  });
  els.reportNext.innerHTML = "";
  (report.nextSteps || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    els.reportNext.appendChild(li);
  });
  els.doneSummary.textContent = entry.summary || entry.logTail || "—";
  els.doneArtifacts.textContent = entry.taskLifecycle
    ? `دورة المهمة: ${entry.taskLifecycle}`
    : "";
}

async function openArtifactOs(relPath, mode = "file") {
  const res = await api("/api/artifacts/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: relPath, mode }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "تعذر الفتح");
  return data;
}

function closeArtifactViewer() {
  viewerRelPath = null;
  els.artifactViewer?.classList.add("hidden");
  if (els.viewerBody) els.viewerBody.textContent = "";
}

async function openArtifactViewer(item) {
  viewerRelPath = item.relPath;
  els.viewerTitle.textContent = item.label || item.relPath;
  els.viewerPath.textContent = item.relPath;
  els.viewerBody.textContent = "جاري التحميل…";
  els.artifactViewer.classList.remove("hidden");
  try {
    const res = await api(
      `/api/artifacts/content?path=${encodeURIComponent(item.relPath)}`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "تعذر القراءة");
    els.viewerBody.textContent = data.content || "(فارغ)";
  } catch (e) {
    els.viewerBody.textContent = e?.message || String(e);
  }
}

function renderArtifactGrid(items, packDir) {
  if (!els.artifactGrid) return;
  els.artifactGrid.innerHTML = "";
  if (els.artifactPackMeta) {
    els.artifactPackMeta.textContent = packDir
      ? `الحزمة: ${packDir} — افتح داخل الواجهة أو في النظام.`
      : "افتح التقرير داخل الواجهة أو في النظام.";
  }
  if (els.btnOpenPackFolder) {
    els.btnOpenPackFolder.style.display = packDir ? "" : "none";
  }
  if (!items?.length) {
    const empty = document.createElement("p");
    empty.className = "artifact-empty";
    empty.textContent = "لا توجد مخرجات قابلة للعرض بعد.";
    els.artifactGrid.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "artifact-card";
    card.innerHTML = `
      <div class="artifact-card-top">
        <h4></h4>
        <span class="artifact-kind"></span>
      </div>
      <p class="artifact-path"></p>
      <div class="artifact-card-actions"></div>
    `;
    card.querySelector("h4").textContent = item.label || item.relPath;
    card.querySelector(".artifact-kind").textContent =
      KIND_LABEL[item.kind] || item.kind || "ملف";
    card.querySelector(".artifact-path").textContent =
      `${item.relPath}${item.bytes != null ? ` · ${formatBytes(item.bytes)}` : ""}`;
    const actions = card.querySelector(".artifact-card-actions");

    const btnView = document.createElement("button");
    btnView.type = "button";
    btnView.className = "btn tiny primary";
    btnView.textContent = "عرض";
    btnView.addEventListener("click", () => openArtifactViewer(item));

    const btnOs = document.createElement("button");
    btnOs.type = "button";
    btnOs.className = "btn ghost tiny";
    btnOs.textContent = "فتح";
    btnOs.addEventListener("click", async () => {
      try {
        await openArtifactOs(item.relPath, "file");
      } catch (e) {
        alert(e?.message || String(e));
      }
    });

    const btnFolder = document.createElement("button");
    btnFolder.type = "button";
    btnFolder.className = "btn ghost tiny";
    btnFolder.textContent = "المجلد";
    btnFolder.addEventListener("click", async () => {
      try {
        await openArtifactOs(item.relPath, "folder");
      } catch (e) {
        alert(e?.message || String(e));
      }
    });

    actions.append(btnView, btnOs, btnFolder);
    els.artifactGrid.appendChild(card);
  });
}

async function loadArtifacts() {
  try {
    const res = await api("/api/artifacts");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "فشل التحميل");
    artifactCache = { items: data.items || [], packDir: data.packDir || null };
    renderArtifactGrid(artifactCache.items, artifactCache.packDir);
  } catch (e) {
    if (els.artifactGrid) {
      els.artifactGrid.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "artifact-empty";
      empty.textContent = e?.message || "تعذر تحميل المخرجات";
      els.artifactGrid.appendChild(empty);
    }
  }
}

function showDone(entry) {
  lastEntry = entry;
  lastFailed = !entry.success;
  busy = false;
  els.btnStop.disabled = true;
  els.runGrid?.classList.remove("is-busy");
  els.doneTitle.textContent = entry.success ? "تم بنجاح." : "لم تكتمل.";
  els.doneMeta.textContent = `${entry.title} · ${entry.route} · ${entry.mode} · exit ${entry.exitCode}`;
  fillReport(entry);
  // Rerun only useful after failure (success task was cleared)
  els.btnRerun.style.display = entry.success ? "none" : "";
  if (entry.success) clearLocalDraft();
  // Keep prompt text on failure so user can edit & retry; on success leave text until «مهمة جديدة»
  showStage("done");
  els.healthMeta.textContent = entry.success ? "ready · task cleared" : "ready · retry kept";
  loadArtifacts();
}

async function resetForNewTask() {
  if (busy) {
    alert("انتظر انتهاء التشغيل الحالي أو أوقفه أولاً");
    return;
  }
  const hasText = (els.prompt.value || "").trim().length > 0;
  if (hasText) {
    const ok = window.confirm(
      "عندك نص مهمة في الصندوق. مسحها وبدء مهمة جديدة؟\n(المهمة المحفوظة على القرص تبقى حتى تنجح أو تستبدلها بالحفظ)"
    );
    if (!ok) return;
  }
  await api("/api/ready", { method: "POST" });
  els.prompt.value = "";
  els.title.value = "";
  els.route.value = "auto";
  els.allowCode.checked = false;
  els.previewBox.hidden = true;
  els.previewBody.textContent = "";
  setLog("");
  els.runState.textContent = "idle";
  lastDraft = null;
  lastFailed = false;
  hideClarify();
  clearLocalDraft();
  showStage("compose");
  els.prompt.focus();
  els.healthMeta.textContent = "ready · new task";
}

function renderSession(session) {
  const n = session?.entries?.length || 0;
  els.sessionMeta.textContent = n
    ? `${n} مهمة · ${session.id}`
    : "لا مهام بعد — ابدأ من الصندوق";
  els.sessionList.innerHTML = "";
  (session?.entries || []).forEach((e) => {
    const li = document.createElement("li");
    li.className = e.success ? "ok" : "fail";
    li.innerHTML = `<div class="t">${escapeHtml(e.title)}</div>
      <div class="m">${e.route} · ${e.mode} · exit ${e.exitCode}</div>`;
    li.title = e.report?.headline || e.summary || "";
    li.addEventListener("click", () => showDone(e));
    els.sessionList.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function runMode(mode) {
  if (busy) return;
  if (mode === "implement") {
    const ok = window.confirm(
      "تشغيل التنفيذ (Level-3) مع GO.\nقد يتم تعديل ملفات في المستودع المستهدف.\nمتابعة؟"
    );
    if (!ok) return;
  }
  setLog(
    ">> Starting Sam-Harness...\n" +
      "   Tip: follow [OK] / [Error] / LIVE lines like the desktop launcher.\n\n"
  );
  els.runState.textContent = `starting:${mode}`;
  els.btnStop.disabled = false;
  els.runGrid?.classList.add("is-busy");
  busy = true;
  showStage("run");

  const res = await api("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      confirmImplement: mode === "implement",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    busy = false;
    els.runState.textContent = "error";
    els.btnStop.disabled = true;
    els.runGrid?.classList.remove("is-busy");
    appendLog(`\n[Error] ${data.error || res.statusText}\n`);
    if (data.blockedRepeat) {
      showDone({
        success: false,
        title: lastDraft?.title || "مهمة مكررة",
        route: lastDraft?.route || "?",
        mode,
        exitCode: 409,
        summary: data.error,
        artifacts: [],
        report: {
          tone: "fail",
          headline: "تكرار التنفيذ الناجح مرفوض",
          bullets: [data.error],
          nextSteps: ["اكتب هدفاً مختلفاً أو مهمة جديدة"],
        },
      });
    }
    return;
  }
  els.runState.textContent = `running:${mode}`;
  els.healthMeta.textContent = "run: active";
}

els.btnPreview.addEventListener("click", async () => {
  try {
    await compose(false);
  } catch (e) {
    alert(e.message || String(e));
  }
});

els.btnSave.addEventListener("click", async () => {
  try {
    const data = await compose(true);
    if (data.blocked) return;
    showRun(data.draft);
  } catch (e) {
    alert(e.message || String(e));
  }
});

els.btnSaveRun.addEventListener("click", async () => {
  try {
    const data = await compose(true);
    if (data.blocked) return;
    showRun(data.draft);
    await runMode("agency");
  } catch (e) {
    alert(e.message || String(e));
  }
});

$("btnClarifySubmit").addEventListener("click", async () => {
  try {
    const answers = collectClarifyAnswers();
    const data = await compose(true, answers);
    if (data.blocked) return;
    showRun(data.draft);
  } catch (e) {
    alert(e.message || String(e));
  }
});

els.btnBack.addEventListener("click", () => {
  if (busy) return;
  showStage("compose");
});

els.btnStop.addEventListener("click", async () => {
  await api("/api/stop", { method: "POST" });
});

els.btnNewTask.addEventListener("click", () => resetForNewTask());
els.btnNewTaskTop.addEventListener("click", () => resetForNewTask());

els.btnRerun.addEventListener("click", async () => {
  if (!lastFailed) {
    alert("إعادة التشغيل مسموحة بعد الفشل فقط. المهام الناجحة تُفرَّغ ولا تُكرر.");
    return;
  }
  if (lastDraft) showRun(lastDraft);
  else showStage("run");
  await runMode("agency");
});

els.btnViewLog.addEventListener("click", () => {
  showStage("run");
  if (lastEntry?.logTail) setLog(lastEntry.logTail);
});

els.btnOpenPackFolder?.addEventListener("click", async () => {
  const pack = artifactCache.packDir;
  if (!pack) {
    alert("لا توجد حزمة تقارير حالياً");
    return;
  }
  try {
    await openArtifactOs(pack, "dir");
  } catch (e) {
    alert(e?.message || String(e));
  }
});

els.btnViewerClose?.addEventListener("click", () => closeArtifactViewer());
els.btnViewerOsOpen?.addEventListener("click", async () => {
  if (!viewerRelPath) return;
  try {
    await openArtifactOs(viewerRelPath, "file");
  } catch (e) {
    alert(e?.message || String(e));
  }
});
els.btnViewerFolder?.addEventListener("click", async () => {
  if (!viewerRelPath) return;
  try {
    await openArtifactOs(viewerRelPath, "folder");
  } catch (e) {
    alert(e?.message || String(e));
  }
});
els.artifactViewer?.addEventListener("click", (ev) => {
  if (ev.target === els.artifactViewer) closeArtifactViewer();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !els.artifactViewer?.classList.contains("hidden")) {
    closeArtifactViewer();
  }
});

els.btnClearSession.addEventListener("click", async () => {
  if (!confirm("تفريغ سجل جلسة المهام؟")) return;
  const res = await api("/api/session/reset", { method: "POST" });
  const data = await res.json();
  if (data.session) renderSession(data.session);
});

document.querySelectorAll(".run-opt").forEach((btn) => {
  btn.addEventListener("click", () => runMode(btn.dataset.mode));
});

els.targetRepo.addEventListener("change", () => {
  const repo = els.targetRepo.value.replace(/[\\/]+$/, "");
  if (!els.packDir.dataset.touched) {
    els.packDir.value = `${repo}\\docs`;
  }
});
els.packDir.addEventListener("input", () => {
  els.packDir.dataset.touched = "1";
});
els.route.addEventListener("change", () => {
  syncWorkspacePanels(els.route.value, lastDraft?.spec || null);
});

document.querySelectorAll("#platformNav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (busy) {
      alert("انتظر انتهاء التشغيل أو أوقفه أولاً");
      return;
    }
    showPlatformPanel(btn.dataset.view);
  });
});

$("btnDailyAdd")?.addEventListener("click", async () => {
  const title = $("dailyPrompt")?.value?.trim();
  const schedule = $("dailyCron")?.value?.trim() || "manual";
  if (!title) return alert("اكتب وصف المهمة");
  await api("/api/daily-ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, schedule, prompt: title }),
  });
  if ($("dailyPrompt")) $("dailyPrompt").value = "";
  await loadDailyOps();
});

$("dailyOpsBody")?.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  await api(act === "toggle" ? "/api/daily-ops/toggle" : "/api/daily-ops/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  await loadDailyOps();
});

let selectedProfile = "auto";
document.querySelectorAll(".profile-card").forEach((card) => {
  card.addEventListener("click", () => {
    selectedProfile = card.dataset.profile;
    document.querySelectorAll(".profile-card").forEach((c) => {
      c.classList.toggle("selected", c === card);
    });
  });
});

$("btnSaveProfile")?.addEventListener("click", async () => {
  const costCapUsd = Number($("costCap")?.value || 0);
  const notes = $("profileNote")?.value?.trim() || undefined;
  const res = await api("/api/hybrid-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: selectedProfile, costCapUsd, notes }),
  });
  const data = await res.json();
  if ($("profileStatus")) {
    $("profileStatus").textContent = data.ok
      ? `تم الحفظ · ${data.profile.mode} · سقف $${data.profile.costCapUsd}`
      : data.error || "فشل الحفظ";
  }
  if (data.ok) renderCostUsage(data.cost);
});

$("btnLogin")?.addEventListener("click", async () => {
  const token = $("loginToken")?.value?.trim() || "";
  try {
    await doLogin(token);
    await bootApp();
  } catch (e) {
    showLogin(e?.message || String(e));
  }
});

$("loginToken")?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") $("btnLogin")?.click();
});

$("btnLogout")?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  csrfToken = "";
  sessionStorage.removeItem("sh_csrf");
  showLogin();
});

$("footerSessionLink")?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  const res = await api("/api/session");
  const data = await res.json();
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(`<pre>${JSON.stringify(data, null, 2)}</pre>`);
  }
});

$("btnMemAdd")?.addEventListener("click", async () => {
  const key = $("memKey")?.value?.trim();
  const value = $("memValue")?.value?.trim();
  if (!key || !value) return alert("المفتاح والملاحظة مطلوبان");
  await api("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if ($("memKey")) $("memKey").value = "";
  if ($("memValue")) $("memValue").value = "";
  await loadMemoryUi();
});

async function restoreActiveTask() {
  let restored = false;
  try {
    const data = await api("/api/active-task").then((r) => r.json());
    const prompt =
      data.draft?.prompt ||
      data.spec?.rawPrompt ||
      data.spec?.goal ||
      data.savedTask?.goal ||
      "";
    if (prompt && !/لا توجد مهمة قيد التنفيذ|CLEARED_AFTER_SUCCESS/i.test(prompt)) {
      applyDraftFields({
        prompt,
        title: data.draft?.title || data.spec?.title || data.savedTask?.title || "",
        route: data.spec?.route || data.savedTask?.route || "auto",
        targetRepo: data.spec?.targetRepo || data.savedTask?.targetRepo || "",
      });
      lastDraft = data.draft
        ? {
            title: data.draft.title,
            route: data.spec?.route || "operational",
            targetRepo: data.spec?.targetRepo,
            body: data.draft.body,
            confidence: data.draft.confidence,
            ready: data.draft.ready,
            needsClarification: data.draft.needsClarification,
            spec: data.spec,
          }
        : data.savedTask
          ? {
              title: data.savedTask.title,
              route: data.savedTask.route,
              targetRepo: data.savedTask.targetRepo,
              body: data.savedTask.body,
            }
          : null;
      if (data.draft?.needsClarification?.length && !data.draft.ready) {
        showClarify({
          needsClarification: data.draft.needsClarification,
          confidence: data.draft.confidence,
          spec: data.spec,
          draft: lastDraft,
        });
      }
      if (data.spec || data.draft?.body) {
        syncWorkspacePanels(data.spec?.route, data.spec);
        els.previewBody.textContent =
          `restored · mode=${data.spec?.workspaceMode || "?"}\n` +
          `confidence=${data.draft?.confidence ?? data.spec?.confidence ?? "?"}\n` +
          `intent=${data.spec?.intent || "?"}\n` +
          `roots=${(data.spec?.roots || []).join(" · ") || "—"}\n\n` +
          (data.draft?.body || JSON.stringify(data.spec, null, 2));
        els.previewBox.hidden = false;
      }
      els.healthMeta.textContent = "ready · task restored";
      restored = true;
    }
  } catch {
    /* fall through to localStorage */
  }
  if (!restored) {
    const local = loadLocalDraft();
    if (local?.prompt?.trim()) {
      applyDraftFields(local);
      els.healthMeta.textContent = "ready · local draft restored";
      restored = true;
    }
  }
  if (restored) saveLocalDraft();
  return restored;
}

let sseStarted = false;
let bootAppReady = false;

async function bootApp() {
  try {
    const h = await api("/api/health").then((r) => r.json());
    els.healthMeta.textContent = h.running
      ? "run: active"
      : `ready · :${h.port} · ${h.tasksInSession || 0} tasks`;
  } catch {
    els.healthMeta.textContent = "offline";
  }

  try {
    const s = await api("/api/session").then((r) => r.json());
    if (s.session) renderSession(s.session);
  } catch {
    /* ignore */
  }

  await loadOperatorContext();
  await restoreActiveTask();
  syncWorkspacePanels(els.route.value, lastDraft?.spec || null);
  showStage("compose");
  await loadProfiles();

  if (!bootAppReady) {
    bootAppReady = true;
    let draftTimer = null;
    els.prompt.addEventListener("input", () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveLocalDraft, 400);
    });
  }

  if (!sseStarted) {
    sseStarted = true;
    const es = new EventSource("/api/events", { withCredentials: true });
    es.addEventListener("log", (ev) => {
      const data = JSON.parse(ev.data);
      appendLog(data.text || "");
    });
    es.addEventListener("session", (ev) => {
      renderSession(JSON.parse(ev.data));
    });
    es.addEventListener("ready", () => {
      busy = false;
      els.btnStop.disabled = true;
      els.runGrid?.classList.remove("is-busy");
    });
    es.addEventListener("run", (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "start") {
        busy = true;
        showStage("run");
        els.runGrid?.classList.add("is-busy");
        els.runState.textContent = `running:${data.mode || data.script || "?"}`;
        els.btnStop.disabled = false;
        els.healthMeta.textContent = "run: active";
      }
      if (data.type === "end") {
        busy = false;
        els.btnStop.disabled = true;
        els.runGrid?.classList.remove("is-busy");
        els.runState.textContent = `done · exit ${data.exitCode}`;
        void loadProfiles();
        if (data.entry) showDone(data.entry);
        else {
          showDone({
            success: data.exitCode === 0,
            title: "Run",
            route: "?",
            mode: "?",
            exitCode: data.exitCode,
            summary: els.log.textContent.slice(-2000),
            artifacts: [],
            report: data.report,
          });
        }
      }
      if (data.type === "stopped") {
        busy = false;
        els.runState.textContent = "stopped";
        els.btnStop.disabled = true;
      }
    });
    es.onerror = () => {
      // cookie session may have expired
      void ensureAuth().then((ok) => {
        if (!ok) es.close();
      });
    };
  }
}

async function boot() {
  showLogin();
  const ok = await ensureAuth();
  if (ok) await bootApp();
}

boot();

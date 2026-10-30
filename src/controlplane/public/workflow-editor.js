/**
 * Phase 9 — dependency-free SVG workflow canvas (no CDN).
 * Exposes window.SamWorkflowEditor for app.js.
 */
(function (global) {
  "use strict";

  const NODE_W = 168;
  const NODE_H = 64;

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function stableStringify(v) {
    return JSON.stringify(v);
  }

  /** Minimal undo/redo (mirrors src/agency/workflowHistory.ts). */
  class History {
    constructor(limit) {
      this.limit = limit || 100;
      this.past = [];
      this.present = null;
      this.future = [];
    }
    reset(value, label) {
      this.past = [];
      this.future = [];
      this.present = { value: clone(value), label: label || "reset" };
    }
    get current() {
      return this.present ? clone(this.present.value) : null;
    }
    get canUndo() {
      return this.past.length > 0;
    }
    get canRedo() {
      return this.future.length > 0;
    }
    push(value, label) {
      if (!this.present) {
        this.reset(value, label || "init");
        return clone(value);
      }
      if (stableStringify(this.present.value) === stableStringify(value)) {
        return clone(this.present.value);
      }
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
      this.present = { value: clone(value), label: label };
      this.future = [];
      return clone(this.present.value);
    }
    undo() {
      if (!this.canUndo || !this.present) return this.current;
      this.future.unshift(this.present);
      this.present = this.past.pop();
      return clone(this.present.value);
    }
    redo() {
      if (!this.canRedo || !this.present) return this.current;
      this.past.push(this.present);
      this.present = this.future.shift();
      return clone(this.present.value);
    }
    status() {
      return {
        canUndo: this.canUndo,
        canRedo: this.canRedo,
        undoDepth: this.past.length,
        redoDepth: this.future.length,
        label: this.present && this.present.label,
      };
    }
  }

  function kindClass(kind) {
    return "wf-kind-" + String(kind || "role").replace(/_/g, "-");
  }

  function routeBadge(route) {
    if (!route) return { text: "—", cls: "wf-badge-unknown" };
    const tier = route.tier || route.route || "local";
    const degraded = route.degraded ? "*" : "";
    let cls = "wf-badge-local";
    if (tier === "paid" || tier === "cloud") cls = "wf-badge-paid";
    else if (tier === "free") cls = "wf-badge-free";
    return {
      text: tier + degraded,
      cls,
      title: (route.model || "") + (route.reason ? " · " + route.reason : ""),
    };
  }

  function validateClient(graph, t) {
    const issues = [];
    const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
    const locked = [
      "router",
      "operational",
      "intake",
      "evidence",
      "review_strategist",
      "review_auditor",
      "go_gate",
      "delivery",
      "level3",
    ];
    for (const id of locked) {
      if (!byId.has(id)) {
        issues.push(t("workflow.err.missingLocked", id) || `Missing locked node: ${id}`);
      } else if (byId.get(id).locked !== true) {
        issues.push(t("workflow.err.mustStayLocked", id) || `${id} must stay locked`);
      }
    }
    const edgeSet = new Set((graph.edges || []).map((e) => `${e.source}->${e.target}`));
    const required = [
      ["review_strategist", "review_auditor"],
      ["review_auditor", "review_strategist"],
      ["review_auditor", "go_gate"],
    ];
    for (const [s, tgt] of required) {
      if (!edgeSet.has(`${s}->${tgt}`)) {
        issues.push(
          t("workflow.err.bypass", `${s}→${tgt}`) ||
            `Cannot bypass review/GO: missing ${s} → ${tgt}`
        );
      }
    }
    for (const n of graph.nodes || []) {
      if (n.kind === "specialist" && n.builtin === false && !(n.prompt || "").trim()) {
        issues.push(
          t("workflow.err.promptRequired", n.id) || `Custom role ${n.id} needs a prompt`
        );
      }
      if (
        n.kind === "specialist" &&
        (!n.models || !n.models.local || !n.models.cloud)
      ) {
        issues.push(
          t("workflow.err.modelsRequired", n.id) || `Specialist ${n.id} needs local+cloud models`
        );
      }
    }
    return issues;
  }

  function extractOrder(graph) {
    const outgoing = new Map();
    for (const e of graph.edges || []) {
      if (e.kind === "reject_loop") continue;
      const list = outgoing.get(e.source) || [];
      list.push(e.target);
      outgoing.set(e.source, list);
    }
    const order = [];
    let cur = "go_gate";
    const seen = new Set();
    while (true) {
      const nexts = outgoing.get(cur) || [];
      const specialistNext = nexts.find((x) => String(x).startsWith("specialist:"));
      const deliveryNext = nexts.find((x) => x === "delivery");
      const nxt = specialistNext || deliveryNext;
      if (!nxt || seen.has(nxt)) break;
      seen.add(nxt);
      if (String(nxt).startsWith("specialist:")) {
        order.push(String(nxt).slice("specialist:".length));
        cur = nxt;
        continue;
      }
      break;
    }
    return order;
  }

  function reorderSpecialists(graph, order) {
    const next = clone(graph);
    next.edges = (next.edges || []).filter((e) => {
      if (e.source === "go_gate" && String(e.target).startsWith("specialist:")) return false;
      if (String(e.source).startsWith("specialist:")) return false;
      if (e.source === "go_gate" && e.target === "delivery") return false;
      return true;
    });
    let prev = "go_gate";
    for (const id of order) {
      const nid = `specialist:${id}`;
      next.edges.push({
        id: `${prev}->${nid}`,
        source: prev,
        target: nid,
        locked: false,
        kind: "flow",
      });
      prev = nid;
    }
    next.edges.push({
      id: `${prev}->delivery`,
      source: prev,
      target: "delivery",
      locked: false,
      kind: "flow",
    });
    return next;
  }

  function createEditor(opts) {
    const root = opts.root;
    const api = opts.api;
    const t = opts.t || ((k) => k);
    const onStatus = opts.onStatus || function () {};

    const els = {
      canvas: root.querySelector("#wfCanvas"),
      svg: null,
      edgesG: null,
      nodesG: null,
      panel: root.querySelector("#wfSidePanel"),
      status: root.querySelector("#wfStatus"),
      errors: root.querySelector("#wfErrors"),
      dirty: root.querySelector("#wfDirtyBadge"),
      routeNote: root.querySelector("#wfRouteNote"),
    };

    const state = {
      graph: null,
      layout: null,
      routing: [],
      selectedId: null,
      dirty: false,
      appliedFingerprint: "",
      connectFrom: null,
      drag: null,
      history: new History(80),
      pan: { x: 0, y: 0 },
      zoom: 1,
    };

    function setStatus(msg, isError) {
      if (els.status) {
        els.status.textContent = msg || "—";
        els.status.classList.toggle("wf-status-error", Boolean(isError));
      }
      onStatus(msg, isError);
    }

    function showErrors(issues) {
      if (!els.errors) return;
      if (!issues || !issues.length) {
        els.errors.hidden = true;
        els.errors.innerHTML = "";
        return;
      }
      els.errors.hidden = false;
      els.errors.innerHTML =
        "<ul>" +
        issues
          .map((i) => `<li>${escapeHtml(typeof i === "string" ? i : i.message || String(i))}</li>`)
          .join("") +
        "</ul>";
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function fingerprint() {
      return stableStringify({
        graph: state.graph,
        // layout changes alone are not "semantic dirty" for apply — but we track both
        layout: state.layout,
      });
    }

    function updateDirty() {
      const fp = fingerprint();
      state.dirty = fp !== state.appliedFingerprint;
      if (els.dirty) {
        els.dirty.hidden = !state.dirty;
        els.dirty.textContent = state.dirty
          ? t("workflow.draft") || "Draft"
          : t("workflow.applied") || "Applied";
      }
      const undoBtn = root.querySelector("#btnWfUndo");
      const redoBtn = root.querySelector("#btnWfRedo");
      const st = state.history.status();
      if (undoBtn) undoBtn.disabled = !st.canUndo;
      if (redoBtn) redoBtn.disabled = !st.canRedo;
    }

    function pushHistory(label) {
      state.history.push(
        { graph: clone(state.graph), layout: clone(state.layout) },
        label
      );
      updateDirty();
    }

    function ensureSvg() {
      if (els.svg) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "wf-svg");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.innerHTML = `
        <marker id="wfArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(214,204,186,0.55)"></path>
        </marker>
        <marker id="wfArrowLoop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(201,162,39,0.8)"></path>
        </marker>`;
      svg.appendChild(defs);
      const world = document.createElementNS("http://www.w3.org/2000/svg", "g");
      world.setAttribute("class", "wf-world");
      const edgesG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      edgesG.setAttribute("class", "wf-edges");
      const nodesG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodesG.setAttribute("class", "wf-nodes");
      world.appendChild(edgesG);
      world.appendChild(nodesG);
      svg.appendChild(world);
      els.canvas.innerHTML = "";
      els.canvas.appendChild(svg);
      els.svg = svg;
      els.world = world;
      els.edgesG = edgesG;
      els.nodesG = nodesG;

      svg.addEventListener("mousedown", onCanvasDown);
      svg.addEventListener("mousemove", onCanvasMove);
      window.addEventListener("mouseup", onCanvasUp);
      svg.addEventListener(
        "wheel",
        (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          state.zoom = Math.min(2.2, Math.max(0.45, state.zoom * delta));
          applyTransform();
        },
        { passive: false }
      );
    }

    function applyTransform() {
      if (!els.world) return;
      els.world.setAttribute(
        "transform",
        `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`
      );
    }

    function posOf(id) {
      const p = (state.layout && state.layout.positions && state.layout.positions[id]) || {
        x: 40,
        y: 40,
      };
      return p;
    }

    function centerOf(id) {
      const p = posOf(id);
      return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 };
    }

    function routeByRole() {
      const map = {};
      (state.routing || []).forEach((d) => {
        map[d.role] = d.route || d;
      });
      return map;
    }

    function render() {
      ensureSvg();
      applyTransform();
      const routes = routeByRole();
      els.edgesG.innerHTML = "";
      els.nodesG.innerHTML = "";

      for (const e of state.graph.edges || []) {
        const a = centerOf(e.source);
        const b = centerOf(e.target);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let d;
        if (e.kind === "reject_loop") {
          const mx = (a.x + b.x) / 2 + 70;
          const my = (a.y + b.y) / 2;
          d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
          path.setAttribute("marker-end", "url(#wfArrowLoop)");
          path.setAttribute("class", "wf-edge wf-edge-loop" + (e.locked ? " locked" : ""));
        } else {
          const dx = (b.x - a.x) * 0.35;
          d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
          path.setAttribute("marker-end", "url(#wfArrow)");
          path.setAttribute(
            "class",
            "wf-edge" + (e.locked ? " locked" : "") + (e.kind === "branch" ? " branch" : "")
          );
        }
        path.setAttribute("d", d);
        path.dataset.edge = e.id;
        els.edgesG.appendChild(path);
        if (e.label) {
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2 - (e.kind === "reject_loop" ? 18 : 8);
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(midX));
          text.setAttribute("y", String(midY));
          text.setAttribute("class", "wf-edge-label");
          text.textContent = e.label;
          els.edgesG.appendChild(text);
        }
      }

      for (const n of state.graph.nodes || []) {
        const p = posOf(n.id);
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute(
          "class",
          "wf-node " +
            kindClass(n.kind) +
            (n.locked ? " locked" : "") +
            (n.enabled === false ? " disabled" : "") +
            (state.selectedId === n.id ? " selected" : "")
        );
        g.setAttribute("transform", `translate(${p.x},${p.y})`);
        g.dataset.id = n.id;

        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width", String(NODE_W));
        rect.setAttribute("height", String(NODE_H));
        rect.setAttribute("rx", "12");
        rect.setAttribute("ry", "12");
        g.appendChild(rect);

        const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
        title.setAttribute("x", "12");
        title.setAttribute("y", "26");
        title.setAttribute("class", "wf-node-title");
        title.textContent = truncate(n.label || n.id, 18);
        g.appendChild(title);

        const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
        sub.setAttribute("x", "12");
        sub.setAttribute("y", "46");
        sub.setAttribute("class", "wf-node-sub");
        const roleKey = n.roleId || (n.id.startsWith("specialist:") ? n.id.slice(11) : n.id);
        const badge = routeBadge(routes[roleKey]);
        sub.textContent =
          (n.locked ? "🔒 " : "") +
          (n.kind === "go_gate" || n.kind === "delivery"
            ? n.kind
            : badge.text + (n.enabled === false ? " · off" : ""));
        if (badge.title) {
          const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
          tip.textContent = badge.title;
          g.appendChild(tip);
        }
        g.appendChild(sub);

        g.addEventListener("mousedown", (ev) => onNodeDown(ev, n));
        g.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectNode(n.id);
        });
        els.nodesG.appendChild(g);
      }

      renderPanel();
      updateDirty();
      const clientIssues = validateClient(state.graph, t);
      showErrors(clientIssues);
    }

    function truncate(s, n) {
      const str = String(s || "");
      return str.length > n ? str.slice(0, n - 1) + "…" : str;
    }

    function selectNode(id, opts) {
      state.selectedId = id;
      if (opts && opts.soft) {
        // Update selection styling without destroying DOM mid-drag.
        if (els.nodesG) {
          els.nodesG.querySelectorAll(".wf-node").forEach((el) => {
            el.classList.toggle("selected", el.dataset.id === id);
          });
        }
        renderPanel();
        return;
      }
      render();
    }

    function renderPanel() {
      if (!els.panel) return;
      const n = (state.graph.nodes || []).find((x) => x.id === state.selectedId);
      if (!n) {
        els.panel.innerHTML = `<p class="lede-sm">${escapeHtml(
          t("workflow.panelEmpty") || "Select a node to edit."
        )}</p>`;
        return;
      }
      const lockedHint = n.locked
        ? `<p class="wf-locked-hint">${escapeHtml(
            n.kind === "specialist"
              ? t("workflow.lockedSpecialistHint") ||
                  "Builtin specialist — cannot delete (disable instead). Properties are editable."
              : t("workflow.lockedHint") ||
                  "Locked spine node — cannot delete or bypass. Linked role properties may still be edited."
          )}</p>`
        : "";
      const canEditRole = Boolean(n.roleId) || n.kind === "specialist";
      const roleId = n.roleId || (n.id.startsWith("specialist:") ? n.id.slice(11) : "");
      const routes = routeByRole();
      const badge = routeBadge(routes[roleId]);

      let body = `
        <div class="wf-panel-head">
          <strong>${escapeHtml(n.label || n.id)}</strong>
          <span class="wf-pill ${badge.cls}" title="${escapeHtml(badge.title || "")}">${escapeHtml(
            badge.text
          )}</span>
        </div>
        <p class="lede-sm"><code>${escapeHtml(n.id)}</code> · ${escapeHtml(n.kind)}${
          n.locked ? " · locked" : ""
        }</p>
        ${lockedHint}
      `;

      if (canEditRole) {
        body += `
          <div class="field">
            <label>${escapeHtml(t("workflow.field.title") || "Title")}</label>
            <input id="wfFieldTitle" type="text" value="${escapeHtml(n.title || n.label || "")}" />
          </div>
          <div class="field">
            <label>${escapeHtml(t("workflow.field.prompt") || "Prompt")}</label>
            <textarea id="wfFieldPrompt" rows="3">${escapeHtml(n.prompt || "")}</textarea>
          </div>
          <div class="field">
            <label>${escapeHtml(t("workflow.field.local") || "Local model")}</label>
            <input id="wfFieldLocal" type="text" value="${escapeHtml(
              (n.models && n.models.local) || ""
            )}" />
          </div>
          <div class="field">
            <label>${escapeHtml(t("workflow.field.cloud") || "Cloud model")}</label>
            <input id="wfFieldCloud" type="text" value="${escapeHtml(
              (n.models && n.models.cloud) || ""
            )}" />
          </div>
          <div class="field">
            <label>${escapeHtml(t("workflow.field.free") || "Free model")}</label>
            <input id="wfFieldFree" type="text" value="${escapeHtml(
              (n.models && n.models.free) || ""
            )}" />
          </div>
          <label class="wf-check">
            <input id="wfFieldPrefersCloud" type="checkbox" ${
              n.prefersCloud ? "checked" : ""
            } />
            ${escapeHtml(t("workflow.field.prefersCloud") || "prefersCloud")}
          </label>
          <label class="wf-check">
            <input id="wfFieldEnabled" type="checkbox" ${n.enabled !== false ? "checked" : ""} ${
              n.id === "review_strategist" ||
              n.id === "review_auditor" ||
              n.id === "go_gate" ||
              roleId === "strategist" ||
              roleId === "auditor" ||
              roleId === "ceo_router" ||
              roleId === "implementer"
                ? "disabled"
                : ""
            } />
            ${escapeHtml(t("workflow.field.enabled") || "Enabled")}
          </label>
          <div class="field">
            <label>${escapeHtml(t("workflow.field.tools") || "Tools / capabilities")}</label>
            <input id="wfFieldTools" type="text" value="${escapeHtml(
              (n.tools || []).join(",")
            )}" placeholder="write_report,read_file,…" />
          </div>
          <div class="actions" style="margin-top:0.75rem">
            <button type="button" class="btn primary tiny" id="btnWfApplyPanel">${escapeHtml(
              t("workflow.applyProps") || "Update node"
            )}</button>
          </div>
        `;
      } else {
        body += `<p class="lede-sm">${escapeHtml(
          t("workflow.structuralNode") || "Structural node — no role properties."
        )}</p>`;
      }

      if (n.kind === "specialist") {
        body += `
          <div class="actions" style="margin-top:0.5rem;flex-wrap:wrap">
            <button type="button" class="btn ghost tiny" id="btnWfMoveUp">${escapeHtml(
              t("workflow.moveUp") || "Move earlier"
            )}</button>
            <button type="button" class="btn ghost tiny" id="btnWfMoveDown">${escapeHtml(
              t("workflow.moveDown") || "Move later"
            )}</button>
            ${
              !n.locked && !n.builtin
                ? `<button type="button" class="btn ghost tiny" id="btnWfDelete">${escapeHtml(
                    t("workflow.deleteNode") || "Delete custom"
                  )}</button>`
                : ""
            }
          </div>
        `;
      }

      els.panel.innerHTML = body;

      const applyBtn = els.panel.querySelector("#btnWfApplyPanel");
      if (applyBtn) {
        applyBtn.addEventListener("click", () => {
          const issues = applyPanelToNode(n.id);
          if (issues.length) {
            showErrors(issues);
            setStatus(issues[0], true);
            return;
          }
          pushHistory("edit-props");
          render();
          setStatus(t("workflow.propsUpdated") || "Node updated (draft)");
        });
      }
      const up = els.panel.querySelector("#btnWfMoveUp");
      const down = els.panel.querySelector("#btnWfMoveDown");
      if (up) up.addEventListener("click", () => moveSpecialist(roleId, -1));
      if (down) down.addEventListener("click", () => moveSpecialist(roleId, 1));
      const del = els.panel.querySelector("#btnWfDelete");
      if (del) {
        del.addEventListener("click", () => deleteCustom(n.id));
      }
    }

    function applyPanelToNode(nodeId) {
      const issues = [];
      const n = state.graph.nodes.find((x) => x.id === nodeId);
      if (!n) return ["node missing"];
      const title = els.panel.querySelector("#wfFieldTitle")?.value?.trim();
      const prompt = els.panel.querySelector("#wfFieldPrompt")?.value || "";
      const local = els.panel.querySelector("#wfFieldLocal")?.value?.trim();
      const cloud = els.panel.querySelector("#wfFieldCloud")?.value?.trim();
      const free = els.panel.querySelector("#wfFieldFree")?.value?.trim() || null;
      const prefersCloud = Boolean(els.panel.querySelector("#wfFieldPrefersCloud")?.checked);
      const enabled = Boolean(els.panel.querySelector("#wfFieldEnabled")?.checked);
      const toolsRaw = els.panel.querySelector("#wfFieldTools")?.value || "";
      if (!title) issues.push(t("workflow.err.title") || "Title required");
      if (!local || !cloud) issues.push(t("workflow.err.models") || "Local and cloud models required");
      if (n.builtin === false && n.kind === "specialist" && !prompt.trim()) {
        issues.push(t("workflow.err.prompt") || "Custom roles require a prompt");
      }
      if (issues.length) return issues;
      n.title = title;
      n.label = title;
      n.prompt = prompt;
      n.models = { local, cloud, free: free || null };
      n.prefersCloud = prefersCloud;
      if (!(n.locked && (n.kind === "review" || nodeId === "go_gate"))) {
        n.enabled = enabled;
      }
      n.tools = toolsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return [];
    }

    function moveSpecialist(roleId, delta) {
      const order = extractOrder(state.graph);
      const idx = order.indexOf(roleId);
      if (idx < 0) return;
      const j = idx + delta;
      if (j < 0 || j >= order.length) return;
      const next = order.slice();
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      state.graph = reorderSpecialists(state.graph, next);
      pushHistory("reorder");
      render();
      setStatus(t("workflow.reordered") || "Specialists reordered (draft)");
    }

    function deleteCustom(nodeId) {
      const n = state.graph.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      if (n.locked || n.builtin) {
        const msg =
          t("workflow.err.cannotDeleteLocked") ||
          "Cannot delete locked or builtin nodes";
        showErrors([msg]);
        setStatus(msg, true);
        return;
      }
      const roleId = n.roleId || nodeId.replace(/^specialist:/, "");
      state.graph.nodes = state.graph.nodes.filter((x) => x.id !== nodeId);
      state.graph.edges = state.graph.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      );
      const order = extractOrder(state.graph).filter((id) => id !== roleId);
      // Also remove from any remaining
      const remaining = (state.graph.nodes || [])
        .filter((x) => x.kind === "specialist")
        .map((x) => x.roleId || x.id.slice(11));
      const finalOrder = order.length ? order : remaining;
      state.graph = reorderSpecialists(state.graph, finalOrder);
      if (state.layout?.positions) delete state.layout.positions[nodeId];
      state.selectedId = null;
      pushHistory("delete");
      render();
      setStatus(t("workflow.deleted") || "Custom role removed (draft)");
    }

    function onNodeDown(ev, n) {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      // Soft select keeps DOM intact so drag can continue on the same <g>.
      selectNode(n.id, { soft: true });
      const start = posOf(n.id);
      state.drag = {
        id: n.id,
        ox: ev.clientX,
        oy: ev.clientY,
        sx: start.x,
        sy: start.y,
        moved: false,
      };
    }

    function onCanvasDown(ev) {
      if (ev.target.closest && ev.target.closest(".wf-node")) return;
      if (ev.button !== 0) return;
      state.drag = {
        id: null,
        pan: true,
        ox: ev.clientX,
        oy: ev.clientY,
        sx: state.pan.x,
        sy: state.pan.y,
      };
      state.selectedId = null;
      renderPanel();
      // re-render selection only
      root.querySelectorAll(".wf-node.selected").forEach((el) => el.classList.remove("selected"));
    }

    function onCanvasMove(ev) {
      if (!state.drag) return;
      const dx = (ev.clientX - state.drag.ox) / state.zoom;
      const dy = (ev.clientY - state.drag.oy) / state.zoom;
      if (state.drag.pan) {
        state.pan.x = state.drag.sx + (ev.clientX - state.drag.ox);
        state.pan.y = state.drag.sy + (ev.clientY - state.drag.oy);
        applyTransform();
        return;
      }
      if (!state.drag.id) return;
      state.drag.moved = true;
      if (!state.layout.positions) state.layout.positions = {};
      state.layout.positions[state.drag.id] = {
        x: state.drag.sx + dx,
        y: state.drag.sy + dy,
      };
      // live update transform of node
      const g = els.nodesG.querySelector(`[data-id="${CSS.escape(state.drag.id)}"]`);
      if (g) {
        const p = state.layout.positions[state.drag.id];
        g.setAttribute("transform", `translate(${p.x},${p.y})`);
      }
      // cheap edge refresh
      renderEdgesOnly();
    }

    function renderEdgesOnly() {
      // Full render is fine for small graphs
      const sel = state.selectedId;
      const keepPanel = els.panel?.innerHTML;
      // skip panel rebuild thrash: temporarily stub
      const panel = els.panel;
      els.panel = null;
      render();
      els.panel = panel;
      state.selectedId = sel;
      if (panel && keepPanel) panel.innerHTML = keepPanel;
      // rebind is skipped during drag — ok
    }

    function onCanvasUp() {
      if (!state.drag) return;
      if (state.drag.id && state.drag.moved) {
        pushHistory("move");
        updateDirty();
      }
      state.drag = null;
      render();
    }

    function fitView() {
      // Fit the full graph into the canvas with a small margin.
      const positions = Object.values((state.layout && state.layout.positions) || {});
      if (!positions.length || !els.canvas) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of positions) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + NODE_W);
        maxY = Math.max(maxY, p.y + NODE_H);
      }
      const pad = 36;
      const bw = maxX - minX + pad * 2;
      const bh = maxY - minY + pad * 2;
      const cw = Math.max(els.canvas.clientWidth || 800, 320);
      const ch = Math.max(els.canvas.clientHeight || 520, 320);
      const zoom = Math.min(1.15, Math.max(0.45, Math.min(cw / bw, ch / bh)));
      state.zoom = zoom;
      state.pan = {
        x: (cw - bw * zoom) / 2 - minX * zoom + pad * zoom,
        y: (ch - bh * zoom) / 2 - minY * zoom + pad * zoom,
      };
      applyTransform();
    }

    async function load() {
      setStatus(t("workflow.loading") || "Loading…");
      const res = await api("/api/workflow");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "load failed");
      state.graph = data.graph;
      state.layout = data.layout;
      state.routing = data.routing || [];
      state.history.reset({ graph: clone(state.graph), layout: clone(state.layout) }, "load");
      state.appliedFingerprint = fingerprint();
      state.dirty = false;
      render();
      fitView();
      const order = extractOrder(state.graph).join("→") || "—";
      setStatus(
        `${t("workflow.loaded") || "Loaded"} · ${state.graph.nodes.length} · ${order}`
      );
      if (els.routeNote) {
        els.routeNote.textContent =
          t("workflow.routeNote") ||
          "Routing badges from /api/routing/effective (cap-aware).";
      }
    }

    async function refreshRouting() {
      try {
        const res = await api("/api/routing/effective");
        const data = await res.json();
        if (data.ok) {
          state.routing = data.decisions || [];
          render();
        }
      } catch {
        /* ignore */
      }
    }

    async function apply() {
      const issues = validateClient(state.graph, t);
      if (issues.length) {
        showErrors(issues);
        setStatus(issues[0], true);
        return;
      }
      setStatus(t("workflow.applying") || "Applying…");
      const res = await api("/api/workflow/graph", {
        method: "PUT",
        body: JSON.stringify({ graph: state.graph }),
      });
      const data = await res.json();
      if (!data.ok) {
        setStatus(data.error || "apply failed", true);
        showErrors([{ message: data.error || "apply failed" }]);
        return;
      }
      // Persist layout separately
      await api("/api/workflow/layout", {
        method: "PUT",
        body: JSON.stringify({ layout: state.layout }),
      });
      state.graph = data.graph || state.graph;
      state.routing = data.routing || state.routing;
      state.history.reset({ graph: clone(state.graph), layout: clone(state.layout) }, "apply");
      state.appliedFingerprint = fingerprint();
      state.dirty = false;
      render();
      setStatus(t("workflow.appliedOk") || "Applied to team config (+ audit)");
    }

    async function saveDraft() {
      const res = await api("/api/workflow/graph", {
        method: "PUT",
        body: JSON.stringify({ graph: state.graph, draft: true }),
      });
      const data = await res.json();
      if (!data.ok) {
        showErrors(data.issues || [{ message: data.error }]);
        setStatus(t("workflow.draftInvalid") || "Draft invalid", true);
        return;
      }
      try {
        localStorage.setItem(
          "sh_workflow_draft",
          JSON.stringify({ graph: state.graph, layout: state.layout, at: Date.now() })
        );
      } catch {
        /* ignore */
      }
      setStatus(t("workflow.draftSaved") || "Draft validated & saved locally");
    }

    async function resetDefaults() {
      if (
        !confirm(
          t("workflow.resetConfirm") ||
            "Reset team workflow and layout to defaults?"
        )
      ) {
        return;
      }
      const res = await api("/api/workflow/reset", { method: "POST", body: "{}" });
      const data = await res.json();
      if (!data.ok) {
        setStatus(data.error || "reset failed", true);
        return;
      }
      state.graph = data.graph;
      state.layout = data.layout;
      state.routing = data.routing || state.routing;
      state.history.reset({ graph: clone(state.graph), layout: clone(state.layout) }, "reset");
      state.appliedFingerprint = fingerprint();
      render();
      setStatus(t("workflow.resetOk") || "Reset to defaults");
    }

    function exportJson() {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        graph: state.graph,
        layout: state.layout,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sam-harness-workflow.json";
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus(t("workflow.exported") || "Exported JSON");
    }

    async function importJson(file) {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        setStatus(t("workflow.importBadJson") || "Invalid JSON", true);
        return;
      }
      const graph = payload.graph || payload;
      const layout = payload.layout;
      const res = await api("/api/workflow/import", {
        method: "POST",
        body: JSON.stringify({ graph, layout, apply: false }),
      });
      const data = await res.json();
      if (!data.ok) {
        showErrors(data.issues || [{ message: data.error }]);
        setStatus(data.error || "import failed", true);
        return;
      }
      state.graph = data.graph || graph;
      if (layout) state.layout = layout;
      pushHistory("import");
      render();
      setStatus(t("workflow.importedDraft") || "Imported as draft — Apply to save");
    }

    function addCustomRole() {
      const id = prompt(t("workflow.newRoleId") || "Role id (snake_case)", "research_analyst");
      if (!id) return;
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(id)) {
        setStatus(t("workflow.err.badId") || "Invalid role id", true);
        return;
      }
      if (state.graph.nodes.some((n) => n.id === `specialist:${id}` || n.roleId === id)) {
        setStatus(t("workflow.err.dupId") || "Role already exists", true);
        return;
      }
      const title = prompt(t("workflow.newRoleTitle") || "Title", id) || id;
      const node = {
        id: `specialist:${id}`,
        kind: "specialist",
        label: title,
        locked: false,
        enabled: true,
        roleId: id,
        title,
        prompt: "Describe the specialist mission and outputs.",
        prefersCloud: false,
        builtin: false,
        stage: "downstream",
        models: {
          local: "qwen2.5:1.5b",
          cloud: "gemma4:cloud",
          free: null,
        },
        tools: ["write_report", "write_file", "read_file", "list_dir", "finish"],
      };
      state.graph.nodes.push(node);
      const order = extractOrder(state.graph);
      order.push(id);
      state.graph = reorderSpecialists(state.graph, order);
      if (!state.layout.positions) state.layout.positions = {};
      state.layout.positions[node.id] = {
        x: 1080,
        y: 100 + order.length * 90,
      };
      state.selectedId = node.id;
      pushHistory("add-role");
      render();
      setStatus(t("workflow.addedRole") || "Custom role added (draft)");
    }

    function undo() {
      const snap = state.history.undo();
      if (!snap) return;
      state.graph = snap.graph;
      state.layout = snap.layout;
      render();
      setStatus(t("workflow.undone") || "Undo");
    }

    function redo() {
      const snap = state.history.redo();
      if (!snap) return;
      state.graph = snap.graph;
      state.layout = snap.layout;
      render();
      setStatus(t("workflow.redone") || "Redo");
    }

    function bindToolbar() {
      const map = {
        btnWfRefresh: () => load().then(refreshRouting),
        btnWfUndo: undo,
        btnWfRedo: redo,
        btnWfDraft: saveDraft,
        btnWfApply: apply,
        btnWfExport: exportJson,
        btnWfReset: resetDefaults,
        btnWfAddRole: addCustomRole,
      };
      Object.entries(map).forEach(([id, fn]) => {
        const el = root.querySelector("#" + id) || document.getElementById(id);
        if (el && !el.dataset.wfBound) {
          el.dataset.wfBound = "1";
          el.addEventListener("click", () => {
            Promise.resolve(fn()).catch((e) => setStatus(e.message || String(e), true));
          });
        }
      });
      const file = root.querySelector("#wfImportFile") || document.getElementById("wfImportFile");
      if (file && !file.dataset.wfBound) {
        file.dataset.wfBound = "1";
        file.addEventListener("change", () => {
          const f = file.files && file.files[0];
          if (f) {
            importJson(f).catch((e) => setStatus(e.message || String(e), true));
            file.value = "";
          }
        });
      }
    }

    bindToolbar();

    return {
      load,
      render,
      refreshRouting,
      getState: () => ({
        graph: clone(state.graph),
        layout: clone(state.layout),
        dirty: state.dirty,
        history: state.history.status(),
      }),
      // exposed for unit-ish checks from console
      _internal: { validateClient, extractOrder, reorderSpecialists, History },
    };
  }

  global.SamWorkflowEditor = { createEditor, History, validateClient: (g) => validateClient(g, (k) => k) };
})(typeof window !== "undefined" ? window : globalThis);

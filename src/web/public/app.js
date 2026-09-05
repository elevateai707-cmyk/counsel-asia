/* counsel-asia web panel — zero-build vanilla JS. Polls /api/status +
   /api/events every ~2s so long builds show live progress. */
const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path, opts).then((r) => r.json());
const usd = (n) => "$" + Number(n).toFixed(4);

let eventCursor = 0;

// --- tabs ---
document.querySelectorAll("#tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + btn.dataset.tab));
    if (btn.dataset.tab === "models") loadModels();
  });
});

// --- prompt view ---
$("run").addEventListener("click", async () => {
  const idea = $("idea").value.trim();
  if (!idea) { $("prompt-msg").textContent = "Describe the project first."; return; }
  $("run").disabled = true;
  $("prompt-msg").textContent = "Starting… (Hermes autoroute, then build --all --apply)";
  try {
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    });
    const data = await res.json();
    $("prompt-msg").textContent = res.ok ? "Running — watch the Progress tab." : "Error: " + data.error;
  } catch (err) {
    $("prompt-msg").textContent = "Error: " + err.message;
  } finally {
    $("run").disabled = false;
  }
});

function taskRow(t) {
  const li = document.createElement("li");
  const routeBadge = t.route ? `<span class="badge route">${t.route}</span>` : "";
  li.innerHTML =
    `<div class="task-top"><span class="task-id">${t.id}</span>` +
    `<span class="task-title">${t.title}</span>` +
    `<span class="badge ${t.status}">${t.status}</span>${routeBadge}</div>` +
    `<div class="task-sub">[${t.kind}/${t.risk}] attempts ${t.attempts}` +
    (t.routeReason ? ` · ${t.routeReason}` : "") +
    (t.spendUsd ? ` · ${usd(t.spendUsd)}` : "") + `</div>`;
  return li;
}

// --- progress view (polled) ---
async function refresh() {
  try {
    const s = await api("/api/status");
    $("spend-chip").textContent = usd(s.spend.total);

    const cap = s.caps.max_usd_per_project;
    const pct = cap > 0 ? Math.min(100, (s.spend.total / cap) * 100) : 0;
    const fill = $("budget-fill");
    fill.style.width = pct + "%";
    fill.className = pct >= 90 ? "max" : pct >= 70 ? "hot" : "";
    $("budget-label").textContent = `${usd(s.spend.total)} spent · ${usd(s.spend.remaining)} remaining of ${usd(cap)} · ${s.cloudCalls.project}/${s.cloudCalls.projectCap} calls`;

    $("run-state").textContent = s.run
      ? s.run.done
        ? `last run (${s.run.kind}) ${s.run.error ? "FAILED: " + s.run.error : "finished"}`
        : `running: ${s.run.kind}…`
      : "";

    for (const listId of ["progress-tasks", "prompt-tasks"]) {
      const ul = $(listId);
      ul.innerHTML = "";
      if (!s.tasks.length) {
        ul.innerHTML = `<li class="dim">No tasks yet — use the Prompt tab.</li>`;
      } else {
        s.tasks.forEach((t) => ul.appendChild(taskRow(t)));
      }
    }

    const ev = await api("/api/events?since=" + eventCursor);
    eventCursor = ev.next;
    const ul = $("events");
    for (const e of ev.events) {
      const li = document.createElement("li");
      li.className = e.type;
      li.textContent = `${e.ts.slice(11, 19)} ${e.type}` +
        (e.taskId ? ` ${e.taskId}` : "") +
        (e.type === "cost" ? ` $${e.usd.toFixed(6)} ${e.provider}${e.model ? ":" + e.model : ""}` : "") +
        (e.type === "cloud_call" ? ` ${e.provider}:${e.model} approved=${e.approved}` : "") +
        (e.title ? ` ${e.title}` : "") +
        (e.summary ? ` ${e.summary.slice(0, 120)}` : "");
      ul.prepend(li);
    }
  } catch {
    /* server restarting — retry next tick */
  }
}
setInterval(refresh, 2000);
refresh();

// --- models view ---
async function loadModels() {
  const data = await api("/api/models");
  const wrap = $("model-rows");
  wrap.innerHTML = "";
  for (const [role, profile] of Object.entries(data.roles)) {
    const row = document.createElement("div");
    row.className = "model-row";
    const options = data.providers
      .filter((p) => p !== "disabled")
      .map((p) => `<option value="${p}" ${p === profile.provider ? "selected" : ""}>${p}</option>`)
      .join("");
    row.innerHTML =
      `<label>${role}</label>` +
      `<div class="current">current: ${profile.provider}${profile.model ? ":" + profile.model : ""}</div>` +
      `<select>${options}</select>` +
      `<input placeholder="model (blank = provider default)" value="${profile.model ?? ""}">` +
      `<button>Save ${role}</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      const provider = row.querySelector("select").value;
      const model = row.querySelector("input").value.trim();
      const res = await fetch("/api/models/" + role, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: model || undefined }),
      });
      const out = await res.json();
      row.querySelector(".current").textContent = res.ok
        ? `saved: ${provider}${model ? ":" + model : ""}`
        : "Error: " + out.error;
    });
    wrap.appendChild(row);
  }

  const keys = $("keys");
  keys.innerHTML = "";
  for (const [name, k] of Object.entries(data.keys)) {
    const li = document.createElement("li");
    li.innerHTML = k.local
      ? `<strong>${name}</strong> — <span class="key-ok">local, no key needed</span>`
      : `<strong>${name}</strong> — ` +
        (k.configured
          ? `<span class="key-ok">configured</span>`
          : `<span class="key-missing">missing ${k.keyEnv}</span>`);
    keys.appendChild(li);
  }
}

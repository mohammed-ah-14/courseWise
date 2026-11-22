// Study tools page: focus timer, deadlines and to-do list.
import { ICONS, escapeHTML, initTabs, store, toast } from "./main.js";

const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

/* ==== Focus timer ======================================================== */
const MODES = { focus: { min: 25, label: "Focus" }, short: { min: 5, label: "Short break" }, long: { min: 15, label: "Long break" } };
const LONG_BREAK_EVERY = 4;
const RING = 2 * Math.PI * 54;
const SESSIONS_KEY = "cw-timer-sessions";
const pageTitle = document.title;

const timer = { mode: "focus", left: MODES.focus.min * 60, endsAt: null, tick: null };
let sessions = store.get(SESSIONS_KEY, { date: today(), count: 0 });
if (sessions.date !== today()) sessions = { date: today(), count: 0 };

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25, 0.5].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* no audio, so we skip */ }
}

function drawTimer() {
  const total = MODES[timer.mode].min * 60;
  $("timer-time").textContent = mmss(timer.left);
  $("timer-label").textContent = MODES[timer.mode].label;
  $("timer-progress").style.strokeDashoffset = RING * (1 - timer.left / total);
  $("timer-start").textContent = timer.tick ? "Pause" : timer.left < total ? "Resume" : "Start";
  $("timer-sessions").textContent = sessions.count;
  document.title = timer.tick ? `${mmss(timer.left)} · ${MODES[timer.mode].label}` : pageTitle;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === timer.mode));
}

function setMode(mode) {
  pause();
  timer.mode = mode;
  timer.left = MODES[mode].min * 60;
  drawTimer();
}

function pause() {
  clearInterval(timer.tick);
  timer.tick = null;
}

function finish() {
  pause();
  beep();
  if (timer.mode === "focus") {
    sessions.count += 1;
    store.set(SESSIONS_KEY, sessions);
    toast("Focus session done. Take a break.");
    setMode(sessions.count % LONG_BREAK_EVERY === 0 ? "long" : "short");
  } else {
    toast("Break over. Ready to focus?");
    setMode("focus");
  }
}

function start() {
  // Count from one fixed end time, so the timer still correct when the tab is in background.
  timer.endsAt = Date.now() + timer.left * 1000;
  timer.tick = setInterval(() => {
    timer.left = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
    if (timer.left === 0) finish();
    else drawTimer();
  }, 250);
  drawTimer();
}

function initTimer() {
  $("timer-progress").style.strokeDasharray = RING;
  $("timer-start").addEventListener("click", () => { timer.tick ? pause() : start(); drawTimer(); });
  $("timer-reset").addEventListener("click", () => setMode(timer.mode));
  $("timer-skip").addEventListener("click", finish);
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  drawTimer();
}

/* ==== Deadlines ========================================================== */
const DEADLINES_KEY = "cw-deadlines";
let deadlines = store.get(DEADLINES_KEY, []);

function countdown(ms) {
  if (ms < 0) return "Overdue";
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 6e4))} min`;
  if (h < 48) return `in ${h} hours`;
  return `in ${Math.round(h / 24)} days`;
}

function urgency(ms) {
  if (ms < 0 || ms < 2 * 8.64e7) return "hard";
  if (ms < 7 * 8.64e7) return "medium";
  return "easy";
}

function drawDeadlines() {
  const now = Date.now();
  const list = [...deadlines].sort((a, b) => a.due - b.due);
  $("d-count").textContent = list.length ? `${list.length} saved` : "";
  $("deadline-list").innerHTML = list.length ? list.map((d) => {
    const ms = d.due - now;
    const date = new Date(d.due).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<li class="deadline is-${urgency(ms)}">
      <span class="deadline-bar" aria-hidden="true"></span>
      <div class="deadline-body"><strong>${escapeHTML(d.title)}</strong><span class="subtle">${escapeHTML(d.type)} · ${date}</span></div>
      <span class="badge badge-${urgency(ms)}">${countdown(ms)}</span>
      <button class="btn btn-ghost btn-icon" type="button" data-id="${d.id}" aria-label="Delete ${escapeHTML(d.title)}">${ICONS.trash}</button>
    </li>`;
  }).join("") : `<li class="state">${ICONS.check}<p>Nothing due. Add your next exam or assignment.</p></li>`;
}

function initDeadlines() {
  $("deadline-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("d-title").value.trim();
    const due = new Date($("d-date").value).getTime();
    $("d-title-error").textContent = title ? "" : "Give it a name.";
    $("d-date-error").textContent = Number.isFinite(due) ? "" : "Pick a date and time.";
    $("d-title").setAttribute("aria-invalid", !title);
    $("d-date").setAttribute("aria-invalid", !Number.isFinite(due));
    if (!title || !Number.isFinite(due)) return;
    deadlines.push({ id: crypto.randomUUID?.() ?? String(Date.now()), title, type: $("d-type").value, due });
    store.set(DEADLINES_KEY, deadlines);
    e.target.reset();
    drawDeadlines();
    toast("Deadline added");
  });
  $("deadline-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-id]");
    if (!btn) return;
    deadlines = deadlines.filter((d) => d.id !== btn.dataset.id);
    store.set(DEADLINES_KEY, deadlines);
    drawDeadlines();
  });
  drawDeadlines();
  setInterval(drawDeadlines, 60_000);
}

/* ==== To-do ============================================================== */
const TODO_KEY = "cw-todos";
let todos = store.get(TODO_KEY, []);
let filter = "all";

function drawTodos() {
  const shown = todos.filter((t) => (filter === "all" ? true : filter === "done" ? t.done : !t.done));
  const left = todos.filter((t) => !t.done).length;
  $("todo-left").textContent = todos.length ? `${left} left` : "";
  $("todo-list").innerHTML = shown.length ? shown.map((t) => `
    <li class="todo-item${t.done ? " is-done" : ""}">
      <label class="check"><input type="checkbox" data-toggle="${t.id}"${t.done ? " checked" : ""}> <span>${escapeHTML(t.text)}</span></label>
      <button class="btn btn-ghost btn-icon" type="button" data-delete="${t.id}" aria-label="Delete task">${ICONS.x}</button>
    </li>`).join("")
    : `<li class="state"><p>${todos.length ? "Nothing in this view." : "No tasks yet."}</p></li>`;
  store.set(TODO_KEY, todos);
}

function initTodos() {
  $("todo-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("todo-input").value.trim();
    if (!text) return $("todo-input").focus();
    todos.unshift({ id: crypto.randomUUID?.() ?? String(Date.now()), text, done: false });
    $("todo-input").value = "";
    drawTodos();
  });
  $("todo-list").addEventListener("change", (e) => {
    const t = todos.find((x) => x.id === e.target.dataset.toggle);
    if (t) { t.done = e.target.checked; drawTodos(); }
  });
  $("todo-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-delete]");
    if (btn) { todos = todos.filter((t) => t.id !== btn.dataset.delete); drawTodos(); }
  });
  document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((o) => o.setAttribute("aria-pressed", o === b));
    drawTodos();
  }));
  $("todo-clear").addEventListener("click", () => { todos = todos.filter((t) => !t.done); drawTodos(); });
  drawTodos();
}

/* Init -------------------------------------------------------------------- */
initTabs(document.querySelector('[role="tablist"]'));
initTimer();
initDeadlines();
initTodos();

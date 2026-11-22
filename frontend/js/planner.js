// Planner page: user make one semester plan and see the workload.
import { getCourses } from "./data.js";
import { attachAutocomplete } from "./autocomplete.js";
import { barChart, PALETTE } from "./charts.js";
import { getList, setList, addToList, removeFromList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, courseUrl, store, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const META_KEY = "cw-planner-meta";
const MAX_COURSES = 8;
const DEFAULT_CREDITS = 3;
const LOAD = { light: 12, heavy: 19, max: 26 }; // workload points

let courses = new Map();
const meta = { cgpa: "", done: "", shift: 0, credits: {}, ...store.get(META_KEY, {}) };

const saveMeta = () => store.set(META_KEY, meta);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Model ------------------------------------------------------------------- */
function planRows() {
  return getList("planner").map((id) => courses.get(id)).filter(Boolean).map((c) => ({
    course: c,
    credits: Number(meta.credits[c.id] ?? c.credits ?? DEFAULT_CREDITS),
    gpa: c.predGpa ?? c.avgGpa,
    predicted: c.predGpa != null,
    difficulty: c.predDifficulty ?? c.difficulty,
  }));
}

function summarise(rows) {
  const credits = rows.reduce((s, r) => s + r.credits, 0);
  const termGpa = credits ? rows.reduce((s, r) => s + r.credits * clamp(r.gpa + meta.shift, 0, 4), 0) / credits : null;
  const cgpa = parseFloat(meta.cgpa);
  const done = parseFloat(meta.done);
  const hasHistory = Number.isFinite(cgpa) && Number.isFinite(done) && done > 0;
  const newCgpa = termGpa == null ? null : hasHistory ? (cgpa * done + termGpa * credits) / (done + credits) : termGpa;
  const hard = rows.filter((r) => r.difficulty === "Hard");
  const risky = rows.filter((r) => r.course.highRisk);
  const points = credits + 2 * hard.length + risky.length;
  return { credits, termGpa, newCgpa, cgpa: hasHistory ? cgpa : null, hard, risky, points };
}

/* Rendering --------------------------------------------------------------- */
function renderList(rows) {
  $("slots").textContent = `${rows.length} of ${MAX_COURSES} courses`;
  $("plan-list").innerHTML = rows.length ? rows.map((r) => `
    <li class="plan-row">
      <div class="plan-course">
        <a href="${courseUrl(r.course.id)}"><strong>${escapeHTML(r.course.code)}</strong></a>
        <span>${escapeHTML(r.course.title)}</span>
      </div>
      <label class="plan-credits"><span class="visually-hidden">Credits for ${escapeHTML(r.course.code)}</span>
        <input class="input input-sm num" type="number" min="0" max="12" step="1" value="${r.credits}" data-credits="${r.course.id}"> <span class="subtle">cr</span></label>
      <div class="plan-gpa"><strong class="num">${fmt.gpa(clamp(r.gpa + meta.shift, 0, 4))}</strong><span class="subtle">${r.predicted ? "predicted" : "history"}</span></div>
      ${difficultyBadge(r.difficulty)}
      <button class="btn btn-ghost btn-icon" type="button" data-remove="${r.course.id}" aria-label="Remove ${escapeHTML(r.course.code)}">${ICONS.x}</button>
    </li>`).join("")
    : `<li class="state">${ICONS.plus}<p>No courses yet. Add one above, or from the <a href="explorer.html">explorer</a>.</p></li>`;
}

function workload(points, credits) {
  if (!credits) return { label: "–", cls: "", detail: "" };
  const label = points < LOAD.light ? "Light" : points < LOAD.heavy ? "Balanced" : "Heavy";
  const cls = { Light: "is-easy", Balanced: "is-medium", Heavy: "is-hard" }[label];
  return { label, cls, detail: `${fmt.credits(credits)} credit hours, with extra weight for hard and high-DFW courses.` };
}

function warnings(s) {
  const out = [];
  if (s.credits > 18) out.push(["is-danger", `${s.credits} credit hours is above the usual 18-hour limit.`]);
  if (s.hard.length >= 2) out.push(["is-warn", `${s.hard.length} hard courses: ${s.hard.map((r) => r.course.code).join(", ")}. Consider spreading them over two terms.`]);
  if (s.risky.length) out.push(["is-warn", `High DFW rate: ${s.risky.map((r) => r.course.code).join(", ")}.`]);
  if (s.credits && s.credits < 12) out.push(["", `${s.credits} credit hours is below a full-time load (12).`]);
  return out.map(([cls, text]) => `<div class="note ${cls}">${cls ? ICONS.warn : ICONS.info}<span>${escapeHTML(text)}</span></div>`).join("");
}

function renderSummary(rows) {
  const s = summarise(rows);
  $("term-gpa").textContent = fmt.gpa(s.termGpa);
  $("new-cgpa").textContent = fmt.gpa(s.newCgpa);
  const delta = s.cgpa != null && s.newCgpa != null ? s.newCgpa - s.cgpa : null;
  $("cgpa-delta").textContent = delta == null ? (s.termGpa == null ? "" : "Add your CGPA for a cumulative estimate") : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} from ${fmt.gpa(s.cgpa)}`;

  const load = workload(s.points, s.credits);
  $("load-label").textContent = load.label;
  $("load-meter").className = `meter ${load.cls}`;
  $("load-meter").firstElementChild.style.width = `${s.credits ? Math.min(100, (s.points / LOAD.max) * 100) : 0}%`;
  $("load-detail").textContent = load.detail;
  $("warnings").innerHTML = warnings(s);

  const chart = $("plan-chart");
  chart.hidden = s.termGpa == null;
  if (s.termGpa != null) {
    const labels = ["Current CGPA", "Term GPA", "New CGPA"];
    const values = [s.cgpa, s.termGpa, s.newCgpa];
    barChart(chart, {
      labels, height: 180, yMin: 0, yMax: 4, showValues: true, format: (v) => v.toFixed(2), label: "CGPA comparison",
      series: [{ name: "GPA", values, colors: [PALETTE.muted, PALETTE.brand, PALETTE.ink] }],
    });
  }
}

function render() {
  const rows = planRows();
  renderList(rows);
  renderSummary(rows);
  const out = meta.shift;
  $("shift-out").textContent = out === 0 ? "±0.00" : `${out > 0 ? "+" : "−"}${Math.abs(out).toFixed(2)}`;
}

/* Inputs ------------------------------------------------------------------ */
function validateNumber(id, max, message) {
  const el = $(id);
  const raw = el.value.trim();
  const v = Number(raw);
  const ok = raw === "" || (Number.isFinite(v) && v >= 0 && v <= max);
  el.setAttribute("aria-invalid", !ok);
  $(`${id}-error`).textContent = ok ? "" : message;
  return ok ? raw : null;
}

function bind() {
  $("cgpa").value = meta.cgpa;
  $("done").value = meta.done;
  $("shift").value = meta.shift;

  $("cgpa").addEventListener("input", () => {
    const v = validateNumber("cgpa", 4, "Enter a CGPA between 0 and 4.");
    if (v !== null) { meta.cgpa = v; saveMeta(); render(); }
  });
  $("done").addEventListener("input", () => {
    const v = validateNumber("done", 250, "Enter a number of hours between 0 and 250.");
    if (v !== null) { meta.done = v; saveMeta(); render(); }
  });
  $("shift").addEventListener("input", (e) => { meta.shift = Number(e.target.value); saveMeta(); render(); });

  $("plan-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    removeFromList("planner", btn.dataset.remove);
    delete meta.credits[btn.dataset.remove];
    saveMeta();
    render();
  });
  $("plan-list").addEventListener("change", (e) => {
    const id = e.target.dataset.credits;
    if (!id) return;
    meta.credits[id] = clamp(Number(e.target.value) || 0, 0, 12);
    saveMeta();
    render();
  });
  $("print").addEventListener("click", () => window.print());
  $("clear").addEventListener("click", () => {
    setList("planner", []);
    meta.credits = {};
    meta.shift = 0;
    $("shift").value = 0;
    saveMeta();
    render();
  });
  attachAutocomplete($("add"), {
    getCourses: () => [...courses.values()],
    clearOnSelect: true,
    onSelect: (c) => { if (addToList("planner", c.id)) render(); },
  });
}

async function init() {
  bind();
  try {
    courses = new Map((await getCourses()).map((c) => [c.id, c]));
    render();
  } catch (err) {
    console.error(err);
    $("plan-list").innerHTML = `<li>${errorState()}</li>`;
  }
}

init();

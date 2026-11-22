// GPA calculator page: term GPA, cumulative GPA and target GPA.
import { ICONS, escapeHTML, fmt, initTabs, store } from "./main.js";

const $ = (id) => document.getElementById(id);
const ROWS_KEY = "cw-gpa-rows";
const SCALE = { "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7, "C+": 2.3, "C": 2.0, "C-": 1.7, "D+": 1.3, "D": 1.0, "F": 0.0 };
const blankRow = () => ({ name: "", credits: 3, grade: "" });

let rows = store.get(ROWS_KEY, null) || [blankRow(), blankRow(), blankRow(), blankRow()];
let lastTerm = null; // save the last term result: { gpa, credits }

/* Term GPA ---------------------------------------------------------------- */
const gradeOptions = (selected) => `<option value="">–</option>${Object.keys(SCALE)
  .map((g) => `<option${g === selected ? " selected" : ""}>${g}</option>`).join("")}`;

function renderRows() {
  $("term-rows").innerHTML = rows.map((r, i) => `
    <li class="gpa-row" data-i="${i}">
      <label class="visually-hidden" for="r-name-${i}">Course ${i + 1} name</label>
      <input class="input input-sm" id="r-name-${i}" data-key="name" type="text" placeholder="Course ${i + 1}" value="${escapeHTML(r.name)}">
      <label class="visually-hidden" for="r-cr-${i}">Credits</label>
      <input class="input input-sm num" id="r-cr-${i}" data-key="credits" type="number" min="0" max="12" step="1" value="${r.credits}">
      <label class="visually-hidden" for="r-gr-${i}">Grade</label>
      <select class="select input-sm" id="r-gr-${i}" data-key="grade">${gradeOptions(r.grade)}</select>
      <button class="btn btn-ghost btn-icon" type="button" data-remove aria-label="Remove row ${i + 1}">${ICONS.x}</button>
    </li>`).join("");
}

function computeTerm() {
  const counted = rows.filter((r) => r.grade && r.credits > 0);
  const credits = counted.reduce((s, r) => s + Number(r.credits), 0);
  const points = counted.reduce((s, r) => s + Number(r.credits) * SCALE[r.grade], 0);
  lastTerm = credits ? { gpa: points / credits, credits } : null;
  $("term-gpa").textContent = lastTerm ? fmt.gpa(lastTerm.gpa) : "–";
  $("term-credits").textContent = fmt.credits(credits);
  $("term-points").textContent = points.toFixed(1);
  store.set(ROWS_KEY, rows);
}

function bindTerm() {
  const list = $("term-rows");
  list.addEventListener("input", (e) => {
    const i = Number(e.target.closest(".gpa-row")?.dataset.i);
    const key = e.target.dataset.key;
    if (!key) return;
    rows[i][key] = key === "credits" ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
    computeTerm();
  });
  list.addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]")) return;
    rows.splice(Number(e.target.closest(".gpa-row").dataset.i), 1);
    if (!rows.length) rows.push(blankRow());
    renderRows();
    computeTerm();
  });
  $("add-row").addEventListener("click", () => {
    rows.push(blankRow());
    renderRows();
    computeTerm();
    $(`r-name-${rows.length - 1}`).focus();
  });
  $("reset-rows").addEventListener("click", () => {
    rows = [blankRow(), blankRow(), blankRow(), blankRow()];
    renderRows();
    computeTerm();
  });
}

/* Reading numbers (shared) ---------------------------------------------------- */
function read(ids, errorId) {
  const values = ids.map((id) => ($(id).value.trim() === "" ? null : Number($(id).value)));
  if (values.some((v) => v == null)) { $(errorId).textContent = ""; return null; }
  const bad = ids.find((id, i) => !Number.isFinite(values[i]) || values[i] < 0 || ($(id).max && values[i] > Number($(id).max)));
  ids.forEach((id) => $(id).setAttribute("aria-invalid", id === bad));
  $(errorId).textContent = bad ? `Check “${document.querySelector(`label[for="${bad}"]`).textContent}”.` : "";
  return bad ? null : values;
}

/* Cumulative --------------------------------------------------------------- */
function computeCumulative() {
  const v = read(["c-cgpa", "c-done", "c-term", "c-credits"], "cum-error");
  if (!v) { ["cum-result", "cum-delta", "cum-hours"].forEach((id) => { $(id).textContent = "–"; }); return; }
  const [cgpa, done, term, credits] = v;
  const total = done + credits;
  const result = total ? (cgpa * done + term * credits) / total : 0;
  const delta = result - cgpa;
  $("cum-result").textContent = fmt.gpa(result);
  $("cum-delta").textContent = `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;
  $("cum-hours").textContent = fmt.int(total);
}

/* Target ------------------------------------------------------------------- */
function computeTarget() {
  const v = read(["g-cgpa", "g-done", "g-target", "g-credits"], "target-error");
  const box = $("target-result");
  box.className = "target-result";
  if (!v) { $("target-need").textContent = "–"; $("target-text").textContent = ""; return; }
  const [cgpa, done, target, credits] = v;
  if (!credits) { $("target-error").textContent = "Next term needs at least one credit hour."; return; }
  const need = (target * (done + credits) - cgpa * done) / credits;
  $("target-need").textContent = fmt.gpa(Math.max(0, need));
  let text;
  if (need > 4) {
    box.classList.add("is-hard");
    const terms = Math.ceil((target * done - cgpa * done) / (credits * (4 - target)) + 1e-9);
    text = `Not reachable in one term, even with a 4.00. At ${credits} hours per term with straight A's, it would take about ${Number.isFinite(terms) && terms > 0 ? terms : "several"} terms.`;
  } else if (need <= cgpa) {
    box.classList.add("is-easy");
    text = need <= 0 ? "You are already above this target." : `Keep a term GPA of ${fmt.gpa(need)} or higher. That is at or below your current average.`;
  } else {
    box.classList.add(need > 3.5 ? "is-medium" : "is-easy");
    text = `Aim for a term GPA of at least ${fmt.gpa(need)} over ${credits} credit hours.`;
  }
  $("target-text").textContent = text;
}

/* Init -------------------------------------------------------------------- */
function init() {
  $("scale-body").innerHTML = Object.entries(SCALE).map(([g, p]) => `<tr><td>${g}</td><td class="num">${p.toFixed(1)}</td></tr>`).join("");
  renderRows();
  bindTerm();
  computeTerm();
  $("tab-cum").addEventListener("input", computeCumulative);
  $("tab-target").addEventListener("input", computeTarget);
  ["tab-cum", "tab-target"].forEach((id) => $(id).addEventListener("submit", (e) => e.preventDefault()));
  $("use-term").addEventListener("click", () => {
    if (!lastTerm) { $("cum-error").textContent = "Fill in the Term GPA tab first."; return; }
    $("c-term").value = lastTerm.gpa.toFixed(2);
    $("c-credits").value = lastTerm.credits;
    computeCumulative();
  });
  initTabs(document.querySelector('[role="tablist"]'));
}

init();

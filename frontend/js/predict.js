import { getCourses, getCourseDetail } from "./data.js";
import { attachAutocomplete } from "./autocomplete.js";
import { addToList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, scaleHTML, courseUrl, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const DIFFICULTY = ["Hard", "Medium", "Easy"];
const DFW_METER_MAX = 30; // % at which the DFW meter is full

let courses = [];
let selected = null; // { course, detail }

/* Averaging over instructors (class-size weighted) ------------------------ */
function weighted(rows, key) {
  const total = rows.reduce((s, r) => s + r.students, 0);
  return rows.reduce((s, r) => s + r[key] * r.students, 0) / total;
}

function combine(rows) {
  if (rows.length === 1) return rows[0];
  const code = (key) => DIFFICULTY[Math.round(weighted(rows.map((r) => ({ ...r, v: DIFFICULTY.indexOf(r[key]) })), "v"))];
  return {
    term: rows[0].term,
    instructor: `Any instructor (${rows.length} sections)`,
    students: rows.reduce((s, r) => s + r.students, 0),
    gpa: weighted(rows, "gpa"),
    dfw: weighted(rows, "dfw"),
    difficulty: code("difficulty"),
    highRisk: weighted(rows.map((r) => ({ ...r, v: r.highRisk ? 1 : 0 })), "v") >= 0.5,
    actualGpa: weighted(rows, "actualGpa"),
    actualDfw: weighted(rows, "actualDfw"),
    actualDifficulty: code("actualDifficulty"),
  };
}

/* Form -------------------------------------------------------------------- */
function setError(id, message) {
  $(`${id}-error`).textContent = message;
  $(id).setAttribute("aria-invalid", Boolean(message));
}

function fillTerms(predictions) {
  const terms = [...new Map(predictions.map((p) => [p.termKey, p.term])).entries()];
  const term = $("p-term");
  term.innerHTML = terms.map(([key, label]) => `<option value="${key}">${escapeHTML(label)}</option>`).join("");
  term.value = terms.at(-1)[0];
  term.disabled = false;
  fillInstructors();
}

function fillInstructors() {
  const rows = selected.detail.predictions.filter((p) => p.termKey === $("p-term").value);
  const select = $("p-instructor");
  select.innerHTML = `<option value="">Any instructor</option>${rows
    .map((p) => `<option value="${escapeHTML(p.instructor)}">${escapeHTML(p.instructor)}</option>`).join("")}`;
  select.disabled = rows.length < 2;
  if (rows.length === 1) select.value = rows[0].instructor;
}

async function selectCourse(course) {
  setError("p-course", "");
  $("p-course").value = course.code;
  $("p-term").disabled = true;
  $("p-term").innerHTML = "<option>Loading terms…</option>";
  try {
    selected = { course, detail: await getCourseDetail(course) };
    fillTerms(selected.detail.predictions);
  } catch (err) {
    console.error(err);
    $("result").innerHTML = errorState();
  }
}

function onSubmit(e) {
  e.preventDefault();
  const typed = $("p-course").value.trim().toLowerCase().replace(/\s+/g, "");
  if (!selected || selected.course.code.toLowerCase().replace(/\s+/g, "") !== typed) {
    selected = null;
    setError("p-course", typed ? "Choose a course from the list." : "Enter a course.");
    $("p-course").focus();
    return;
  }
  if (!$("p-term").value) {
    setError("p-term", "Choose a term.");
    return;
  }
  setError("p-term", "");
  const term = $("p-term").value;
  const instructor = $("p-instructor").value;
  const rows = selected.detail.predictions.filter((p) => p.termKey === term && (!instructor || p.instructor === instructor));
  renderResult(selected.course, selected.detail, combine(rows));
  history.replaceState(null, "", `?id=${selected.course.id}`);
}

/* Result ------------------------------------------------------------------ */
function renderResult(course, detail, p) {
  const instructorHistory = detail.instructors.find((i) => i.name === p.instructor);
  const error = p.gpa - p.actualGpa;
  const meter = (v) => Math.min(100, (v / DFW_METER_MAX) * 100);
  const level = p.difficulty.toLowerCase();

  $("result").innerHTML = `
    <article class="panel result">
      <header class="result-head">
        <div>
          <span class="eyebrow">${escapeHTML(p.term)}</span>
          <h2><a href="${courseUrl(course.id)}">${escapeHTML(course.code)}</a> ${escapeHTML(course.title)}</h2>
          <p class="subtle">${escapeHTML(p.instructor)} · ${fmt.int(p.students)} students</p>
        </div>
        ${difficultyBadge(p.difficulty)}
      </header>

      <div class="result-main">
        <div class="stat"><span class="stat-label">Predicted average GPA</span><span class="stat-value result-big">${fmt.gpa(p.gpa)}</span></div>
        ${scaleHTML([
          { value: course.avgGpa, label: `5-yr avg ${fmt.gpa(course.avgGpa)}`, variant: "is-ghost" },
          { value: p.gpa, label: `Predicted ${fmt.gpa(p.gpa)}`, variant: "is-brand" },
        ], { from: 1.5, to: 4 })}
      </div>

      <div class="grid grid-2 result-metrics">
        <div class="stack">
          <div class="spread"><span class="stat-label subtle">Predicted DFW rate</span><strong class="num">${fmt.pct(p.dfw)}</strong></div>
          <div class="meter is-${level}"><span style="width:${meter(p.dfw)}%"></span></div>
          <span class="subtle result-small">${p.highRisk ? "Among the 20% of offerings with the most D, F and W grades." : "Not in the top 20% for D, F and W grades."}</span>
        </div>
        <div class="stack">
          <span class="stat-label subtle">Context</span>
          <ul class="context-list" role="list">
            <li><span>Course, last 5 years</span><strong class="num">${fmt.gpa(course.avgGpa)}</strong></li>
            ${instructorHistory ? `<li><span>This instructor, this course</span><strong class="num">${fmt.gpa(instructorHistory.gpa)}</strong></li>` : ""}
            <li><span>Course DFW, last 5 years</span><strong class="num">${fmt.pct(course.dfw)}</strong></li>
          </ul>
        </div>
      </div>

      <div class="result-actual">
        <div class="spread">
          <strong>What actually happened</strong>
          <span class="subtle result-small">Held out from training</span>
        </div>
        <dl class="result-actual-grid">
          <div><dt>Actual GPA</dt><dd class="num">${fmt.gpa(p.actualGpa)}</dd></div>
          <div><dt>Actual DFW</dt><dd class="num">${fmt.pct(p.actualDfw)}</dd></div>
          <div><dt>Model error</dt><dd class="num">${error >= 0 ? "+" : "−"}${Math.abs(error).toFixed(2)}</dd></div>
          <div><dt>Actual label</dt><dd>${difficultyBadge(p.actualDifficulty)}</dd></div>
        </dl>
      </div>

      <div class="note">${ICONS.info}<span>This describes the course offering on average, not your personal grade.</span></div>

      <div class="row">
        <button class="btn btn-primary" type="button" id="r-plan">${ICONS.plus} Add to planner</button>
        <a class="btn btn-outline" href="${courseUrl(course.id)}">Course details</a>
      </div>
    </article>`;
  $("r-plan").addEventListener("click", () => addToList("planner", course.id));
}

/* Init -------------------------------------------------------------------- */
async function init() {
  $("predict-form").addEventListener("submit", onSubmit);
  $("p-term").addEventListener("change", fillInstructors);
  attachAutocomplete($("p-course"), {
    getCourses: () => courses,
    filter: (c) => c.predGpa != null,
    onSelect: selectCourse,
  });
  try {
    courses = await getCourses();
    const id = new URLSearchParams(location.search).get("id");
    const preset = courses.find((c) => c.id === id && c.predGpa != null);
    if (preset) {
      await selectCourse(preset);
      $("predict-form").requestSubmit();
    }
  } catch (err) {
    console.error(err);
    $("result").innerHTML = errorState();
  }
}

init();

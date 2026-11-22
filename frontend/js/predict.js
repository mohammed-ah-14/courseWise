// Predictor page: guess the difficulty of one course for a term (live model or old test term).
import { getCourses, getCourseDetail, getLiveModel, getForecastOptions, getForecast } from "./data.js";
import { attachAutocomplete } from "./autocomplete.js";
import { addToList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, scaleHTML, courseUrl, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const DIFFICULTY = ["Hard", "Medium", "Easy"];
const DFW_METER_MAX = 30; // % when the DFW meter become full
// Term option values: "live:2026-fa" = forecast from the running model, "test:2025-fa" = old test term that the model never see in training.
const LIVE = "live";
const TEST = "test";
const FORMAT_LABELS = { "in-person": "in person", online: "online" };

let courses = [];
let live = null; // health info from the live model, or null if it is not running
let selected = null; // { course, detail, options }
let request = 0; // id of the newest forecast request; we ignore the older answers

const termKind = () => $("p-term").value.split(":")[0];
const termKey = () => $("p-term").value.split(":")[1];

/* Average the test predictions for all instructors (use class size as weight) --- */
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

function renderLiveStatus() {
  $("p-live").innerHTML = live
    ? `<span class="live-dot is-on" aria-hidden="true"></span>Live model · trained on grades up to ${escapeHTML(live.dataUntil)}`
    : `<span class="live-dot" aria-hidden="true"></span>Live model offline · showing held-out 2025–2026 predictions. Run <code>python3 -m coursewise serve</code> for upcoming terms.`;
  $("p-course-hint").textContent = live
    ? "Any course offered since 2016."
    : "Only courses with a prediction for 2025–2026 are listed.";
}

const option = (value, label) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;

function fillTerms() {
  const upcoming = selected.options?.terms ?? [];
  const past = [...new Map(selected.detail.predictions.map((p) => [p.termKey, p.term])).entries()];
  const term = $("p-term");
  if (!upcoming.length && !past.length) {
    term.innerHTML = "<option value=''>No prediction for this course</option>";
    setError("p-term", "The model has no prediction for this course yet.");
    return;
  }
  const group = (label, items) => (items.length ? `<optgroup label="${label}">${items.join("")}</optgroup>` : "");
  term.innerHTML =
    group("Upcoming · live forecast", upcoming.map((t) => option(`${LIVE}:${t.key}`, t.label))) +
    group("Held out · compare with what happened", past.map(([key, label]) => option(`${TEST}:${key}`, label)));
  term.value = upcoming.length ? `${LIVE}:${upcoming[0].key}` : `${TEST}:${past.at(-1)[0]}`;
  term.disabled = false;
  setError("p-term", "");
  onTermChange();
}

function fillInstructors() {
  const isLive = termKind() === LIVE;
  const names = isLive
    ? selected.options.instructors.map((i) => i.name)
    : selected.detail.predictions.filter((p) => p.termKey === termKey()).map((p) => p.instructor);
  const select = $("p-instructor");
  const previous = select.value;
  select.innerHTML = option("", "Any instructor") + names.map((n) => option(n, n)).join("");
  select.disabled = names.length < 2;
  if (names.length === 1) select.value = names[0];
  else if (names.includes(previous)) select.value = previous;
  $("p-instructor-hint").textContent = isLive
    ? "“Any instructor” averages the instructors of the course’s last two years, weighted by students."
    : "“Any instructor” averages all sections of that term by class size.";
}

function onTermChange() {
  const isLive = termKind() === LIVE;
  $("p-format-field").hidden = !isLive;
  if (isLive) $("p-format").options[0].textContent = `Usual format (${FORMAT_LABELS[selected.options.usualFormat]})`;
  fillInstructors();
}

async function selectCourse(course) {
  setError("p-course", "");
  $("p-course").value = course.code;
  $("p-term").disabled = true;
  $("p-term").innerHTML = "<option>Loading terms…</option>";
  try {
    const [detail, options] = await Promise.all([
      getCourseDetail(course),
      live ? getForecastOptions(course.id).catch(() => null) : null,
    ]);
    selected = { course, detail, options };
    fillTerms();
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
  history.replaceState(null, "", `?id=${selected.course.id}`);
  const instructor = $("p-instructor").value;
  if (termKind() === LIVE) {
    showForecast(instructor, $("p-format").value);
    return;
  }
  const rows = selected.detail.predictions.filter((p) => p.termKey === termKey() && (!instructor || p.instructor === instructor));
  renderResult(selected.course, selected.detail, combine(rows));
}

/* Live forecast ----------------------------------------------------------- */
function stateHTML(icon, message) {
  return `<div class="panel result-empty">${icon}<p>${escapeHTML(message)}</p></div>`;
}

async function showForecast(instructor, format) {
  const id = ++request;
  const { course, detail, options } = selected;
  $("result").innerHTML = stateHTML('<div class="spinner" aria-hidden="true"></div>', "Running the model…");
  try {
    const f = await getForecast({ course: course.id, term: termKey(), instructor, format });
    if (id !== request) return;
    renderResult(course, detail, {
      term: f.term.label,
      instructor: f.instructor ?? `Any instructor (${f.sections.length})`,
      subline: FORMAT_LABELS[f.format ?? options.usualFormat],
      gpa: f.gpa,
      dfw: f.dfw,
      difficulty: f.difficulty,
      highRisk: f.highRisk,
      forecast: f,
    });
  } catch (err) {
    if (id !== request) return;
    console.error(err);
    $("result").innerHTML = stateHTML(ICONS.warn, `The live model could not answer: ${err.message}`);
  }
}

function forecastHTML(f) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const chances = DIFFICULTY.map((d) => `<div><dt>${d}</dt><dd class="num">${pct(f.difficultyProbabilities[d])}</dd></div>`).join("");
  return `
      <div class="result-actual">
        <div class="spread">
          <strong>How sure the model is</strong>
          <span class="subtle result-small">Uses grades up to ${escapeHTML(f.dataUntil)}</span>
        </div>
        <dl class="result-actual-grid">
          ${chances}
          <div><dt>High-risk chance</dt><dd class="num">${pct(f.highRiskProbability)}</dd></div>
        </dl>
      </div>
      ${f.newPair ? `<div class="note is-warn">${ICONS.info}<span>This instructor has not taught this course before, so the forecast leans on their other courses and the course’s own history.</span></div>` : ""}`;
}

/* Result ------------------------------------------------------------------ */
function actualHTML(p) {
  const error = p.gpa - p.actualGpa;
  return `
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
      </div>`;
}

function riskText(p) {
  const top = "the 20% of offerings with the most D, F and W grades";
  if (!p.forecast) return p.highRisk ? `Among ${top}.` : `Not in ${top}.`;
  const chance = Math.round(p.forecast.highRiskProbability * 100);
  return `${p.highRisk ? "Flagged as high risk" : "Not flagged"}: ${chance}% chance of being among ${top}.`;
}

function renderResult(course, detail, p) {
  const instructorHistory = detail.instructors.find((i) => i.name === p.instructor);
  const meter = (v) => Math.min(100, (v / DFW_METER_MAX) * 100);
  const level = p.difficulty.toLowerCase();
  const subline = p.forecast ? p.subline : `${fmt.int(p.students)} students`;

  $("result").innerHTML = `
    <article class="panel result">
      <header class="result-head">
        <div>
          <span class="eyebrow">${escapeHTML(p.term)}${p.forecast ? " · forecast" : ""}</span>
          <h2><a href="${courseUrl(course.id)}">${escapeHTML(course.code)}</a> ${escapeHTML(course.title)}</h2>
          <p class="subtle">${escapeHTML(p.instructor)} · ${escapeHTML(subline)}</p>
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
          <span class="subtle result-small">${riskText(p)}</span>
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

      ${p.forecast ? forecastHTML(p.forecast) : actualHTML(p)}

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
  $("p-term").addEventListener("change", onTermChange);
  attachAutocomplete($("p-course"), {
    getCourses: () => courses,
    filter: (c) => Boolean(live) || c.predGpa != null,
    onSelect: selectCourse,
  });
  try {
    [courses, live] = await Promise.all([getCourses(), getLiveModel()]);
    renderLiveStatus();
    const id = new URLSearchParams(location.search).get("id");
    const preset = courses.find((c) => c.id === id && (live || c.predGpa != null));
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

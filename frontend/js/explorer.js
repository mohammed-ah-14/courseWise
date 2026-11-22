// Explorer page: search, filter and show all the courses, with a view switch.
import { getCourses } from "./data.js";
import { addToList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, courseUrl, debounce, errorState, store } from "./main.js";

const PAGE_SIZE = 24;
const VIEW_KEY = "cw-explorer-view";
const $ = (id) => document.getElementById(id);

const state = {
  q: "", group: "", subject: "", levels: new Set(), difficulty: new Set(),
  credits: "", gened: "", predicted: false, sort: "code", view: store.get(VIEW_KEY, "grid"), shown: PAGE_SIZE,
};
let courses = [];

/* Filtering --------------------------------------------------------------- */
const SORTERS = {
  code: (a, b) => a.subject.localeCompare(b.subject) || a.code.localeCompare(b.code, undefined, { numeric: true }),
  "gpa-asc": (a, b) => a.avgGpa - b.avgGpa,
  "gpa-desc": (a, b) => b.avgGpa - a.avgGpa,
  "dfw-desc": (a, b) => b.dfw - a.dfw,
  "size-desc": (a, b) => b.classSize - a.classSize,
};

function matches(c) {
  const q = state.q.toLowerCase().replace(/\s+/g, "");
  if (q && !c.code.toLowerCase().replace(/\s+/g, "").includes(q) && !c.title.toLowerCase().replace(/\s+/g, "").includes(q)) return false;
  if (state.group && c.group !== state.group) return false;
  if (state.subject && c.subject !== state.subject) return false;
  if (state.levels.size && !state.levels.has(String(c.level))) return false;
  if (state.difficulty.size && !state.difficulty.has(c.difficulty)) return false;
  if (state.credits) {
    const want = Number(state.credits);
    if (c.credits == null || (want === 5 ? c.credits < 5 : c.credits !== want)) return false;
  }
  if (state.gened && !c.gened.includes(state.gened)) return false;
  if (state.predicted && c.predGpa == null) return false;
  return true;
}

/* Rendering --------------------------------------------------------------- */
function card(c) {
  return `<article class="course-card">
    <div class="spread">
      <a class="course-card-code" href="${courseUrl(c.id)}">${escapeHTML(c.code)}</a>
      ${difficultyBadge(c.difficulty)}
    </div>
    <p class="course-card-title">${escapeHTML(c.title)}</p>
    <div class="mini-scale" aria-hidden="true"><i style="left:${Math.max(0, ((c.avgGpa - 2) / 2) * 100)}%"></i></div>
    <dl class="course-card-stats">
      <div><dt>Avg GPA</dt><dd class="num">${fmt.gpa(c.avgGpa)}</dd></div>
      <div><dt>DFW</dt><dd class="num">${fmt.pct(c.dfw)}</dd></div>
      <div><dt>Credits</dt><dd class="num">${fmt.credits(c.credits)}</dd></div>
    </dl>
    <div class="course-card-actions">
      <a class="link-arrow" href="${courseUrl(c.id)}">Details ${ICONS.arrow}</a>
      <span class="row">
        <button class="btn btn-ghost btn-sm" type="button" data-add="compare" data-id="${c.id}">Compare</button>
        <button class="btn btn-outline btn-sm" type="button" data-add="planner" data-id="${c.id}">${ICONS.plus} Plan</button>
      </span>
    </div>
  </article>`;
}

function table(list) {
  const rows = list.map((c) => `<tr>
    <td><a class="code" href="${courseUrl(c.id)}">${escapeHTML(c.code)}</a><span class="sub">${escapeHTML(c.title)}</span></td>
    <td>${c.level === 500 ? "Grad" : c.level}</td>
    <td class="num">${fmt.credits(c.credits)}</td>
    <td class="num">${fmt.gpa(c.avgGpa)}</td>
    <td class="num">${fmt.pct(c.dfw)}</td>
    <td class="num">${fmt.int(c.classSize)}</td>
    <td>${difficultyBadge(c.difficulty)}</td>
    <td><button class="btn btn-ghost btn-sm" type="button" data-add="planner" data-id="${c.id}" aria-label="Add ${escapeHTML(c.code)} to planner">${ICONS.plus}</button></td>
  </tr>`).join("");
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Course</th><th>Level</th><th class="num">Credits</th><th class="num">Avg GPA</th><th class="num">DFW</th><th class="num">Class size</th><th>Difficulty</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function render() {
  const list = courses.filter(matches).sort(SORTERS[state.sort]);
  const page = list.slice(0, state.shown);
  $("count").textContent = list.length
    ? `Showing ${fmt.int(page.length)} of ${fmt.int(list.length)} courses`
    : "No courses match these filters.";
  $("results").innerHTML = !list.length
    ? `<div class="state">${ICONS.search}<p>Try removing a filter or searching for a different code.</p></div>`
    : state.view === "grid" ? `<div class="course-grid">${page.map(card).join("")}</div>` : table(page);
  $("more").hidden = list.length <= state.shown;
  syncUrl();
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.subject) params.set("subject", state.subject);
  if (state.group) params.set("group", state.group);
  history.replaceState(null, "", params.size ? `?${params}` : location.pathname);
}

/* Controls ---------------------------------------------------------------- */
function fillSelect(el, values) {
  el.insertAdjacentHTML("beforeend", values.map((v) => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join(""));
}

function setView(view) {
  state.view = view;
  store.set(VIEW_KEY, view);
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
}

function update(changes) {
  Object.assign(state, changes, { shown: PAGE_SIZE });
  render();
}

function bindControls() {
  $("q").addEventListener("input", debounce((e) => update({ q: e.target.value.trim() }), 120));
  $("f-group").addEventListener("change", (e) => update({ group: e.target.value }));
  $("f-subject").addEventListener("change", (e) => update({ subject: e.target.value }));
  $("f-credits").addEventListener("change", (e) => update({ credits: e.target.value }));
  $("f-gened").addEventListener("change", (e) => update({ gened: e.target.value }));
  $("f-predicted").addEventListener("change", (e) => update({ predicted: e.target.checked }));
  $("sort").addEventListener("change", (e) => update({ sort: e.target.value }));
  $("f-level").addEventListener("change", (e) => {
    e.target.checked ? state.levels.add(e.target.value) : state.levels.delete(e.target.value);
    update({});
  });
  $("f-difficulty").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const on = chip.getAttribute("aria-pressed") !== "true";
    chip.setAttribute("aria-pressed", on);
    on ? state.difficulty.add(chip.dataset.value) : state.difficulty.delete(chip.dataset.value);
    update({});
  });
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.innerHTML = b.dataset.view === "grid" ? ICONS.grid : ICONS.list;
    b.addEventListener("click", () => { setView(b.dataset.view); render(); });
  });
  $("more").addEventListener("click", () => { state.shown += PAGE_SIZE; render(); });
  $("reset").addEventListener("click", resetFilters);
  $("results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (btn) addToList(btn.dataset.add, btn.dataset.id);
  });
}

function resetFilters() {
  Object.assign(state, { q: "", group: "", subject: "", credits: "", gened: "", predicted: false });
  state.levels.clear();
  state.difficulty.clear();
  ["q", "f-group", "f-subject", "f-credits", "f-gened"].forEach((id) => { $(id).value = ""; });
  $("f-predicted").checked = false;
  document.querySelectorAll("#f-level input").forEach((i) => { i.checked = false; });
  document.querySelectorAll("#f-difficulty .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  update({});
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.q = params.get("q") || "";
  state.subject = params.get("subject") || "";
  state.group = params.get("group") || "";
  $("q").value = state.q;
  $("f-subject").value = state.subject;
  $("f-group").value = state.group;
}

async function init() {
  setView(state.view);
  bindControls();
  try {
    courses = await getCourses();
    fillSelect($("f-group"), [...new Set(courses.map((c) => c.group))].sort());
    fillSelect($("f-subject"), [...new Set(courses.map((c) => c.subject))].sort());
    fillSelect($("f-gened"), [...new Set(courses.flatMap((c) => c.gened))].sort());
    readUrl();
    render();
  } catch (err) {
    console.error(err);
    $("count").textContent = "";
    $("results").innerHTML = errorState();
  }
}

init();

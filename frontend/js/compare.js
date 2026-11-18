import { getCourses, getCourseDetail } from "./data.js";
import { attachAutocomplete } from "./autocomplete.js";
import { barChart, lineChart, SERIES_COLORS } from "./charts.js";
import { getList, setList, addToList, removeFromList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, courseUrl, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const SLOTS = 3;
const TREND_YEARS = 10;
const GRADE_GROUPS = { A: ["A+", "A", "A-"], B: ["B+", "B", "B-"], C: ["C+", "C", "C-"], D: ["D+", "D", "D-"], F: ["F"], W: ["W"] };
const DIFFICULTY_RANK = { Easy: 2, Medium: 1, Hard: 0 };

let courses = new Map();

/* Rows of the comparison table: [label, value(c), better: "high" | "low" | null, format] */
const ROWS = [
  ["Difficulty", (c) => c.difficulty, null, difficultyBadge],
  ["Average GPA (5 yrs)", (c) => c.avgGpa, "high", fmt.gpa],
  ["Predicted GPA", (c) => c.predGpa, "high", (v, c) => (v == null ? "–" : `${fmt.gpa(v)} <span class="subtle">${escapeHTML(c.predTerm)}</span>`)],
  ["DFW rate", (c) => c.dfw, "low", (v) => fmt.pct(v)],
  ["Predicted DFW", (c) => c.predDfw, "low", (v) => fmt.pct(v)],
  ["Credit hours", (c) => c.credits, null, fmt.credits],
  ["Avg class size", (c) => c.classSize, null, fmt.int],
  ["Instructors (5 yrs)", (c) => c.instructors, null, fmt.int],
  ["Times offered", (c) => c.offerings, null, fmt.int],
  ["Last offered", (c) => c.lastTerm, null, escapeHTML],
];

const selected = () => getList("compare").map((id) => courses.get(id)).filter(Boolean);

/* Slots ------------------------------------------------------------------- */
function renderSlots(list) {
  const filled = list.map((c, i) => `
    <div class="slot is-filled" style="--slot-color:${SERIES_COLORS[i]}">
      <div class="spread"><span class="slot-dot"></span>
        <button class="btn btn-ghost btn-icon" type="button" data-remove="${c.id}" aria-label="Remove ${escapeHTML(c.code)}">${ICONS.x}</button></div>
      <a class="slot-code" href="${courseUrl(c.id)}">${escapeHTML(c.code)}</a>
      <span class="slot-title">${escapeHTML(c.title)}</span>
      ${difficultyBadge(c.difficulty)}
    </div>`);
  const empty = Array.from({ length: SLOTS - list.length }, (_, i) => `
    <div class="slot">
      <label class="field-label" for="slot-${i}">${list.length + i === 0 ? "First course" : "Add a course"}</label>
      <div class="ac"><input class="input" id="slot-${i}" type="text" placeholder="Code or title"></div>
    </div>`);
  $("slots").innerHTML = [...filled, ...empty].join("");
  $("slots").querySelectorAll("input").forEach((input) => attachAutocomplete(input, {
    getCourses: () => [...courses.values()],
    filter: (c) => !getList("compare").includes(c.id),
    onSelect: (c) => { addToList("compare", c.id, { silent: true }); render(); },
  }));
}

/* Table & verdict --------------------------------------------------------- */
function bestIndex(values, better) {
  if (!better) return -1;
  const valid = values.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (valid.length < 2) return -1;
  valid.sort((a, b) => (better === "high" ? b[0] - a[0] : a[0] - b[0]));
  return valid[0][0] === valid[1][0] ? -1 : valid[0][1];
}

function renderTable(list) {
  const head = `<thead><tr><th></th>${list.map((c) => `<th><a class="code" href="${courseUrl(c.id)}">${escapeHTML(c.code)}</a></th>`).join("")}</tr></thead>`;
  const body = ROWS.map(([label, get, better, format]) => {
    const values = list.map(get);
    const best = bestIndex(values, better);
    return `<tr><th scope="row">${label}</th>${values.map((v, i) =>
      `<td class="${i === best ? "is-best" : ""}">${format(v, list[i])}</td>`).join("")}</tr>`;
  }).join("");
  $("compare-table").innerHTML = `${head}<tbody>${body}</tbody>`;
}

function renderVerdict(list) {
  if (list.length < 2) {
    $("verdict").innerHTML = list.length
      ? `<div class="note">${ICONS.info}<span>Add one more course to compare.</span></div>` : "";
    return;
  }
  // Score: difficulty label first, then GPA, then lower DFW.
  const score = (c) => DIFFICULTY_RANK[c.difficulty] * 10 + (c.predGpa ?? c.avgGpa) - c.dfw / 100;
  const ranked = [...list].sort((a, b) => score(b) - score(a));
  const [easy, next] = ranked;
  const gap = (easy.predGpa ?? easy.avgGpa) - (next.predGpa ?? next.avgGpa);
  $("verdict").innerHTML = `<div class="verdict">
    <span class="eyebrow">On the numbers</span>
    <p><strong>${escapeHTML(easy.code)}</strong> looks like the more forgiving choice: its students average
    <strong>${fmt.gpa(easy.avgGpa)}</strong> with a DFW rate of <strong>${fmt.pct(easy.dfw)}</strong>${gap > 0.05 ? `, about ${gap.toFixed(2)} GPA points above ${escapeHTML(next.code)}` : ""}.
    Interest and fit matter more than a small difference in averages.</p>
  </div>`;
}

/* Charts ------------------------------------------------------------------ */
function legend(el, list) {
  el.innerHTML = list.map((c, i) => `<span><i style="background:${SERIES_COLORS[i]}"></i>${escapeHTML(c.code)}</span>`).join("");
}

async function renderCharts(list) {
  const details = await Promise.all(list.map(getCourseDetail));
  const groups = Object.keys(GRADE_GROUPS);
  barChart($("chart-grades"), {
    labels: groups,
    series: list.map((c, i) => {
      const total = Object.values(details[i].grades).reduce((s, n) => s + n, 0) || 1;
      return { name: c.code, color: SERIES_COLORS[i], values: groups.map((g) => (100 * GRADE_GROUPS[g].reduce((s, k) => s + (details[i].grades[k] || 0), 0)) / total) };
    }),
    format: (v) => `${Math.round(v)}%`, label: "Share of grades by letter",
  });

  const lastYear = Math.max(...details.flatMap((d) => d.trend.map((t) => t[0])));
  const years = Array.from({ length: TREND_YEARS }, (_, i) => lastYear - TREND_YEARS + 1 + i);
  lineChart($("chart-trend"), {
    labels: years.map(String),
    series: list.map((c, i) => {
      const byYear = new Map(details[i].trend.map((t) => [t[0], t[1]]));
      return { name: c.code, color: SERIES_COLORS[i], values: years.map((y) => byYear.get(y) ?? null) };
    }),
    format: (v) => v.toFixed(2), label: "Average GPA by year",
  });
  legend($("legend-grades"), list);
  legend($("legend-trend"), list);
}

/* Render ------------------------------------------------------------------ */
function render() {
  const list = selected();
  renderSlots(list);
  renderVerdict(list);
  $("compare-body").hidden = list.length < 2;
  history.replaceState(null, "", list.length ? `?ids=${list.map((c) => c.id).join(",")}` : location.pathname);
  if (list.length >= 2) {
    renderTable(list);
    renderCharts(list).catch((err) => console.error(err));
  }
}

async function init() {
  $("slots").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    removeFromList("compare", btn.dataset.remove);
    render();
  });
  try {
    courses = new Map((await getCourses()).map((c) => [c.id, c]));
    const fromUrl = new URLSearchParams(location.search).get("ids");
    if (fromUrl) setList("compare", fromUrl.split(",").filter((id) => courses.has(id)).slice(0, SLOTS));
    render();
  } catch (err) {
    console.error(err);
    $("slots").innerHTML = errorState();
  }
}

init();

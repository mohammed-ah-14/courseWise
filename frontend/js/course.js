import { getCourse, getCourseDetail } from "./data.js";
import { barChart, lineChart, PALETTE } from "./charts.js";
import { addToList } from "./lists.js";
import { ICONS, escapeHTML, fmt, difficultyBadge, scaleHTML, toast, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "W"];
const TERM_ORDER = ["Winter", "Spring", "Summer", "Fall"];
const COVID = { from: "2020", to: "2021", label: "COVID" };

// A grades green, D/F red, W grey, the rest ink.
const gradeColor = (g) => (g === "W" ? PALETTE.muted : g.startsWith("A") ? PALETTE.brand
  : g.startsWith("D") || g === "F" ? PALETTE.hard : PALETTE.ink);

/* Header ------------------------------------------------------------------ */
function renderHead(c) {
  document.title = `${c.code} ${c.title} · CourseWise`;
  $("crumb").textContent = c.code;
  $("c-eyebrow").textContent = `${c.subject} · ${c.group} · ${c.level === 500 ? "Graduate" : `${c.level} level`}`;
  $("c-title").innerHTML = `<span class="course-code">${escapeHTML(c.code)}</span> ${escapeHTML(c.title)}`;
  const tags = [
    difficultyBadge(c.difficulty),
    c.highRisk ? '<span class="badge badge-hard">High DFW</span>' : "",
    c.credits != null ? `<span class="tag">${fmt.credits(c.credits)} credits</span>` : "",
    ...c.gened.map((g) => `<span class="tag">Gen-Ed: ${escapeHTML(g)}</span>`),
    `<span class="tag">Last offered ${escapeHTML(c.lastTerm)}</span>`,
  ];
  $("c-tags").innerHTML = tags.join("");

  $("c-actions").hidden = false;
  $("copy-link").innerHTML = ICONS.link;
  $("add-planner").addEventListener("click", () => addToList("planner", c.id));
  $("add-compare").addEventListener("click", () => {
    addToList("compare", c.id, { silent: true });
    location.href = "compare.html";
  });
  $("copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied");
    } catch {
      toast("Could not copy the link", { type: "error" });
    }
  });
}

/* Overview ---------------------------------------------------------------- */
function renderOverview(c) {
  const markers = [{ value: c.avgGpa, label: `5-yr avg ${fmt.gpa(c.avgGpa)}`, variant: c.predGpa ? "is-ghost" : "" }];
  if (c.predGpa) markers.push({ value: c.predGpa, label: `Predicted ${fmt.gpa(c.predGpa)}`, variant: "is-brand" });
  $("c-scale").innerHTML = scaleHTML(markers, { from: 1.5, to: 4 });

  const parts = [`Students averaged <strong>${fmt.gpa(c.avgGpa)}</strong> over the last five years this course ran, and <strong>${fmt.pct(c.dfw)}</strong> got a D, an F or withdrew.`];
  if (c.predGpa) parts.push(`For <strong>${escapeHTML(c.predTerm)}</strong>, the model predicted <strong>${fmt.gpa(c.predGpa)}</strong> and a DFW rate of <strong>${fmt.pct(c.predDfw)}</strong> (${c.predDifficulty.toLowerCase()} for that year).`);
  $("c-summary").innerHTML = parts.join(" ");

  const stats = [
    ["Average GPA", fmt.gpa(c.avgGpa)],
    ["DFW rate", fmt.pct(c.dfw)],
    ["Avg class size", fmt.int(c.classSize)],
    ["Students (5 yrs)", fmt.int(c.students)],
    ["Times offered", fmt.int(c.offerings)],
    ["Instructors (5 yrs)", fmt.int(c.instructors)],
  ];
  $("c-stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/* Charts ------------------------------------------------------------------ */
function renderCharts(detail) {
  const total = GRADE_ORDER.reduce((s, g) => s + (detail.grades[g] || 0), 0);
  const share = GRADE_ORDER.map((g) => (total ? (100 * (detail.grades[g] || 0)) / total : 0));
  $("grades-note").textContent = `${fmt.int(total)} grades, last five years`;
  barChart($("chart-grades"), {
    labels: GRADE_ORDER,
    series: [{ name: "Share", values: share, colors: GRADE_ORDER.map(gradeColor) }],
    format: (v) => `${Math.round(v)}%`,
    label: "Grade distribution",
    tip: (i) => `<strong>${GRADE_ORDER[i]}</strong><br>${share[i].toFixed(1)}% · ${fmt.int(detail.grades[GRADE_ORDER[i]] || 0)} students`,
  });

  const terms = TERM_ORDER.filter((t) => detail.terms[t]);
  barChart($("chart-terms"), {
    labels: terms,
    series: [{ name: "Avg GPA", values: terms.map((t) => detail.terms[t].gpa), color: PALETTE.ink }],
    yMin: 0, yMax: 4, format: (v) => v.toFixed(1), showValues: true, label: "Average GPA by term",
    tip: (i) => `<strong>${terms[i]}</strong><br>GPA ${fmt.gpa(detail.terms[terms[i]].gpa)} · DFW ${fmt.pct(detail.terms[terms[i]].dfw)}`,
  });

  const years = detail.trend.map((t) => String(t[0]));
  lineChart($("chart-gpa"), {
    labels: years,
    series: [{ name: "Avg GPA", values: detail.trend.map((t) => t[1]), color: PALETTE.ink }],
    format: (v) => v.toFixed(2), band: COVID, label: "Average GPA by year",
  });
  lineChart($("chart-dfw"), {
    labels: years,
    series: [{ name: "DFW", values: detail.trend.map((t) => t[2]), color: PALETTE.hard }],
    yMin: 0, format: (v) => `${v.toFixed(0)}%`, band: COVID, label: "DFW rate by year",
  });
}

/* Tables ------------------------------------------------------------------ */
function renderInstructors(list) {
  const table = $("instructors");
  const body = table.querySelector("tbody");
  let key = "students", dir = -1;
  const draw = () => {
    const rows = [...list].sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) : a[key] - b[key]) * dir);
    body.innerHTML = rows.length ? rows.map((i) => `<tr>
      <td>${escapeHTML(i.name)}</td><td class="num">${i.offerings}</td><td class="num">${fmt.int(i.students)}</td>
      <td class="num">${fmt.gpa(i.gpa)}</td><td class="num">${fmt.pct(i.dfw)}</td><td>${escapeHTML(i.last)}</td></tr>`).join("")
      : '<tr><td colspan="6" class="subtle">No instructor data.</td></tr>';
    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.sort === key ? (dir === 1 ? "ascending" : "descending") : "none");
    });
  };
  table.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    dir = th.dataset.sort === key ? -dir : th.dataset.sort === "name" ? 1 : -1;
    key = th.dataset.sort;
    draw();
  }));
  draw();
}

function renderPredictions(list) {
  if (!list.length) { $("pred-section").hidden = true; return; }
  $("predictions").innerHTML = list.map((p) => {
    const err = p.gpa - p.actualGpa;
    return `<tr>
      <td>${escapeHTML(p.term)}</td><td>${escapeHTML(p.instructor)}</td><td class="num">${fmt.int(p.students)}</td>
      <td class="num">${fmt.gpa(p.gpa)}</td><td class="num">${fmt.gpa(p.actualGpa)}</td>
      <td class="num ${Math.abs(err) > 0.3 ? "is-off" : ""}">${err >= 0 ? "+" : "−"}${Math.abs(err).toFixed(2)}</td>
      <td>${difficultyBadge(p.difficulty)}</td><td>${difficultyBadge(p.actualDifficulty)}</td>
    </tr>`;
  }).join("");
}

/* Init -------------------------------------------------------------------- */
function notFound(id) {
  $("c-eyebrow").textContent = "Not found";
  $("c-title").textContent = id ? `No course called “${id}”` : "No course selected";
  $("course-body").innerHTML = `<section class="section"><div class="container"><div class="state">${ICONS.search}
    <p>It may not have run since 2016. Try the explorer instead.</p>
    <a class="btn btn-primary" href="explorer.html">Open the explorer ${ICONS.arrow}</a></div></div></section>`;
}

async function init() {
  const id = new URLSearchParams(location.search).get("id")?.toUpperCase().replace(/\s+/g, "");
  try {
    const course = id && await getCourse(id);
    if (!course) return notFound(id);
    renderHead(course);
    renderOverview(course);
    const detail = await getCourseDetail(course);
    renderCharts(detail);
    renderInstructors(detail.instructors);
    renderPredictions(detail.predictions);
  } catch (err) {
    console.error(err);
    $("course-body").innerHTML = `<div class="container">${errorState()}</div>`;
  }
}

init();

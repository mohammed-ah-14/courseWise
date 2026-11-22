// Insights page: findings and charts about the course difficulty over the years.
import { getInsights } from "./data.js";
import { barChart, lineChart, hbarList, PALETTE } from "./charts.js";
import { escapeHTML, fmt, courseUrl, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);
const COVID = { from: "2020", to: "2021", label: "COVID" };
const LEVEL_NAMES = { 100: "100", 200: "200", 300: "300", 400: "400", 500: "Grad" };
const TERM_ORDER = ["Winter", "Spring", "Summer", "Fall"];

let data;
let metric = "gpa";

/* Findings ---------------------------------------------------------------- */
const byKey = (list, key) => list.find((x) => x.key === key);

// The newest year is often not complete, so use the last year that have normal number of students.
function lastFullYear(years) {
  const [last, prev] = years.slice(-2).reverse();
  return last.students < prev.students * 0.6 ? prev : last;
}

function findings(d) {
  const first = d.byYear[0];
  const last = lastFullYear(d.byYear);
  const y2019 = byKey(d.byYear, 2019), y2020 = byKey(d.byYear, 2020);
  const intro = byKey(d.byLevel, 100), grad = byKey(d.byLevel, 500);
  const groups = d.byGroup; // sorted from the hardest first
  const items = [
    [`+${(last.gpa - first.gpa).toFixed(2)}`, "Grade inflation",
      `The average GPA rose from ${fmt.gpa(first.gpa)} in ${first.key} to ${fmt.gpa(last.gpa)} in ${last.key}. That is why difficulty is judged within each year.`],
    y2019 && y2020 && [`${y2020.gpa >= y2019.gpa ? "+" : "−"}${Math.abs(y2020.gpa - y2019.gpa).toFixed(2)}`, "The COVID year",
      `In the first pandemic year the average went from ${fmt.gpa(y2019.gpa)} (2019) to ${fmt.gpa(y2020.gpa)} (2020), the biggest one-year change in the data.`],
    intro && grad && [fmt.gpa(grad.gpa), grad.gpa > intro.gpa ? "Graduate courses grade higher" : "Graduate courses grade lower",
      `Graduate courses average ${fmt.gpa(grad.gpa)}, against ${fmt.gpa(intro.gpa)} for 100-level courses. Compare courses with others at the same level.`],
    [fmt.gpa(groups[0].gpa), `${groups[0].key} is the hardest field`,
      `${groups[0].key} courses average ${fmt.gpa(groups[0].gpa)} with ${fmt.pct(groups[0].dfw)} DFW, while ${groups.at(-1).key} averages ${fmt.gpa(groups.at(-1).gpa)}.`],
  ].filter(Boolean);
  $("findings").innerHTML = items.map(([num, title, text], i) => `
    <li class="finding reveal is-visible">
      <span class="finding-index">${String(i + 1).padStart(2, "0")}</span>
      <strong class="finding-num num">${num}</strong>
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(text)}</p>
    </li>`).join("");
}

/* Year chart -------------------------------------------------------------- */
function fillYears(years) {
  const options = years.map((y) => `<option value="${y.key}">${y.key}</option>`).join("");
  $("from").innerHTML = options;
  $("to").innerHTML = options;
  $("from").value = years[0].key;
  $("to").value = years.at(-1).key;
}

function renderYears() {
  let from = Number($("from").value), to = Number($("to").value);
  if (from > to) [from, to] = [to, from];
  const years = data.byYear.filter((y) => y.key >= from && y.key <= to);
  const isGpa = metric === "gpa";
  lineChart($("year-chart"), {
    labels: years.map((y) => String(y.key)),
    series: [{ name: isGpa ? "Avg GPA" : "DFW rate", values: years.map((y) => y[metric]), color: isGpa ? PALETTE.ink : PALETTE.hard }],
    format: isGpa ? (v) => v.toFixed(2) : (v) => `${v.toFixed(1)}%`,
    band: COVID, height: 280, label: isGpa ? "Average GPA by year" : "DFW rate by year",
  });
}

/* Breakdowns -------------------------------------------------------------- */
function renderBreakdowns(d) {
  document.querySelectorAll("[data-recent]").forEach((el) => { el.textContent = `Avg GPA, ${d.recentYears.join("–")}`; });
  const gpaItem = (x) => ({ label: x.key, sub: `${fmt.compact(x.students)} students · DFW ${fmt.pct(x.dfw)}`, value: x.gpa });
  hbarList($("by-group"), { items: d.byGroup.map((x) => ({ ...gpaItem(x), color: PALETTE.ink })), domain: [2.8, 4], format: fmt.gpa });

  const subjectItem = (color) => (x) => ({ ...gpaItem(x), href: `explorer.html?subject=${encodeURIComponent(x.key)}`, color });
  hbarList($("hard-subjects"), { items: d.hardestSubjects.map(subjectItem(PALETTE.hard)), domain: [2.5, 4], format: fmt.gpa });
  hbarList($("easy-subjects"), { items: d.easiestSubjects.map(subjectItem(PALETTE.easy)), domain: [2.5, 4], format: fmt.gpa });

  const levels = [...d.byLevel].sort((a, b) => a.key - b.key);
  barChart($("by-level"), {
    labels: levels.map((l) => LEVEL_NAMES[l.key]), height: 180, yMin: 0, yMax: 4, showValues: true,
    series: [{ name: "Avg GPA", values: levels.map((l) => l.gpa), color: PALETTE.brand }],
    format: (v) => v.toFixed(2), label: "Average GPA by course level",
  });
  const terms = TERM_ORDER.map((t) => byKey(d.byTerm, t)).filter(Boolean);
  barChart($("by-term"), {
    labels: terms.map((t) => t.key), height: 180, yMin: 0, showValues: true,
    series: [{ name: "DFW", values: terms.map((t) => t.dfw), color: PALETTE.hard }],
    format: (v) => `${v.toFixed(1)}%`, label: "DFW rate by term",
  });
  barChart($("dfw-hist"), {
    labels: d.dfwHistogram.map((b, i) => (i === d.dfwHistogram.length - 1 ? `${b.from}%+` : `${b.from}–${b.to}%`)),
    series: [{ name: "Courses", values: d.dfwHistogram.map((b) => b.courses), color: PALETTE.brand }],
    format: (v) => fmt.int(v), showValues: true, label: "Courses by DFW band",
  });
}

function renderTables(d) {
  const row = (c, first, second) => `<tr>
    <td><a class="code" href="${courseUrl(c.id)}">${escapeHTML(c.code)}</a><span class="sub">${escapeHTML(c.title)}</span></td>
    <td class="num">${first}</td><td class="num">${second}</td><td class="num">${fmt.int(c.students)}</td></tr>`;
  $("top-hard").innerHTML = d.hardestCourses.map((c) => row(c, fmt.gpa(c.avgGpa), fmt.pct(c.dfw))).join("");
  $("top-dfw").innerHTML = d.highestDfw.map((c) => row(c, fmt.pct(c.dfw), fmt.gpa(c.avgGpa))).join("");
}

/* Init -------------------------------------------------------------------- */
async function init() {
  try {
    data = await getInsights();
    findings(data);
    fillYears(data.byYear);
    // Both tabs control the same chart, so they only change the metric.
    const tabs = document.querySelectorAll("[data-metric]");
    tabs.forEach((t) => t.addEventListener("click", () => {
      metric = t.dataset.metric;
      tabs.forEach((o) => o.setAttribute("aria-selected", o === t));
      renderYears();
    }));
    $("from").addEventListener("change", renderYears);
    $("to").addEventListener("change", renderYears);
    renderYears();
    renderBreakdowns(data);
    renderTables(data);
  } catch (err) {
    console.error(err);
    $("findings").outerHTML = errorState();
  }
}

init();

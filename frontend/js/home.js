// Home page: counters, hero, GPA spectrum chart and the hardest / most forgiving ranking.
import { getCourses, getMeta, getModel } from "./data.js";
import { attachAutocomplete } from "./autocomplete.js";
import { mount } from "./charts.js";
import { escapeHTML, fmt, difficultyBadge, scaleHTML, courseUrl, errorState } from "./main.js";

const FEATURED_ID = "MATH220";
const SPECTRUM_MIN_STUDENTS = 300;
const SPECTRUM_RANGE = [2.2, 4.0];
const RANK_MIN_STUDENTS = 500;
const RANK_SIZE = 6;
const DIFFICULTY_COLOR = { Hard: "var(--hard)", Medium: "var(--medium)", Easy: "var(--easy)" };

let courses = [];

/* Counters ---------------------------------------------------------------- */
function animateCount(el, target, format) {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / 1400, 1);
    el.textContent = format(target * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function initCounters(meta) {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const format = "compact" in el.dataset ? fmt.compact : fmt.int;
    animateCount(el, meta[el.dataset.count] ?? 0, format);
  });
  document.querySelectorAll("[data-meta]").forEach((el) => { el.textContent = meta[el.dataset.meta]; });
}

/* Hero -------------------------------------------------------------------- */
function initSearch() {
  const input = document.getElementById("hero-q");
  attachAutocomplete(input, {
    getCourses: () => courses,
    onSelect: (c) => { location.href = courseUrl(c.id); },
  });
}

function renderHeroCard(course) {
  const card = document.getElementById("hero-card");
  if (!course) { card.hidden = true; return; }
  card.href = courseUrl(course.id);
  const markers = [
    { value: course.avgGpa, label: `5-yr avg ${fmt.gpa(course.avgGpa)}`, variant: "is-ghost" },
    { value: course.predGpa, label: `Predicted ${fmt.gpa(course.predGpa)}`, variant: "is-brand" },
  ];
  card.innerHTML = `
    <span class="hero-card-label">Prediction · ${escapeHTML(course.predTerm || course.lastTerm)}</span>
    <div class="hero-card-head">
      <div><strong>${escapeHTML(course.code)}</strong><span>${escapeHTML(course.title)}</span></div>
      ${difficultyBadge(course.predDifficulty || course.difficulty)}
    </div>
    ${scaleHTML(markers, { from: 2, to: 4 })}
    <dl class="hero-card-stats">
      <div><dt>Predicted DFW</dt><dd class="num">${fmt.pct(course.predDfw ?? course.dfw)}</dd></div>
      <div><dt>Class size</dt><dd class="num">${fmt.int(course.classSize)}</dd></div>
      <div><dt>Credits</dt><dd class="num">${fmt.credits(course.credits)}</dd></div>
    </dl>
    <span class="hero-card-more">Open course</span>`;
}

/* Spectrum (beeswarm chart of course GPAs) ------------------------------------ */
function spectrumLayout(list, width, r) {
  const [lo, hi] = SPECTRUM_RANGE;
  const pad = 8;
  const x = (g) => pad + ((Math.min(hi, Math.max(lo, g)) - lo) / (hi - lo)) * (width - pad * 2);
  const columns = new Map();
  const dots = list.map((c) => {
    const cx = x(c.avgGpa);
    const col = Math.round(cx / (r * 2));
    const n = columns.get(col) || 0;
    columns.set(col, n + 1);
    return { c, cx, slot: n % 2 ? Math.ceil(n / 2) : -n / 2 };
  });
  const maxSlot = Math.max(...dots.map((d) => Math.abs(d.slot)));
  return { dots, maxSlot, x };
}

function renderSpectrum(group = null) {
  const el = document.getElementById("spectrum");
  const list = courses.filter((c) => c.students >= SPECTRUM_MIN_STUDENTS).sort((a, b) => b.students - a.students);
  mount(el, (width) => {
    const r = width < 600 ? 2.2 : 3;
    const { dots, maxSlot, x } = spectrumLayout(list, width, r);
    const half = 120;
    const gap = Math.min(r * 2, half / Math.max(1, maxSlot));
    const height = half * 2 + 40;
    const mid = half + 6;
    const ticks = [2.5, 3.0, 3.5, 4.0].map((t) => `
      <line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${height - 26}"/>
      <text x="${x(t)}" y="${height - 8}" text-anchor="middle">${t.toFixed(1)}</text>`).join("");
    const circles = dots.map(({ c, cx, slot }) => {
      const dim = group && c.group !== group;
      const tip = `<strong>${escapeHTML(c.code)}</strong> ${escapeHTML(c.title)}<br>Avg GPA ${fmt.gpa(c.avgGpa)} · DFW ${fmt.pct(c.dfw)}`;
      return `<a href="${courseUrl(c.id)}"><circle cx="${cx.toFixed(1)}" cy="${(mid + slot * gap).toFixed(1)}" r="${r}"
        style="fill:${DIFFICULTY_COLOR[c.difficulty]};opacity:${dim ? 0.08 : 0.75}" data-tip="${escapeHTML(tip)}"/></a>`;
    }).join("");
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution of ${list.length} courses by average GPA">${ticks}${circles}</svg>`;
  });
}

function initSpectrumFilters() {
  const box = document.getElementById("spectrum-filters");
  const groups = [...new Set(courses.map((c) => c.group))].filter((g) => g !== "Other").sort();
  box.innerHTML = ["All fields", ...groups].map((g, i) =>
    `<button class="chip" type="button" aria-pressed="${i === 0}" data-group="${i ? escapeHTML(g) : ""}">${escapeHTML(g)}</button>`).join("");
  box.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    box.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === chip));
    renderSpectrum(chip.dataset.group || null);
  });
}

/* Rankings ---------------------------------------------------------------- */
function rankRows(list) {
  return list.map((c, i) => `
    <li>
      <span class="rank-num">${String(i + 1).padStart(2, "0")}</span>
      <a class="rank-name" href="${courseUrl(c.id)}"><strong>${escapeHTML(c.code)}</strong><span>${escapeHTML(c.title)}</span></a>
      <span class="rank-bar" aria-hidden="true"><i style="left:${((c.avgGpa - 2) / 2) * 100}%"></i></span>
      <span class="rank-gpa num">${fmt.gpa(c.avgGpa)}</span>
    </li>`).join("");
}

function renderRankings() {
  const big = courses.filter((c) => c.students >= RANK_MIN_STUDENTS).sort((a, b) => a.avgGpa - b.avgGpa);
  document.getElementById("hardest").innerHTML = rankRows(big.slice(0, RANK_SIZE));
  document.getElementById("easiest").innerHTML = rankRows(big.slice(-RANK_SIZE).reverse());
}

/* Init -------------------------------------------------------------------- */
async function init() {
  initSearch();
  try {
    const [meta, list] = await Promise.all([getMeta(), getCourses()]);
    courses = list;
    initCounters(meta);
    renderHeroCard(courses.find((c) => c.id === FEATURED_ID) || courses.find((c) => c.predGpa));
    initSpectrumFilters();
    renderSpectrum();
    renderRankings();
  } catch (err) {
    console.error(err);
    document.getElementById("spectrum").innerHTML = errorState();
    document.getElementById("hero-card").hidden = true;
    ["hardest", "easiest"].forEach((id) => { document.getElementById(id).innerHTML = ""; });
  }
  getModel()
    .then((m) => { document.getElementById("model-mae").textContent = `±${m.tasks.gpa.test.mae.toFixed(2)}`; })
    .catch(() => {});
}

init();

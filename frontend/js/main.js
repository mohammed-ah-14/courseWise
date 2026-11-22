// CourseWise — shared layout and UI behavior (header, footer, theme, toast, helper functions).

const svg = (body, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICONS = {
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', ' class="arrow"'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', ' class="icon-moon"'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', ' class="icon-sun"'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  up: svg('<path d="m18 15-6-6-6 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  print: svg('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
};

// Brand logo: one diamond (like the UoS pattern) with a going-up line inside.
export const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M16 2.5 29.5 16 16 29.5 2.5 16Z"/><path d="m9.5 18.5 4-4 3 3 6-6"/></svg>`;

// Pages are inside pages/ folder, but index.html is in the root. So we make the links work from both.
const IN_PAGES = location.pathname.includes("/pages/");
const ROOT = IN_PAGES ? "../" : "";
const PAGES = IN_PAGES ? "" : "pages/";

const NAV = [
  { href: PAGES + "explorer.html", label: "Explorer" },
  { href: PAGES + "predict.html", label: "Predictor" },
  { href: PAGES + "planner.html", label: "Planner" },
  { href: PAGES + "compare.html", label: "Compare" },
  { href: PAGES + "insights.html", label: "Insights" },
  {
    label: "More",
    children: [
      { href: PAGES + "gpa.html", label: "GPA Calculator", desc: "Term, cumulative and target GPA" },
      { href: PAGES + "tools.html", label: "Study Tools", desc: "Focus timer, deadlines, to-dos" },
      { href: PAGES + "model.html", label: "How It Works", desc: "The data and the model" },
      { href: PAGES + "about.html", label: "About", desc: "The project and the team" },
      { href: PAGES + "contact.html", label: "Contact", desc: "Feedback and data issues" },
    ],
  },
];

function currentPage() {
  const file = location.pathname.split("/").pop();
  return file === "" ? "index.html" : file.endsWith(".html") ? file : `${file}.html`;
}

const current = (href) => (href.split("/").pop() === currentPage() ? ' aria-current="page"' : "");

function navItem(item) {
  if (!item.children) return `<li><a href="${item.href}"${current(item.href)}>${item.label}</a></li>`;
  const sub = item.children
    .map((c) => `<li><a href="${c.href}"${current(c.href)}>${c.label}<small>${c.desc}</small></a></li>`)
    .join("");
  return `<li class="nav-drop" data-open="false">
    <button type="button" aria-expanded="false">${item.label}${ICONS.chevron}</button>
    <ul class="nav-menu">${sub}</ul>
  </li>`;
}

function closeDropdowns(root) {
  root.querySelectorAll(".nav-drop").forEach((d) => {
    d.dataset.open = "false";
    d.querySelector("button").setAttribute("aria-expanded", "false");
  });
}

function renderHeader() {
  const el = document.getElementById("site-header");
  if (!el) return;
  el.className = "site-header";
  el.innerHTML = `
    <nav class="container nav" aria-label="Main">
      <a class="brand" href="${ROOT}index.html" aria-label="CourseWise home">${BRAND_MARK}<span class="brand-name">CourseWise</span></a>
      <ul class="nav-links" id="nav-links">${NAV.map(navItem).join("")}</ul>
      <div class="nav-actions">
        <a class="btn btn-primary btn-sm nav-cta" href="${PAGES}predict.html">Predict a course ${ICONS.arrow}</a>
        <button class="btn btn-ghost btn-icon theme-toggle" type="button" aria-label="Toggle dark mode">${ICONS.moon}${ICONS.sun}</button>
        <button class="btn btn-ghost btn-icon menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">${ICONS.menu}</button>
      </div>
    </nav>`;

  el.querySelectorAll(".nav-drop").forEach((drop) => {
    const btn = drop.querySelector("button");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = drop.dataset.open !== "true";
      closeDropdowns(el);
      drop.dataset.open = open;
      btn.setAttribute("aria-expanded", open);
    });
  });
  document.addEventListener("click", () => closeDropdowns(el));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDropdowns(el));

  const menuBtn = el.querySelector(".menu-toggle");
  menuBtn.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    menuBtn.setAttribute("aria-expanded", open);
  });

  el.querySelector(".theme-toggle").addEventListener("click", toggleTheme);

  const onScroll = () => el.classList.toggle("is-scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function renderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.className = "site-footer";
  el.innerHTML = `
    <img class="footer-pattern" src="${ROOT}assets/images/unidiamond3.png" alt="" aria-hidden="true">
    <div class="container footer-top">
      <div class="footer-about">
        <a class="brand" href="${ROOT}index.html">${BRAND_MARK}<span class="brand-name">CourseWise</span></a>
        <p>Course difficulty estimated from historical grade data, so students can plan a semester they can handle.</p>
      </div>
      <div class="footer-col">
        <h4>Explore</h4>
        <ul>
          <li><a href="${PAGES}explorer.html">Course Explorer</a></li>
          <li><a href="${PAGES}predict.html">Difficulty Predictor</a></li>
          <li><a href="${PAGES}compare.html">Compare Courses</a></li>
          <li><a href="${PAGES}insights.html">Insights</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Plan</h4>
        <ul>
          <li><a href="${PAGES}planner.html">Semester Planner</a></li>
          <li><a href="${PAGES}gpa.html">GPA Calculator</a></li>
          <li><a href="${PAGES}tools.html">Study Tools</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Project</h4>
        <ul>
          <li><a href="${PAGES}model.html">How It Works</a></li>
          <li><a href="${PAGES}about.html">About</a></li>
          <li><a href="${PAGES}contact.html">Contact</a></li>
        </ul>
      </div>
    </div>
    <div class="container footer-bottom">
      <span class="footer-uni"><a href="https://www.sharjah.ac.ae"><img src="${ROOT}assets/images/unilogo_long_white.png" alt="University of Sharjah" width="718" height="138"></a> Student project · ${new Date().getFullYear()}</span>
      <span>Predictions describe course-level trends, not individual grades.</span>
    </div>`;
}

/* Theme ------------------------------------------------------------------- */
const THEME_KEY = "cw-theme";
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set(THEME_KEY, next);
  document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
}

/* Safe localStorage ------------------------------------------------------- */
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is not available */ }
  },
};

/* Toast ------------------------------------------------------------------- */
export function toast(message, { type = "success", duration = 2800 } = {}) {
  let region = document.querySelector(".toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const t = document.createElement("div");
  t.className = `toast${type === "error" ? " is-error" : ""}`;
  t.textContent = message;
  region.append(t);
  setTimeout(() => {
    t.classList.add("is-leaving");
    t.addEventListener("transitionend", () => t.remove(), { once: true });
  }, duration);
}

/* Back to top ------------------------------------------------------------- */
function initToTop() {
  const btn = document.createElement("button");
  btn.className = "to-top";
  btn.type = "button";
  btn.setAttribute("aria-label", "Back to top");
  btn.innerHTML = ICONS.up;
  btn.addEventListener("click", () => window.scrollTo({ top: 0 }));
  document.body.append(btn);
  window.addEventListener("scroll", () => btn.classList.toggle("is-visible", window.scrollY > 700), { passive: true });
}

/* Scroll reveal ----------------------------------------------------------- */
export function initReveal(root = document) {
  const items = root.querySelectorAll(".reveal:not(.is-visible)");
  if (!("IntersectionObserver" in window)) return items.forEach((i) => i.classList.add("is-visible"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    });
  }, { threshold: 0.1 });
  items.forEach((i) => io.observe(i));
}

/* Accordion & tabs -------------------------------------------------------- */
export function initAccordions(root = document) {
  root.querySelectorAll(".acc-trigger").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.setAttribute("aria-expanded", btn.getAttribute("aria-expanded") !== "true");
    });
  });
}

// Tabs: <div role="tablist"> with [role=tab][aria-controls]; it call onChange(id).
export function initTabs(tablist, onChange = () => {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) panel.hidden = !on;
    });
    onChange(tab.getAttribute("aria-controls"));
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
  select(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]);
}

/* Formatting helpers ------------------------------------------------------ */
export const fmt = {
  int: (n) => new Intl.NumberFormat("en-US").format(Math.round(n)),
  compact: (n) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n),
  gpa: (n) => (n == null ? "–" : Number(n).toFixed(2)),
  pct: (n, digits = 1) => (n == null ? "–" : `${Number(n).toFixed(digits)}%`),
  credits: (n) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1)),
};

export function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function difficultyBadge(level) {
  if (!level) return '<span class="badge badge-plain">No data</span>';
  return `<span class="badge badge-${level.toLowerCase()}">${level}</span>`;
}

export const courseUrl = (id) => `${PAGES}course.html?id=${encodeURIComponent(id)}`;

// Find the position (0-100%) of one GPA on the 0-4 scale.
export const gpaPercent = (gpa) => Math.max(0, Math.min(100, (gpa / 4) * 100));

const MIN_MARKER_GAP = 14; // % of scale width we need to show two labels side by side

// Make the HTML for GPA scale: markers = [{ value, label, variant: "" | "is-ghost" | "is-brand" }]
export function scaleHTML(markers, { from = 0, to = 4 } = {}) {
  const pos = (v) => Math.max(0, Math.min(100, ((v - from) / (to - from)) * 100));
  const ticks = [];
  for (let v = from; v <= to + 1e-9; v += 0.5) ticks.push(`<span style="left:${pos(v)}%">${v.toFixed(1)}</span>`);
  const shown = markers.filter((m) => m.value != null);
  const main = shown.filter((m) => m.variant !== "is-ghost");
  // If a ghost (comparison) marker is on top of the main one, it only make the scale messy.
  const visible = shown.filter((m) => m.variant !== "is-ghost"
    || main.every((o) => Math.abs(pos(o.value) - pos(m.value)) > MIN_MARKER_GAP));
  const pins = visible
    .map((m) => `<div class="scale-marker ${m.variant || ""}" style="left:${pos(m.value)}%"><span>${escapeHTML(m.label)}</span></div>`)
    .join("");
  return `<div class="scale" role="img" aria-label="${escapeHTML(shown.map((m) => m.label).join(", "))} on a ${from} to ${to} GPA scale">
    <div class="scale-track"></div>${pins}<div class="scale-ticks">${ticks.join("")}</div></div>`;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function errorState(message = "Could not load course data.") {
  return `<div class="state">${ICONS.warn}<p>${escapeHTML(message)}</p><p class="subtle" style="font-size:var(--fs-xs)">Open the site through a local server (for example VS Code Live Server), not as a file.</p></div>`;
}

/* Init -------------------------------------------------------------------- */
renderHeader();
renderFooter();
initToTop();
initReveal();
initAccordions();

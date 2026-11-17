// CourseWise — shared layout and UI behaviour (header, footer, theme, toast, etc.)

const ICONS = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  moon: '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
};

export const ARROW = '<span class="btn-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>';

const NAV = [
  { href: "explorer.html", label: "Explorer" },
  { href: "predict.html", label: "Predictor" },
  { href: "planner.html", label: "Planner" },
  { href: "insights.html", label: "Insights" },
  {
    label: "Tools",
    children: [
      { href: "gpa.html", label: "GPA Calculator", desc: "Term, cumulative and target GPA" },
      { href: "compare.html", label: "Compare Courses", desc: "Side-by-side course stats" },
      { href: "tools.html", label: "Study Tools", desc: "Timer, deadlines and to-dos" },
    ],
  },
  { href: "model.html", label: "How It Works" },
];

function currentPage() {
  const file = location.pathname.split("/").pop();
  return file === "" ? "index.html" : file.endsWith(".html") ? file : `${file}.html`;
}

function renderHeader() {
  const el = document.getElementById("site-header");
  if (!el) return;
  const page = currentPage();
  const link = ({ href, label }) =>
    `<a href="${href}"${href === page ? ' aria-current="page"' : ""}>${label}</a>`;

  const items = NAV.map((item) => {
    if (!item.children) return `<li>${link(item)}</li>`;
    const sub = item.children
      .map((c) => `<li><a href="${c.href}"${c.href === page ? ' aria-current="page"' : ""}>${c.label}<small>${c.desc}</small></a></li>`)
      .join("");
    return `<li class="nav-drop" data-open="false">
      <button type="button" aria-expanded="false">${item.label}${ICONS.chevron}</button>
      <ul class="nav-menu">${sub}</ul>
    </li>`;
  }).join("");

  el.className = "site-header";
  el.innerHTML = `
    <div class="topbar">
      <div class="container">
        <span>A student project at the University of Sharjah</span>
        <ul>
          <li><a href="about.html">About</a></li>
          <li><a href="contact.html">Contact</a></li>
          <li><a href="https://www.sharjah.ac.ae" target="_blank" rel="noopener">sharjah.ac.ae</a></li>
        </ul>
      </div>
    </div>
    <nav class="container nav" aria-label="Main">
      <a class="brand" href="index.html" aria-label="CourseWise home">
        <img class="brand-logo brand-logo-light" src="assets/images/unilogo_long.png" alt="University of Sharjah" width="718" height="138">
        <img class="brand-logo brand-logo-dark" src="assets/images/unilogo_long_white.png" alt="" width="718" height="138">
        <span class="brand-divider" aria-hidden="true"></span>
        <span class="brand-name">CourseWise</span>
      </a>
      <ul class="nav-links" id="nav-links">${items}</ul>
      <div class="nav-actions">
        <a class="btn btn-primary btn-sm nav-cta" href="predict.html">Predict a course ${ARROW}</a>
        <button class="btn btn-ghost btn-icon theme-toggle" type="button" aria-label="Toggle dark mode">${ICONS.moon}${ICONS.sun}</button>
        <button class="btn btn-ghost btn-icon menu-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">${ICONS.menu}</button>
      </div>
    </nav>`;

  // Dropdowns
  el.querySelectorAll(".nav-drop").forEach((drop) => {
    const btn = drop.querySelector("button");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = drop.dataset.open !== "true";
      drop.dataset.open = open;
      btn.setAttribute("aria-expanded", open);
    });
  });
  document.addEventListener("click", () => {
    el.querySelectorAll(".nav-drop").forEach((d) => {
      d.dataset.open = "false";
      d.querySelector("button").setAttribute("aria-expanded", "false");
    });
  });

  // Mobile menu
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
  const year = new Date().getFullYear();
  el.className = "site-footer";
  el.innerHTML = `
    <div class="footer-stripe"></div>
    <div class="container footer-top">
      <div class="footer-about">
        <img class="footer-logo" src="assets/images/unilogo_long_white.png" alt="University of Sharjah" width="718" height="138">
        <p>CourseWise is a student project that estimates course difficulty from historical grade data to help students plan their semesters.</p>
      </div>
      <div class="footer-col">
        <h4>Explore</h4>
        <ul>
          <li><a href="explorer.html">Course Explorer</a></li>
          <li><a href="predict.html">Difficulty Predictor</a></li>
          <li><a href="insights.html">Insights</a></li>
          <li><a href="compare.html">Compare Courses</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Plan</h4>
        <ul>
          <li><a href="planner.html">Semester Planner</a></li>
          <li><a href="gpa.html">GPA Calculator</a></li>
          <li><a href="tools.html">Study Tools</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Project</h4>
        <ul>
          <li><a href="model.html">How It Works</a></li>
          <li><a href="about.html">About</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </div>
    </div>
    <div class="container footer-bottom">
      <span>© ${year} CourseWise · University of Sharjah student project</span>
      <span>Predictions describe course-level trends, not individual grades.</span>
    </div>`;
}

/* Theme ------------------------------------------------------------------- */
const THEME_KEY = "cw-theme";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
}

/* Toast ------------------------------------------------------------------- */
export function toast(message, { type = "success", duration = 3000 } = {}) {
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
  window.addEventListener("scroll", () => btn.classList.toggle("is-visible", window.scrollY > 600), { passive: true });
}

/* Scroll reveal ----------------------------------------------------------- */
export function initReveal(root = document) {
  const items = root.querySelectorAll(".reveal:not(.is-visible)");
  if (!("IntersectionObserver" in window)) return items.forEach((i) => i.classList.add("is-visible"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  items.forEach((i) => io.observe(i));
}

/* Accordion --------------------------------------------------------------- */
export function initAccordions(root = document) {
  root.querySelectorAll(".acc-trigger").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.setAttribute("aria-expanded", btn.getAttribute("aria-expanded") !== "true");
    });
  });
}

/* Helpers ----------------------------------------------------------------- */
export function difficultyBadge(level) {
  const cls = { Easy: "easy", Medium: "medium", Hard: "hard" }[level] || "medium";
  return `<span class="badge badge-${cls}">${level}</span>`;
}

export function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Init -------------------------------------------------------------------- */
renderHeader();
renderFooter();
initToTop();
initReveal();
initAccordions();

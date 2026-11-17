import { getCourses, getMeta } from "./data.js";
import { escapeHTML } from "./main.js";

const fmt = new Intl.NumberFormat("en-US");

function animateCount(el, target) {
  const duration = 1200;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function initCounters(meta) {
  const els = document.querySelectorAll("[data-count]");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      animateCount(e.target, meta[e.target.dataset.count] ?? 0);
      io.unobserve(e.target);
    });
  }, { threshold: 0.5 });
  els.forEach((el) => io.observe(el));
}

function rows(list) {
  return list.map((c) => `
    <tr>
      <td><a class="code" href="course.html?id=${encodeURIComponent(c.id)}">${escapeHTML(c.code)}</a><div class="course-sub">${escapeHTML(c.title)}</div></td>
      <td class="num">${c.avgGpa.toFixed(2)}</td>
      <td class="num">${c.dfw.toFixed(1)}%</td>
      <td>${c.level}</td>
    </tr>`).join("");
}

async function init() {
  try {
    const [meta, courses] = await Promise.all([getMeta(), getCourses()]);
    initCounters(meta);
    const sorted = [...courses].sort((a, b) => a.avgGpa - b.avgGpa);
    document.getElementById("hardest").innerHTML = rows(sorted.slice(0, 5));
    document.getElementById("easiest").innerHTML = rows(sorted.slice(-5).reverse());
  } catch (err) {
    console.error(err);
    const msg = `<tr><td colspan="4" class="state">Could not load course data.</td></tr>`;
    document.getElementById("hardest").innerHTML = msg;
    document.getElementById("easiest").innerHTML = msg;
  }
}

init();

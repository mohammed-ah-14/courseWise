// Small SVG charts, no library need. Colors use CSS variables, so dark mode work automatically.
import { escapeHTML, debounce } from "./main.js";

const M = { top: 20, right: 12, bottom: 30, left: 44 };

/* Helpers ----------------------------------------------------------------- */
function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || raw;
  // Ticks always cover [min, max], so no data point go outside of the axis.
  const ticks = [];
  const last = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= last + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

// Draw the chart when it mount and again when container width change. draw(width) give back the SVG text.
export function mount(el, draw) {
  let lastWidth = 0;
  const render = () => {
    const width = Math.round(el.clientWidth);
    if (!width || width === lastWidth) return;
    lastWidth = width;
    el.innerHTML = draw(width);
  };
  if (!el._chartObserver) {
    el._chartObserver = new ResizeObserver(debounce(render, 80));
    el._chartObserver.observe(el);
    attachTooltip(el);
  }
  el._render = () => { lastWidth = 0; render(); };
  el._render();
}

// Any element inside the chart that have data-tip="<html>" will show a tooltip when mouse hover on it.
function attachTooltip(el) {
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  el.append(tip);
  el.addEventListener("pointermove", (e) => {
    const target = e.target.closest("[data-tip]");
    if (!target || !el.contains(target)) { tip.hidden = true; return; }
    if (!tip.isConnected) el.append(tip);
    const box = el.getBoundingClientRect();
    tip.innerHTML = target.dataset.tip;
    tip.hidden = false;
    const x = Math.max(70, Math.min(box.width - 70, e.clientX - box.left));
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY - box.top}px`;
  });
  el.addEventListener("pointerleave", () => { tip.hidden = true; });
}

function yAxis(ticks, y, width, format) {
  return ticks.map((t) => `
    <line class="grid-line" x1="${M.left}" x2="${width - M.right}" y1="${y(t)}" y2="${y(t)}"/>
    <text x="${M.left - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${format(t)}</text>`).join("");
}

const svgOpen = (width, height, label) =>
  `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(label)}">`;

/* Bar chart (single or grouped) ------------------------------------------- */
/**
 * labels: string[]; series: [{ name, values: number[], color, colors?: per-bar colours }]
 * opts: height, format(v), yMin, yMax, label (aria), showValues, tip(i, s) => html
 */
export function barChart(el, { labels, series, height = 260, format = String, yMin = 0, yMax, label = "Bar chart", showValues = false, tip }) {
  mount(el, (width) => {
    const max = yMax ?? Math.max(...series.flatMap((s) => s.values)) * 1.1;
    const ticks = niceTicks(yMin, max, 4);
    const top = Math.max(max, ticks.at(-1));
    const y = scale(yMin, top, height - M.bottom, M.top);
    const band = (width - M.left - M.right) / labels.length;
    const inner = Math.min(band * 0.7, 18 * series.length + 24);
    const barW = inner / series.length;
    const every = Math.ceil(labels.length / Math.max(1, Math.floor((width - M.left) / 44)));

    const bars = labels.map((lab, i) => {
      const x0 = M.left + band * i + (band - inner) / 2;
      const rects = series.map((s, j) => {
        const v = s.values[i];
        if (v == null) return "";
        const h = Math.max(0, y(yMin) - y(v));
        const tipHtml = tip ? tip(i, s) : `<strong>${escapeHTML(lab)}</strong><br>${escapeHTML(s.name || "")} ${format(v)}`;
        const valueText = showValues ? `<text class="value-label" x="${x0 + barW * j + barW / 2}" y="${y(v) - 6}" text-anchor="middle">${format(v)}</text>` : "";
        const fill = s.colors?.[i] ?? s.color;
        return `<rect x="${x0 + barW * j + 1}" y="${y(v)}" width="${Math.max(1, barW - 2)}" height="${h}" rx="3" style="fill:${fill}" data-tip="${escapeHTML(tipHtml)}"/>${valueText}`;
      }).join("");
      const text = i % every === 0 ? `<text x="${M.left + band * i + band / 2}" y="${height - M.bottom + 18}" text-anchor="middle">${escapeHTML(lab)}</text>` : "";
      return rects + text;
    }).join("");

    return `${svgOpen(width, height, label)}${yAxis(ticks, y, width, format)}
      <line class="baseline" x1="${M.left}" x2="${width - M.right}" y1="${y(yMin)}" y2="${y(yMin)}"/>${bars}</svg>`;
  });
}

/* Line chart -------------------------------------------------------------- */
/**
 * labels: x labels; series: [{ name, values, color, dashed }]
 * opts: height, format, yMin, yMax, band: { from, to, label } (shade the x range using the label value)
 */
export function lineChart(el, { labels, series, height = 260, format = String, yMin, yMax, band, label = "Line chart" }) {
  mount(el, (width) => {
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    const lo = yMin ?? Math.min(...all);
    const hi = yMax ?? Math.max(...all);
    const pad = (hi - lo) * 0.12 || 0.1;
    const ticks = niceTicks(yMin ?? lo - pad, yMax ?? hi + pad, 4);
    const y = scale(ticks[0], ticks.at(-1), height - M.bottom, M.top);
    const inset = 14; // some space, so first point and x label not touch the y-axis labels
    const step = (width - M.left - M.right - inset * 2) / Math.max(1, labels.length - 1);
    const x = (i) => M.left + inset + step * i;
    const every = Math.ceil(labels.length / Math.max(1, Math.floor((width - M.left) / 48)));

    let shade = "";
    if (band) {
      const i0 = labels.indexOf(band.from), i1 = labels.indexOf(band.to);
      if (i0 >= 0 && i1 >= 0) {
        shade = `<rect x="${x(i0) - step / 2}" y="${M.top}" width="${x(i1) - x(i0) + step}" height="${height - M.top - M.bottom}" style="fill:var(--surface-2)"/>
          <text x="${(x(i0) + x(i1)) / 2}" y="${M.top + 12}" text-anchor="middle">${escapeHTML(band.label)}</text>`;
      }
    }

    const lines = series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
      const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), "");
      const dots = pts.map((p) => (p ? `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" style="fill:${s.color}"/>` : "")).join("");
      return `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 4"' : ""}/>${dots}`;
    }).join("");

    const hovers = labels.map((lab, i) => {
      const rows = series.filter((s) => s.values[i] != null).map((s) => `${escapeHTML(s.name)}: ${format(s.values[i])}`).join("<br>");
      return `<rect x="${x(i) - step / 2}" y="${M.top}" width="${step}" height="${height - M.top - M.bottom}" fill="transparent" data-tip="${escapeHTML(`<strong>${escapeHTML(lab)}</strong><br>${rows}`)}"/>`;
    }).join("");

    const xLabels = labels.map((lab, i) => (i % every === 0
      ? `<text x="${x(i)}" y="${height - M.bottom + 18}" text-anchor="middle">${escapeHTML(lab)}</text>` : "")).join("");

    return `${svgOpen(width, height, label)}${shade}${yAxis(ticks, y, width, format)}${lines}${xLabels}${hovers}</svg>`;
  });
}

/* Horizontal bars (HTML) -------------------------------------------------- */
/** items: [{ label, sub, value, color, href }]; domain: [min, max] */
export function hbarList(el, { items, domain, format = String }) {
  const [d0, d1] = domain ?? [0, Math.max(...items.map((i) => i.value))];
  const pos = (v) => Math.max(2, ((v - d0) / (d1 - d0 || 1)) * 100);
  el.innerHTML = `<ol class="hbars" role="list">${items.map((it) => {
    const name = it.href ? `<a href="${it.href}">${escapeHTML(it.label)}</a>` : escapeHTML(it.label);
    return `<li>
      <span class="hbar-label">${name}${it.sub ? `<small>${escapeHTML(it.sub)}</small>` : ""}</span>
      <span class="hbar-track"><span style="width:${pos(it.value)}%;background:${it.color || "var(--navy)"}"></span></span>
      <span class="hbar-value num">${format(it.value)}</span>
    </li>`;
  }).join("")}</ol>`;
}

// UoS brand colors for the charts (the tokens are in base.css).
export const PALETTE = {
  ink: "var(--navy)",
  brand: "var(--brand)",
  blue: "var(--uos-blue)",
  purple: "var(--uos-purple)",
  yellow: "var(--uos-yellow)",
  orange: "var(--uos-orange)",
  muted: "var(--ink-3)",
  easy: "var(--easy)",
  medium: "var(--medium)",
  hard: "var(--hard)",
};
export const SERIES_COLORS = [PALETTE.ink, PALETTE.brand, "var(--uos-navy)"];

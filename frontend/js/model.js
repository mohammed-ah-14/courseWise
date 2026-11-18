import { getModel, getMeta } from "./data.js";
import { barChart, hbarList, PALETTE } from "./charts.js";
import { escapeHTML, fmt, initTabs, errorState } from "./main.js";

const $ = (id) => document.getElementById(id);

const TASKS = {
  gpa: { title: "Average GPA", kind: "regression", unit: "GPA points", about: "Predicts the average GPA of a course offering." },
  dfw: { title: "DFW rate", kind: "regression", unit: "share", about: "Predicts the share of students who get a D or F, or withdraw." },
  difficulty: { title: "Difficulty", kind: "classes", labels: ["Hard", "Medium", "Easy"], about: "Predicts Hard, Medium or Easy, relative to other courses in the same year." },
  high_risk: { title: "High DFW risk", kind: "classes", labels: ["No", "Yes"], about: "Predicts whether an offering is in the top 20% of DFW rates for its year." },
};

const MODEL_NAMES = {
  baseline: "Baseline (past average)", linear: "Linear (ridge)", lasso: "Lasso", svm: "SVM", knn: "k-nearest neighbours",
  decision_tree: "Decision tree", random_forest: "Random forest", xgboost: "XGBoost", lightgbm: "LightGBM",
  catboost: "CatBoost", mlp: "Neural network (MLP)", ensemble: "Ensemble (top 3)", logistic: "Logistic regression",
};
const SHORT_NAMES = { random_forest: "RF", decision_tree: "Tree", catboost: "CatBoost", xgboost: "XGB", lightgbm: "LGBM",
  baseline: "Base", mlp: "MLP", linear: "Linear", lasso: "Lasso", svm: "SVM", knn: "kNN", logistic: "Logistic" };
const modelName = (m) => MODEL_NAMES[m] || m.replace(/_/g, " ");
const shortName = (m) => SHORT_NAMES[m] || m;

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const METRICS = {
  regression: [["mae", "MAE", "lower"], ["rmse", "RMSE", "lower"], ["r2", "R²", "higher"]],
  classes: [["f1_macro", "F1 (macro)", "higher"], ["accuracy", "Accuracy", "higher"], ["roc_auc", "ROC AUC", "higher"]],
};

/* Timeline ---------------------------------------------------------------- */
function renderTimeline(split) {
  const [first, last] = [split.history[0], split.test[1]];
  const span = last - first + 1;
  const parts = [["History only", split.history, "var(--surface-2)"], ["Train", split.train, "var(--uos-green-strong)"],
    ["Validate", split.validation, "var(--uos-green-soft)"], ["Test", split.test, "var(--brand)"]];
  $("timeline").innerHTML = `<div class="timeline-bar">${parts.map(([label, [a, b], color]) => `
      <div class="timeline-seg" style="flex:${b - a + 1};--seg:${color}">
        <span class="timeline-label">${label}</span><span class="timeline-years num">${a}–${b}</span>
      </div>`).join("")}</div>
    <p class="subtle result-small">${span} years in total. Cross-validation inside the training years uses expanding windows (train up to year N, validate on N+1).</p>`;
  document.querySelectorAll('[data-split="test"]').forEach((el) => { el.textContent = split.test.join("–"); });
}

/* Task panels ------------------------------------------------------------- */
function headline(task, info) {
  const t = info.test;
  const items = TASKS[task].kind === "regression"
    ? [["Best model", modelName(info.bestModel)], ["Mean abs. error", task === "dfw" ? pct(t.mae) : `±${t.mae.toFixed(3)}`], ["RMSE", task === "dfw" ? pct(t.rmse) : t.rmse.toFixed(3)], ["R²", t.r2.toFixed(3)]]
    : [["Best model", modelName(info.bestModel)], ["F1 (macro)", t.f1_macro.toFixed(3)], ["Accuracy", pct(t.accuracy)], ...(t.roc_auc ? [["ROC AUC", t.roc_auc.toFixed(3)]] : [])];
  return `<dl class="stats">${items.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${escapeHTML(v)}</dd></div>`).join("")}</dl>`;
}

function comparisonTable(task, info) {
  const metrics = METRICS[TASKS[task].kind].filter(([key]) => info.comparison.some((r) => r[key] != null));
  const rows = info.comparison.map((r, i) => `<tr class="${r.model === info.bestModel ? "is-highlight" : ""}">
    <td class="num">${i + 1}</td><td>${escapeHTML(modelName(r.model))}</td>
    ${metrics.map(([key]) => `<td class="num">${r[key] == null ? "–" : r[key].toFixed(3)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th class="num">#</th><th>Model</th>${metrics.map(([, label, dir]) => `<th class="num">${label} <span class="subtle">(${dir} is better)</span></th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function confusionMatrix(task, info) {
  const m = info.test.confusion_matrix;
  if (!m) return "";
  const labels = TASKS[task].labels;
  const max = Math.max(...m.flat());
  const cells = m.map((row, i) => `<tr><th scope="row">${labels[i]}</th>${row.map((v, j) => {
    const a = (v / max) * 0.85 + 0.05;
    const color = i === j ? `color-mix(in srgb, var(--brand) ${a * 100}%, var(--surface))` : `color-mix(in srgb, var(--ink-3) ${a * 60}%, var(--surface))`;
    return `<td class="num" style="background:${color}">${fmt.int(v)}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="panel">
    <div class="panel-head"><h3 class="panel-title">Confusion matrix (test)</h3><span class="subtle result-small">Rows: actual · columns: predicted</span></div>
    <div class="table-wrap"><table class="table confusion"><thead><tr><th></th>${labels.map((l) => `<th class="num">${l}</th>`).join("")}</tr></thead><tbody>${cells}</tbody></table></div>
  </div>`;
}

function taskPanel(task, info) {
  const kind = TASKS[task].kind;
  const metricLabel = METRICS[kind][0][1];
  return `<div class="stack task-panel" id="panel-${task}" role="tabpanel" hidden style="gap:var(--s5)">
    <p class="muted">${TASKS[task].about}</p>
    ${headline(task, info)}
    <div class="grid ${kind === "classes" ? "grid-2" : ""}">
      <div class="panel">
        <div class="panel-head"><h3 class="panel-title">${metricLabel} by model (validation)</h3></div>
        <div class="chart" id="chart-${task}" style="min-height:240px"></div>
      </div>
      ${confusionMatrix(task, info)}
    </div>
    ${info.importance?.length ? `<div class="panel"><div class="panel-head"><h3 class="panel-title">Most important inputs</h3></div><div id="imp-${task}"></div></div>` : ""}
    ${comparisonTable(task, info)}
  </div>`;
}

function drawTaskCharts(task, info) {
  const kind = TASKS[task].kind;
  const [key, label, dir] = METRICS[kind][0];
  const rows = info.comparison.filter((r) => r[key] != null);
  barChart($(`chart-${task}`), {
    labels: rows.map((r) => shortName(r.model)),
    series: [{ name: label, values: rows.map((r) => r[key]), colors: rows.map((r) => (r.model === info.bestModel ? PALETTE.brand : PALETTE.ink)) }],
    yMin: dir === "lower" ? 0 : Math.max(0, Math.min(...rows.map((r) => r[key])) - 0.05),
    format: (v) => v.toFixed(3), label: `${label} by model`,
    tip: (i) => `<strong>${escapeHTML(modelName(rows[i].model))}</strong><br>${label} ${rows[i][key].toFixed(4)}`,
  });
  if (info.importance?.length) {
    const top = info.importance.slice(0, 10);
    hbarList($(`imp-${task}`), {
      items: top.map((f) => ({ label: f.feature.replace(/_/g, " "), value: f.importance, color: PALETTE.ink })),
      format: (v) => v.toFixed(3),
    });
  }
}

function renderTasks(tasks) {
  const names = Object.keys(TASKS).filter((t) => tasks[t]);
  $("task-tabs").innerHTML = names.map((t, i) =>
    `<button class="tab" role="tab" aria-selected="${i === 0}" aria-controls="panel-${t}" data-task="${t}">${TASKS[t].title}</button>`).join("");
  $("task-panels").innerHTML = names.map((t) => taskPanel(t, tasks[t])).join("");
  const drawn = new Set();
  initTabs($("task-tabs"), (panelId) => {
    const task = panelId.replace("panel-", "");
    // Charts measure their container, so draw a task only once its panel is visible.
    if (!drawn.has(task)) { drawn.add(task); drawTaskCharts(task, tasks[task]); }
  });
}

/* Data facts -------------------------------------------------------------- */
function renderMeta(meta) {
  document.querySelectorAll("[data-meta]").forEach((el) => { el.textContent = meta[el.dataset.meta]; });
  const facts = [["Student grades", fmt.compact(meta.gradeRecords)], ["Courses", fmt.int(meta.totalCourses)], ["Instructors", fmt.int(meta.instructors)], ["Subjects", fmt.int(meta.subjects.length)]];
  $("data-facts").innerHTML = facts.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

async function init() {
  try {
    const [model, meta] = await Promise.all([getModel(), getMeta()]);
    renderTimeline(model.split);
    renderTasks(model.tasks);
    renderMeta(meta);
  } catch (err) {
    console.error(err);
    $("task-panels").innerHTML = errorState("Could not load the model report.");
  }
}

init();

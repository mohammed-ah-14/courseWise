// CourseWise — loading the data.
// The static JSON files are made by `python3 -m coursewise export` (backend).
// Live forecast come from `python3 -m coursewise serve`. If it is not running, the site use only the static files.

const API_URL = "http://127.0.0.1:8000/api/";
const API_TIMEOUT_MS = 1500; // only for health check; one forecast can take few seconds

const cache = new Map();

function load(path) {
  if (!cache.has(path)) {
    const promise = fetch(new URL(`../data/${path}.json`, import.meta.url)).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${path}.json (${res.status})`);
      return res.json();
    });
    promise.catch(() => cache.delete(path));
    cache.set(path, promise);
  }
  return cache.get(path);
}

export const getCourses = () => load("courses").then((d) => d.courses);
export const getMeta = () => load("courses").then((d) => d.meta);
export const getInsights = () => load("insights");
export const getModel = () => load("model");

export async function getCourse(id) {
  const courses = await getCourses();
  return courses.find((c) => c.id === id);
}

// The detail (grades, trend, terms, instructors, predictions) is saved in one file for each subject.
export async function getCourseDetail(course) {
  const subject = await load(`subjects/${course.subject}`);
  return subject[course.id];
}

/* Live model API ---------------------------------------------------------- */
async function api(endpoint, params = {}, { timeout } = {}) {
  const url = new URL(endpoint, API_URL);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  const res = await fetch(url, { signal: timeout ? AbortSignal.timeout(timeout) : undefined });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `API error ${res.status}`);
  return body;
}

let health;
// Give back { dataUntil, terms, ... } if the live model is running, if not it give null. We check only one time per page.
export function getLiveModel() {
  health ??= api("health", {}, { timeout: API_TIMEOUT_MS }).catch(() => null);
  return health;
}

export const getForecastOptions = (courseId) => api("options", { course: courseId });

// Send { course, term, instructor?, format? } and get the forecast for the next term.
export const getForecast = ({ course, term, instructor, format }) => api("predict", { course, term, instructor, format });

const normalise = (s) => s.toLowerCase().replace(/\s+/g, "");

// Ranking: exact code > code prefix > title word prefix > anywhere. If same rank, the bigger course go first.
export function searchCourses(courses, query, limit = 8, filter = () => true) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qCode = normalise(q);
  const scored = [];
  for (const c of courses) {
    if (!filter(c)) continue;
    const code = normalise(c.code);
    const title = c.title.toLowerCase();
    let score = 0;
    if (code === qCode) score = 4;
    else if (code.startsWith(qCode)) score = 3;
    else if (title.startsWith(q) || title.includes(` ${q}`)) score = 2;
    else if (title.includes(q) || code.includes(qCode)) score = 1;
    if (score) scored.push([score, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].students - a[1].students);
  return scored.slice(0, limit).map(([, c]) => c);
}

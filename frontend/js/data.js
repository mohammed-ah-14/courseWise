// CourseWise — data loading. Files are produced by `python3 -m coursewise export` (backend).
// To switch to a live model API later, only these functions need to change.

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

// Detail (grades, trend, terms, instructors, predictions) lives in one file per subject.
export async function getCourseDetail(course) {
  const subject = await load(`subjects/${course.subject}`);
  return subject[course.id];
}

const normalise = (s) => s.toLowerCase().replace(/\s+/g, "");

// Rank: exact code > code prefix > title word prefix > anywhere. Bigger courses first on ties.
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

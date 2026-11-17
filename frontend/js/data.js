// CourseWise — data loading. Swap paths for the model API later (Stage 2).

const cache = new Map();

async function load(name) {
  if (cache.has(name)) return cache.get(name);
  const promise = fetch(`data/${name}.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
    return res.json();
  });
  cache.set(name, promise);
  return promise;
}

export const getCourses = () => load("courses").then((d) => d.courses);
export const getMeta = () => load("courses").then((d) => d.meta);
export const getCourse = async (id) => (await getCourses()).find((c) => c.id === id);

// Saved course lists shared between pages (planner, compare), kept in localStorage.
import { store, toast } from "./main.js";

const KEYS = { planner: "cw-planner", compare: "cw-compare" };
const LIMITS = { planner: 8, compare: 3 };

export const getList = (name) => store.get(KEYS[name], []);
export const setList = (name, ids) => store.set(KEYS[name], ids);

export function addToList(name, id, { silent = false } = {}) {
  const ids = getList(name);
  const label = name === "planner" ? "planner" : "comparison";
  if (ids.includes(id)) {
    if (!silent) toast(`Already in your ${label}`);
    return false;
  }
  if (ids.length >= LIMITS[name]) {
    toast(`Your ${label} is full (max ${LIMITS[name]})`, { type: "error" });
    return false;
  }
  setList(name, [...ids, id]);
  if (!silent) toast(`Added to your ${label}`);
  return true;
}

export function removeFromList(name, id) {
  setList(name, getList(name).filter((x) => x !== id));
}

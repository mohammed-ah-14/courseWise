// Course autocomplete for a text input (keyboard + mouse, ARIA combobox).
import { searchCourses } from "./data.js";
import { escapeHTML, difficultyBadge } from "./main.js";

let uid = 0;

/**
 * @param {HTMLInputElement} input  must sit inside an element with class "ac"
 * @param {object} opts
 *   getCourses: () => course[]          (already loaded list)
 *   onSelect:   (course) => void
 *   filter:     (course) => boolean     optional
 *   clearOnSelect: boolean              empty the input after choosing
 */
export function attachAutocomplete(input, { getCourses, onSelect, filter, clearOnSelect = false, limit = 8 }) {
  const list = document.createElement("ul");
  list.className = "ac-list";
  list.id = `ac-list-${++uid}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.after(list);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };

  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", j === i));
    list.children[i]?.scrollIntoView({ block: "nearest" });
  };

  const choose = (course) => {
    input.value = clearOnSelect ? "" : course.code;
    close();
    onSelect(course);
  };

  const render = () => {
    results = searchCourses(getCourses() || [], input.value, limit, filter);
    if (!input.value.trim()) return close();
    list.innerHTML = results.length
      ? results.map((c, i) => `<li role="option" id="${list.id}-${i}" data-i="${i}">
          <span class="ac-code">${escapeHTML(c.code)}</span>
          <span class="ac-title">${escapeHTML(c.title)}</span>
          ${difficultyBadge(c.difficulty)}
        </li>`).join("")
      : '<li class="ac-empty">No matching course</li>';
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(results.length ? 0 : -1);
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", () => input.value.trim() && render());
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    e.preventDefault();
    choose(results[Number(li.dataset.i)]);
  });
  input.addEventListener("blur", () => setTimeout(close, 100));

  return { close, results: () => results };
}

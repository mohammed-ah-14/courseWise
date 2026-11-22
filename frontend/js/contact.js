// Contact page: form with checking, rating and message length limit.
import { ICONS, escapeHTML } from "./main.js";

const $ = (id) => document.getElementById(id);
const MIN_MESSAGE = 20;
const MAX_MESSAGE = 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RATING_LABELS = ["Not useful", "Slightly useful", "Useful", "Very useful", "Essential"];

let rating = 0;

const RULES = {
  name: (v) => (v.trim().length >= 2 ? "" : "Enter your name."),
  email: (v) => (!v.trim() ? "Enter your email." : EMAIL.test(v.trim()) ? "" : "That email doesn't look right."),
  topic: (v) => (v ? "" : "Choose a topic."),
  message: (v) => (v.trim().length >= MIN_MESSAGE ? "" : `Write at least ${MIN_MESSAGE} characters (${v.trim().length} so far).`),
  agree: (_, el) => (el.checked ? "" : "Please tick this box to continue."),
};

function check(id) {
  const el = $(id);
  const message = RULES[id](el.value, el);
  $(`${id}-error`).textContent = message;
  el.setAttribute("aria-invalid", Boolean(message));
  return !message;
}

function renderStars() {
  $("stars").innerHTML = RATING_LABELS.map((label, i) => `
    <button type="button" role="radio" class="star${i < rating ? " is-on" : ""}" aria-checked="${i + 1 === rating}" aria-label="${i + 1}: ${label}" data-value="${i + 1}">${ICONS.star}</button>`).join("")
    + `<span class="subtle star-label">${rating ? RATING_LABELS[rating - 1] : ""}</span>`;
}

function init() {
  renderStars();
  $("stars").addEventListener("click", (e) => {
    const star = e.target.closest("[data-value]");
    if (!star) return;
    const value = Number(star.dataset.value);
    rating = value === rating ? 0 : value;
    renderStars();
    $("stars").querySelector(`[data-value="${value}"]`).focus();
  });

  $("message").addEventListener("input", (e) => {
    $("counter").textContent = `${e.target.value.length} / ${MAX_MESSAGE}`;
  });
  // Check the field when user leave it. After it show an error, check again while user is typing.
  Object.keys(RULES).forEach((id) => {
    $(id).addEventListener("blur", () => $(id).value && check(id));
    $(id).addEventListener("input", () => $(id).getAttribute("aria-invalid") === "true" && check(id));
    $(id).addEventListener("change", () => $(id).getAttribute("aria-invalid") === "true" && check(id));
  });

  $("contact-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const results = Object.keys(RULES).map(check);
    const firstBad = Object.keys(RULES)[results.indexOf(false)];
    if (firstBad) return $(firstBad).focus();
    $("done-text").innerHTML = `Thanks, ${escapeHTML($("name").value.trim().split(" ")[0])}. Your note about <strong>${escapeHTML($("topic").value.toLowerCase())}</strong> was recorded.`;
    $("contact-form").hidden = true;
    $("contact-done").hidden = false;
    $("contact-done").focus();
  });

  $("again").addEventListener("click", () => {
    $("contact-form").reset();
    rating = 0;
    renderStars();
    $("counter").textContent = `0 / ${MAX_MESSAGE}`;
    $("contact-done").hidden = true;
    $("contact-form").hidden = false;
    $("name").focus();
  });
}

init();

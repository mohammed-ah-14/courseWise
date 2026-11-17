// Runs in <head> before paint to avoid a light/dark flash.
(function () {
  var theme;
  try { theme = localStorage.getItem("cw-theme"); } catch (e) {}
  if (!theme) theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();

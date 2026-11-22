// This run inside <head> before the page paint, so there is no flash between light and dark.
(function () {
  var theme;
  try { theme = localStorage.getItem("cw-theme"); } catch (e) {}
  if (!theme) theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();

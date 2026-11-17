// Applies the saved theme before the first paint to avoid a light flash in dark mode.
(function () {
  try {
    var stored = localStorage.getItem('hh-theme');
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    // Storage may be unavailable (private mode): the system theme applies.
  }
})();

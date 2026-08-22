(function () {
  const storageKey = 'feedbackhub-theme';
  const root = document.documentElement;
  const saved = localStorage.getItem(storageKey);
  function applySavedTheme() {
    if (saved === 'dark') document.body.classList.add('dark-mode');
    updateButtons();
  }

  function updateButtons() {
    const dark = document.body.classList.contains('dark-mode');
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.innerHTML = dark ? '☀️ <span>Light mode</span>' : '🌙 <span>Dark mode</span>';
    });
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  window.toggleTheme = function () {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem(storageKey, document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    updateButtons();
    document.dispatchEvent(new CustomEvent('themechange', { detail: { dark: document.body.classList.contains('dark-mode') } }));
  };

  if (document.body) applySavedTheme();
  else document.addEventListener('DOMContentLoaded', applySavedTheme);
}());

(() => {
  const root = document.documentElement;
  const key = 'crawlio-theme-v1';
  const media = matchMedia('(prefers-color-scheme: dark)');
  root.dataset.theme = 'light';
  try {
    const stored = localStorage.getItem(key) || localStorage.getItem('seointel-theme-v2');
    if (stored === 'dark' || stored === 'light') root.dataset.theme = stored;
  } catch {}
  const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : media.matches;
  const update = () => document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.hidden = false;
    button.textContent = dark() ? 'Light mode' : 'Dark mode';
    button.setAttribute('aria-label', dark() ? 'Switch to light theme' : 'Switch to dark theme');
  });
  document.addEventListener('DOMContentLoaded', () => {
    update();
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      root.dataset.theme = dark() ? 'light' : 'dark';
      try { localStorage.setItem(key, root.dataset.theme); } catch {}
      update();
    }));
  }, { once: true });
  media.addEventListener('change', update);
  addEventListener('storage', event => {
    if (event.key !== key) return;
    if (event.newValue === 'light' || event.newValue === 'dark') root.dataset.theme = event.newValue;
    else delete root.dataset.theme;
    update();
  });
})();

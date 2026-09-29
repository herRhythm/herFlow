// Runs in the head so the selected theme is applied before the page is painted.
(function () {
  var root = document.documentElement;
  var theme = 'light';
  try { if (localStorage.getItem('cg_theme') === 'dark') theme = 'dark'; } catch (e) {}
  root.setAttribute('data-theme', theme);

  function mount() {
    var button = document.getElementById('themeToggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'themeToggle';
      button.className = 'theme-toggle';
      document.body.appendChild(button);
    }
    button.type = 'button';
    function apply(next, persist) {
      root.setAttribute('data-theme', next);
      var dark = next === 'dark';
      var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = '<span aria-hidden="true">' + (dark ? '☀' : '☾') + '</span><span>' + (dark ? 'Light' : 'Dark') + '</span>';
      if (persist) { try { localStorage.setItem('cg_theme', next); } catch (e) {} }
    }
    apply(theme, false);
    button.addEventListener('click', function () {
      apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });
    window.addEventListener('storage', function (event) {
      if (event.key === 'cg_theme' || event.key === null) apply(event.newValue === 'dark' ? 'dark' : 'light', false);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const pages = ['index', 'about', 'checkout', 'companion-guide', 'becoming-you', 'companion', 'menarche', 'rising-moon', 'walking-beside-her'].map(name => name + '.html');
pages.push('files/HerRhythm_Companion_Guide_Digital_2.html');

test('all live pages use one theme controller and stylesheet without inline theme code', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(page, root), 'utf8');
    assert.equal((html.match(/<script\b[^>]*src="(?:\.\.\/)?assets\/theme\.js[^\"]*"/g) || []).length, 1, page);
    assert.equal((html.match(/<link\b[^>]*href="(?:\.\.\/)?assets\/theme\.css[^\"]*"/g) || []).length, 1, page);
    assert.doesNotMatch(html, /cg_theme|id="themeToggle"|data-theme\s*=|prefers-color-scheme|css\/(?:themes\/light|base\/tokens|components\/theme-toggle)\.css/, page);
  }
});

test('live component styles delegate theme overrides to assets/theme.css', () => {
  function check(dir) {
    for (const item of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const path = dir + '/' + item.name;
      if (item.isDirectory()) check(path);
      else if (item.name.endsWith('.css')) assert.doesNotMatch(readFileSync(new URL(path, root), 'utf8'), /data-theme\s*=|prefers-color-scheme|#themeToggle|\.theme-toggle/, path);
    }
  }
  check('css');
  for (const path of ['assets/checkout.css', 'assets/client-feedback.css']) assert.doesNotMatch(readFileSync(new URL(path, root), 'utf8'), /data-theme\s*=|prefers-color-scheme|#themeToggle|\.theme-toggle/, path);
});

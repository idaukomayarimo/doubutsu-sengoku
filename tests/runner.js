/*
 * ごく小さなテストランナー（ブラウザで tests/index.html を開くと実行）
 *   test('名前', () => { expect(実際).toBe(期待); });
 * 結果は画面と window.__testResults（{ passed, failed, failures }）に出る。
 */
window.TestRunner = (() => {
  'use strict';

  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  const fmt = (v) => {
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  function expect(actual) {
    const fail = (msg) => { throw new Error(msg); };
    return {
      toBe: (expected) => { if (actual !== expected) fail(`期待 ${fmt(expected)} / 実際 ${fmt(actual)}`); },
      toEqual: (expected) => { if (fmt(actual) !== fmt(expected)) fail(`期待 ${fmt(expected)} / 実際 ${fmt(actual)}`); },
      toBeTruthy: () => { if (!actual) fail(`真であるべき / 実際 ${fmt(actual)}`); },
      toBeFalsy: () => { if (actual) fail(`偽であるべき / 実際 ${fmt(actual)}`); },
      toBeGreaterThan: (n) => { if (!(actual > n)) fail(`${fmt(actual)} は ${n} より大きいべき`); },
      toBeLessThan: (n) => { if (!(actual < n)) fail(`${fmt(actual)} は ${n} より小さいべき`); },
    };
  }

  function run() {
    const list = document.getElementById('results');
    const failures = [];
    cases.forEach(({ name, fn }) => {
      const li = document.createElement('li');
      try {
        fn();
        li.className = 'pass';
        li.textContent = `✓ ${name}`;
      } catch (err) {
        failures.push({ name, message: err.message });
        li.className = 'fail';
        li.textContent = `✗ ${name}`;
        const pre = document.createElement('pre');
        pre.textContent = err.stack || err.message;
        li.appendChild(pre);
      }
      list.appendChild(li);
    });
    const passed = cases.length - failures.length;
    const summary = document.getElementById('summary');
    summary.textContent = `${passed} / ${cases.length} 件成功${failures.length ? `（${failures.length} 件失敗）` : ''}`;
    summary.className = failures.length ? 'fail' : 'pass';
    window.__testResults = { passed, failed: failures.length, failures };
  }

  window.test = test;
  window.expect = expect;
  return { run };
})();

// Interface language (src/i18n): t() and its keys. Every t('…') / tj('…') in src/ passes string
// literals, and each has a Simplified Chinese translation with the same {placeholders}.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadBundled } from './bundle.mjs';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };

const m = await loadBundled(`
  export { t, tj, tc, translate, detectLocale, locale } from './src/i18n';
  export { default as zhCN } from './src/i18n/zh-CN';
`);

const root = fileURLToPath(new URL('..', import.meta.url));
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [join(dir, e.name)] : [],
  );

/** Every key passed to t() / tj() in src/, with where; and calls whose key isn't a literal. */
function keysInSource() {
  const keys = new Map();
  const dynamic = [];
  for (const file of files(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (!/\bt[jc]?\(/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (node) => `${relative(root, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const literals = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
      if (ts.isParenthesizedExpression(node)) return literals(node.expression);
      if (ts.isConditionalExpression(node)) {
        const a = literals(node.whenTrue);
        const b = literals(node.whenFalse);
        return a && b ? [...a, ...b] : null;
      }
      return null;
    };
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(t|tj|tc)$/.test(node.expression.text) && node.arguments.length) {
        const isTc = node.expression.text === 'tc';
        const context = isTc ? literals(node.arguments[0]) : null;
        const texts = literals(node.arguments[isTc ? 1 : 0]);
        const found = isTc ? (context?.length === 1 && texts ? texts.map((x) => `${x}|${context[0]}`) : null) : texts;
        if (found) for (const k of found) keys.set(k, keys.get(k) ?? where(node));
        else dynamic.push(`${where(node)}: ${node.arguments[0].getText(sf).slice(0, 80)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { keys, dynamic };
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');

test('t() falls back to the English and fills placeholders', () => {
  assert.equal(m.locale, 'en', 'tests run in English');
  assert.equal(m.t('Save'), 'Save');
  assert.equal(m.t('Delete {name}?', { name: 'Ada' }), 'Delete Ada?');
  assert.equal(m.translate({ 'Delete {name}?': '删除 {name}？' }, 'Delete {name}?', { name: 'Ada' }), '删除 Ada？');
  assert.equal(m.translate({}, 'Not translated', undefined), 'Not translated');
  assert.equal(m.translate({ a: '' }, 'a'), 'a', 'an empty translation is no translation');
  assert.equal(m.translate(null, 'Keep {braces} without vars'), 'Keep {braces} without vars');
});

test('the browser language picks Chinese or English unless the person chose one', () => {
  assert.equal(m.detectLocale('auto', ['zh-CN', 'en']), 'zh-CN');
  assert.equal(m.detectLocale('auto', ['zh-TW']), 'zh-CN');
  assert.equal(m.detectLocale('auto', ['en-US', 'zh-CN']), 'en');
  assert.equal(m.detectLocale('auto', ['de-DE']), 'en');
  assert.equal(m.detectLocale('auto', []), 'en');
  assert.equal(m.detectLocale('en', ['zh-CN']), 'en');
  assert.equal(m.detectLocale('zh-CN', ['en-US']), 'zh-CN');
});

test('every t() key is a literal with a Chinese translation and the same placeholders', () => {
  const { keys, dynamic } = keysInSource();
  assert.deepEqual(dynamic, [], 'pass a literal to t()/tj(), or use tDynamic() for run-time text');
  const missing = [...keys].filter(([k]) => !m.zhCN[k]).map(([k, at]) => `${at}: ${JSON.stringify(k)}`);
  assert.deepEqual(missing, [], `${missing.length} key(s) without a zh-CN translation`);
  const mismatched = [...keys]
    .filter(([k]) => m.zhCN[k] && placeholders(k) !== placeholders(m.zhCN[k]))
    .map(([k, at]) => `${at}: ${JSON.stringify(k)} → ${JSON.stringify(m.zhCN[k])}`);
  assert.deepEqual(mismatched, [], 'a translation keeps the same {placeholders}');
});

test('tc() picks the translation for its context and reads plain English', () => {
  assert.equal(m.tc('task status', 'Review'), 'Review');
  assert.equal(m.tc('task status', 'Done {n}', { n: 2 }), 'Done 2');
});

test('tj() puts React nodes in the placeholders', () => {
  const parts = m.tj('Press {key} to send', { key: 'KEY' });
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.props.children), ['Press ', 'KEY', ' to send']);
});

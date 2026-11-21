import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Load just the component in memory. The stylesheet is not needed for SSR.
const component = new URL('../src/components/MathText.tsx', import.meta.url);
const stylesheet = import.meta.resolve('katex/dist/katex.min.css');
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === stylesheet) return { format: 'module', source: '', shortCircuit: true };
    if (url !== component.href) return nextLoad(url, context);
    const { outputText } = ts.transpileModule(readFileSync(component, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
const { MathText } = await import(component.href);
hooks.deregister();

function render(text) {
  const html = renderToStaticMarkup(createElement(MathText, { text }));
  assert.ok(!html.includes('katex-error'), `KaTeX rejected a segment of ${text}`);
  return html;
}

function modes(html) {
  return Array.from(html.matchAll(/<math\b([^>]*)>/g), ([, attrs]) => attrs.includes('display="block"') ? 'block' : 'inline');
}

test('all four fences preserve MathML mode and surrounding text', () => {
  const html = render(String.raw`作代换 $x=\sin t$，then \(dx=\cos t\,dt\)，得到 $$\frac{u}{v}$$ 和
\[
\frac{a}{b}
\]。`);
  assert.deepEqual(modes(html), ['inline', 'inline', 'block', 'block']);
  assert.equal(html.match(/class="math-display"/g)?.length, 2);
  assert.equal(html.match(/<mfrac>/g)?.length, 2);
  for (const text of ['作代换 ', '，then ', '，得到 ', ' 和\n', '。']) assert.ok(html.includes(`>${text}</span>`));
});

test('determinant row breaks and the bank’s doubly wrapped inline options', () => {
  const html = render(String.raw`行列式 $\begin{vmatrix}a&b\\[2pt]c&d\end{vmatrix}$ 取值 $\(-1\quad 2\)$ 或 $\(2\quad -1\)$（ ）.`);
  assert.deepEqual(modes(html), ['inline', 'inline', 'inline']);
  assert.match(html, /<mtable\b/);
  assert.equal(html.match(/<mtr>/g)?.length, 2);
  assert.ok(html.includes('> 或 </span>'));
  assert.ok(html.includes('>（ ）.</span>'));
});

test('unmatched fences and escaped dollars stay in prose, later pairs still render', () => {
  const html = render(String.raw`价格 \$5，错配 \[a\)，未闭 $$u

下一段 $$v$$，\(w\)，$x$$y$。`);
  assert.deepEqual(modes(html), ['block', 'inline', 'inline', 'inline']);
  assert.ok(html.includes(String.raw`价格 \$5，错配 \[a\)，未闭 $$u`));
  assert.ok(html.includes('下一段 </span>'));
  assert.ok(render(String.raw`\[费用 = \$5\]`).includes('display="block"'));
  const sameLine = render('价格 $5，另有公式 $$z$$。');
  assert.deepEqual(modes(sameLine), ['block']);
  assert.ok(sameLine.includes('>价格 $5，另有公式 </span>'));
});

test('dollars inside a TeX text argument belong to the enclosing formula', () => {
  const html = render(String.raw`$$\text{when $x^{2}$ is positive}\quad x\ne 0$$`);
  assert.deepEqual(modes(html), ['block']);
  assert.match(html, /<msup>/);
});

test('plain parentheses, text commands, fill-in blanks and spacing keep their meaning', () => {
  const html = render(String.raw`说明 (English)（中文）\text{取值范围}：\underline{\hspace{2em}}（\quad）`);
  assert.deepEqual(modes(html), ['inline']);
  assert.ok(html.includes('>说明 (English)（中文）</span>'));
  assert.ok(html.includes('>取值范围</span>'));
  assert.match(html, /class="latex-blank" aria-label="填空"/);
  assert.ok(html.includes('>（</span>'));
  assert.ok(html.includes('>）</span>'));
});

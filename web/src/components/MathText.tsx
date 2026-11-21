import katex from 'katex';
import type { ReactNode } from 'react';
import 'katex/dist/katex.min.css';

const BARE_LATEX = /\\text\{[^{}]*\}|\\underline\{\\hspace\{[^{}]*\}\}|\\underline\{[^{}]*\}|\\qquad|\\quad/g;

function renderPlain(part: string, key: number) {
  if (!part.includes('\\')) return <span key={key}>{part}</span>;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of part.matchAll(BARE_LATEX)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(<span key={`${key}-text-${last}`}>{part.slice(last, index)}</span>);
    const textMatch = match[0].match(/^\\text\{([^{}]*)\}$/);
    if (textMatch) {
      nodes.push(<span key={`${key}-plain-${index}`}>{textMatch[1]}</span>);
    } else if (/^\\underline\{(?:(?:\\qquad|\\hspace\{[^{}]*\}|\s)*)\}$/.test(match[0])) {
      nodes.push(<span key={`${key}-blank-${index}`} className="latex-blank" aria-label="填空" />);
    } else {
      try {
        nodes.push(<span key={`${key}-math-${index}`} dangerouslySetInnerHTML={{ __html: katex.renderToString(match[0], { throwOnError: false, strict: false }) }} />);
      } catch {
        nodes.push(<code key={`${key}-raw-${index}`}>{match[0]}</code>);
      }
    }
    last = index + match[0].length;
  }
  if (last < part.length) nodes.push(<span key={`${key}-tail`}>{part.slice(last)}</span>);
  return <span key={key}>{nodes}</span>;
}

const closingFence: Record<string, string> = {
  '$': '$', '$$': '$$', '\\(': '\\)', '\\[': '\\]',
  '$\\(': '\\)$', // Some exported options wrap one inline formula twice.
};

export function MathText({ text }: { text: string }) {
  const source = String(text || '');
  const nodes: ReactNode[] = [];
  const fences = /(\\[\\${}])|[{}]|\$\\\(|\$\$?|\\[()[\]]|\r?\n[ \t]*\r?\n/g;
  let plainStart = 0;
  let open: RegExpExecArray | null = null;
  let braceDepth = 0;
  let token: RegExpExecArray | null;
  while ((token = fences.exec(source))) {
    const [marker, escaped] = token;
    if (escaped) continue;
    if (marker === '{' || marker === '}') {
      if (open) braceDepth = Math.max(0, braceDepth + (marker === '{' ? 1 : -1));
      continue;
    }
    // A delimiter inside a TeX argument (e.g. \text{when $x$ ...}) belongs to KaTeX.
    if (braceDepth && !marker.includes('\n')) continue;
    const startsBlock = open?.[0] === '$' && marker === '$$' && /\s/.test(source[token.index - 1]);
    if (!open || startsBlock || !source.startsWith(closingFence[open[0]], token.index)) {
      // An incompatible fence or a blank line leaves the unfinished span in prose.
      open = closingFence[marker] ? token : null;
      braceDepth = 0;
      continue;
    }
    const [left] = open;
    const start = open.index;
    const end = token.index + closingFence[left].length;
    if (start > plainStart) nodes.push(renderPlain(source.slice(plainStart, start), plainStart));
    const display = left === '$$' || left === '\\[';
    const latex = source.slice(start + left.length, token.index);
    try {
      const html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: false });
      nodes.push(<span key={start} className={display ? 'math-display' : undefined} dangerouslySetInnerHTML={{ __html: html }} />);
    } catch { nodes.push(<code key={start}>{source.slice(start, end)}</code>); }
    fences.lastIndex = end;
    plainStart = end;
    open = null;
  }
  if (plainStart < source.length) nodes.push(renderPlain(source.slice(plainStart), plainStart));
  return <span className="math-text">{nodes}</span>;
}

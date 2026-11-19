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

export function MathText({ text }: { text: string }) {
  const normalized = String(text || '')
    .replace(/\\\(/g, '$').replace(/\\\)/g, '$')
    .replace(/\\\[/g, '$$').replace(/\\\]/g, '$$');
  const parts = normalized.split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$)/g);
  return <span className="math-text">{parts.map((part, index) => {
    const match = part.match(/^(\$\$?)([\s\S]*)\1$/);
    if (!match) return renderPlain(part, index);
    const display = match[1] === '$$';
    try {
      return <span key={index} className={display ? 'math-display' : undefined} dangerouslySetInnerHTML={{ __html: katex.renderToString(match[2], { displayMode: display, throwOnError: false, strict: false }) }} />;
    } catch { return <code key={index}>{part}</code>; }
  })}</span>;
}

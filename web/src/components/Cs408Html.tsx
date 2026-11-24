import katex from 'katex';
import { useMemo } from 'react';

function sanitizeAndRender(html: string): string {
  if (!html) return '';
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || /^\s*javascript:/i.test(attribute.value)) node.removeAttribute(attribute.name);
    }
  });
  template.content.querySelectorAll('span.formula[data-tex]').forEach(span => {
    const tex = span.getAttribute('data-tex') || '';
    try {
      span.outerHTML = katex.renderToString(tex, { throwOnError: false, strict: false });
    } catch {
      // Keep the original text when KaTeX cannot parse a formula.
    }
  });
  return template.innerHTML;
}

export function Cs408Html({ html, className = '' }: { html: string; className?: string }) {
  const rendered = useMemo(() => sanitizeAndRender(html), [html]);
  return <div className={`cs408-html ${className}`.trim()} dangerouslySetInnerHTML={{ __html: rendered }} />;
}

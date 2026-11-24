import type { CSSProperties } from 'react';

const formulas = [
  { text: 'lim x→0 sin x / x = 1', left: '2%', top: '14%', size: 40, rotate: -8, duration: 38, delay: -4 },
  { text: 'lim x→0 sin x / x = 1', left: '73%', top: '66%', size: 32, rotate: 6, duration: 46, delay: -16 },
  { text: 'lim (1 + 1/x)ˣ = e', left: '71%', top: '16%', size: 34, rotate: 5, duration: 44, delay: -12 },
  { text: '∫₀¹ x² dx = 1/3', left: '4%', top: '47%', size: 32, rotate: 4, duration: 41, delay: -8 },
  { text: 'Σ 1/n² = π²/6', left: '7%', top: '78%', size: 34, rotate: -4, duration: 47, delay: -18 },
  { text: 'det(A) = λ₁λ₂⋯λₙ', left: '68%', top: '37%', size: 30, rotate: -5, duration: 43, delay: -22 },
  { text: 'rank(A) + nullity(A) = n', left: '22%', top: '90%', size: 25, rotate: -2, duration: 49, delay: -15 },
  { text: 'f′(x) = dy/dx', left: '43%', top: '7%', size: 26, rotate: -3, duration: 52, delay: -24 },
  { text: 'e^(iπ) + 1 = 0', left: '86%', top: '54%', size: 27, rotate: 5, duration: 43, delay: -10 },
  { text: 'AᵀA', left: '53%', top: '47%', size: 36, rotate: 7, duration: 36, delay: -6 },
];

const cs408Glyphs = [
  { text: 'O(n log n)', left: '2%', top: '14%', size: 38, rotate: -6, duration: 38, delay: -4 },
  { text: 'TCP / IP', left: '73%', top: '66%', size: 32, rotate: 5, duration: 46, delay: -16 },
  { text: 'Cache 命中', left: '71%', top: '16%', size: 31, rotate: 4, duration: 44, delay: -12 },
  { text: '进程 ↔ 线程', left: '4%', top: '47%', size: 29, rotate: 3, duration: 41, delay: -8 },
  { text: '二叉树遍历', left: '7%', top: '78%', size: 31, rotate: -4, duration: 47, delay: -18 },
  { text: 'Dijkstra', left: '68%', top: '37%', size: 29, rotate: -5, duration: 43, delay: -22 },
  { text: 'inode → 簇', left: '22%', top: '90%', size: 24, rotate: -2, duration: 49, delay: -15 },
  { text: 'CSMA/CD', left: '43%', top: '7%', size: 27, rotate: -3, duration: 52, delay: -24 },
  { text: 'PV 操作', left: '86%', top: '54%', size: 27, rotate: 5, duration: 43, delay: -10 },
  { text: 'OSI 7 层', left: '53%', top: '47%', size: 32, rotate: 6, duration: 36, delay: -6 },
];

export function MathBackdrop({ subject = 'math2' }: { subject?: 'math2' | 'cs408' }) {
  const glyphs = subject === 'cs408' ? cs408Glyphs : formulas;
  return <div className={`math-backdrop ${subject === 'cs408' ? 'cs408-backdrop' : ''}`} aria-hidden="true">
    {glyphs.map((formula, index) => <span
      className={`math-glyph ${subject === 'cs408' ? 'cs408-glyph' : ''}`}
      key={index}
      style={{
        left: formula.left,
        top: formula.top,
        fontSize: `${formula.size}px`,
        '--math-rotate': `${formula.rotate}deg`,
        animationDuration: `${formula.duration}s`,
        animationDelay: `${formula.delay}s`,
      } as CSSProperties}
    >{formula.text}</span>)}
  </div>;
}

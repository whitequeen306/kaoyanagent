import type { FigureAsset } from '../types';

export function QuestionFigures({ assets }: { assets?: FigureAsset[] | null }) {
  if (!assets?.length) return null;
  return <div className="question-figures">{assets.map(asset => (
    <figure key={asset.id}>
      <img src={asset.url} alt={asset.alt || '题目图形'} width={asset.width} height={asset.height} />
    </figure>
  ))}</div>;
}

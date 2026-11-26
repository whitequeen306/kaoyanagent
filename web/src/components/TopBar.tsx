type Subject = 'math2' | 'cs408';
type MathView = 'repair' | 'compose' | 'paper' | 'wrong' | 'papers' | 'examPapers' | 'agent';
type Cs408View = 'compose' | 'repair' | 'papers' | 'paper' | 'wrong' | 'history' | 'agent';

export function TopBar({ subject, view, cs408View, onSwitchSubject, onBrand, onOpenSettings, actions }: {
  subject: Subject;
  view: MathView;
  cs408View: Cs408View;
  onSwitchSubject: (subject: Subject) => void;
  onBrand: () => void;
  onOpenSettings: () => void;
  actions: {
    compose: () => void;
    mathExams: () => void;
    repair: () => void;
    wrong: () => void;
    papers: () => void;
    agent: () => void;
    cs408Compose: () => void;
    cs408Repair: () => void;
    cs408Papers: () => void;
    cs408History: () => void;
    cs408Wrong: () => void;
    cs408Agent: () => void;
  };
}) {
  const tab = (active: boolean) => ({ className: active ? 'active' : '', 'aria-current': active ? 'page' : undefined } as const);
  return <header className="topbar no-print">
    <button className="brand" onClick={onBrand}>
      <span className={`brand-mark ${subject === 'cs408' ? 'cs408-mark' : ''}`}>{subject === 'cs408' ? '408' : '∑'}</span>
      <span><strong>题脉</strong><small>{subject === 'cs408' ? '考研 408 · 智能练习' : '考研数学二 · 智能练习'}</small></span>
    </button>
    <div className="subject-switch" role="tablist" aria-label="科目切换">
      <button role="tab" aria-selected={subject === 'math2'} className={subject === 'math2' ? 'active' : ''} onClick={() => onSwitchSubject('math2')}>数学二</button>
      <button role="tab" aria-selected={subject === 'cs408'} className={subject === 'cs408' ? 'active' : ''} onClick={() => onSwitchSubject('cs408')}>408</button>
    </div>
    <nav aria-label="主导航">
      {subject === 'math2' ? <>
        <button {...tab(view === 'compose')} onClick={actions.compose}>自由练习</button>
        <button {...tab(view === 'examPapers')} onClick={actions.mathExams}>真题试卷</button>
        <button {...tab(view === 'repair')} onClick={actions.repair}>今日修复</button>
        <button {...tab(view === 'wrong')} onClick={actions.wrong}>错题本</button>
        <button {...tab(view === 'papers')} onClick={actions.papers}>我的试卷</button>
        <button {...tab(view === 'agent')} onClick={actions.agent}>学习助手</button>
        <button onClick={onOpenSettings}>模型设置</button>
      </> : <>
        <button {...tab(cs408View === 'compose')} onClick={actions.cs408Compose}>自由练习</button>
        <button {...tab(cs408View === 'papers')} onClick={actions.cs408Papers}>真题试卷</button>
        <button {...tab(cs408View === 'repair')} onClick={actions.cs408Repair}>今日修复</button>
        <button {...tab(cs408View === 'wrong')} onClick={actions.cs408Wrong}>错题本</button>
        <button {...tab(cs408View === 'history')} onClick={actions.cs408History}>我的试卷</button>
        <button {...tab(cs408View === 'agent')} onClick={actions.cs408Agent}>学习助手</button>
        <button onClick={onOpenSettings}>模型设置</button>
      </>}
    </nav>
  </header>;
}

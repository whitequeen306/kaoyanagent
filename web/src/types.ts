export type Qtype = 'single_choice' | 'fill_blank' | 'free_response';
export type SourceMode = 'real' | 'ai' | 'mixed';
export type PaperMode = 'exam' | 'drill';
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface Knowledge { id: string; parent_id: string | null; code: string; name: string; level: number; aliases: string[]; question_count?: number; single_choice_count?: number; free_response_count?: number; }
export interface Option { label: string; latex: string; }
export interface FigureAsset { id: string; url: string; width: number; height: number; alt?: string; }
export interface Question {
  id: string; seq_label: string; qtype: Qtype; stem_latex: string; options_json?: Option[] | null;
  sub_items_json?: { label: string; prompt_latex: string }[] | null; score_x2: number;
  difficulty: Difficulty; source: 'real' | 'ai'; answer_latex: string; year?: number; is_fixture?: boolean; score_source?: string | null;
  has_figure?: boolean; figure_asset_id?: string | null; figure_assets?: FigureAsset[] | null;
}
export type PublicQuestion = Omit<Question, 'answer_latex'>;
export interface PaperItem { question: Question; score_x2: number; }
export interface Paper {
  id: string; mode: PaperMode; source_mode: SourceMode; items_json: PaperItem[];
  total_score_x2: number; status: string; adjustments: string[]; actual_ratio: { real: number; ai: number }; dataset?: string; created_at?: string;
  submitted_at?: string | null; result?: GradeResult | null; title?: string | null; origin?: string | null;
  grading?: PaperGrading | null;
}
export interface Attempt {
  question_id: string; score_x2: number; max_score_x2: number; score_rate_bp: number;
  feedback?: string; grading_status?: string; error_tags_json?: string[];
  answer_raw?: string; confirmed_latex?: string | null; correct_answer?: string; explanation?: string; solution_steps?: string[];
}
export interface GradeResult {
  attempts: Attempt[]; score_x2: number; max_score_x2: number; score_rate_bp: number;
  by_source: Record<string, { score_x2: number; max_score_x2: number }>;
}
export interface PaperGrading {
  pending_count: number; job_id: string | null; status: string; stage: string | null;
}
export type RepairStatus = 'new' | 'generating' | 'ready' | 'needs_retry' | 'passed' | 'completed' | 'failed' | 'grading';
export interface RepairCase {
  id: string; question_id: string; status: RepairStatus;
  diagnosis: { cause_tags: string[]; summary: string; first_gap?: string; focus?: string; confidence?: number } | null;
  wrong_answer?: string; error_tags?: string[];
  repair_passes?: number; repair_variants_done?: number; next_repair_at?: string | null;
  selection_count?: number; last_selected_at?: string | null;
  question: PublicQuestion | null; paper_id?: string | null; paper_status?: string | null;
  variant_stats?: { total: number; answered: number; correct: number; rate_bp: number | null; mastered: boolean; pending: boolean } | null;
  job_stage?: string | null; job_detail?: string | null; job_progress?: number | null;
}
export interface DailyAiMessage { role: 'user' | 'assistant'; content: string; }
export interface DailyAnswerImage { mime_type: 'image/png' | 'image/jpeg' | 'image/webp'; data_url: string; name: string; }
export interface DailyWrongAnswer {
  date: string;
  correct: boolean;
  answer_kind: 'image' | 'text';
  answer_raw: string | null;
  feedback: string;
}
export interface DailyJudgment {
  in_wrong_book: boolean;
  answer_raw: string | null;
  review: { correct_answer: string; explanation: string; solution_steps: string[] } | null;
  correct: boolean | null;
  feedback: string;
  retryable?: boolean;
  answer_kind: 'text' | 'image';
  grading_status: string;
}
export type DailyPublicQuestion = Omit<PublicQuestion, 'score_x2' | 'score_source'> & {
  sub_items_json?: { label: string; prompt_latex: string }[] | null;
};
export interface DailyQuestionState {
  date: string; status: 'available' | 'submitted';
  reason: { code: string; text: string };
  question: DailyPublicQuestion;
  result: DailyJudgment | null;
  ai_messages: DailyAiMessage[];
}

export interface Cs408Option {
  label: string;
  source_label?: string | null;
  text: string;
  image?: { url: string; width?: number | null; height?: number | null; alt?: string } | null;
}
export interface Cs408Question {
  id: string; seq_label: string; qtype: 'single_choice' | 'free_response';
  section: string; subject: 'cs408'; year: number | null; number: number | null; title?: string | null;
  question_html: string; question_text?: string;
  options: Cs408Option[]; figures?: { url: string; alt?: string; width?: number | null; height?: number | null }[];
  score_x2: number; score_source?: string | null; difficulty?: string; source: 'real' | 'ai'; is_fixture?: boolean;
  has_explanation?: boolean; ai_kind?: 'practice' | 'variant'; knowledge?: { code: string; role?: string; weight?: number }[];
}
export interface Cs408PaperItem { question_id: string; question: Cs408Question; score_x2: number; }
export interface Cs408Review {
  correct_answer?: string; explanation?: string; explanation_html?: string;
  solution_steps?: string[]; has_explanation?: boolean;
}
export interface Cs408Attempt extends Cs408Review {
  question_id: string; score_x2: number; max_score_x2: number; score_rate_bp: number;
  grading_status: string; answer_raw?: string; feedback?: string | null;
}
export interface Cs408Result {
  attempts: Cs408Attempt[]; score_x2: number; max_score_x2: number; score_rate_bp: number;
  single_answered: number; free_answered: number;
}
export interface Cs408Paper {
  id: string; subject: 'cs408'; year: number | null; title: string; mode: string; source_mode?: string; origin?: string | null; status: string;
  created_at: string; submitted_at?: string | null; items: Cs408PaperItem[];
  total_score_x2: number; auto_score_x2: number; result: Cs408Result | null;
}
export interface Cs408Year {
  id: string; subject: 'cs408'; year: number; title: string;
  single_choice: number; free_response: number; question_count: number;
  total_score_x2: number; auto_score_x2: number;
  paper_id: string | null; status: string | null; created_at?: string | null; submitted_at?: string | null;
  score_x2: number | null; max_score_x2: number; score_rate_bp: number | null; attempt_count: number; answered_questions: number;
}
export interface Cs408WrongItem {
  question_id: string; first_wrong_at: string; last_result?: string; review_count?: number;
  question: Cs408Question; attempt: Cs408Attempt | null; review: Cs408Review;
  knowledge: { code: string; name: string }[];
}

export interface Cs408RepairDiagnosis {
  cause_tags: string[]; summary: string; first_gap?: string; focus?: string; confidence?: number;
}
export interface Cs408RepairCase {
  id: string; question_id: string; status: string;
  diagnosis: Cs408RepairDiagnosis | null;
  wrong_answer?: string; error_tags?: string[];
  repair_passes?: number; repair_variants_done?: number; next_repair_at?: string | null;
  paper_id?: string | null; paper_status?: string | null; paper_title?: string | null;
  job_stage?: string | null; job_detail?: string | null; job_progress?: number | null;
  question: Cs408Question | null;
  knowledge: { code: string; name: string }[];
}
export interface Cs408RepairPayload {
  date: string; items: Cs408RepairCase[]; backlog_count: number; completed_count: number;
}

export interface Cs408HistoryItem {
  id: string; origin: string | null; mode: string; year: number | null; title: string;
  status: string; created_at: string; submitted_at?: string | null;
  questions: number; total_score_x2: number; auto_score_x2: number;
  score_x2: number | null; max_score_x2: number; score_rate_bp: number | null;
  node_names: string[];
}
export interface Cs408Metrics {
  question_bank: number; papers: number; submitted: number; exam_years_done: number;
  practice_papers: number; repair_papers: number; single_attempts: number; wrong_count: number;
  score_x2: number; max_score_x2: number; score_rate_bp: number | null;
  chapters: { code: string; name: string; subject: string | null; attempts: number; correct: number; score_x2: number; max_score_x2: number; score_rate_bp: number | null }[];
  recent: Cs408HistoryItem[];
}

export interface Cs408AgentProfile {
  subject: '408'; exam_year: number; target_score: number; foundation: string; stage: string;
  daily_minutes: number; weak_points: string[]; notes: string;
}
export interface Cs408AgentMessage { role: 'user' | 'assistant'; content: string; created_at?: string; }
export interface Cs408AgentState {
  profile: Cs408AgentProfile; messages: Cs408AgentMessage[]; configured: boolean;
}
export interface Cs408AgentReply {
  reply: string; profile: Cs408AgentProfile; messages: Cs408AgentMessage[];
}

export interface MathExamYear {
  year: number; question_count: number; single_choice: number; fill_blank: number; free_response: number;
  total_score_x2: number; held_count: number; paper_id: string | null; status: string | null;
  created_at?: string | null; submitted_at?: string | null;
  score_x2: number | null; max_score_x2: number; score_rate_bp: number | null; attempt_count: number; answered_questions: number;
}

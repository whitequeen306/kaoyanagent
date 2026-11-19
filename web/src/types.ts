export type Qtype = 'single_choice' | 'fill_blank' | 'free_response';
export type SourceMode = 'real' | 'ai' | 'mixed';
export type PaperMode = 'exam' | 'drill';
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface Knowledge { id: string; parent_id: string | null; code: string; name: string; level: number; aliases: string[]; }
export interface Option { label: string; latex: string; }
export interface Question {
  id: string; seq_label: string; qtype: Qtype; stem_latex: string; options_json?: Option[] | null;
  sub_items_json?: { label: string; prompt_latex: string }[] | null; score_x2: number;
  difficulty: Difficulty; source: 'real' | 'ai'; answer_latex: string; year?: number; is_fixture?: boolean; score_source?: string | null;
}
export interface PaperItem { question: Question; score_x2: number; }
export interface Paper {
  id: string; mode: PaperMode; source_mode: SourceMode; items_json: PaperItem[];
  total_score_x2: number; status: string; adjustments: string[]; actual_ratio: { real: number; ai: number }; dataset?: string; created_at?: string;
  submitted_at?: string | null; result?: GradeResult | null; title?: string | null; origin?: string | null;
}
export interface Attempt {
  question_id: string; score_x2: number; max_score_x2: number; score_rate_bp: number;
  feedback?: string; grading_status?: string; error_tags_json?: string[];
  answer_raw?: string; correct_answer?: string; explanation?: string; solution_steps?: string[];
}
export interface GradeResult {
  attempts: Attempt[]; score_x2: number; max_score_x2: number; score_rate_bp: number;
  by_source: Record<string, { score_x2: number; max_score_x2: number }>;
}

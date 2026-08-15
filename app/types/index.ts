export interface Round {
  id: string
  name: string
  date: string
  round_date: string | null
  status: 'pending' | 'active' | 'completed'
  revealed_question_number: number
  presenter_active_question: number
  presenter_show_state: 'welcome' | 'sample_question' | 'sample_answer' | 'rules' | 'get_ready' | 'question' | 'timer_start' | 'answer_revealed' | 'correct_teams' | 'winners'
  presenter_timer_started_at: string | null
  presenter_theme?: 'dark' | 'light' | null
  winner_data?: {
    rank1?: Team[]
    rank2?: Team[]
    rank3?: Team[]
  } | null
  created_at?: string
}

export interface Team {
  id: string
  round_id: string
  team_number: number
  name: string
  school_name?: string | null
  tie_breaker_score: number
  created_at?: string
}

export interface Question {
  id: string
  round_id: string
  question_number: number
  correct_answer: 'ก' | 'ข' | 'ค' | 'ง'
  points: number
  question_text: string | null
  choice_a: string | null
  choice_b: string | null
  choice_c: string | null
  choice_d: string | null
  is_image_only: boolean
  question_image_url: string | null
  answer_image_url: string | null
  choices_layout: '1_col' | '2_col'
  created_at?: string
}

export interface Answer {
  id: string
  team_id: string
  question_number: number
  submitted_answer: 'ก' | 'ข' | 'ค' | 'ง' | null
  is_correct: boolean
  recorded_by: string | null
  updated_at: string
}

export interface ProgressSummary {
  question_number: number
  submitted_count: number
}

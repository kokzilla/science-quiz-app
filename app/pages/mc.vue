<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  Award, 
  ChevronLeft, 
  ChevronRight,
  LogOut,
  RefreshCw,
  Users,
  CheckCircle,
  HelpCircle,
  AlertCircle
} from 'lucide-vue-next'
import type { Team, Question, Answer } from '~/types'

const route = useRoute()
const { supabase, isConfigured } = useSupabase()
const { validateStaffOrAdmin, logout } = useAuth()

const teams = ref<Team[]>([])
const questions = ref<Question[]>([])
const answers = ref<Answer[]>([])

const selectedQuestion = ref(1)
const loading = ref(true)
const passkeyValid = ref(false)
const answersChannel = ref<any>(null)

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  loading.value = true
  
  try {
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
      .order('team_number', { ascending: true })
    teams.value = (tData || []) as Team[]

    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
    questions.value = (qData || []) as Question[]

    await fetchAnswers()
    
    // Subscribe to realtime answer updates
    cleanupAnswersSubscription()
    
    answersChannel.value = supabase.value
      .channel('mc-answers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => {
        fetchAnswers()
      })
      .subscribe()
      
  } catch (err) {
    console.error('Error loading round data in MC view:', err)
  } finally {
    loading.value = false
  }
}

// Using useRoundSelector composable
const {
  selectedRoundId,
  roundsList,
  currentRound,
  handleRoundChange
} = useRoundSelector(onRoundChanged)

const cleanupAnswersSubscription = () => {
  if (answersChannel.value && supabase.value) {
    supabase.value.removeChannel(answersChannel.value)
    answersChannel.value = null
  }
}

onMounted(async () => {
  const isValid = await validateStaffOrAdmin()
  if (!isValid) return
  passkeyValid.value = true
})

onUnmounted(() => {
  cleanupAnswersSubscription()
})

const fetchAnswers = async () => {
  if (!supabase.value || teams.value.length === 0) return
  const teamIds = teams.value.map(t => t.id)
  const { data } = await supabase.value
    .from('answers')
    .select('*')
    .in('team_id', teamIds)
  answers.value = (data || []) as Answer[]
}

// Compute submitted and correct counts client-side dynamically for all 20 questions
const questionStatsSummary = computed(() => {
  const summary: Record<number, { submitted: number; correct: number }> = {}
  for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
    summary[i] = { submitted: 0, correct: 0 }
  }
  
  answers.value.forEach(ans => {
    const qNum = ans.question_number
    if (qNum >= 1 && qNum <= TOTAL_QUESTIONS) {
      if (ans.submitted_answer) {
        summary[qNum].submitted++
      }
      if (ans.is_correct) {
        summary[qNum].correct++
      }
    }
  })
  
  return summary
})

// Correct answer choice for current question
const currentQuestionCorrectAnswer = computed(() => {
  const q = questions.value.find(item => item.question_number === selectedQuestion.value)
  return q ? q.correct_answer : 'ยังไม่ระบุ'
})

// List of teams who answered CORRECTLY for current question
const correctTeamsList = computed(() => {
  if (teams.value.length === 0) return []
  return teams.value.filter(team => {
    const ansRow = answers.value.find(a => a.team_id === team.id && a.question_number === selectedQuestion.value)
    return ansRow && ansRow.is_correct
  })
})

// Number of teams that have submitted an answer for the current question
const currentQuestionSubmittedCount = computed(() => {
  return questionStatsSummary.value[selectedQuestion.value]?.submitted || 0
})

// Whether all teams have submitted an answer for the current question
const isCurrentQuestionFullySubmitted = computed(() => {
  return teams.value.length > 0 && currentQuestionSubmittedCount.value === teams.value.length
})

// List of teams who have NOT yet submitted an answer for the current question
const pendingTeamsList = computed(() => {
  if (teams.value.length === 0) return []
  return teams.value.filter(team => {
    const ansRow = answers.value.find(a => a.team_id === team.id && a.question_number === selectedQuestion.value)
    return !ansRow || !ansRow.submitted_answer
  })
})
</script>

<template>
  <div class="container mc-dashboard" v-if="passkeyValid">
    
    <!-- Top Configuration / Compact Action Bar -->
    <div class="glass-card action-bar">
      <div class="header-branding">
        <h1 class="mc-nav-title">แผงควบคุมพิธีกร (MC Monitor)</h1>
        <span class="round-badge" v-if="currentRound">{{ currentRound.name }}</span>
      </div>

      <div class="selector-group">
        <label class="form-label selector-label">รอบแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input round-select">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        
        <button @click="fetchAnswers" class="btn btn-secondary refresh-btn" title="รีเฟรชสถิติ">
          <RefreshCw :size="14" />
        </button>
      </div>

      <button @click="logout" class="btn btn-secondary exit-btn">
        <LogOut :size="14" />
        <span>ออกจากระบบ</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="loading-spin"></div>
      <p>กำลังเตรียมข้อมูลสำหรับพิธีกร...</p>
    </div>

    <template v-else-if="currentRound">
      <!-- Main Layout Split Grid (Single Screen, No Scroll) -->
      <div class="mc-split-grid">
        
        <!-- LEFT COLUMN: SELECTED QUESTION & 20-QUESTION PROGRESS BOARD -->
        <div class="mc-column col-left">
          
          <!-- Card 1: Selected Question Info -->
          <div class="glass-card status-card">
            <div class="navigation-controls">
              <button 
                @click="selectedQuestion = Math.max(1, selectedQuestion - 1)" 
                class="btn btn-secondary nav-arrow-btn" 
                :disabled="selectedQuestion === 1"
              >
                <ChevronLeft :size="16" />
              </button>
              
              <div class="question-display-text">
                ข้อที่ {{ selectedQuestion }}
              </div>
              
              <button 
                @click="selectedQuestion = Math.min(TOTAL_QUESTIONS, selectedQuestion + 1)" 
                class="btn btn-secondary nav-arrow-btn" 
                :disabled="selectedQuestion === TOTAL_QUESTIONS"
              >
                <ChevronRight :size="16" />
              </button>
            </div>

            <!-- Stats Horizontal List -->
            <div class="stats-row">
              <div class="stat-item highlight-ans">
                <span class="stat-lbl">เฉลย:</span>
                <span class="stat-val-text text-gold">{{ currentQuestionCorrectAnswer }}</span>
              </div>
              
              <div class="stat-item">
                <span class="stat-lbl">ส่งคำตอบ:</span>
                <span class="stat-val-text" :class="isCurrentQuestionFullySubmitted ? 'text-success' : 'text-cyan'">
                  {{ currentQuestionSubmittedCount }}/{{ teams.length }}
                </span>
              </div>

              <div class="stat-item">
                <span class="stat-lbl">ตอบถูก:</span>
                <span class="stat-val-text text-success">{{ correctTeamsList.length }} ทีม</span>
              </div>
            </div>
          </div>

          <!-- Card 2: 20-Question Progress Board (Moved here!) -->
          <div class="glass-card board-card">
            <div class="board-header">
              <h2 class="board-title">กระดานคีย์คำตอบและผล (20 ข้อ)</h2>
              <span class="board-indicator-lbl">*คลิกเลือกข้อ*</span>
            </div>

            <div class="progress-grid">
              <div 
                v-for="i in TOTAL_QUESTIONS" 
                :key="i" 
                class="progress-tile"
                :class="{ 
                  'active-tile': selectedQuestion === i,
                  'completed-tile': questionStatsSummary[i]?.submitted === teams.length,
                  'in-progress-tile': (questionStatsSummary[i]?.submitted || 0) > 0 && (questionStatsSummary[i]?.submitted || 0) < teams.length,
                  'empty-tile': (questionStatsSummary[i]?.submitted || 0) === 0
                }"
                @click="selectedQuestion = i"
              >
                <div class="tile-q-name">Q{{ i }}</div>
                
                <div class="tile-progress-ratio">
                  {{ questionStatsSummary[i]?.submitted }}/{{ teams.length }}
                </div>

                <div class="tile-bar-bg">
                  <div 
                    class="tile-bar-fill"
                    :style="`width: ${teams.length > 0 ? (questionStatsSummary[i]?.submitted / teams.length) * 100 : 0}%`"
                    :class="questionStatsSummary[i]?.submitted === teams.length ? 'fill-success' : 'fill-warning'"
                  ></div>
                </div>
              </div>
            </div>

            <!-- Dashboard Legend labels -->
            <div class="dashboard-legend">
              <div class="legend-item"><span class="legend-color bg-success-legend"></span> <span>ครบ (Green)</span></div>
              <div class="legend-item"><span class="legend-color bg-warning-legend"></span> <span>กำลังบันทึก (Orange)</span></div>
              <div class="legend-item"><span class="legend-color bg-grey-legend"></span> <span>ยังไม่เริ่ม (Grey)</span></div>
            </div>
          </div>

        </div>

        <!-- RIGHT COLUMN: SPLIT CORRECT / PENDING TEAMS LISTS (Prominent space) -->
        <div class="mc-column col-right">
          
          <!-- Card 3: Split Correct / Pending Teams list (Moved here!) -->
          <div class="glass-card teams-list-card" :class="{ 'fully-submitted-card': isCurrentQuestionFullySubmitted }">
            <div class="split-lists-container">
              
              <!-- Correct Teams Sub-column -->
              <div class="sub-column list-correct">
                <h2 class="column-subtitle text-success">
                  <Award :size="14" class="text-gold" />
                  <span>ทีมตอบถูก ({{ correctTeamsList.length }} ทีม)</span>
                </h2>
                
                <div v-if="correctTeamsList.length === 0" class="no-teams-placeholder">
                  <span>ไม่มีทีมตอบถูก</span>
                </div>
                <div v-else class="badges-grid">
                  <div class="team-badge badge-correct" v-for="team in correctTeamsList" :key="team.id" :title="team.name">
                    {{ Number(team.team_number) }}
                  </div>
                </div>
              </div>
              
              <!-- Pending Teams Sub-column -->
              <div class="sub-column list-pending">
                <h2 class="column-subtitle text-warning">
                  <AlertCircle :size="14" />
                  <span>ยังไม่คีย์ ({{ pendingTeamsList.length }} ทีม)</span>
                </h2>
                
                <div v-if="pendingTeamsList.length === 0" class="no-teams-placeholder text-success">
                  <CheckCircle :size="14" />
                  <span>คีย์ครบถ้วนแล้ว</span>
                </div>
                <div v-else class="badges-grid">
                  <div class="team-badge badge-pending" v-for="team in pendingTeamsList" :key="team.id" :title="team.name">
                    {{ String(team.team_number).padStart(2, '0') }}
                  </div>
                </div>
              </div>
              
            </div>
          </div>

        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
/* Main Dashboard layout constraints to fit single page */
.mc-dashboard {
  max-width: 1600px;
  height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem 1.5rem;
}

.action-bar {
  margin-bottom: 1rem; 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 0.5rem 1.25rem;
  flex-shrink: 0;
  gap: 1rem;
}

.header-branding {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.mc-nav-title {
  font-size: 1.15rem;
  font-weight: 800;
  color: #fff;
  margin: 0;
}

.round-badge {
  background: rgba(0, 229, 255, 0.12);
  border: 1px solid rgba(0, 229, 255, 0.25);
  color: var(--color-cyan);
  font-size: 0.75rem;
  padding: 0.15rem 0.6rem;
  border-radius: 12px;
  font-weight: 700;
}

.selector-group {
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.selector-label {
  margin-bottom: 0; 
  white-space: nowrap;
  font-size: 0.85rem;
}

.round-select {
  width: 200px;
  height: 32px;
  font-size: 0.85rem;
  padding: 0.2rem 0.5rem;
}

.refresh-btn {
  height: 32px;
  padding: 0 0.5rem;
}

.exit-btn {
  height: 32px;
  font-size: 0.82rem;
  padding: 0 0.75rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.loading-container {
  text-align: center; 
  color: var(--text-secondary); 
  padding: 5rem;
  flex: 1;
}

.loading-spin {
  width: 40px; 
  height: 40px; 
  border: 3px solid var(--color-cyan); 
  border-top-color: transparent; 
  border-radius: 50%; 
  margin: 0 auto 1.5rem;
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 2 Column Layout (Left: Control/Badges, Right: 20Q Board) */
.mc-split-grid {
  display: grid; 
  grid-template-columns: 0.8fr 1.2fr; 
  gap: 1rem; 
  flex: 1;
  min-height: 0; /* Constraints overflow */
}

.mc-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

/* LEFT COLUMN CARDS */
.status-card {
  padding: 0.75rem 1.25rem;
  text-align: center;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.navigation-controls {
  display: flex; 
  align-items: center; 
  justify-content: center; 
  gap: 1.25rem;
}

.nav-arrow-btn {
  width: 32px; 
  height: 32px; 
  border-radius: 50%; 
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.question-display-text {
  font-size: 2rem; 
  font-family: var(--font-title); 
  font-weight: 800; 
  color: var(--color-cyan); 
  text-shadow: var(--shadow-neon-cyan); 
  min-width: 100px;
}

.stats-row {
  display: flex;
  justify-content: space-around;
  align-items: center; /* Center items vertically */
  background: rgba(255,255,255,0.01);
  border: 1px solid var(--glass-border);
  padding: 0.4rem;
  border-radius: var(--radius-sm);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.highlight-ans {
  border-right: 1px solid var(--glass-border);
  padding-right: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.highlight-ans .stat-lbl {
  font-size: 0.78rem;
  font-weight: 700;
}

.highlight-ans .stat-val-text {
  font-size: 2.6rem; /* Make correct answer (เฉลย) extremely large and clear */
  line-height: 1.1;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.45);
}

.stat-lbl {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.stat-val-text {
  font-family: var(--font-title);
  font-size: 1.15rem;
  font-weight: 800;
}

.text-gold {
  color: var(--color-gold);
}

.text-success {
  color: var(--color-success);
}

.text-cyan {
  color: var(--color-cyan);
}

/* TEAMS LIST CARD (Compact Badges List) */
.teams-list-card {
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  padding: 1rem;
  min-height: 0;
}

.split-lists-container {
  display: grid;
  grid-template-columns: 1.4fr 0.6fr; /* 70% for Correct, 30% for Pending */
  gap: 1rem;
  flex: 1;
  min-height: 0;
}

.sub-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.column-subtitle {
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0.25rem;
  margin-bottom: 0.25rem;
  flex-shrink: 0;
}

.list-correct .badges-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 0.5rem;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

.list-pending .badges-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 0.35rem;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

.team-badge {
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-title);
}

.badge-correct {
  background: rgba(0, 230, 118, 0.08);
  border: 1px solid rgba(0, 230, 118, 0.3);
  color: var(--color-success);
  font-size: 2rem; /* Even larger font size */
  font-weight: 850;
  height: 56px; /* Increased height */
  border-radius: 8px;
}

.badge-pending {
  background: rgba(255, 145, 0, 0.08);
  border: 1px solid rgba(255, 145, 0, 0.3);
  color: var(--color-warning);
  font-size: 0.8rem; /* Smaller font size */
  font-weight: 700;
  height: 24px; /* Smaller height */
}

.no-teams-placeholder {
  margin: auto;
  font-size: 0.78rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.fully-submitted-card {
  border-color: rgba(0, 230, 118, 0.35) !important;
  background: rgba(0, 230, 118, 0.02) !important;
}

/* RIGHT COLUMN: OVERVIEW BOARD */
.board-card {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0.4rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.board-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.board-indicator-lbl {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.progress-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  flex: 1;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.progress-tile {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  padding: 0.25rem 0.4rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  transition: all var(--transition-fast);
  height: auto;
  min-height: 48px;
  justify-content: space-between;
}

.progress-tile:hover {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.02);
}

.active-tile {
  border-color: var(--color-cyan) !important;
  box-shadow: var(--shadow-neon-cyan);
  background: rgba(0, 229, 255, 0.04) !important;
}

.completed-tile {
  background: rgba(0, 230, 118, 0.1);
  border-color: rgba(0, 230, 118, 0.35);
}

.in-progress-tile {
  background: rgba(255, 145, 0, 0.12);
  border-color: rgba(255, 145, 0, 0.45);
}

.empty-tile {
  opacity: 0.55;
}

.tile-q-name {
  font-family: var(--font-title);
  font-size: 0.95rem;
  font-weight: 800;
  color: #fff;
}

.tile-progress-ratio {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-secondary);
}

.completed-tile .tile-progress-ratio {
  color: var(--color-success);
}

.in-progress-tile .tile-progress-ratio {
  color: var(--color-warning);
}

.tile-bar-bg {
  width: 100%;
  height: 4px;
  background: rgba(255,255,255,0.05);
  border-radius: 2px;
  overflow: hidden;
}

.tile-bar-fill {
  height: 100%;
  border-radius: 2px;
}

.fill-success {
  background-color: var(--color-success);
}

.fill-warning {
  background-color: var(--color-warning);
}

.fill-cyan {
  background-color: var(--color-cyan);
}

.tile-correct-count {
  font-size: 0.7rem;
  color: var(--text-secondary);
  border-top: 1px dashed var(--glass-border);
  padding-top: 0.15rem;
  margin-top: 0.15rem;
}

.dashboard-legend {
  display: flex;
  gap: 1rem;
  margin-top: 0.75rem;
  border-top: 1px solid var(--glass-border);
  padding-top: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.legend-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.bg-success-legend { background-color: rgba(0, 230, 118, 0.3); border: 1px solid var(--color-success); }
.bg-warning-legend { background-color: rgba(255, 145, 0, 0.3); border: 1px solid var(--color-warning); }
.bg-grey-legend { background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); }

.light-theme .tile-q-name {
  color: #0f172a;
}
.light-theme .mc-nav-title {
  color: #0f172a;
}
</style>

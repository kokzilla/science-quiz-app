<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  Sliders, 
  Tv, 
  Play, 
  HelpCircle,
  Award,
  ChevronLeft, 
  ChevronRight,
  RefreshCw,
  LogOut,
  AlertCircle,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Clock,
  BookOpen,
  Sun,
  Moon
} from 'lucide-vue-next'
import type { Question, Answer, Team } from '~/types'

const router = useRouter()
const { supabase, isConfigured } = useSupabase()
const { validateAdminOnly, getActivePasskey } = useAuth()

const questions = ref<Question[]>([])
const answers = ref<Answer[]>([])
const teams = ref<Team[]>([])

const loading = ref(true)
const passkeyValid = ref(false)
const adminPasskey = ref('')
const errorMsg = ref('')

// Realtime subscriptions
let answersChannel: any = null
let roundChannel: any = null
let configChannel: any = null
let autoTimerTimeout: any = null
const isLoaded = ref(false)

// Audio & Theme settings refs
const soundEnabled = ref(true)
const ttsEnabled = ref(true)
const presenterTheme = ref<'dark' | 'light'>('dark')

const cleanupSubscriptions = () => {
  if (answersChannel && supabase.value) {
    supabase.value.removeChannel(answersChannel)
    answersChannel = null
  }
  if (roundChannel && supabase.value) {
    supabase.value.removeChannel(roundChannel)
    roundChannel = null
  }
  if (configChannel && supabase.value) {
    supabase.value.removeChannel(configChannel)
    configChannel = null
  }
}

const setupConfigChannel = () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  if (configChannel) {
    supabase.value.removeChannel(configChannel)
    configChannel = null
  }
  
  configChannel = supabase.value.channel(`presenter-config-${selectedRoundId.value}`)
  configChannel
    .on('broadcast', { event: 'request_audio_settings' }, () => {
      sendAudioSettings()
    })
    .subscribe()
}

const sendAudioSettings = () => {
  if (configChannel) {
    configChannel.send({
      type: 'broadcast',
      event: 'audio_settings',
      payload: {
        soundEnabled: soundEnabled.value,
        ttsEnabled: ttsEnabled.value,
        presenterTheme: presenterTheme.value
      }
    })
  }
}

const togglePresenterTheme = () => {
  presenterTheme.value = presenterTheme.value === 'dark' ? 'light' : 'dark'
  if (typeof window !== 'undefined') {
    localStorage.setItem('presenter_theme', presenterTheme.value)
  }
  sendAudioSettings()
}

const toggleSound = () => {
  soundEnabled.value = !soundEnabled.value
  sendAudioSettings()
}

const toggleTts = () => {
  ttsEnabled.value = !ttsEnabled.value
  sendAudioSettings()
}

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  loading.value = true
  isLoaded.value = false
  
  try {
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
      .order('question_number', { ascending: true })
    questions.value = (qData || []) as Question[]

    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
      .order('team_number', { ascending: true })
    teams.value = (tData || []) as Team[]

    await fetchAnswers()

    // Clean up old subscriptions first
    cleanupSubscriptions()

    // Setup audio config broadcast channel
    setupConfigChannel()

    // Subscribe to realtime answer updates
    answersChannel = supabase.value
      .channel('presenter-admin-answers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => {
        fetchAnswers()
      })
      .subscribe()

    // Subscribe to round changes
    roundChannel = supabase.value
      .channel('presenter-admin-round')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `id=eq.${roundId}` }, (payload: any) => {
        currentRound.value = payload.new
      })
      .subscribe()
      
  } catch (err: any) {
    errorMsg.value = `โหลดข้อมูลควบคุมล้มเหลว: ${err.message}`
  } finally {
    loading.value = false
    setTimeout(() => {
      isLoaded.value = true
    }, 500)
  }
}

// Using useRoundSelector composable
const {
  selectedRoundId,
  roundsList,
  currentRound,
  handleRoundChange
} = useRoundSelector(onRoundChanged)

onUnmounted(() => {
  cleanupSubscriptions()
  if (autoTimerTimeout) clearTimeout(autoTimerTimeout)
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    const savedTheme = localStorage.getItem('presenter_theme') as 'dark' | 'light' | null
    if (savedTheme) {
      presenterTheme.value = savedTheme
    }
  }

  const isValid = await validateAdminOnly()
  if (!isValid) return
  
  adminPasskey.value = getActivePasskey()
  passkeyValid.value = true
})

watch(
  [
    () => currentRound.value?.presenter_show_state,
    () => currentRound.value?.presenter_active_question
  ],
  ([newState, newQNum], [oldState, oldQNum]) => {
    if (autoTimerTimeout) {
      clearTimeout(autoTimerTimeout)
      autoTimerTimeout = null
    }

    if (!isLoaded.value) return

    if (newState === 'question') {
      autoTimerTimeout = setTimeout(() => {
        if (currentRound.value?.presenter_show_state === 'question' && currentRound.value?.presenter_active_question === newQNum) {
          updatePresenterState(newQNum as number, 'timer_start', true)
        }
      }, 2500)
    }
  }
)

const fetchAnswers = async () => {
  if (!supabase.value || teams.value.length === 0) return
  const teamIds = teams.value.map(t => t.id)
  const { data } = await supabase.value
    .from('answers')
    .select('*')
    .in('team_id', teamIds)
  answers.value = (data || []) as Answer[]
}

// Update presenter active question or state via secure RPC
const updatePresenterState = async (qNum: number, state: string, startTimer: boolean = false) => {
  if (!supabase.value || !currentRound.value) return
  
  try {
    const timestamp = startTimer ? new Date().toISOString() : null
    
    const { error } = await supabase.value.rpc('update_presenter_state_secure', {
      p_round_id: currentRound.value.id,
      p_active_question: qNum,
      p_show_state: state,
      p_timer_started_at: timestamp,
      p_passkey: adminPasskey.value
    })

    if (error) throw error
  } catch (err: any) {
    alert(`ไม่สามารถอัปเดตสถานะจอใหญ่ได้: ${err.message}`)
  }
}

// Helper calculations
const activeQuestionData = computed(() => {
  if (!currentRound.value) return null
  return questions.value.find(q => q.question_number === currentRound.value.presenter_active_question)
})

const activeQuestionAnswersCount = computed(() => {
  if (!currentRound.value) return 0
  return answers.value.filter(a => a.question_number === currentRound.value.presenter_active_question && a.submitted_answer).length
})

const activeQuestionCorrectCount = computed(() => {
  if (!currentRound.value) return 0
  return answers.value.filter(a => a.question_number === currentRound.value.presenter_active_question && a.is_correct).length
})

const handleExit = () => {
  router.push('/')
}
</script>

<template>
  <div class="container dashboard-container" v-if="passkeyValid">
    
    <!-- Top Action Bar -->
    <div class="glass-card action-bar">
      <div class="selector-group">
        <label class="form-label selector-label">รอบการแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input selector-dropdown">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div class="buttons-group">
        <NuxtLink :to="`/presenter?round=${selectedRoundId}`" target="_blank" class="btn btn-secondary led-btn">
          <Tv :size="16" />
          <span>เปิดจอ LED ใหญ่</span>
        </NuxtLink>
        <button @click="handleExit" class="btn btn-secondary exit-btn">
          <LogOut :size="16" />
          <span>กลับหน้าแรก</span>
        </button>
      </div>
    </div>

    <!-- Error/Loading states -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spin"></div>
      <p>กำลังเตรียมระบบควบคุมเวที...</p>
    </div>

    <div v-else-if="errorMsg" class="glass-card error-card">
      <AlertCircle :size="48" class="error-icon" />
      <p>{{ errorMsg }}</p>
    </div>

    <template v-else-if="currentRound">
      <!-- Main Dashboard Grid Layout (Single Widescreen Page) -->
      <div class="presenter-admin-layout">
        
        <!-- COLUMN 1: STAGE CONTROLS & SETUP -->
        <div class="dashboard-col col-control">
          
          <!-- Card 1: Setup & Intro (ก่อนเริ่มแข่งขัน - ย่อเล็ก) -->
          <div class="glass-card setup-card">
            <h3 class="card-subtitle">1. เตรียมตัวก่อนแข่ง (กดครั้งเดียว)</h3>
            <div class="setup-buttons-grid">
              <button 
                @click="updatePresenterState(1, 'welcome')" 
                class="btn btn-secondary btn-setup" 
                :class="{ active: currentRound.presenter_show_state === 'welcome' }"
              >
                1. หน้าปก
              </button>
              
              <button 
                @click="updatePresenterState(1, 'rules')" 
                class="btn btn-secondary btn-setup" 
                :class="{ active: currentRound.presenter_show_state === 'rules' }"
              >
                2. กติกา
              </button>
              
              <button 
                @click="updatePresenterState(1, 'sample_question')" 
                class="btn btn-secondary btn-setup" 
                :class="{ active: currentRound.presenter_show_state === 'sample_question' }"
              >
                3. ตัวอย่างโจทย์
              </button>
              
              <button 
                @click="updatePresenterState(1, 'sample_answer')" 
                class="btn btn-secondary btn-setup" 
                :class="{ active: currentRound.presenter_show_state === 'sample_answer' }"
              >
                4. เฉลยตัวอย่าง
              </button>
              
              <button 
                @click="updatePresenterState(1, 'get_ready')" 
                class="btn btn-secondary btn-setup" 
                :class="{ active: currentRound.presenter_show_state === 'get_ready' }"
              >
                5. เตรียมแข่ง
              </button>
            </div>
          </div>
          
          <!-- Card 2: Question Controller (ควบคุมข้อสอบรายข้อ - ชัดเจนและใหญ่) -->
          <div class="glass-card controller-card">
            <div class="controller-header">
              <h2 class="section-title">2. ควบคุมหน้าจอเวทีรายข้อ</h2>
              
              <!-- Audio & Theme Toggles -->
              <div class="audio-controls-group">
                <button 
                  @click="togglePresenterTheme" 
                  class="btn toggle-audio-btn" 
                  :class="presenterTheme === 'light' ? 'btn-primary' : 'btn-secondary'"
                  :title="presenterTheme === 'dark' ? 'ธีมจอเวที (Presenter): โหมดมืด (คลิกเปลี่ยนเป็นสว่าง)' : 'ธีมจอเวที (Presenter): โหมดสว่าง (คลิกเปลี่ยนเป็นมืด)'"
                >
                  <Sun v-if="presenterTheme === 'light'" :size="14" />
                  <Moon v-else :size="14" />
                </button>

                <button 
                  @click="toggleTts" 
                  class="btn toggle-audio-btn" 
                  :class="ttsEnabled ? 'btn-primary' : 'btn-secondary'"
                  :title="ttsEnabled ? 'เสียงพูดอ่านโจทย์/ผู้ชนะ: เปิด' : 'เสียงพูดอ่านโจทย์/ผู้ชนะ: ปิด'"
                >
                  <Mic v-if="ttsEnabled" :size="14" />
                  <MicOff v-else :size="14" />
                </button>

                <button 
                  @click="toggleSound" 
                  class="btn toggle-audio-btn" 
                  :class="soundEnabled ? 'btn-primary' : 'btn-secondary'"
                  :title="soundEnabled ? 'เสียงเตือนเวลานับถอยหลัง: เปิด' : 'เสียงเตือนเวลานับถอยหลัง: ปิด'"
                >
                  <Volume2 v-if="soundEnabled" :size="14" />
                  <VolumeX v-else :size="14" />
                </button>
              </div>
            </div>
            
            <div class="active-question-display">
              <span class="display-label">ข้อคำถามปัจจุบัน</span>
              <div class="display-controls">
                <button 
                  @click="updatePresenterState(Math.max(1, currentRound.presenter_active_question - 1), 'question')" 
                  class="btn btn-secondary nav-q-btn"
                  :disabled="currentRound.presenter_active_question === 1"
                >
                  <ChevronLeft :size="20" />
                </button>
                
                <span class="active-q-num-text">ข้อที่ {{ currentRound.presenter_active_question }}</span>
                
                <button 
                  @click="updatePresenterState(Math.min(TOTAL_QUESTIONS, currentRound.presenter_active_question + 1), 'question')" 
                  class="btn btn-secondary nav-q-btn"
                  :disabled="currentRound.presenter_active_question === TOTAL_QUESTIONS"
                >
                  <ChevronRight :size="20" />
                </button>
              </div>
            </div>

            <!-- Prominent Command Actions - Re-numbered 1 to 4 and vertically tight aligned -->
            <div class="state-commands-list">
              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'question')"
                class="btn cmd-state-btn btn-show-question"
                :class="{ active: currentRound.presenter_show_state === 'question' }"
              >
                <div class="btn-double-label">
                  <strong>1. แสดงโจทย์บนจอเวที (Show Question)</strong>
                  <small>* แสดงคำถาม + ตัวเลือก (นับถอยหลัง 30 วิ อัตโนมัติใน 2.5 วินาที)</small>
                </div>
              </button>

              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'timer_start', true)"
                class="btn cmd-state-btn btn-start-timer"
                :class="{ active: currentRound.presenter_show_state === 'timer_start' }"
              >
                <div class="btn-icon-label">
                  <Clock :size="18" />
                  <span>2. ปล่อยเวลาถอยหลังทันที (Force Timer)</span>
                </div>
              </button>

              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'answer_revealed')"
                class="btn cmd-state-btn btn-reveal-answer"
                :class="{ active: currentRound.presenter_show_state === 'answer_revealed' }"
              >
                <strong>3. เฉลยคำตอบถูกต้อง (Reveal Answer)</strong>
              </button>

              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'correct_teams')"
                class="btn cmd-state-btn btn-reveal-teams"
                :class="{ active: currentRound.presenter_show_state === 'correct_teams' }"
              >
                <div class="btn-double-label">
                  <strong>4. แสดงทีมตอบถูกบนจอเวที (Reveal Teams)</strong>
                  <small>* อ่านประกาศหมายเลขทีมตอบถูกออฟไลน์</small>
                </div>
              </button>
            </div>
          </div>

        </div>

        <!-- COLUMN 2: DIRECT QUESTION SELECTOR (Moved here before preview) -->
        <div class="dashboard-col col-selector">
          
          <div class="glass-card questions-direct-selector">
            <div class="selector-card-header">
              <h2 class="section-title">3. เลือกข้อสอบโดยตรง</h2>
              <button @click="onRoundChanged(selectedRoundId)" class="btn btn-secondary refresh-q-btn" title="รีเฟรชคลังข้อสอบ">
                <RefreshCw :size="12" />
              </button>
            </div>
            
            <div class="questions-buttons-grid">
              <button 
                v-for="i in TOTAL_QUESTIONS" 
                :key="i"
                @click="updatePresenterState(i, 'question')"
                class="btn grid-q-btn"
                :class="{ 
                  active: currentRound.presenter_active_question === i,
                  configured: questions.some(q => q.question_number === i)
                }"
              >
                <div class="q-tile-content">
                  <span class="q-tile-number">Q{{ i }}</span>
                  <span class="q-tile-badge">
                    {{ questions.find(q => q.question_number === i)?.is_image_only ? 'สไลด์' : questions.find(q => q.question_number === i) ? 'TEXT' : 'ว่าง' }}
                  </span>
                  <span class="q-tile-ans" v-if="questions.some(q => q.question_number === i)">
                    ({{ questions.find(q => q.question_number === i)?.correct_answer }})
                  </span>
                </div>
              </button>
            </div>
          </div>

        </div>

        <!-- COLUMN 3: LIVE PREVIEW & STATS (Moved here as the last column) -->
        <div class="dashboard-col col-preview">
          
          <!-- Card 1: Live Question preview -->
          <div class="glass-card monitor-card">
            <h2 class="section-title">4. มอนิเตอร์โจทย์ข้อปัจจุบัน</h2>
            
            <div v-if="activeQuestionData" class="monitor-details">
              <div class="preview-header">
                <span class="preview-q-badge">
                  คำถามข้อที่ {{ activeQuestionData.question_number }}
                </span>
                <span class="preview-mode-badge" :class="activeQuestionData.is_image_only ? 'bg-purple' : 'bg-cyan'">
                  {{ activeQuestionData.is_image_only ? 'SLIDE' : 'TEXT' }}
                </span>
              </div>

              <!-- Question text -->
              <p class="preview-question-text">
                {{ activeQuestionData.question_text || '(ไม่มีโจทย์ข้อความ - โหมดภาพสไลด์)' }}
              </p>

              <!-- Image previews in single row to save space -->
              <div class="previews-row" v-if="activeQuestionData.question_image_url || activeQuestionData.answer_image_url">
                <div v-if="activeQuestionData.question_image_url" class="image-preview-box">
                  <span class="image-lbl">ภาพโจทย์:</span>
                  <img :src="activeQuestionData.question_image_url" class="preview-image" alt="Question" />
                </div>
                <div v-if="activeQuestionData.answer_image_url" class="image-preview-box">
                  <span class="image-lbl">ภาพเฉลย:</span>
                  <img :src="activeQuestionData.answer_image_url" class="preview-image" alt="Answer" />
                </div>
              </div>

              <!-- Compact Choices list with Correct Choice highlighted -->
              <div v-if="!activeQuestionData.is_image_only" class="compact-choices-list">
                <div class="compact-choice-item" :class="{ correct: activeQuestionData.correct_answer === 'ก' }">
                  <span class="choice-tag">ก</span> <span class="choice-lbl">{{ activeQuestionData.choice_a }}</span>
                </div>
                <div class="compact-choice-item" :class="{ correct: activeQuestionData.correct_answer === 'ข' }">
                  <span class="choice-tag">ข</span> <span class="choice-lbl">{{ activeQuestionData.choice_b }}</span>
                </div>
                <div class="compact-choice-item" :class="{ correct: activeQuestionData.correct_answer === 'ค' }">
                  <span class="choice-tag">ค</span> <span class="choice-lbl">{{ activeQuestionData.choice_c }}</span>
                </div>
                <div class="compact-choice-item" :class="{ correct: activeQuestionData.correct_answer === 'ง' }">
                  <span class="choice-tag">ง</span> <span class="choice-lbl">{{ activeQuestionData.choice_d }}</span>
                </div>
              </div>
            </div>
            
            <div v-else class="empty-monitor">
              <HelpCircle :size="24" class="empty-icon" />
              <p>ไม่มีข้อมูลโจทย์ในระบบสำหรับข้อนี้</p>
            </div>
          </div>

          <!-- Card 2: Stats Summary -->
          <div class="glass-card stats-summary-card">
            <h2 class="section-title">5. สถิติเรียลไทม์ (ข้อนี้)</h2>
            <div class="stats-boxes-grid">
              <div class="stat-box-container answers-received">
                <span class="stat-box-lbl">ส่งคำตอบแล้ว</span>
                <span class="stat-box-val">
                  {{ activeQuestionAnswersCount }} / {{ teams.length }} ทีม
                </span>
              </div>
              
              <div class="stat-box-container correct-answers">
                <span class="stat-box-lbl">ทีมที่ตอบถูกต้อง</span>
                <span class="stat-box-val text-success">
                  {{ activeQuestionCorrectCount }} ทีม
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
/* dashboard layout to fit single page */
.dashboard-container {
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
}

.selector-group {
  display: flex; 
  align-items: center; 
  gap: 0.75rem;
}

.selector-label {
  margin-bottom: 0; 
  white-space: nowrap;
  font-size: 0.9rem;
}

.selector-dropdown {
  min-width: 250px;
  height: 36px;
  padding: 0.25rem 0.5rem;
  font-size: 0.9rem;
}

.buttons-group {
  display: flex; 
  gap: 0.5rem;
}

.led-btn, .exit-btn {
  height: 36px;
  font-size: 0.85rem;
  padding: 0 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.loading-state {
  text-align: center; 
  color: var(--text-secondary); 
  padding: 5rem;
  flex: 1;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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

.error-card {
  text-align: center; 
  color: var(--color-error); 
  padding: 4rem;
  flex: 1;
}

.error-icon {
  margin-bottom: 1rem;
}

/* Widescreen 3-column layout without scroll, Column order rearranged: Control (1.1fr) -> Selector (0.9fr) -> Preview (1fr) */
.presenter-admin-layout {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr 1fr;
  gap: 1rem;
  flex: 1;
  min-height: 0; /* Important to make child overflow work correctly */
}

.dashboard-col {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

/* SETUP CARD (ย่อให้เล็ก) */
.setup-card {
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.card-subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-weight: 700;
}

.setup-buttons-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.4rem;
}

.btn-setup {
  padding: 0.4rem 0.25rem;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
  height: 34px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.btn-setup:hover {
  background: rgba(0, 229, 255, 0.15);
  border-color: var(--color-cyan);
  color: #ffffff;
}

.btn-setup.active {
  background: var(--color-cyan) !important;
  color: #000000 !important;
  border-color: var(--color-cyan) !important;
  box-shadow: var(--shadow-neon-cyan);
}

/* Light Theme Overrides for Setup Buttons */
.light-theme .btn-setup {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(15, 23, 42, 0.15);
  color: var(--text-primary);
}

.light-theme .btn-setup:hover {
  background: #ffffff;
  border-color: var(--color-cyan);
}

.light-theme .btn-setup.active {
  background: var(--color-cyan) !important;
  color: #000000 !important;
  border-color: var(--color-cyan) !important;
  box-shadow: var(--shadow-neon-cyan);
}

/* CONTROLLER CARD */
.controller-card {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.controller-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0.5rem;
  margin-bottom: 0.75rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.audio-controls-group {
  display: flex;
  gap: 0.4rem;
}

.toggle-audio-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-question-display {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255,255,255,0.015);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 1rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.display-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.display-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.nav-q-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-q-num-text {
  font-size: 1.6rem;
  font-family: var(--font-title);
  font-weight: 800;
  color: var(--color-cyan);
}

/* Vertically tight aligned controller actions */
.state-commands-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem; /* Closer vertical gap */
  flex: 1;
  justify-content: flex-start; /* Align closer to the top instead of stretching */
}

.cmd-state-btn {
  padding: 0.5rem 0.75rem; /* Reduced padding for tighter sizing */
  text-align: left;
  justify-content: flex-start;
  min-height: 44px; /* Reduced min-height */
  border-radius: var(--radius-sm);
}

.cmd-state-btn.active {
  box-shadow: var(--shadow-neon-cyan);
}

.btn-show-question.active {
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)) !important;
  color: #000 !important;
  border-color: var(--color-cyan) !important;
}

.btn-start-timer.active {
  background: var(--color-error) !important;
  color: #fff !important;
  border-color: var(--color-error) !important;
  box-shadow: 0 0 10px rgba(255, 23, 68, 0.4) !important;
}

.btn-reveal-answer.active {
  background: var(--color-warning) !important;
  color: #fff !important;
  border-color: var(--color-warning) !important;
  box-shadow: 0 0 10px rgba(255, 145, 0, 0.4) !important;
}

.btn-reveal-teams.active {
  background: var(--color-success) !important;
  color: #000 !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 10px rgba(0, 230, 118, 0.4) !important;
}

.btn-double-label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.btn-double-label strong {
  font-size: 0.82rem; /* Slightly smaller text for compact alignment */
}

.btn-double-label small {
  font-size: 0.65rem;
  opacity: 0.85;
}

.btn-icon-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  font-size: 0.82rem;
}

/* MONITOR CARD */
.monitor-card {
  padding: 1rem;
  flex: 1.6;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.monitor-details {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
  min-height: 0;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.preview-q-badge {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-cyan);
}

.preview-mode-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  font-weight: 700;
}

.bg-purple {
  background-color: rgba(213, 0, 249, 0.15);
  color: var(--color-purple);
}

.bg-cyan {
  background-color: rgba(0, 229, 255, 0.15);
  color: var(--color-cyan);
}

.preview-question-text {
  font-size: 0.95rem;
  line-height: 1.4;
  color: var(--text-primary);
  max-height: 80px;
  overflow-y: auto;
  padding-right: 0.25rem;
  flex-shrink: 0;
}

.previews-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  flex-shrink: 0;
}

.image-preview-box {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.image-lbl {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.preview-image {
  max-width: 100%;
  max-height: 65px;
  object-fit: contain;
  border-radius: 4px;
  border: 1px solid var(--glass-border);
}

.compact-choices-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  overflow-y: auto;
}

.compact-choice-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  font-size: 0.85rem;
}

.compact-choice-item.correct {
  border-color: var(--color-success);
  background: rgba(0, 230, 118, 0.08);
}

.compact-choice-item.correct .choice-tag {
  background: var(--color-success);
  color: #000;
}

.choice-tag {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.choice-lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-monitor {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  margin: auto;
}

.empty-icon {
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

/* STATS SUMMARY CARD */
.stats-summary-card {
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.stats-boxes-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.stat-box-container {
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  text-align: center;
  display: flex;
  flex-direction: column;
}

.answers-received {
  background: rgba(0,229,255,0.02);
  border: 1px solid rgba(0,229,255,0.08);
}

.correct-answers {
  background: rgba(0,230,118,0.02);
  border: 1px solid rgba(0,230,118,0.08);
}

.stat-box-lbl {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.stat-box-val {
  font-family: var(--font-title);
  font-size: 1.15rem;
  font-weight: 800;
}

.text-success {
  color: var(--color-success);
}

/* QUESTIONS DIRECT SELECTOR */
.questions-direct-selector {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.selector-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0.5rem;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
}

.refresh-q-btn {
  padding: 0.25rem 0.5rem;
  height: 28px;
}

.questions-buttons-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
  flex: 1;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.grid-q-btn {
  padding: 0.25rem;
  height: auto;
  min-height: 54px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
}

.grid-q-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-cyan);
}

.grid-q-btn.configured {
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.25);
}

.grid-q-btn.active {
  background: rgba(0, 229, 255, 0.22);
  border-color: var(--color-cyan) !important;
  box-shadow: var(--shadow-neon-cyan);
}

.q-tile-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
}

.q-tile-number {
  font-family: var(--font-title);
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--text-primary);
}

.q-tile-badge {
  font-size: 0.6rem;
  color: var(--text-secondary);
  opacity: 0.85;
}

.q-tile-ans {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--color-gold);
}

.no-round-selected {
  text-align: center;
  padding: 5rem;
  color: var(--text-secondary);
  flex: 1;
}

/* Light Theme Overrides for Grid Question Buttons */
.light-theme .grid-q-btn {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(15, 23, 42, 0.12);
  color: var(--text-primary);
}

.light-theme .grid-q-btn:hover {
  background: #ffffff;
  border-color: var(--color-cyan);
}

.light-theme .grid-q-btn.configured {
  background: rgba(0, 131, 143, 0.1);
  border-color: rgba(0, 131, 143, 0.3);
}

.light-theme .grid-q-btn.active {
  background: rgba(0, 131, 143, 0.2);
  border-color: var(--color-cyan) !important;
  box-shadow: var(--shadow-neon-cyan);
}

.light-theme .q-tile-number {
  color: var(--text-primary);
}

.light-theme .q-tile-badge {
  color: var(--text-secondary);
}
</style>

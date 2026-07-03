<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter, useRoute } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
import { 
  Sliders, 
  Tv, 
  Play, 
  HelpCircle,
  Award,
  ChevronLeft, 
  ChevronRight,
  Eye,
  RefreshCw,
  LogOut,
  AlertCircle,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  CheckCircle,
  Clock
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)
const questions = ref<any[]>([])
const answers = ref<any[]>([])
const teams = ref<any[]>([])

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

// Audio settings refs
const soundEnabled = ref(true)
const ttsEnabled = ref(true)

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
        ttsEnabled: ttsEnabled.value
      }
    })
  }
}

const toggleSound = () => {
  soundEnabled.value = !soundEnabled.value
  sendAudioSettings()
}

const toggleTts = () => {
  ttsEnabled.value = !ttsEnabled.value
  sendAudioSettings()
}

onUnmounted(() => {
  cleanupSubscriptions()
  if (autoTimerTimeout) clearTimeout(autoTimerTimeout)
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    adminPasskey.value = localStorage.getItem('admin_passkey') || ''
    
    if (!adminPasskey.value) {
      router.push('/')
      return
    }
    
    // Verify passkey against DB
    const validated = await verifyAuth(adminPasskey.value)
    if (!validated) {
      router.push('/')
      return
    }
    passkeyValid.value = true
  }

  if (isConfigured.value) {
    await fetchRounds()
  }
})

const verifyAuth = async (key: string) => {
  if (!supabase.value) return false
  const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'admin', p_passkey: key })
  return !!data
}

watch(roundsList, () => {
  if (roundsList.value.length > 0) {
    const queryId = route.query.round as string
    if (queryId && roundsList.value.some(r => r.id === queryId)) {
      selectedRoundId.value = queryId
    } else {
      selectedRoundId.value = roundsList.value[0].id
    }
    handleRoundChange()
  }
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
          updatePresenterState(newQNum, 'timer_start', true)
        }
      }, 2500)
    }
  }
)

const fetchRounds = async () => {
  if (!supabase.value) return
  const { data } = await supabase.value
    .from('rounds')
    .select('*')
    .order('created_at', { ascending: false })
  if (data) {
    roundsList.value = data
  }
}

const handleRoundChange = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  loading.value = true
  isLoaded.value = false
  
  try {
    // 1. Fetch round
    const { data: rData } = await supabase.value
      .from('rounds')
      .select('*')
      .eq('id', selectedRoundId.value)
      .single()
    currentRound.value = rData

    // 2. Fetch questions
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('question_number', { ascending: true })
    questions.value = qData || []

    // 3. Fetch teams
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('team_number', { ascending: true })
    teams.value = tData || []

    // 4. Fetch answers
    await fetchAnswers()

    // Clean up old subscriptions first
    cleanupSubscriptions()

    // Setup audio config broadcast channel
    setupConfigChannel()

    // Subscribe to realtime answer updates (to show stats)
    answersChannel = supabase.value
      .channel('presenter-admin-answers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => {
        fetchAnswers()
      })
      .subscribe()

    // Subscribe to round changes (in case other admin updates state)
    roundChannel = supabase.value
      .channel('presenter-admin-round')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `id=eq.${selectedRoundId.value}` }, (payload) => {
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

const fetchAnswers = async () => {
  if (!supabase.value || teams.value.length === 0) return
  const teamIds = teams.value.map(t => t.id)
  const { data } = await supabase.value
    .from('answers')
    .select('*')
    .in('team_id', teamIds)
  answers.value = data || []
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
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Action Bar -->
    <div class="glass-card" style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
      <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 280px;">
        <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">รอบการแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input" style="max-width: 320px;">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div style="display: flex; gap: 0.5rem;">
        <NuxtLink :to="`/presenter?round=${selectedRoundId}`" target="_blank" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem;">
          <Tv :size="16" />
          <span>เปิดหน้าจอ LED ใหญ่</span>
        </NuxtLink>
        <button @click="handleExit" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem;">
          <LogOut :size="16" />
          <span>กลับหน้าแรก</span>
        </button>
      </div>
    </div>

    <!-- Error/Loading states -->
    <div v-if="loading" style="text-align: center; color: var(--text-secondary); padding: 5rem;">
      <div class="loading-spin" style="width: 40px; height: 40px; border: 3px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%; margin: 0 auto 1.5rem;"></div>
      <p>กำลังเตรียมระบบควบคุมเวที...</p>
    </div>

    <div v-else-if="errorMsg" class="glass-card" style="text-align: center; color: var(--color-error); padding: 4rem;">
      <AlertCircle :size="48" style="margin-bottom: 1rem;" />
      <p>{{ errorMsg }}</p>
    </div>

    <template v-else-if="currentRound">
      <div style="text-align: center; margin-bottom: 2rem;">
        <h1 style="font-size: 2.2rem; background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.25rem;">
          แผงควบคุมหน้าจอเวที (Stage Admin Panel)
        </h1>
        <p style="color: var(--text-secondary); font-size: 1.05rem;">
          {{ currentRound.name }} • สั่งเปลี่ยนภาพ เสียงนับถอยหลัง และเฉลยสดบนจอ LED หน้าห้องประชุม
        </p>
      </div>

      <div class="presenter-admin-grid">
        
        <!-- LEFT COLUMN: ACTIVE COMMAND CONTROLLER -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- State controller card -->
          <div class="glass-card controller-card">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); padding-bottom: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem;">
              <h2 class="section-title" style="margin: 0; border: none; padding: 0;">ปุ่มควบคุมจอเวที</h2>
              
              <!-- Audio Controls -->
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <button 
                  @click="toggleTts" 
                  class="btn" 
                  :class="ttsEnabled ? 'btn-primary' : 'btn-secondary'"
                  style="padding: 0.5rem; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; margin: 0;"
                  :title="ttsEnabled ? 'เสียงพูดอ่านโจทย์/ผู้ชนะ: เปิด' : 'เสียงพูดอ่านโจทย์/ผู้ชนะ: ปิด'"
                >
                  <Mic v-if="ttsEnabled" :size="16" />
                  <MicOff v-else :size="16" />
                </button>

                <button 
                  @click="toggleSound" 
                  class="btn" 
                  :class="soundEnabled ? 'btn-primary' : 'btn-secondary'"
                  style="padding: 0.5rem; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; margin: 0;"
                  :title="soundEnabled ? 'เสียงเตือนเวลานับถอยหลัง: เปิด' : 'เสียงเตือนเวลานับถอยหลัง: ปิด'"
                >
                  <Volume2 v-if="soundEnabled" :size="16" />
                  <VolumeX v-else :size="16" />
                </button>
              </div>
            </div>
            
            <div class="active-question-display">
              <span class="active-q-label">ข้อคำถามที่เลือก</span>
              <div class="active-q-controls">
                <button 
                  @click="updatePresenterState(Math.max(1, currentRound.presenter_active_question - 1), 'question')" 
                  class="btn btn-secondary q-nav-btn"
                  :disabled="currentRound.presenter_active_question === 1"
                >
                  <ChevronLeft :size="24" />
                </button>
                
                <span class="active-q-number">ข้อที่ {{ currentRound.presenter_active_question }}</span>
                
                <button 
                  @click="updatePresenterState(Math.min(20, currentRound.presenter_active_question + 1), 'question')" 
                  class="btn btn-secondary q-nav-btn"
                  :disabled="currentRound.presenter_active_question === 20"
                >
                  <ChevronRight :size="24" />
                </button>
              </div>
            </div>

            <!-- Action buttons state -->
            <div class="control-actions-stack">
              <!-- Action 1: Show Question -->
              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'question')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'question' ? 'btn-primary active-btn' : 'btn-secondary'"
              >
                <HelpCircle :size="20" />
                <span>1. แสดงโจทย์คำถาม / สไลด์โจทย์</span>
              </button>

              <!-- Action 2: Start Timer -->
              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'timer_start', true)"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'timer_start' ? 'btn-primary active-btn-timer' : 'btn-secondary'"
              >
                <Clock :size="20" />
                <span>2. เริ่มจับเวลา 30 วินาที (เริ่มอัตโนมัติหลังเปิดโจทย์ 2.5 วิ)</span>
              </button>

              <!-- Action 3: Reveal Answer -->
              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'answer_revealed')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'answer_revealed' ? 'btn-primary active-btn' : 'btn-secondary'"
              >
                <Eye :size="20" />
                <span>3. แสดงคำตอบที่ถูกต้อง</span>
              </button>

              <!-- Action 4: Reveal Correct Teams -->
              <button 
                @click="updatePresenterState(currentRound.presenter_active_question, 'correct_teams')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'correct_teams' ? 'btn-primary active-btn' : 'btn-secondary'"
              >
                <Award :size="20" />
                <span>4. ประกาศรายชื่อทีมที่ตอบถูกต้อง</span>
              </button>
            </div>
          </div>

          <!-- Live Status Info -->
          <div class="glass-card">
            <h3 style="margin-bottom: 1rem; color: #fff;">ข้อมูลประชากรคำตอบข้อนี้</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; text-align: center;">
              <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border);">
                <span style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">ส่งคำตอบแล้ว</span>
                <span style="font-family: var(--font-title); font-size: 1.8rem; font-weight: 800; color: var(--color-cyan);">
                  {{ activeQuestionAnswersCount }} / {{ teams.length }} ทีม
                </span>
              </div>
              <div style="background: rgba(0, 230, 118, 0.04); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid rgba(0, 230, 118, 0.15);">
                <span style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">ตอบถูกต้อง</span>
                <span style="font-family: var(--font-title); font-size: 1.8rem; font-weight: 800; color: var(--color-success);">
                  {{ activeQuestionCorrectCount }} ทีม
                </span>
              </div>
            </div>

            <!-- Question Metadata Review -->
            <div v-if="activeQuestionData" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--glass-border); font-size: 0.95rem;">
              <p style="margin-bottom: 0.5rem;"><strong style="color: var(--color-cyan);">คำตอบข้อนี้:</strong> {{ activeQuestionData.correct_answer }}</p>
              <p style="margin-bottom: 0.5rem;"><strong style="color: var(--color-cyan);">รูปแบบข้อสอบ:</strong> {{ activeQuestionData.is_image_only ? 'สไลด์รูปภาพเต็มจอ' : 'แบบฟอร์มข้อความพิมพ์' }}</p>
              <p v-if="activeQuestionData.question_text" style="color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                <strong>โจทย์ย่อ:</strong> {{ activeQuestionData.question_text }}
              </p>
            </div>
          </div>

        </div>

        <!-- RIGHT COLUMN: Q1-Q20 SELECTOR GRID & STATS -->
        <div class="glass-card" style="display: flex; flex-direction: column; gap: 1.25rem;">
          
          <!-- Pre-competition sequence (horizontal & compact) -->
          <div style="border: 1px solid rgba(213, 0, 249, 0.2); padding: 1rem; border-radius: var(--radius-md); background: rgba(213, 0, 249, 0.02); display: flex; flex-direction: column; gap: 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
              <h3 style="font-size: 1rem; font-weight: 700; color: var(--color-purple); display: flex; align-items: center; gap: 0.4rem; margin: 0;">
                <Sliders :size="16" style="color: var(--color-purple);" />
                <span>ขั้นตอนก่อนเริ่มการแข่งขัน (Pre-competition Sequence)</span>
              </h3>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">คลิกเลือกหัวข้อเพื่อให้หน้าจอเวทีแสดงผลตามลำดับ</span>
            </div>
            
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button 
                @click="updatePresenterState(1, 'welcome')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'welcome' ? 'btn-primary active-btn' : 'btn-secondary'"
                style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; flex: 1; min-width: 130px; margin: 0;"
              >
                <span>1. หน้าต้อนรับ</span>
              </button>
              
              <button 
                @click="updatePresenterState(1, 'rules')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'rules' ? 'btn-primary active-btn' : 'btn-secondary'"
                style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; flex: 1; min-width: 130px; margin: 0;"
              >
                <span>2. กติกาและเวลา</span>
              </button>
              
              <button 
                @click="updatePresenterState(1, 'sample_question')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'sample_question' ? 'btn-primary active-btn' : 'btn-secondary'"
                style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; flex: 1; min-width: 120px; margin: 0;"
              >
                <span>3. ข้อสอบตัวอย่าง</span>
              </button>
              
              <button 
                @click="updatePresenterState(1, 'sample_answer')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'sample_answer' ? 'btn-primary active-btn' : 'btn-secondary'"
                style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; flex: 1; min-width: 120px; margin: 0;"
              >
                <span>4. เฉลยตัวอย่าง</span>
              </button>
              
              <button 
                @click="updatePresenterState(1, 'get_ready')"
                class="btn control-btn"
                :class="currentRound.presenter_show_state === 'get_ready' ? 'btn-primary active-btn' : 'btn-secondary'"
                style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; flex: 1; min-width: 130px; margin: 0;"
              >
                <span>5. เตรียมพร้อมแข่ง</span>
              </button>
            </div>
          </div>

          <h2 class="section-title" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; border-top: 1px solid var(--glass-border); padding-top: 1rem;">
            <span>คลังคำถามของรอบการแข่งนี้</span>
            <button @click="handleRoundChange" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; height: 32px; gap: 0.25rem;">
              <RefreshCw :size="12" />
              <span>รีเฟรช</span>
            </button>
          </h2>

          <div class="questions-admin-grid">
            <div 
              v-for="i in 20" 
              :key="i"
              class="q-status-tile"
              :class="{ 
                'active-tile': currentRound.presenter_active_question === i,
                'configured-tile': questions.some(q => q.question_number === i)
              }"
              @click="updatePresenterState(i, 'question')"
            >
              <div class="tile-number">Q{{ i }}</div>
              
              <!-- Indicator of config -->
              <div class="tile-indicators">
                <span 
                  v-if="questions.find(q => q.question_number === i)?.is_image_only"
                  class="badge-slide"
                >
                  SLIDE
                </span>
                <span 
                  v-else-if="questions.some(q => q.question_number === i)"
                  class="badge-text"
                >
                  TEXT
                </span>
                <span v-else class="badge-empty">
                  ว่าง
                </span>
              </div>

              <!-- Answer key -->
              <div v-if="questions.find(q => q.question_number === i)" class="tile-key">
                เฉลย: <strong style="color: var(--color-gold);">{{ questions.find(q => q.question_number === i)?.correct_answer }}</strong>
              </div>
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
.presenter-admin-grid {
  display: grid;
  grid-template-columns: 450px 1fr;
  gap: 2rem;
}

@media (max-width: 1024px) {
  .presenter-admin-grid {
    grid-template-columns: 1fr;
  }
}

.section-title {
  font-size: 1.3rem;
  color: #fff;
  border-bottom: 1px solid var(--glass-border);
  padding-bottom: 0.75rem;
  margin-bottom: 1.25rem;
}

.controller-card {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.active-question-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--glass-border);
  padding: 1.5rem;
  border-radius: var(--radius-md);
  gap: 0.5rem;
}

.active-q-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.active-q-controls {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.q-nav-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.active-q-number {
  font-family: var(--font-title);
  font-size: 2.5rem;
  font-weight: 800;
  color: var(--color-cyan);
  text-shadow: var(--shadow-neon-cyan);
}

.control-actions-stack {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.control-btn {
  width: 100%;
  height: 60px;
  font-size: 1.1rem;
  justify-content: flex-start;
  padding: 0 1.5rem;
  border-radius: var(--radius-md);
}

.active-btn {
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)) !important;
  color: #000 !important;
  font-weight: 800;
  box-shadow: var(--shadow-neon-cyan);
}

.active-btn-timer {
  background: var(--color-error) !important;
  color: #fff !important;
  font-weight: 800;
  box-shadow: 0 0 15px rgba(255, 23, 68, 0.4);
}

/* Q1-Q20 selection grid */
.questions-admin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
}

.q-status-tile {
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 1.25rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  transition: all var(--transition-fast);
}

.q-status-tile:hover {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.02);
}

.active-tile {
  border-color: var(--color-cyan) !important;
  background: rgba(0, 229, 255, 0.05) !important;
  box-shadow: var(--shadow-neon-cyan);
  transform: translateY(-2px);
}

.tile-number {
  font-family: var(--font-title);
  font-size: 1.4rem;
  font-weight: 800;
  color: #fff;
}

.tile-indicators {
  font-size: 0.75rem;
  font-weight: 700;
}

.badge-slide {
  background: rgba(213, 0, 249, 0.15);
  color: var(--color-purple);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.badge-text {
  background: rgba(0, 229, 255, 0.15);
  color: var(--color-cyan);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.badge-empty {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.tile-key {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.light-theme .section-title {
  color: #0f172a;
}
.light-theme .tile-number {
  color: #0f172a;
}
.light-theme .badge-empty {
  background: rgba(0,0,0,0.05);
}
</style>

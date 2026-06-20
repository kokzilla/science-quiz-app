<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { 
  Tv, 
  AlertCircle, 
  Volume2, 
  VolumeX, 
  HelpCircle,
  Award,
  CheckCircle,
  Play,
  Mic,
  MicOff
} from 'lucide-vue-next'

const route = useRoute()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)
const question = ref<any>(null)
const correctTeams = ref<any[]>([])
const allTeams = ref<any[]>([])

const loading = ref(true)
const errorMsg = ref('')

// Sound files
const audioReady = ref(false)
const soundEnabled = ref(true)
const ttsEnabled = ref(true) // TTS voice toggle state
let tickAudio: HTMLAudioElement | null = null
let alarmAudio: HTMLAudioElement | null = null

// Timer state
const timerRemaining = ref(30)
const timerActive = ref(false)
let timerInterval: any = null

// Realtime subscriptions
let roundChannel: any = null
let answersChannel: any = null

onMounted(async () => {
  selectedRoundId.value = route.query.round as string || ''
  
  if (isConfigured.value) {
    await fetchRounds()
  } else {
    loading.value = false
  }

  // Pre-load audio elements
  if (typeof window !== 'undefined') {
    tickAudio = new Audio('/sounds/countdown.mp3')
    tickAudio.loop = true
    alarmAudio = new Audio('/sounds/alarm.mp3')

    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices()
      }
    }
  }
})

onUnmounted(() => {
  cleanupSubscriptions()
  stopLocalTimer()
  stopSounds()
})

const fetchRounds = async () => {
  if (!supabase.value) return
  const { data } = await supabase.value
    .from('rounds')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (data) {
    roundsList.value = data
    if (!selectedRoundId.value && data.length > 0) {
      selectedRoundId.value = data[0].id
    }
  }

  if (selectedRoundId.value) {
    await loadPresentationState()
    setupRealtimeSubscription()
  } else {
    errorMsg.value = 'ยังไม่มีรอบการแข่งขันในระบบ'
    loading.value = false
  }
}

const loadPresentationState = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  try {
    // 1. Fetch round state
    const { data: rData, error: rErr } = await supabase.value
      .from('rounds')
      .select('*')
      .eq('id', selectedRoundId.value)
      .single()

    if (rErr) throw rErr
    currentRound.value = rData

    // 2. Fetch all teams in round (for calculations)
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('team_number', { ascending: true })
    allTeams.value = tData || []

    // 3. Fetch active question details
    await fetchActiveQuestion(rData.presenter_active_question)

    // 4. Update timer based on state
    syncTimerState()

    errorMsg.value = ''
  } catch (err: any) {
    console.error('Error loading presenter state:', err)
    errorMsg.value = `โหลดข้อมูลหน้าจอเวทีล้มเหลว: ${err.message}`
  } finally {
    loading.value = false
  }
}

const fetchActiveQuestion = async (qNum: number) => {
  if (!supabase.value || !selectedRoundId.value) return
  const { data } = await supabase.value
    .from('questions')
    .select('*')
    .eq('round_id', selectedRoundId.value)
    .eq('question_number', qNum)
    .maybeSingle()
  
  question.value = data || null
  
  if (currentRound.value?.presenter_show_state === 'correct_teams') {
    await fetchCorrectTeams()
  }
}

const fetchCorrectTeams = async () => {
  if (!supabase.value || !question.value || allTeams.value.length === 0) {
    correctTeams.value = []
    return
  }

  const { data: answersData } = await supabase.value
    .from('answers')
    .select('team_id, is_correct')
    .eq('question_number', question.value.question_number)
    .in('team_id', allTeams.value.map(t => t.id))
    .eq('is_correct', true)
  
  const correctIds = answersData?.map(ans => ans.team_id) || []
  correctTeams.value = allTeams.value.filter(t => correctIds.includes(t.id))

  // Sort correct teams by number ascending
  correctTeams.value.sort((a, b) => a.team_number - b.team_number)

  // Trigger TTS voice announcement
  if (currentRound.value?.presenter_show_state === 'correct_teams') {
    speakCorrectTeams()
  }
}

const getThaiMaleVoice = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  
  // Filter for Thai voices
  const thaiVoices = voices.filter(v => v.lang.toLowerCase().startsWith('th'))
  if (thaiVoices.length === 0) return null

  // Prefer Pattara (Windows male), Niwat (macOS male) or any name containing "pattara", "niwat", "male"
  const maleKeywords = ['pattara', 'niwat', 'male']
  for (const keyword of maleKeywords) {
    const found = thaiVoices.find(v => v.name.toLowerCase().includes(keyword))
    if (found) return found
  }
  return thaiVoices[0]
}

const speakCorrectTeams = () => {
  if (!ttsEnabled.value || typeof window === 'undefined' || !('speechSynthesis' in window)) return

  // Cancel any ongoing speech
  window.speechSynthesis.cancel()

  const qNum = currentRound.value?.presenter_active_question || 1
  let text = `รายชื่อทีมที่ตอบถูกต้องในข้อที่ ${qNum} `

  if (correctTeams.value.length === 0) {
    text += 'ไม่มีทีมใดตอบถูกในข้อนี้ครับ'
  } else {
    const teamPhrases = correctTeams.value.map(t => `ทีมที่ ${t.team_number}`)
    text += `มีทั้งหมด ${correctTeams.value.length} ทีม ได้แก่ `
    if (teamPhrases.length === 1) {
      text += teamPhrases[0]
    } else {
      text += teamPhrases.slice(0, -1).join(', ') + ' และ ' + teamPhrases[teamPhrases.length - 1]
    }
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'th-TH'
  
  // Set voice to Thai male voice if available
  const maleVoice = getThaiMaleVoice()
  if (maleVoice) {
    utterance.voice = maleVoice
  }

  utterance.volume = soundEnabled.value ? 1.0 : 0.0
  utterance.rate = 0.95 // Slightly slower for clear Thai pronunciation

  // Chrome Bug Workaround: Delay speaking slightly after cancel() to avoid thread hang
  setTimeout(() => {
    window.speechSynthesis.speak(utterance)
  }, 100)
}

// Setup real-time listener for Stage Admin updates
const setupRealtimeSubscription = () => {
  if (!supabase.value || !selectedRoundId.value) return

  cleanupSubscriptions()

  // Listen to round state updates (active question, state, timer timestamp)
  roundChannel = supabase.value
    .channel('presenter-round-state')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rounds',
      filter: `id=eq.${selectedRoundId.value}`
    }, async (payload) => {
      const prevActiveQ = currentRound.value?.presenter_active_question
      const prevShowState = currentRound.value?.presenter_show_state
      currentRound.value = payload.new

      // If active question changed, fetch new question details
      if (payload.new.presenter_active_question !== prevActiveQ) {
        await fetchActiveQuestion(payload.new.presenter_active_question)
      } else if (payload.new.presenter_show_state === 'correct_teams') {
        await fetchCorrectTeams()
      }

      // Sync timer and sounds
      syncTimerState()

      // Cancel TTS speech if we moved away from correct_teams
      if (payload.new.presenter_show_state !== 'correct_teams' && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
        window.speechSynthesis.cancel()
      }
    })
    .subscribe()
}

const cleanupSubscriptions = () => {
  if (roundChannel) supabase.value?.removeChannel(roundChannel)
}

// Timer and Sound synchronization logic
const syncTimerState = () => {
  const state = currentRound.value?.presenter_show_state
  const startAt = currentRound.value?.presenter_timer_started_at

  if (state === 'timer_start' && startAt) {
    startLocalTimer(startAt)
  } else {
    stopLocalTimer()
    stopSounds()
  }
}

const startLocalTimer = (startedAtIso: string) => {
  stopLocalTimer()
  
  const startedAt = new Date(startedAtIso).getTime()
  
  const updateTimer = () => {
    const now = Date.now()
    const elapsed = Math.floor((now - startedAt) / 1000)
    const remaining = Math.max(0, 30 - elapsed)
    
    timerRemaining.value = remaining

    if (remaining > 0) {
      timerActive.value = true
      if (remaining <= 5) {
        playTick()
      } else {
        stopSounds()
      }
    } else {
      timerActive.value = false
      stopLocalTimer()
      playAlarm()
    }
  }

  updateTimer() // run once immediately
  timerInterval = setInterval(updateTimer, 500)
}

const stopLocalTimer = () => {
  if (timerInterval) clearInterval(timerInterval)
  timerActive.value = false
}

// Watchers to immediately stop speech when audio/TTS is muted
watch(ttsEnabled, (newVal) => {
  if (!newVal && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
    window.speechSynthesis.cancel()
  }
})

watch(soundEnabled, (newVal) => {
  if (!newVal && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
    window.speechSynthesis.cancel()
  }
})

const playTick = () => {
  if (soundEnabled.value && audioReady.value && tickAudio) {
    tickAudio.play().catch(e => console.log('Audio error:', e))
  }
}

const playAlarm = () => {
  stopSounds()
  if (soundEnabled.value && audioReady.value && alarmAudio) {
    alarmAudio.play().catch(e => console.log('Audio error:', e))
  }
}

const stopSounds = () => {
  if (tickAudio) {
    tickAudio.pause()
    tickAudio.currentTime = 0;
  }
  if (typeof window !== 'undefined' && ('speechSynthesis' in window)) {
    window.speechSynthesis.cancel()
  }
}

// Unlock audio autoplay
const enableAudio = () => {
  audioReady.value = true
  
  // Play silent clips to unlock HTMLAudioElement
  if (tickAudio && alarmAudio) {
    tickAudio.play().then(() => {
      tickAudio?.pause()
      tickAudio!.currentTime = 0
    }).catch(e => console.log(e))
    
    alarmAudio.play().then(() => {
      alarmAudio?.pause()
      alarmAudio!.currentTime = 0
    }).catch(e => console.log(e))
  }

  // Speak empty utterance to unlock SpeechSynthesis in Chrome/Edge autoplay policy
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const unlockUtterance = new SpeechSynthesisUtterance('')
    window.speechSynthesis.speak(unlockUtterance)
  }
}

const questionFontSize = computed(() => {
  if (!question.value || !question.value.question_text) return '3.6rem'
  const len = question.value.question_text.length
  if (len < 60) return '5.4rem'
  if (len < 120) return '4.4rem'
  return '3.6rem'
})

const handleRoundChange = () => {
  loading.value = true
  loadPresentationState()
  setupRealtimeSubscription()
}
</script>

<template>
  <div class="presenter-view">
    
    <!-- Audio unlock overlay gate -->
    <div v-if="!audioReady" class="audio-unlock-overlay no-print">
      <div class="glass-card" style="max-width: 500px; text-align: center; padding: 3rem; border-color: var(--color-cyan);">
        <Volume2 :size="64" class="text-cyan" style="margin-bottom: 1.5rem;" />
        <h2 style="font-size: 1.8rem; margin-bottom: 1rem; color: #fff;">เปิดการใช้งานระบบเสียงเวที</h2>
        <p style="color: var(--text-secondary); margin-bottom: 2rem;">
          เบราว์เซอร์บล็อกการเล่นเสียงอัตโนมัติ กรุณาคลิกปุ่มด้านล่างเพื่อเริ่มระบบภาพและเสียงเตือน 30 วินาทีออกลำโพงห้องประชุม
        </p>
        <button @click="enableAudio" class="btn btn-primary" style="font-size: 1.2rem; padding: 1rem 2.5rem; display: flex; align-items: center; gap: 0.5rem; margin: 0 auto;">
          <Play :size="20" />
          <span>เริ่มใช้งานหน้าจอเวที</span>
        </button>
      </div>
    </div>

    <!-- Configuration selector (no-print floating top right for testing) -->
    <div class="no-print" style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem; z-index: 99;">
      <button 
        @click="ttsEnabled = !ttsEnabled" 
        class="btn btn-secondary" 
        style="padding: 0.5rem; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;"
        :title="ttsEnabled ? 'ปิดระบบเสียงอ่านเลขทีมตอบถูก' : 'เปิดระบบเสียงอ่านเลขทีมตอบถูก'"
      >
        <Mic v-if="ttsEnabled" :size="18" class="text-cyan" />
        <MicOff v-else :size="18" style="color: var(--text-muted);" />
      </button>

      <button @click="soundEnabled = !soundEnabled" class="btn btn-secondary" style="padding: 0.5rem; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;">
        <Volume2 v-if="soundEnabled" :size="18" />
        <VolumeX v-else :size="18" style="color: var(--text-muted);" />
      </button>

      <div style="background: rgba(0,0,0,0.5); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--glass-border);">
        <span>รอบการแข่ง:</span>
        <select v-model="selectedRoundId" @change="handleRoundChange" style="background: var(--bg-tertiary); color: var(--text-primary); border: none; font-size: 0.75rem; border-radius: 4px; padding: 0.2rem 0.5rem; outline: none; cursor: pointer; max-width: 140px;">
          <option v-for="r in roundsList" :key="r.id" :value="r.id" style="color: var(--text-primary); background: var(--bg-secondary);">
            {{ r.name }}
          </option>
        </select>
      </div>
    </div>

    <!-- Error States -->
    <div v-if="!isConfigured || errorMsg" style="max-width: 500px; margin: auto; text-align: center;" class="glass-card">
      <AlertCircle :size="64" class="text-error" style="margin-bottom: 1.5rem;" />
      <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff;">เกิดข้อผิดพลาดในการเชื่อมต่อ</h2>
      <p style="color: var(--text-secondary); margin-bottom: 2rem;">
        {{ errorMsg || 'กรุณาตั้งค่าเชื่อมต่อฐานข้อมูลก่อนใช้งาน' }}
      </p>
    </div>

    <div v-else-if="loading" style="margin: auto; text-align: center; color: var(--text-secondary);">
      <div class="loading-spin" style="width: 50px; height: 50px; border: 4px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%; margin: 0 auto 1.5rem;"></div>
      <p>กำลังเตรียมระบบแสดงผลจอใหญ่...</p>
    </div>

    <template v-else-if="currentRound">
      <!-- MAIN PRESENTATION BODY -->
      <div class="presentation-container">
        
        <!-- Timer countdown overlay widget -->
        <div v-if="currentRound.presenter_show_state === 'timer_start'" class="timer-overlay">
          <div class="timer-circle" :class="{ 'timer-warning': timerRemaining <= 5 }">
            <div class="timer-seconds">{{ timerRemaining }}</div>
            <div class="timer-label">วินาที</div>
          </div>
        </div>

        <!-- 1. CORRECT TEAMS GRID VIEW -->
        <div v-if="currentRound.presenter_show_state === 'correct_teams'" class="presenter-card correct-teams-container">
          <h1 class="presenter-header-text" style="color: var(--color-gold); display: flex; align-items: center; justify-content: center; gap: 1rem;">
            <Award :size="48" style="color: var(--color-gold);" />
            <span>รายชื่อทีมที่ตอบถูกต้องในข้อที่ {{ currentRound.presenter_active_question }} จำนวน {{ correctTeams.length }} ทีม</span>
          </h1>

          <div v-if="correctTeams.length === 0" class="no-correct-teams">
            ยังไม่มีผู้ตอบถูก หรือระบบกำลังตรวจคำตอบ
          </div>
          <div v-else class="correct-teams-grid">
            <div 
              v-for="team in correctTeams" 
              :key="team.id"
              class="correct-team-badge"
            >
              <CheckCircle :size="40" class="icon-success" />
              <span>TEAM {{ String(team.team_number).padStart(2, '0') }}</span>
            </div>
          </div>
        </div>

        <!-- 2. NO QUESTION DATA LOADED YET -->
        <div v-else-if="!question" class="presenter-card" style="text-align: center; padding: 8rem 0;">
          <HelpCircle :size="80" style="color: var(--text-muted); margin-bottom: 2rem;" />
          <h2 style="font-size: 2.2rem; color: #fff;">รอกรรมการเลือกข้อคำถาม...</h2>
          <p style="color: var(--text-secondary); font-size: 1.2rem; margin-top: 0.5rem;">
            เตรียมตัวแข่งขันในข้อถัดไป
          </p>
        </div>

        <!-- 3. SLIDE IMAGE MODE (Solution 1) -->
        <div v-else-if="question.is_image_only" class="presenter-slide-mode">
          <img 
            :src="currentRound.presenter_show_state === 'answer_revealed' && question.answer_image_url ? question.answer_image_url : question.question_image_url" 
            alt="Question Slide"
            class="slide-image"
          />
        </div>

        <!-- 4. DYNAMIC TEXT/HTML MODE (Solution 3) -->
        <div v-else class="presenter-card text-question-layout">
          <!-- Header info -->
          <div class="question-header">
            <span class="question-badge">ข้อที่ {{ question.question_number }}</span>
            <span class="question-points">({{ question.points }} คะแนน)</span>
          </div>

          <!-- Question Text -->
          <div class="question-body">
            <h1 class="question-text" :style="{ fontSize: questionFontSize }" v-html="question.question_text"></h1>
            
            <!-- Optional embedded diagram/image -->
            <div v-if="question.question_image_url" class="question-image-box">
              <img :src="question.question_image_url" alt="Diagram" class="question-diagram" />
            </div>
          </div>

          <!-- Choices Grid -->
          <div class="choices-grid" :class="{ 'layout-1-col': question.choices_layout === '1_col' }">
            <!-- Choice ก -->
            <div 
              class="choice-card"
              :class="{ 
                'correct': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer === 'ก',
                'incorrect': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer !== 'ก'
              }"
            >
              <div class="choice-letter">ก</div>
              <div class="choice-text" v-html="question.choice_a"></div>
            </div>

            <!-- Choice ข -->
            <div 
              class="choice-card"
              :class="{ 
                'correct': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer === 'ข',
                'incorrect': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer !== 'ข'
              }"
            >
              <div class="choice-letter">ข</div>
              <div class="choice-text" v-html="question.choice_b"></div>
            </div>

            <!-- Choice ค -->
            <div 
              class="choice-card"
              :class="{ 
                'correct': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer === 'ค',
                'incorrect': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer !== 'ค'
              }"
            >
              <div class="choice-letter">ค</div>
              <div class="choice-text" v-html="question.choice_c"></div>
            </div>

            <!-- Choice ง -->
            <div 
              class="choice-card"
              :class="{ 
                'correct': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer === 'ง',
                'incorrect': currentRound.presenter_show_state === 'answer_revealed' && question.correct_answer !== 'ง'
              }"
            >
              <div class="choice-letter">ง</div>
              <div class="choice-text" v-html="question.choice_d"></div>
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
.presenter-view {
  background: #020306;
  background-image: 
    radial-gradient(circle at 50% 0%, rgba(213, 0, 249, 0.08) 0%, transparent 70%),
    radial-gradient(circle at 100% 100%, rgba(0, 229, 255, 0.04) 0%, transparent 60%);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1.5rem 8rem 1.5rem; /* Pushes content up to prevent stage edge blockage */
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--font-body);
}

.presentation-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  max-width: 95vw; /* Fills widescreen LED displays beautifully */
  margin: 0 auto;
  width: 100%;
}

.presenter-card {
  background: rgba(10, 12, 22, 0.6);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-lg);
  padding: 3rem;
}

/* Audio unlock overlay */
.audio-unlock-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(2, 3, 6, 0.95);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Timer Countdown Radial Overlay */
.timer-overlay {
  position: absolute;
  top: 2rem;
  right: 2rem;
  z-index: 50;
}
.timer-circle {
  width: 130px;
  height: 130px;
  border-radius: 50%;
  background: rgba(10, 12, 22, 0.9);
  border: 6px solid var(--color-cyan);
  box-shadow: var(--shadow-neon-cyan);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: pulse 1s infinite alternate;
}

.timer-circle.timer-warning {
  border-color: var(--color-error);
  box-shadow: 0 0 20px rgba(255, 23, 68, 0.6);
  animation: pulse-danger 0.5s infinite;
}

.timer-seconds {
  font-family: var(--font-title);
  font-size: 3.2rem;
  font-weight: 900;
  line-height: 1;
  color: #fff;
}

.timer-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

@keyframes pulse {
  from { transform: scale(1); }
  to { transform: scale(1.05); }
}

@keyframes pulse-danger {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

/* Correct Teams Grid view */
.correct-teams-container {
  min-height: 700px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 3rem;
  animation: fadeIn 0.5s ease-out;
}

.no-correct-teams {
  font-size: 2rem;
  color: var(--text-secondary);
  text-align: center;
}

.correct-teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  width: 100%;
  max-width: 100%; /* Spans full widescreen container width */
}

.correct-team-badge {
  background: rgba(0, 230, 118, 0.05);
  border: 2px solid rgba(0, 230, 118, 0.35);
  box-shadow: 0 0 15px rgba(0, 230, 118, 0.05);
  padding: 1.5rem 2rem;
  border-radius: var(--radius-md);
  font-family: var(--font-title);
  font-size: 2.6rem; /* Increased size */
  font-weight: 800;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.2rem;
  animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.icon-success {
  color: var(--color-success);
}

@keyframes popIn {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* Slide mode (Solution 1) */
.presenter-slide-mode {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
}
.slide-image {
  max-width: 100%;
  max-height: 85vh;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  border: 1px solid var(--glass-border);
  object-fit: contain;
}

/* Dynamic text/HTML mode (Solution 3) */
.text-question-layout {
  display: flex;
  flex-direction: column;
  gap: 1.8rem;
  min-height: 70vh;
  justify-content: flex-start; /* Aligns to top of card, leaving blank space at bottom */
}

.question-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.question-badge {
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  color: #000;
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.2rem;
  padding: 0.5rem 2rem;
  border-radius: var(--radius-sm);
}

.question-points {
  color: var(--color-gold);
  font-family: var(--font-title);
  font-size: 1.8rem;
  font-weight: 800;
}

.question-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 2rem;
}

.question-text {
  font-size: 2.8rem;
  font-weight: 700;
  text-align: center;
  line-height: 1.4;
  color: #fff;
}

.question-image-box {
  max-height: 22vh;
  overflow: hidden;
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
}
.question-diagram {
  max-height: 22vh;
  object-fit: contain;
}

.choices-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}
.choices-grid.layout-1-col {
  grid-template-columns: 1fr;
  gap: 1.2rem; /* Reduced gap to save height */
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}
.choices-grid.layout-1-col .choice-card {
  padding: 1.1rem 3rem; /* Reduced vertical padding to save height, kept large horizontal padding */
  gap: 2rem;
}
.choices-grid.layout-1-col .choice-letter {
  width: 80px; /* Reduced from 90px to save height */
  height: 80px;
  font-size: 3rem; /* Still very large */
}
.choices-grid.layout-1-col .choice-text {
  font-size: 3rem; /* Still very large */
}

.choice-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--glass-border);
  padding: 1.1rem 2.2rem; /* Reduced top/bottom padding to prevent stage cutoff */
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 1.8rem;
  transition: all 0.5s ease;
}

.choice-letter {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-title);
  font-size: 2.8rem; /* Increased size */
  font-weight: 900;
  color: #fff;
  transition: all 0.5s ease;
  flex-shrink: 0;
}

.choice-text {
  font-size: 2.8rem; /* Increased size */
  font-weight: 600;
}

/* Choices Reveal States */
.choice-card.correct {
  background: rgba(0, 230, 118, 0.08) !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 20px rgba(0, 230, 118, 0.2);
  transform: scale(1.02);
}
.choice-card.correct .choice-letter {
  background: var(--color-success) !important;
  color: #052e16 !important;
}

.choice-card.incorrect {
  opacity: 0.35;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Light Theme tweaks */
.light-theme .presenter-view {
  background: #f1f5f9;
  background-image: 
    radial-gradient(circle at 50% 0%, rgba(142, 36, 170, 0.04) 0%, transparent 70%),
    radial-gradient(at 100% 100%, rgba(0, 172, 193, 0.03) 0%, transparent 60%);
}

.light-theme .presenter-card {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(15, 23, 42, 0.06);
}

.light-theme .timer-circle {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--color-cyan);
}

.light-theme .timer-seconds {
  color: #0f172a;
}

.light-theme .question-text {
  color: #0f172a;
}

.light-theme .choice-card {
  background: rgba(15, 23, 42, 0.02);
  border-color: rgba(15, 23, 42, 0.05);
}

.light-theme .choice-card .choice-letter {
  background: #cbd5e1;
  color: #0f172a;
}

.light-theme .choice-card.correct {
  background: rgba(0, 230, 118, 0.1) !important;
  border-color: var(--color-success) !important;
}

.light-theme .choice-card.correct .choice-letter {
  background: var(--color-success) !important;
  color: #fff !important;
}

.light-theme .correct-team-badge {
  background: rgba(0, 230, 118, 0.08);
  border-color: rgba(0, 230, 118, 0.3);
  color: #0f172a;
}

.light-theme .audio-unlock-overlay {
  background: rgba(241, 245, 249, 0.95);
}

.light-theme .audio-unlock-overlay h2 {
  color: #0f172a;
}

.presenter-header-text {
  font-size: 3.8rem;
  font-weight: 800;
}

/* ==========================================================================
   WIDESCREEN LED & HIGH ASPECT RATIO OPTIMIZATIONS
   ========================================================================== */
@media (max-height: 900px) or (min-aspect-ratio: 1.8/1) {
  .presenter-view {
    padding: 1rem 1.5rem 5rem 1.5rem; /* Reduce vertical padding on short/wide displays */
  }
  .presenter-card {
    padding: 2rem;
  }
  .correct-teams-container {
    min-height: 500px;
    gap: 2rem;
  }
  .correct-teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.2rem;
  }
  .text-question-layout {
    min-height: 60vh;
    gap: 1rem;
  }
  .question-image-box, .question-diagram {
    max-height: 18vh !important; /* Slightly shrink diagram to fit shorter viewports */
  }
  .choices-grid {
    gap: 1.2rem;
  }
  .choice-card {
    padding: 1.1rem 1.8rem; /* Reduced padding */
    gap: 1.2rem;
  }
  .choices-grid.layout-1-col {
    gap: 1rem;
  }
  .choices-grid.layout-1-col .choice-card {
    padding: 0.9rem 2.4rem;
    gap: 1.5rem;
  }
  .choices-grid.layout-1-col .choice-letter {
    width: 70px;
    height: 70px;
    font-size: 2.6rem;
  }
  .choices-grid.layout-1-col .choice-text {
    font-size: 2.6rem;
  }
  .timer-overlay {
    top: 1rem;
    right: 1rem;
  }
  .timer-circle {
    width: 110px;
    height: 110px;
  }
  .timer-seconds {
    font-size: 2.8rem;
  }
}

@media (max-height: 720px) {
  .presenter-view {
    padding: 0.5rem 1rem 4rem 1rem;
  }
  .presenter-card {
    padding: 1rem 1.5rem;
  }
  .correct-teams-container {
    min-height: 400px;
    gap: 1.5rem;
  }
  .correct-teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1rem;
  }
  .question-header {
    margin-bottom: 0.25rem;
  }
  .question-badge {
    font-size: 1.8rem;
    padding: 0.25rem 1rem;
  }
  .question-points {
    font-size: 1.6rem;
  }
  .choice-card {
    padding: 0.8rem 1.5rem; /* Reduced padding */
    gap: 1rem;
  }
  .choices-grid.layout-1-col {
    gap: 0.8rem;
  }
  .choices-grid.layout-1-col .choice-card {
    padding: 0.7rem 1.8rem;
    gap: 1.2rem;
  }
  .choices-grid.layout-1-col .choice-letter {
    width: 60px;
    height: 60px;
    font-size: 2.2rem;
  }
  .choices-grid.layout-1-col .choice-text {
    font-size: 2.2rem;
  }
}

/* Advanced Formatting & Fraction support inside v-html */
:deep(sup) {
  font-size: 0.6em;
  vertical-align: super;
  line-height: 0;
}
:deep(sub) {
  font-size: 0.6em;
  vertical-align: sub;
  line-height: 0;
}
:deep(.fraction) {
  display: inline-flex;
  flex-direction: column;
  vertical-align: middle;
  align-items: center;
  line-height: 1.1;
  font-size: 0.85em;
  padding: 0 0.15em;
}
:deep(.fraction .numerator) {
  border-bottom: 2px solid currentColor;
  padding-bottom: 1px;
  width: 100%;
  text-align: center;
}
:deep(.fraction .denominator) {
  padding-top: 1px;
  width: 100%;
  text-align: center;
}
</style>

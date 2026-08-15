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
const presenterTheme = ref<'dark' | 'light'>('dark') // Presenter theme state
let tickAudio: HTMLAudioElement | null = null
let alarmAudio: HTMLAudioElement | null = null

// Timer state
const timerRemaining = ref(30)
const timerActive = ref(false)
let timerInterval: any = null

// Realtime subscriptions
let roundChannel: any = null
let answersChannel: any = null
let configChannel: any = null

// Question Intro state
const showQuestionIntro = ref(false)
const isFetchingQuestion = ref(false)
let introTimeout: any = null
let speakTimeout: any = null
let correctTeamsSpeakTimeout: any = null

const hasThaiVoice = ref(false)

const checkThaiVoicePresence = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    hasThaiVoice.value = false
    return
  }
  const voices = window.speechSynthesis.getVoices()
  const hasVoice = voices.some(v => v.lang.startsWith('th') || v.lang.includes('TH'))
  hasThaiVoice.value = hasVoice
}

onMounted(async () => {
  selectedRoundId.value = route.query.round as string || ''
  
  if (isConfigured.value) {
    await fetchRounds()
  } else {
    loading.value = false
  }

  // Load initial saved theme if any
  if (typeof window !== 'undefined') {
    const savedTheme = localStorage.getItem('presenter_theme') as 'dark' | 'light' | null
    if (savedTheme) {
      presenterTheme.value = savedTheme
    }
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
        checkThaiVoicePresence()
      }
      checkThaiVoicePresence()
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
  isFetchingQuestion.value = true
  try {
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
  } finally {
    isFetchingQuestion.value = false
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
  const thaiVoices = voices.filter(v => v.lang.toLowerCase().startsWith('th') || v.lang.toLowerCase().includes('th'))
  if (thaiVoices.length === 0) return null

  // Prioritize premium/natural/specific voices (e.g. Premwadee for Edge Online, Ajchara for clear Windows Speech, Pattara for offline)
  const voiceKeywords = ['premwadee', 'ajchara', 'pattara', 'niwat', 'narisa', 'google', 'male']
  for (const keyword of voiceKeywords) {
    const found = thaiVoices.find(v => v.name.toLowerCase().includes(keyword))
    if (found) return found
  }
  return thaiVoices[0]
}

const speakCorrectTeams = () => {
  if (!ttsEnabled.value || typeof window === 'undefined' || !('speechSynthesis' in window)) return

  // Cancel any pending speech timeout
  if (correctTeamsSpeakTimeout) clearTimeout(correctTeamsSpeakTimeout)

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
  correctTeamsSpeakTimeout = setTimeout(() => {
    window.speechSynthesis.speak(utterance)
    correctTeamsSpeakTimeout = null
  }, 150)
}

const speakQuestionStart = (qNum: number) => {
  if (!ttsEnabled.value || typeof window === 'undefined' || !('speechSynthesis' in window)) return

  // Cancel any pending speech timeout
  if (speakTimeout) clearTimeout(speakTimeout)

  // Cancel any ongoing speech
  window.speechSynthesis.cancel()

  const text = `ข้อที่ ${qNum} เริ่มครับ`

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
  speakTimeout = setTimeout(() => {
    window.speechSynthesis.speak(utterance)
    speakTimeout = null
  }, 150)
}

let activeIntroUnwatch: (() => void) | null = null

const triggerQuestionStart = (qNum: number) => {
  if (introTimeout) clearTimeout(introTimeout)
  if (activeIntroUnwatch) {
    activeIntroUnwatch()
    activeIntroUnwatch = null
  }
  showQuestionIntro.value = true
  
  speakQuestionStart(qNum)
  
  const startTime = Date.now()
  
  const checkAndHide = () => {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, 2500 - elapsed)
    
    const isDone = () => {
      return !isFetchingQuestion.value && (question.value?.question_number === qNum || question.value === null)
    }

    if (isDone()) {
      introTimeout = setTimeout(() => {
        showQuestionIntro.value = false
      }, remaining)
    } else {
      activeIntroUnwatch = watch(
        [isFetchingQuestion, () => question.value],
        () => {
          if (isDone()) {
            if (activeIntroUnwatch) {
              activeIntroUnwatch()
              activeIntroUnwatch = null
            }
            const currentElapsed = Date.now() - startTime
            const currentRemaining = Math.max(0, 2500 - currentElapsed)
            introTimeout = setTimeout(() => {
              showQuestionIntro.value = false
            }, currentRemaining)
          }
        }
      )
    }
  }

  checkAndHide()
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
        if (payload.new.presenter_show_state === 'question') {
          triggerQuestionStart(payload.new.presenter_active_question)
        }
        await fetchActiveQuestion(payload.new.presenter_active_question)
      } else {
        if (payload.new.presenter_show_state === 'correct_teams') {
          await fetchCorrectTeams()
        } else if (payload.new.presenter_show_state === 'question' && prevShowState !== 'question') {
          triggerQuestionStart(payload.new.presenter_active_question)
        }
      }

      // Sync timer and sounds
      syncTimerState()

      // Cancel TTS speech if we moved away from speaking states
      if (payload.new.presenter_show_state !== 'correct_teams' && payload.new.presenter_show_state !== 'question' && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
        window.speechSynthesis.cancel()
      }
    })
    .subscribe()

  // Listen to audio & theme config broadcast channel
  configChannel = supabase.value.channel(`presenter-config-${selectedRoundId.value}`)
  configChannel
    .on('broadcast', { event: 'audio_settings' }, ({ payload }) => {
      soundEnabled.value = payload.soundEnabled
      ttsEnabled.value = payload.ttsEnabled
      if (payload.presenterTheme) {
        presenterTheme.value = payload.presenterTheme
        if (typeof window !== 'undefined') {
          localStorage.setItem('presenter_theme', payload.presenterTheme)
        }
      }
    })
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        // Request current settings from the admin panel
        configChannel.send({
          type: 'broadcast',
          event: 'request_audio_settings'
        })
      }
    })
}

const cleanupSubscriptions = () => {
  if (roundChannel) supabase.value?.removeChannel(roundChannel)
  if (configChannel) {
    supabase.value?.removeChannel(configChannel)
    configChannel = null
  }
}

// Timer and Sound synchronization logic
const syncTimerState = () => {
  const state = currentRound.value?.presenter_show_state
  const startAt = currentRound.value?.presenter_timer_started_at

  if (state === 'timer_start' && startAt) {
    startLocalTimer(startAt)
  } else if (state === 'sample_question') {
    startLocalSampleTimer()
  } else {
    stopLocalTimer()
    stopSounds()
  }
}

let lastTimerIso: string | null = null
let localTimerStartMs: number | null = null

const startLocalTimer = (startedAtIso: string) => {
  // If timer for this exact startedAt event is already actively running, do not reset it
  if (lastTimerIso === startedAtIso && timerActive.value && timerInterval) {
    return
  }

  stopLocalTimer()
  lastTimerIso = startedAtIso
  localTimerStartMs = Date.now()
  
  const updateTimer = () => {
    const now = Date.now()
    const elapsed = Math.floor((now - (localTimerStartMs || now)) / 1000)
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

const startLocalSampleTimer = () => {
  stopLocalTimer()
  
  const startedAt = Date.now()
  
  const updateTimer = () => {
    const now = Date.now()
    // Countdown 2x faster: count elapsed in half-seconds (500ms)
    const elapsed = Math.floor((now - startedAt) / 500)
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
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  timerActive.value = false
  lastTimerIso = null
  localTimerStartMs = null
}

// Watchers to immediately stop speech when audio/TTS is muted
watch(ttsEnabled, (newVal) => {
  if (!newVal && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
    window.speechSynthesis.cancel()
  }
})

watch(soundEnabled, (newVal) => {
  if (!newVal) {
    stopSounds()
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
  if (alarmAudio) {
    alarmAudio.pause()
    alarmAudio.currentTime = 0;
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
  if (!question.value || !question.value.question_text) return '4.5rem'
  const hasImg = !!question.value.question_image_url
  const len = question.value.question_text.length

  if (question.value.choices_layout === '1_col') {
    if (hasImg) {
      if (len < 50) return 'clamp(2.8rem, 3.5vw, 4.2rem)'
      if (len < 100) return 'clamp(2.3rem, 2.9vw, 3.5rem)'
      if (len < 180) return 'clamp(1.9rem, 2.3vw, 2.9rem)'
      return 'clamp(1.7rem, 2.0vw, 2.4rem)'
    }

    if (len < 40) return 'clamp(4.2rem, 5.5vw, 6.3rem)'
    if (len < 90) return 'clamp(3.6rem, 4.7vw, 5.3rem)'
    if (len < 160) return 'clamp(3.0rem, 3.8vw, 4.4rem)'
    if (len < 240) return 'clamp(2.35rem, 3.0vw, 3.55rem)'
    return 'clamp(1.95rem, 2.4vw, 2.95rem)'
  }

  if (hasImg) {
    if (len < 50) return 'clamp(3.3rem, 4.1vw, 4.9rem)'
    if (len < 100) return 'clamp(2.7rem, 3.5vw, 4.1rem)'
    if (len < 180) return 'clamp(2.3rem, 2.9vw, 3.5rem)'
    return 'clamp(2.0rem, 2.5vw, 2.9rem)'
  }

  if (len < 40) return 'clamp(4.7rem, 6.3vw, 7.0rem)'
  if (len < 90) return 'clamp(4.1rem, 5.3vw, 5.9rem)'
  if (len < 160) return 'clamp(3.5rem, 4.5vw, 5.1rem)'
  if (len < 240) return 'clamp(2.85rem, 3.6vw, 4.05rem)'
  return 'clamp(2.45rem, 3.0vw, 3.45rem)'
})

const handleRoundChange = () => {
  loading.value = true
  loadPresentationState()
  setupRealtimeSubscription()
}

const handlePageClick = () => {
  if (!audioReady.value) {
    enableAudio()
  }
}
</script>

<template>
  <div class="presenter-view" :class="{ 'light-theme': presenterTheme === 'light' }" @click="handlePageClick">
    
    <!-- Floating audio unlock banner/hint at the bottom -->
    <div 
      v-if="!audioReady" 
      class="no-print"
      style="position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); border: 1px solid var(--glass-border-glow); padding: 0.8rem 2.2rem; border-radius: 30px; font-size: 1.25rem; color: var(--color-cyan); z-index: 1000; display: flex; align-items: center; gap: 0.75rem; cursor: pointer; box-shadow: 0 0 25px rgba(0, 229, 255, 0.25); animation: pulseHint 2s infinite;"
      @click.stop="enableAudio"
    >
      <Volume2 :size="18" />
      <span>คลิกพื้นที่ใดก็ได้บนหน้าจอนี้ เพื่อเชื่อมต่อระบบเสียงเวที (Click anywhere to unlock audio)</span>
    </div>
    
    <!-- Audio unlock overlay gate -->
    <div v-if="!audioReady && currentRound?.presenter_show_state !== 'welcome'" class="audio-unlock-overlay no-print">
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

    <!-- Configuration selector (no-print floating bottom right to avoid blocking timer) -->
    <div class="no-print presenter-bottom-controls" style="position: fixed; bottom: 1.2rem; right: 1.2rem; display: flex; gap: 0.5rem; align-items: center; z-index: 99; background: rgba(10, 14, 26, 0.7); padding: 0.35rem 0.5rem; border-radius: 30px; border: 1px solid var(--glass-border); backdrop-filter: blur(8px); box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
      
      <!-- Compact Circular Thai Voice Status Badge -->
      <div 
        v-if="!hasThaiVoice" 
        style="background: rgba(255, 23, 68, 0.2); border: 1px solid rgba(255, 23, 68, 0.4); color: #ff5252; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.75rem; box-shadow: 0 0 10px rgba(255, 82, 82, 0.15);"
        title="ไม่พบเสียงสังเคราะห์ภาษาไทย (แนะนำให้เปิดด้วย Microsoft Edge)"
      >
        TH
      </div>
      <div 
        v-else 
        style="background: rgba(0, 230, 118, 0.15); border: 1px solid rgba(0, 230, 118, 0.3); color: #00e676; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.75rem;"
        title="เสียงสังเคราะห์ภาษาไทยพร้อมใช้งาน"
      >
        TH
      </div>

      <button 
        @click="ttsEnabled = !ttsEnabled" 
        class="btn btn-secondary" 
        style="padding: 0.5rem; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;"
        :title="ttsEnabled ? 'ปิดระบบเสียงอ่านเลขทีมตอบถูก' : 'เปิดระบบเสียงอ่านเลขทีมตอบถูก'"
      >
        <Mic v-if="ttsEnabled" :size="16" class="text-cyan" />
        <MicOff v-else :size="16" style="color: var(--text-muted);" />
      </button>

      <button @click="soundEnabled = !soundEnabled" class="btn btn-secondary" style="padding: 0.5rem; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
        <Volume2 v-if="soundEnabled" :size="16" />
        <VolumeX v-else :size="16" style="color: var(--text-muted);" />
      </button>

      <!-- Hide round selector as requested -->
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
        
        <!-- Large Question Intro Popup Overlay -->
        <Transition name="intro-fade">
          <div v-if="showQuestionIntro" class="question-intro-overlay">
            <div class="intro-badge-cosmic">ข้อที่ {{ currentRound.presenter_active_question }}</div>
            <div class="intro-subtext">เตรียมตัวอ่านคำถาม...</div>
          </div>
        </Transition>

        <!-- Timer countdown overlay widget -->
        <div v-if="currentRound.presenter_show_state === 'timer_start' || currentRound.presenter_show_state === 'sample_question'" class="timer-overlay">
          <div class="timer-circle" :class="{ 'timer-warning': timerRemaining <= 5 }">
            <div class="timer-seconds">{{ timerRemaining }}</div>
            <div class="timer-label">วินาที</div>
          </div>
        </div>

        <!-- 0. WELCOME / INTRO SCREEN -->
        <div v-if="currentRound.presenter_show_state === 'welcome'" class="presenter-card welcome-container">
          <!-- Logo & Institution Info -->
          <div class="welcome-org-section">
            <img src="/scibru-logo.png" alt="SciBRU Logo" class="welcome-logo" />
            <div class="welcome-org-name">คณะวิทยาศาสตร์ มหาวิทยาลัยราชภัฏบุรีรัมย์</div>
          </div>

          <h1 class="welcome-title">การแข่งขันตอบปัญหาวิทยาศาสตร์</h1>
          <h2 class="welcome-subtitle">ระดับ {{ currentRound.name }}</h2>
          <div class="welcome-date" v-if="currentRound.round_date">
            วันที่ {{ currentRound.round_date }}
          </div>
        </div>

        <!-- A. RULES SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'rules'" class="presenter-card rules-container">
          <h1 class="rules-title">กติกาการแข่งขัน</h1>
          <div class="rules-content-card">
            <div class="rule-row">
              <span class="rule-icon">📝</span>
              <span class="rule-text">จำนวนคำถามทั้งสิ้น <strong class="highlight-yellow">20 ข้อ</strong></span>
            </div>
            <div class="rule-row">
              <span class="rule-icon">⏱️</span>
              <span class="rule-text">กำหนดเวลาตอบคำถามข้อละ <strong class="highlight-cyan">30 วินาที</strong></span>
            </div>
          </div>
        </div>

        <!-- B. SAMPLE QUESTION SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'sample_question'" class="presenter-card sample-q-container">
          <div class="sample-badge">ข้อสอบตัวอย่าง (Sample Question)</div>
          <h1 class="sample-q-text">ตัวอย่าง: ดาวเคราะห์ดวงใดอยู่ใกล้ดวงอาทิตย์มากที่สุด?</h1>
          
          <div class="sample-choices-grid">
            <div class="sample-choice-card">
              <span class="sample-choice-letter">ก</span>
              <span class="sample-choice-text">ดาวศุกร์ (Venus)</span>
            </div>
            <div class="sample-choice-card">
              <span class="sample-choice-letter">ข</span>
              <span class="sample-choice-text">ดาวพุธ (Mercury)</span>
            </div>
            <div class="sample-choice-card">
              <span class="sample-choice-letter">ค</span>
              <span class="sample-choice-text">ดาวอังคาร (Mars)</span>
            </div>
            <div class="sample-choice-card">
              <span class="sample-choice-letter">ง</span>
              <span class="sample-choice-text">โลก (Earth)</span>
            </div>
          </div>
        </div>

        <!-- C. SAMPLE ANSWER SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'sample_answer'" class="presenter-card sample-q-container">
          <div class="sample-badge">ข้อสอบตัวอย่าง (เฉลย)</div>
          <h1 class="sample-q-text">ตัวอย่าง: ดาวเคราะห์ดวงใดอยู่ใกล้ดวงอาทิตย์มากที่สุด?</h1>
          
          <div class="sample-choices-grid">
            <div class="sample-choice-card incorrect">
              <span class="sample-choice-letter">ก</span>
              <span class="sample-choice-text">ดาวศุกร์ (Venus)</span>
            </div>
            <div class="sample-choice-card correct">
              <span class="sample-choice-letter">ข</span>
              <span class="sample-choice-text">ดาวพุธ (Mercury)</span>
            </div>
            <div class="sample-choice-card incorrect">
              <span class="sample-choice-letter">ค</span>
              <span class="sample-choice-text">ดาวอังคาร (Mars)</span>
            </div>
            <div class="sample-choice-card incorrect">
              <span class="sample-choice-letter">ง</span>
              <span class="sample-choice-text">โลก (Earth)</span>
            </div>
          </div>
        </div>

        <!-- D. GET READY SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'get_ready'" class="presenter-card get-ready-container">
          <h1 class="get-ready-title">เตรียมพร้อมแข่งขัน</h1>
          <p class="get-ready-subtitle">โปรดเตรียมเครื่องเขียนและกระดาษคำตอบให้พร้อม</p>
          <div class="get-ready-waiting-box">
            <div class="pulse-ring"></div>
            <span>รอการเปิดคำถามข้อที่ 1 จากคณะกรรมการ...</span>
          </div>
        </div>

        <!-- 1. CORRECT TEAMS GRID VIEW -->
        <div v-else-if="currentRound.presenter_show_state === 'correct_teams'" class="presenter-card correct-teams-container">
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
              {{ team.team_number }}
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
        <div v-else-if="question.is_image_only" class="presenter-slide-mode" :class="{ 'invisible-during-intro': showQuestionIntro }">
          <img 
            :src="currentRound.presenter_show_state === 'answer_revealed' && question.answer_image_url ? question.answer_image_url : question.question_image_url" 
            alt="Question Slide"
            class="slide-image"
          />
        </div>

        <!-- 4. DYNAMIC TEXT/HTML MODE (Solution 3) -->
        <div v-else class="presenter-card text-question-layout" :class="{ 'invisible-during-intro': showQuestionIntro }">
          <!-- Header info -->
          <div class="question-header">
            <span class="question-badge">ข้อที่ {{ question.question_number }}</span>
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0.5rem 1.5rem 5.5rem 1.5rem; /* 5.5rem bottom clearance to prevent stage blockage */
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--font-body);
  box-sizing: border-box;
}

.presentation-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  position: relative;
  max-width: 98vw; /* Fills widescreen displays */
  margin: 0 auto;
  width: 100%;
  height: 100%;
}

.presenter-card {
  background: rgba(10, 12, 22, 0.65);
  border: 1.5px solid var(--glass-border);
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-lg);
  padding: 1.5rem 2.5rem 2rem 2.5rem;
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
  top: 1rem;
  right: 1.5rem;
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
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1.5rem;
  width: 100%;
  max-width: 100%; /* Spans full widescreen container width */
  justify-content: center;
}

.correct-team-badge {
  background: rgba(0, 230, 118, 0.05);
  border: 2px solid rgba(0, 230, 118, 0.35);
  box-shadow: 0 0 15px rgba(0, 230, 118, 0.05);
  aspect-ratio: 1;
  border-radius: 50%;
  font-family: var(--font-title);
  font-size: 3.2rem; /* Big legible numbers */
  font-weight: 900;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
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
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
  box-sizing: border-box;
  margin-bottom: 0.5rem;
}

.question-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.2rem;
}

.question-badge {
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  color: #000;
  font-family: var(--font-title);
  font-weight: 900;
  font-size: 2.6rem;
  padding: 0.4rem 2.2rem;
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
  gap: 1.5rem;
  padding: 0.5rem 1rem;
}

.question-text {
  font-weight: 750;
  text-align: center;
  line-height: 1.3;
  color: #fff;
  max-width: 98%;
  word-break: break-word;
  overflow-wrap: break-word;
  filter: drop-shadow(0 2px 10px rgba(0, 0, 0, 0.5));
}

.question-image-box {
  max-height: 25vh;
  overflow: hidden;
  border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
}
.question-diagram {
  max-height: 25vh;
  object-fit: contain;
}

.choices-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem 2.2rem;
  width: 100%;
  margin-bottom: 0.5rem; /* Elevated from card bottom */
}
.choices-grid.layout-1-col {
  grid-template-columns: 1fr;
  gap: 0.8rem;
  max-width: 100%;
  margin: 0 auto 0.5rem auto;
  width: 100%;
}
.choices-grid.layout-1-col .choice-card {
  padding: 0.9rem 2.2rem;
  gap: 1.8rem;
  min-height: 75px;
}
.choices-grid.layout-1-col .choice-letter {
  width: 72px;
  height: 72px;
  min-width: 72px;
  font-size: 3.2rem;
}
.choices-grid.layout-1-col .choice-text {
  font-size: clamp(2.6rem, 3.5vw, 3.7rem);
}

.choice-card {
  background: linear-gradient(135deg, rgba(24, 29, 56, 0.9), rgba(15, 18, 36, 0.9));
  border: 2px solid rgba(255, 255, 255, 0.16);
  padding: 1.6rem 2.8rem;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 2.4rem;
  transition: all 0.3s ease;
  min-height: 120px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.choice-letter {
  width: 110px;
  height: 110px;
  min-width: 110px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-title);
  font-size: 4.6rem;
  font-weight: 900;
  color: #fff;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.choice-text {
  font-size: clamp(3.3rem, 4.2vw, 4.5rem);
  font-weight: 700;
  line-height: 1.3;
  word-break: break-word;
  overflow-wrap: break-word;
  flex: 1;
  color: #fff;
}

/* Choices Reveal States */
.choice-card.correct {
  background: rgba(0, 230, 118, 0.14) !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 25px rgba(0, 230, 118, 0.35);
  transform: scale(1.02);
}
.choice-card.correct .choice-letter {
  background: var(--color-success) !important;
  color: #052e16 !important;
  border-color: var(--color-success) !important;
}

.choice-card.incorrect {
  opacity: 0.35;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Light Theme tweaks */
.light-theme .presenter-view,
.light-theme.presenter-view {
  background: #f1f5f9;
  background-image: 
    radial-gradient(circle at 50% 0%, rgba(142, 36, 170, 0.04) 0%, transparent 70%),
    radial-gradient(at 100% 100%, rgba(0, 172, 193, 0.03) 0%, transparent 60%);
  color: #0f172a;
}

.light-theme .presenter-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(15, 23, 42, 0.12);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
}

.light-theme .timer-circle {
  background: rgba(255, 255, 255, 0.95);
  border-color: var(--color-cyan);
}

.light-theme .timer-seconds {
  color: #0f172a;
}

.light-theme .question-text {
  color: #0f172a !important;
  filter: none;
}

.light-theme .choice-card {
  background: #ffffff !important;
  border-color: rgba(15, 23, 42, 0.18) !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
}

.light-theme .choice-card .choice-letter {
  background: #e2e8f0 !important;
  color: #0f172a !important;
  border-color: #94a3b8 !important;
}

.light-theme .choice-card .choice-text,
.light-theme .choice-text {
  color: #0f172a !important;
}

.light-theme .choice-card.correct {
  background: rgba(0, 230, 118, 0.15) !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 25px rgba(0, 230, 118, 0.25);
}

.light-theme .choice-card.correct .choice-letter {
  background: var(--color-success) !important;
  color: #ffffff !important;
  border-color: var(--color-success) !important;
}

.light-theme .choice-card.correct .choice-text {
  color: #052e16 !important;
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
    padding: 0.4rem 1.2rem 4rem 1.2rem;
  }
  .presenter-card {
    padding: 1.2rem 1.8rem 1.5rem 1.8rem;
  }
  .correct-teams-container {
    min-height: 500px;
    gap: 2rem;
  }
  .correct-teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 1.2rem;
  }
  .correct-team-badge {
    font-size: 2.8rem;
  }
  .text-question-layout {
    gap: 1rem;
    margin-bottom: 0.2rem;
  }
  .question-badge {
    font-size: 2.2rem;
    padding: 0.3rem 1.6rem;
  }
  .question-image-box, .question-diagram {
    max-height: 20vh !important;
  }
  .choices-grid {
    gap: 1.1rem 1.5rem;
    margin-bottom: 0.2rem;
  }
  .choice-card {
    padding: 1.1rem 2rem;
    gap: 1.8rem;
    min-height: 95px;
  }
  .choice-letter {
    width: 90px;
    height: 90px;
    min-width: 90px;
    font-size: 3.8rem;
  }
  .choice-text {
    font-size: clamp(2.7rem, 3.3vw, 3.5rem);
  }
  .choices-grid.layout-1-col {
    gap: 0.6rem;
    margin-bottom: 0.2rem;
  }
  .choices-grid.layout-1-col .choice-card {
    padding: 0.7rem 1.8rem;
    gap: 1.4rem;
    min-height: 65px;
  }
  .choices-grid.layout-1-col .choice-letter {
    width: 62px;
    height: 62px;
    min-width: 62px;
    font-size: 2.7rem;
  }
  .choices-grid.layout-1-col .choice-text {
    font-size: clamp(2.1rem, 2.7vw, 2.9rem);
  }
  .timer-overlay {
    top: 0.8rem;
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
    padding: 0.3rem 0.8rem 3rem 0.8rem;
  }
  .presenter-card {
    padding: 0.8rem 1.2rem;
  }
  .correct-teams-container {
    min-height: 400px;
    gap: 1.5rem;
  }
  .correct-teams-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 1rem;
  }
  .correct-team-badge {
    font-size: 2.2rem;
  }
  .question-header {
    margin-bottom: 0.2rem;
  }
  .question-badge {
    font-size: 1.8rem;
    padding: 0.25rem 1.2rem;
  }
  .question-points {
    font-size: 1.6rem;
  }
  .choice-card {
    padding: 0.8rem 1.6rem;
    gap: 1.4rem;
    min-height: 80px;
  }
  .choice-letter {
    width: 72px;
    height: 72px;
    min-width: 72px;
    font-size: 2.8rem;
  }
  .choice-text {
    font-size: 2.3rem;
  }
  .choices-grid.layout-1-col {
    gap: 0.5rem;
  }
  .choices-grid.layout-1-col .choice-card {
    padding: 0.5rem 1.4rem;
    gap: 1.2rem;
    min-height: 55px;
  }
  .choices-grid.layout-1-col .choice-letter {
    width: 52px;
    height: 52px;
    min-width: 52px;
    font-size: 2.3rem;
  }
  .choices-grid.layout-1-col .choice-text {
    font-size: 1.8rem;
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

/* Question Intro Overlay Styles */
.question-intro-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #020306;
  background-image: 
    radial-gradient(circle at 50% 50%, rgba(213, 0, 249, 0.18) 0%, transparent 70%),
    radial-gradient(circle at 50% 50%, rgba(0, 229, 255, 0.12) 0%, transparent 60%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
}

.invisible-during-intro {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

.intro-badge-cosmic {
  font-family: var(--font-title);
  font-size: 8rem;
  font-weight: 900;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 30px rgba(0, 229, 255, 0.3));
  margin-bottom: 1.5rem;
  animation: zoomPulse 2.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite alternate;
}

.intro-subtext {
  font-size: 2.2rem;
  color: var(--text-secondary);
  letter-spacing: 2px;
  opacity: 0.8;
}

@keyframes zoomPulse {
  0% { transform: scale(0.95); filter: drop-shadow(0 0 20px rgba(0, 229, 255, 0.2)); }
  100% { transform: scale(1.05); filter: drop-shadow(0 0 40px rgba(213, 0, 249, 0.4)); }
}

/* intro-fade transition */
.intro-fade-enter-active, .intro-fade-leave-active {
  transition: opacity 0.4s ease;
}
.intro-fade-enter-from, .intro-fade-leave-to {
  opacity: 0;
}

/* Welcome/Intro Screen Styles */
.welcome-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4rem 3rem 5rem 3rem;
  min-height: calc(100vh - 7rem);
  flex: 1;
  height: 100%;
  animation: fadeIn 0.5s ease-out;
  gap: 2.2rem;
}

.welcome-org-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.2rem;
  margin-bottom: 1.5rem;
  animation: fadeInDown 0.6s ease-out;
}

.welcome-logo {
  width: 190px;
  height: 190px;
  object-fit: contain;
  filter: drop-shadow(0 0 20px rgba(213, 0, 249, 0.25));
  transition: transform 0.5s ease;
}

.welcome-logo:hover {
  transform: scale(1.08) rotate(3deg);
}

.welcome-org-name {
  font-family: var(--font-body);
  font-size: clamp(2.4rem, 3.0vw, 3.4rem);
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 1px;
}

.welcome-title {
  font-family: var(--font-title);
  font-size: clamp(6.0rem, 7.5vw, 9.0rem);
  font-weight: 900;
  line-height: 1.35;
  padding: 0.1em 0.15em 0.35em 0.15em;
  display: inline-block;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 25px rgba(0, 229, 255, 0.2));
  margin-bottom: 0.5rem;
}

.welcome-subtitle {
  font-family: var(--font-body);
  font-size: clamp(4.4rem, 5.5vw, 6.4rem);
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.welcome-date {
  font-family: var(--font-body);
  font-size: clamp(2.8rem, 3.4vw, 4.0rem);
  font-weight: 700;
  color: var(--text-secondary);
  border: 1.5px solid var(--glass-border);
  background: var(--bg-primary);
  padding: 1.2rem 3.8rem;
  border-radius: 50px;
  display: inline-block;
  margin-top: 1rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

@keyframes pulseHint {
  0% { transform: translate(-50%, 0) scale(1); opacity: 0.9; }
  50% { transform: translate(-50%, -4px) scale(1.02); opacity: 1; box-shadow: 0 0 30px rgba(0, 229, 255, 0.35); }
  100% { transform: translate(-50%, 0) scale(1); opacity: 0.9; }
}

@keyframes pulseRed {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(1.3); opacity: 1; }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-height: 900px) or (min-aspect-ratio: 1.8/1) {
  .welcome-container {
    padding: 2.5rem 2rem;
    min-height: calc(100vh - 5rem);
    gap: 1.4rem;
  }
  .welcome-logo {
    width: 140px;
    height: 140px;
  }
  .welcome-org-name {
    font-size: 2.2rem;
  }
  .welcome-org-section {
    margin-bottom: 1rem;
    gap: 0.8rem;
  }
  .welcome-title {
    font-size: clamp(5.0rem, 6.0vw, 7.0rem);
    margin-bottom: 0.5rem;
  }
  .welcome-subtitle {
    font-size: clamp(3.4rem, 4.2vw, 4.8rem);
    margin-bottom: 0.5rem;
  }
  .welcome-date {
    font-size: 2.4rem;
    padding: 0.8rem 2.8rem;
  }
}

@media (max-height: 720px) {
  .welcome-container {
    padding: 1.5rem 1.5rem;
    min-height: calc(100vh - 3.5rem);
    gap: 0.8rem;
  }
  .welcome-logo {
    width: 100px;
    height: 100px;
  }
  .welcome-org-name {
    font-size: 1.6rem;
  }
  .welcome-org-section {
    margin-bottom: 0.5rem;
    gap: 0.4rem;
  }
  .welcome-title {
    font-size: 4.2rem;
  }
  .welcome-subtitle {
    font-size: 2.8rem;
  }
  .welcome-date {
    font-size: 1.8rem;
    padding: 0.5rem 2rem;
  }
}
/* Rules Screen Styles */
.rules-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 3rem 5rem 3rem;
  min-height: calc(100vh - 7rem);
  flex: 1;
  height: 100%;
  animation: fadeIn 0.5s ease-out;
  text-align: center;
  gap: 3rem;
}

.rules-title {
  font-family: var(--font-title);
  font-size: clamp(6.0rem, 7.5vw, 8.5rem);
  font-weight: 900;
  color: #fff;
  line-height: 1.35;
  padding: 0.1em 0.15em 0.35em 0.15em;
  display: inline-block;
  margin-bottom: 1.5rem;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 25px rgba(0, 229, 255, 0.2));
}

.rules-content-card {
  background: linear-gradient(135deg, rgba(24, 29, 56, 0.85), rgba(15, 18, 36, 0.85));
  border: 2px solid rgba(255, 255, 255, 0.12);
  padding: 5rem 8rem;
  border-radius: 28px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 4rem;
  max-width: 1400px;
  width: 100%;
}

.rule-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3rem;
}

.rule-icon {
  font-size: 5.5rem;
}

.rule-text {
  font-size: clamp(3.6rem, 4.4vw, 5.0rem);
  font-weight: 700;
  color: var(--text-primary);
}

.highlight-yellow {
  color: var(--color-gold);
  font-size: clamp(4.4rem, 5.2vw, 6.0rem);
  font-weight: 900;
  white-space: nowrap;
}

.highlight-cyan {
  color: var(--color-cyan);
  font-size: clamp(4.4rem, 5.2vw, 6.0rem);
  font-weight: 900;
  white-space: nowrap;
}

/* Sample Question Screen Styles */
.sample-q-container {
  padding: 2rem 3rem 4.5rem 3rem;
  min-height: calc(100vh - 7rem);
  flex: 1;
  height: 100%;
  animation: fadeIn 0.5s ease-out;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 1.5rem;
}

.sample-badge {
  background: rgba(213, 0, 249, 0.18);
  border: 1.5px solid rgba(213, 0, 249, 0.4);
  color: var(--color-purple);
  padding: 0.6rem 2.5rem;
  border-radius: 30px;
  font-size: 2.2rem;
  font-weight: 800;
  align-self: center;
  margin-bottom: 1rem;
  letter-spacing: 1px;
}

.sample-q-text {
  font-size: clamp(4.4rem, 5.6vw, 6.2rem);
  font-weight: 750;
  color: #fff;
  text-align: center;
  margin-bottom: 1.5rem;
  line-height: 1.35;
  filter: drop-shadow(0 2px 10px rgba(0, 0, 0, 0.5));
}

.sample-choices-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem 2.2rem;
  width: 100%;
  margin-bottom: 0.5rem;
}

.sample-choice-card {
  background: linear-gradient(135deg, rgba(24, 29, 56, 0.9), rgba(15, 18, 36, 0.9));
  border: 2px solid rgba(255, 255, 255, 0.16);
  padding: 1.6rem 2.8rem;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 2.4rem;
  transition: all 0.3s ease;
  min-height: 120px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.sample-choice-letter {
  width: 110px;
  height: 110px;
  min-width: 110px;
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-title);
  font-size: 4.6rem;
  font-weight: 900;
  color: #fff;
  flex-shrink: 0;
}

.sample-choice-text {
  font-size: clamp(3.6rem, 4.5vw, 4.8rem);
  font-weight: 700;
  color: #fff;
  line-height: 1.3;
}

.sample-choice-card.correct {
  background: rgba(0, 230, 118, 0.14) !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 25px rgba(0, 230, 118, 0.35);
  transform: scale(1.02);
}

.sample-choice-card.correct .sample-choice-letter {
  background: var(--color-success) !important;
  color: #052e16 !important;
  border-color: var(--color-success) !important;
}

.sample-choice-card.incorrect {
  opacity: 0.35;
}

/* Get Ready Screen Styles */
.get-ready-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4rem 3rem 5rem 3rem;
  min-height: calc(100vh - 7rem);
  flex: 1;
  height: 100%;
  animation: fadeIn 0.5s ease-out;
  gap: 2.5rem;
}

.get-ready-title {
  font-family: var(--font-title);
  font-size: clamp(6.0rem, 7.5vw, 8.5rem);
  font-weight: 900;
  line-height: 1.35;
  padding: 0.1em 0.15em 0.35em 0.15em;
  display: inline-block;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 25px rgba(0, 229, 255, 0.2));
  margin-bottom: 0.5rem;
}

.get-ready-subtitle {
  font-size: clamp(3.6rem, 4.5vw, 5.0rem);
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}

.get-ready-waiting-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2.2rem;
  font-size: clamp(3.0rem, 3.8vw, 4.2rem);
  color: var(--color-cyan);
  font-weight: 700;
  background: rgba(0, 229, 255, 0.05);
  border: 2px solid rgba(0, 229, 255, 0.3);
  padding: 2.5rem 5rem;
  border-radius: 60px;
  box-shadow: 0 0 35px rgba(0, 229, 255, 0.15);
}

.get-ready-waiting-box .pulse-ring {
  width: 26px;
  height: 26px;
}

/* Light theme tweaks for pre-competition */
.light-theme .welcome-title,
.light-theme .rules-title,
.light-theme .get-ready-title {
  background: linear-gradient(135deg, #7c3aed, #0284c7) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
  filter: drop-shadow(0 2px 8px rgba(124, 58, 237, 0.15)) !important;
}

.light-theme .welcome-subtitle {
  color: #0f172a !important;
}

.light-theme .welcome-org-name {
  color: #475569 !important;
}

.light-theme .welcome-date {
  color: #0f172a !important;
  background: #ffffff !important;
  border-color: rgba(15, 23, 42, 0.18) !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.06);
}

.light-theme .rules-content-card {
  background: #ffffff !important;
  border-color: rgba(15, 23, 42, 0.15) !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
}

.light-theme .rule-text {
  color: #0f172a !important;
}

.light-theme .sample-q-text {
  color: #0f172a !important;
  filter: none;
}

.light-theme .sample-choice-card {
  background: #ffffff !important;
  border-color: rgba(15, 23, 42, 0.18) !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
}

.light-theme .sample-choice-letter {
  background: #e2e8f0 !important;
  color: #0f172a !important;
  border: 2px solid #94a3b8;
}

.light-theme .sample-choice-text {
  color: #0f172a !important;
}

.light-theme .sample-choice-card.correct {
  background: rgba(0, 230, 118, 0.15) !important;
  border-color: var(--color-success) !important;
  box-shadow: 0 0 25px rgba(0, 230, 118, 0.25);
}

.light-theme .sample-choice-card.correct .sample-choice-letter {
  background: var(--color-success) !important;
  color: #ffffff !important;
  border-color: var(--color-success) !important;
}

.light-theme .sample-choice-card.correct .sample-choice-text {
  color: #052e16 !important;
}

.light-theme .get-ready-subtitle {
  color: #475569 !important;
}

.light-theme .get-ready-waiting-box {
  background: rgba(0, 172, 193, 0.06);
  border-color: rgba(0, 172, 193, 0.3);
  color: var(--color-cyan);
  box-shadow: 0 4px 20px rgba(0, 172, 193, 0.1);
}

.light-theme .presenter-bottom-controls {
  background: rgba(255, 255, 255, 0.88) !important;
  border-color: rgba(15, 23, 42, 0.15) !important;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08) !important;
}

@media (max-height: 900px) or (min-aspect-ratio: 1.8/1) {
  .rules-container, .sample-q-container, .get-ready-container {
    padding: 2.5rem 2rem 3.5rem 2rem;
    min-height: calc(100vh - 5rem);
    gap: 1.5rem;
  }
  .rules-title, .get-ready-title {
    font-size: clamp(4.8rem, 5.8vw, 6.5rem);
    margin-bottom: 1rem;
  }
  .rules-content-card {
    padding: 3.5rem 5rem;
    gap: 2.5rem;
  }
  .rule-icon {
    font-size: 4.2rem;
  }
  .rule-text {
    font-size: 2.8rem;
  }
  .highlight-yellow, .highlight-cyan {
    font-size: 3.4rem;
  }
  .sample-badge {
    font-size: 1.6rem;
    padding: 0.5rem 2rem;
  }
  .sample-q-text {
    font-size: clamp(3.4rem, 4.2vw, 4.8rem);
    margin-bottom: 1rem;
  }
  .sample-choice-card {
    padding: 1.1rem 2rem;
    gap: 1.8rem;
    min-height: 95px;
  }
  .sample-choice-letter {
    width: 90px;
    height: 90px;
    min-width: 90px;
    font-size: 3.8rem;
  }
  .sample-choice-text {
    font-size: clamp(3.0rem, 3.6vw, 3.8rem);
  }
  .get-ready-subtitle {
    font-size: 2.8rem;
    margin-bottom: 1.5rem;
  }
  .get-ready-waiting-box {
    font-size: 2.6rem;
    padding: 1.6rem 3.5rem;
  }
}

@media (max-height: 720px) {
  .rules-container, .sample-q-container, .get-ready-container {
    padding: 1.5rem 1.2rem 2.5rem 1.2rem;
    min-height: calc(100vh - 3.5rem);
    gap: 1rem;
  }
  .rules-title, .get-ready-title {
    font-size: 4.0rem;
    margin-bottom: 0.8rem;
  }
  .rules-content-card {
    padding: 2.5rem 3rem;
    gap: 1.8rem;
  }
  .rule-icon {
    font-size: 3.2rem;
  }
  .rule-text {
    font-size: 2.2rem;
  }
  .highlight-yellow, .highlight-cyan {
    font-size: 2.6rem;
  }
  .sample-badge {
    font-size: 1.3rem;
  }
  .sample-q-text {
    font-size: 3.0rem;
    margin-bottom: 0.8rem;
  }
  .sample-choice-card {
    padding: 0.8rem 1.6rem;
    gap: 1.4rem;
    min-height: 80px;
  }
  .sample-choice-letter {
    width: 72px;
    height: 72px;
    min-width: 72px;
    font-size: 2.8rem;
  }
  .sample-choice-text {
    font-size: 2.6rem;
  }
  .get-ready-subtitle {
    font-size: 2.2rem;
    margin-bottom: 1rem;
  }
  .get-ready-waiting-box {
    font-size: 2.0rem;
    padding: 1.2rem 2.5rem;
  }
}
</style>

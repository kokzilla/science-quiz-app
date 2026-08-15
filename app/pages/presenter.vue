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
const allAnswers = ref<any[]>([])
const allQuestions = ref<any[]>([])

const loading = ref(true)
const errorMsg = ref('')

// Sound files
const audioReady = ref(false)
const soundEnabled = ref(true)
const ttsEnabled = ref(true) // TTS voice toggle state
const presenterTheme = ref<'dark' | 'light'>('dark') // Presenter theme state
const balloonsEnabled = ref(true) // Cover balloon teams toggle state
let tickAudio: HTMLAudioElement | null = null
let alarmAudio: HTMLAudioElement | null = null

// Timer state
const timerRemaining = ref(30)
const timerActive = ref(false)
let timerInterval: any = null

// Realtime subscriptions
let roundChannel: any = null
let answersChannel: any = null
let teamsChannel: any = null
let configChannel: any = null
let localConfigBc: any = null

const applyConfigPayload = (payload: any) => {
  if (!payload) return
  if (typeof payload.soundEnabled === 'boolean') {
    soundEnabled.value = payload.soundEnabled
    if (!payload.soundEnabled) {
      stopThankYouMusic()
      stopSounds()
    } else if (currentRound.value?.presenter_show_state === 'thank_you' && !thankYouMusicInterval) {
      startThankYouMusic()
    }
  }
  if (typeof payload.ttsEnabled === 'boolean') ttsEnabled.value = payload.ttsEnabled
  if (typeof payload.balloonsEnabled === 'boolean') {
    balloonsEnabled.value = payload.balloonsEnabled
    if (!payload.balloonsEnabled) {
      stopWelcomeBalloonCycle()
    } else if (currentRound.value?.presenter_show_state === 'welcome' && !welcomeBalloonInterval) {
      startWelcomeBalloonCycle()
    }
  }
  if (payload.presenterTheme === 'light' || payload.presenterTheme === 'dark') {
    presenterTheme.value = payload.presenterTheme
    if (typeof window !== 'undefined') {
      localStorage.setItem('presenter_theme', payload.presenterTheme)
    }
  }
}

// Fireworks Animation System
const fireworksCanvas = ref<HTMLCanvasElement | null>(null)
let fireworksAnimationId: number | null = null
let fireworksLaunchInterval: any = null

interface FireworkParticle {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
  alpha: number
  decay: number
  gravity: number
  drag: number
  flicker: boolean
}

interface FireworkRocket {
  x: number
  y: number
  vx: number
  vy: number
  targetY: number
  color: string
  trail: { x: number; y: number; alpha: number }[]
  exploded: boolean
}

const fwColors = [
  '#FFD700', // Gold
  '#FFA500', // Orange
  '#00E5FF', // Cyan
  '#FF2E93', // Neon Pink
  '#00FF88', // Emerald Neon
  '#A855F7', // Violet
  '#FF4500', // Red-Orange
  '#FFFFFF', // Pure White
  '#38BDF8'  // Sky Blue
]

let audioCtx: AudioContext | null = null

const getAudioContext = () => {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

const playFireworkLaunchSound = () => {
  if (!soundEnabled.value) return
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // White noise for whoosh
    const bufferSize = Math.floor(ctx.sampleRate * 0.35)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(350, now)
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.3)
    filter.Q.setValueAtTime(3.2, now)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.01, now)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.12)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34)

    noise.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + 0.35)
  } catch (e) {}
}

const playFireworkExplosionSound = () => {
  if (!soundEnabled.value) return
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // 1. Sub-bass thump (sine wave 100Hz -> 35Hz)
    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(105, now)
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.28)

    oscGain.gain.setValueAtTime(0.4, now)
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32)

    osc.connect(oscGain)
    oscGain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.35)

    // 2. Explosion burst noise
    const bufferSize = Math.floor(ctx.sampleRate * 0.75)
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(700 + Math.random() * 300, now)
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.7)

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.3, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72)

    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + 0.75)

    // 3. Crackle bursts after slight delay
    if (Math.random() > 0.25) {
      const crackleCount = 3 + Math.floor(Math.random() * 4)
      for (let c = 0; c < crackleCount; c++) {
        const delay = 0.12 + c * 0.07 + Math.random() * 0.03
        const cTime = now + delay

        const popOsc = ctx.createOscillator()
        const popGain = ctx.createGain()
        popOsc.type = 'triangle'
        popOsc.frequency.setValueAtTime(500 + Math.random() * 700, cTime)
        popOsc.frequency.exponentialRampToValueAtTime(80, cTime + 0.035)

        popGain.gain.setValueAtTime(0.07, cTime)
        popGain.gain.exponentialRampToValueAtTime(0.001, cTime + 0.035)

        popOsc.connect(popGain)
        popGain.connect(ctx.destination)

        popOsc.start(cTime)
        popOsc.stop(cTime + 0.04)
      }
    }
  } catch (e) {}
}

let particles: FireworkParticle[] = []
let rockets: FireworkRocket[] = []

const createExplosion = (x: number, y: number, color: string) => {
  playFireworkExplosionSound()
  const count = 55 + Math.floor(Math.random() * 35)
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4
    const speed = 2.5 + Math.random() * 6.5
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: Math.random() > 0.3 ? color : fwColors[Math.floor(Math.random() * fwColors.length)],
      size: 2.2 + Math.random() * 2.5,
      alpha: 1,
      decay: 0.012 + Math.random() * 0.018,
      gravity: 0.07,
      drag: 0.955,
      flicker: Math.random() > 0.5
    })
  }
}

const launchRocket = () => {
  if (!fireworksCanvas.value) return
  playFireworkLaunchSound()
  const w = fireworksCanvas.value.width
  const h = fireworksCanvas.value.height
  const startX = w * 0.12 + Math.random() * (w * 0.76)
  const targetY = h * 0.10 + Math.random() * (h * 0.40)
  const color = fwColors[Math.floor(Math.random() * fwColors.length)]
  const speed = 12 + Math.random() * 5

  rockets.push({
    x: startX,
    y: h,
    vx: (Math.random() - 0.5) * 3,
    vy: -speed,
    targetY,
    color,
    trail: [],
    exploded: false
  })
}

const updateFireworks = () => {
  if (!fireworksCanvas.value) return
  const ctx = fireworksCanvas.value.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, fireworksCanvas.value.width, fireworksCanvas.value.height)

  // Update & draw rockets
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i]
    r.trail.push({ x: r.x, y: r.y, alpha: 1 })
    if (r.trail.length > 7) r.trail.shift()

    // Draw rocket trail
    for (let t = 0; t < r.trail.length; t++) {
      const point = r.trail[t]
      ctx.beginPath()
      ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = r.color
      ctx.globalAlpha = (t / r.trail.length) * 0.7
      ctx.fill()
    }

    r.x += r.vx
    r.y += r.vy
    r.vy += 0.15 // slight deceleration

    // Check if reached target
    if (r.y <= r.targetY || r.vy >= -1) {
      createExplosion(r.x, r.y, r.color)
      rockets.splice(i, 1)
    }
  }

  // Update & draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.vx *= p.drag
    p.vy *= p.drag
    p.vy += p.gravity
    p.x += p.vx
    p.y += p.vy
    p.alpha -= p.decay

    if (p.alpha <= 0) {
      particles.splice(i, 1)
      continue
    }

    ctx.save()
    ctx.globalAlpha = p.flicker && Math.random() > 0.4 ? p.alpha * 0.6 : p.alpha
    ctx.fillStyle = p.color
    ctx.shadowBlur = 12
    ctx.shadowColor = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (currentRound.value?.presenter_show_state === 'winners') {
    fireworksAnimationId = requestAnimationFrame(updateFireworks)
  }
}

const resizeFireworksCanvas = () => {
  if (fireworksCanvas.value && typeof window !== 'undefined') {
    fireworksCanvas.value.width = window.innerWidth
    fireworksCanvas.value.height = window.innerHeight
  }
}

const startFireworks = () => {
  if (typeof window === 'undefined') return
  stopFireworks()
  resizeFireworksCanvas()

  // Initial burst of 4 fireworks
  setTimeout(() => {
    launchRocket()
    launchRocket()
  }, 100)
  setTimeout(() => {
    launchRocket()
    launchRocket()
  }, 450)

  // Continuous auto-launch
  fireworksLaunchInterval = setInterval(() => {
    if (currentRound.value?.presenter_show_state === 'winners') {
      launchRocket()
      if (Math.random() > 0.35) {
        setTimeout(launchRocket, 180 + Math.random() * 260)
      }
    }
  }, 700)

  fireworksAnimationId = requestAnimationFrame(updateFireworks)
}

const stopFireworks = () => {
  if (fireworksAnimationId) {
    cancelAnimationFrame(fireworksAnimationId)
    fireworksAnimationId = null
  }
  if (fireworksLaunchInterval) {
    clearInterval(fireworksLaunchInterval)
    fireworksLaunchInterval = null
  }
  rockets = []
  particles = []
  if (fireworksCanvas.value) {
    const ctx = fireworksCanvas.value.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, fireworksCanvas.value.width, fireworksCanvas.value.height)
  }
}

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

  // Load initial saved theme if any and listen to local cross-tab broadcasts
  if (typeof window !== 'undefined') {
    const savedTheme = localStorage.getItem('presenter_theme') as 'dark' | 'light' | null
    if (savedTheme) {
      presenterTheme.value = savedTheme
    }

    if ('BroadcastChannel' in window) {
      try {
        localConfigBc = new BroadcastChannel('presenter_config_channel')
        localConfigBc.onmessage = (msg: MessageEvent) => {
          if (msg.data && msg.data.event === 'audio_settings' && msg.data.payload) {
            applyConfigPayload(msg.data.payload)
          }
        }
      } catch (e) {}
    }

    window.addEventListener('storage', (e) => {
      if (e.key === 'presenter_theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        presenterTheme.value = e.newValue
      }
    })
    window.addEventListener('resize', resizeFireworksCanvas)
    if (currentRound.value?.presenter_show_state === 'winners') {
      startFireworks()
    } else if (currentRound.value?.presenter_show_state === 'thank_you') {
      startFloatingBubbles()
      startThankYouMusic()
    } else if (currentRound.value?.presenter_show_state === 'welcome') {
      startWelcomeBalloonCycle()
    } else if (currentRound.value?.presenter_show_state === 'scoreboard') {
      startScoreboardCycle()
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

watch(
  () => currentRound.value?.presenter_show_state,
  (newState) => {
    if (newState === 'winners') {
      startFireworks()
    } else {
      stopFireworks()
    }

    if (newState === 'thank_you') {
      startFloatingBubbles()
      startThankYouMusic()
      speakThankYouMessage()
    } else {
      stopFloatingBubbles()
      stopThankYouMusic()
    }

    if (newState === 'welcome') {
      startWelcomeBalloonCycle()
    } else {
      stopWelcomeBalloonCycle()
    }

    if (newState === 'scoreboard') {
      startScoreboardCycle()
    } else {
      stopScoreboardCycle()
    }
  }
)

watch(
  () => allTeams.value,
  (newTeams) => {
    if (currentRound.value?.presenter_show_state === 'welcome' && newTeams.length > 0 && !welcomeBalloonInterval) {
      startWelcomeBalloonCycle()
    }
  }
)

watch(
  () => soundEnabled.value,
  (isEnabled) => {
    if (!isEnabled) {
      stopThankYouMusic()
      stopSounds()
    } else {
      if (currentRound.value?.presenter_show_state === 'thank_you' && !thankYouMusicInterval) {
        startThankYouMusic()
      }
    }
  }
)

onUnmounted(() => {
  cleanupSubscriptions()
  stopLocalTimer()
  stopSounds()
  stopFireworks()
  stopFloatingBubbles()
  stopThankYouMusic()
  stopWelcomeBalloonCycle()
  stopScoreboardCycle()
  if (thankYouSpeakTimeout) {
    clearTimeout(thankYouSpeakTimeout)
    thankYouSpeakTimeout = null
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', resizeFireworksCanvas)
  }
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
    if (rData?.presenter_theme === 'light' || rData?.presenter_theme === 'dark') {
      presenterTheme.value = rData.presenter_theme
    }

    // 2. Fetch all teams in round (for calculations)
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('team_number', { ascending: true })
    allTeams.value = tData || []

    // 2.1 Fetch all answers and questions for scoring
    if (tData && tData.length > 0) {
      const teamIds = tData.map(t => t.id)
      const { data: aData } = await supabase.value
        .from('answers')
        .select('*')
        .in('team_id', teamIds)
      allAnswers.value = aData || []
    } else {
      allAnswers.value = []
    }

    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', selectedRoundId.value)
    allQuestions.value = qData || []

    // 3. Fetch active question details
    await fetchActiveQuestion(rData.presenter_active_question)

    // 4. Update timer based on state
    syncTimerState()

    if (rData?.presenter_show_state === 'thank_you') {
      startFloatingBubbles()
      startThankYouMusic()
    } else if (rData?.presenter_show_state === 'welcome') {
      startWelcomeBalloonCycle()
    } else if (rData?.presenter_show_state === 'scoreboard') {
      startScoreboardCycle()
    }

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

const winnerData = computed(() => {
  if (!currentRound.value?.winner_data) return { rank1: [], rank2: [], rank3: [] }
  const wd = currentRound.value.winner_data
  return {
    rank1: wd.rank1 || [],
    rank2: wd.rank2 || [],
    rank3: wd.rank3 || []
  }
})

const formatSchoolName = (schoolName?: string) => {
  if (!schoolName) return ''
  const trimmed = schoolName.trim()
  if (trimmed.startsWith('โรงเรียน')) return trimmed
  return `โรงเรียน${trimmed}`
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

let thankYouSpeakTimeout: any = null

const speakThankYouMessage = () => {
  if (!ttsEnabled.value || typeof window === 'undefined' || !('speechSynthesis' in window)) return

  if (thankYouSpeakTimeout) clearTimeout(thankYouSpeakTimeout)
  window.speechSynthesis.cancel()

  const text = `ขอขอบคุณทุกทีมที่เข้าร่วมการแข่งขันตอบปัญหาวิทยาศาสตร์ แล้วพบกันใหม่ปีหน้าครับ`

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'th-TH'
  
  const maleVoice = getThaiMaleVoice()
  if (maleVoice) {
    utterance.voice = maleVoice
  }

  utterance.volume = soundEnabled.value ? 1.0 : 0.0
  utterance.rate = 0.95

  thankYouSpeakTimeout = setTimeout(() => {
    window.speechSynthesis.speak(utterance)
    thankYouSpeakTimeout = null
  }, 200)
}

// ==========================================
// Scoreboard Display System (14 Teams / Page, 3s Cycle)
// ==========================================
const SCOREBOARD_PAGE_SIZE = 14
const scoreboardPageIndex = ref(0)
const scoreboardProgressKey = ref(0)
let scoreboardInterval: any = null

const teamsWithScores = computed(() => {
  if (!allTeams.value || allTeams.value.length === 0) return []
  
  // Build map of correct answers from questions if available
  const answerKeyMap = new Map<number, string>()
  allQuestions.value.forEach(q => {
    if (q.correct_answer) {
      answerKeyMap.set(q.question_number, q.correct_answer)
    }
  })

  return allTeams.value.map(team => {
    const teamAnswers = allAnswers.value.filter(ans => ans.team_id === team.id)
    let correctCount = 0
    
    teamAnswers.forEach(ans => {
      if (ans.is_correct) {
        correctCount++
      } else {
        const expected = answerKeyMap.get(ans.question_number)
        if (expected && ans.submitted_answer === expected) {
          correctCount++
        }
      }
    })

    const totalScore = correctCount + (team.tie_breaker_score || 0)
    return {
      ...team,
      correctCount,
      totalScore
    }
  }).sort((a, b) => a.team_number - b.team_number)
})

const scoreboardTotalPages = computed(() => {
  return Math.max(1, Math.ceil(teamsWithScores.value.length / SCOREBOARD_PAGE_SIZE))
})

const currentScoreboardTeams = computed(() => {
  const start = scoreboardPageIndex.value * SCOREBOARD_PAGE_SIZE
  return teamsWithScores.value.slice(start, start + SCOREBOARD_PAGE_SIZE)
})

const startScoreboardCycle = () => {
  stopScoreboardCycle()
  scoreboardPageIndex.value = 0
  scoreboardProgressKey.value++

  scoreboardInterval = setInterval(() => {
    if (scoreboardTotalPages.value > 1) {
      scoreboardPageIndex.value = (scoreboardPageIndex.value + 1) % scoreboardTotalPages.value
      scoreboardProgressKey.value++
    }
  }, 6000)
}

const stopScoreboardCycle = () => {
  if (scoreboardInterval) {
    clearInterval(scoreboardInterval)
    scoreboardInterval = null
  }
}

// ==========================================
// Welcome Screen Team Balloons Carousel System (Randomized Positions & Multiple Sounds - 4 Teams per Batch)
// ==========================================
const welcomeTeamIndex = ref(0)
const welcomePairKey = ref(0)
let welcomeBalloonInterval: any = null
let lastSoundIndex = -1

const currentWelcomeBatch = computed(() => {
  if (!allTeams.value || allTeams.value.length === 0) return []
  const count = allTeams.value.length
  const batchSize = Math.min(4, count)
  const result: any[] = []
  for (let i = 0; i < batchSize; i++) {
    const idx = (welcomeTeamIndex.value + i) % count
    result.push({
      ...allTeams.value[idx],
      batchIndex: i,
      gradientIdx: (welcomeTeamIndex.value + i) % 12
    })
  }
  return result
})

// 4 Corner / Peripheral Quadrant Slot Pools (Non-overlapping, keeping center text fully visible)
const quadrant1Slots = [
  { top: '8%', left: '3%' },
  { top: '16%', left: '4%' },
  { top: '10%', left: '8.5%' },
  { top: '22%', left: '3.5%' }
]

const quadrant2Slots = [
  { top: '56%', left: '3%' },
  { top: '68%', left: '4%' },
  { top: '74%', left: '9.5%' },
  { top: '62%', left: '8.5%' }
]

const quadrant3Slots = [
  { top: '8%', right: '3%' },
  { top: '16%', right: '4%' },
  { top: '10%', right: '8.5%' },
  { top: '22%', right: '3.5%' }
]

const quadrant4Slots = [
  { top: '56%', right: '3%' },
  { top: '68%', right: '4%' },
  { top: '74%', right: '9.5%' },
  { top: '62%', right: '8.5%' }
]

const currentBalloonPositions = ref<{
  pos1: Record<string, string>;
  pos2: Record<string, string>;
  pos3: Record<string, string>;
  pos4: Record<string, string>;
}>({
  pos1: { top: '10%', left: '3.5%' },
  pos2: { top: '62%', left: '3.5%' },
  pos3: { top: '10%', right: '3.5%' },
  pos4: { top: '62%', right: '3.5%' }
})

const randomizeBalloonPositions = () => {
  const getSlotStyle = (slots: any[]) => {
    const slot = slots[Math.floor(Math.random() * slots.length)]
    const jitterY = (Math.random() * 3.2 - 1.6).toFixed(1)
    const jitterX = (Math.random() * 2.2 - 1.1).toFixed(1)

    const style: Record<string, string> = {
      top: `calc(${slot.top} + ${jitterY}%)`
    }
    if (slot.left) {
      style.left = `calc(${slot.left} + ${jitterX}%)`
    } else if (slot.right) {
      style.right = `calc(${slot.right} + ${jitterX}%)`
    }
    return style
  }

  currentBalloonPositions.value = {
    pos1: getSlotStyle(quadrant1Slots),
    pos2: getSlotStyle(quadrant2Slots),
    pos3: getSlotStyle(quadrant3Slots),
    pos4: getSlotStyle(quadrant4Slots)
  }
}

// 3 Distinct Sound Variations for 4 Balloons Appearing
const playBalloonSound = () => {
  if (!soundEnabled.value) return
  const ctx = getAudioContext()
  if (!ctx) return

  // Pick a rotating/random sound variant among 3 distinct types
  let soundVariant = Math.floor(Math.random() * 3)
  if (soundVariant === lastSoundIndex) {
    soundVariant = (soundVariant + 1) % 3
  }
  lastSoundIndex = soundVariant

  try {
    const now = ctx.currentTime

    if (soundVariant === 0) {
      // Sound 1: Cheerful Quadruple Bubble Pop (4 ascending playful pops)
      const playPop = (freq1: number, freq2: number, delay: number, vol: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq1, now + delay)
        osc.frequency.exponentialRampToValueAtTime(freq2, now + delay + 0.08)

        gain.gain.setValueAtTime(0.001, now + delay)
        gain.gain.linearRampToValueAtTime(vol, now + delay + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.2)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + delay)
        osc.stop(now + delay + 0.22)
      }
      playPop(440, 880, 0, 0.19)
      playPop(550, 1100, 0.06, 0.19)
      playPop(660, 1320, 0.12, 0.20)
      playPop(880, 1760, 0.18, 0.21)
    } else if (soundVariant === 1) {
      // Sound 2: Magical Crystal Glockenspiel Arpeggio (4 ascending notes: C5 - E5 - G5 - C6)
      const playChime = (freq: number, delay: number, vol: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, now + delay)

        gain.gain.setValueAtTime(0.001, now + delay)
        gain.gain.linearRampToValueAtTime(vol, now + delay + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.35)

        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + delay)
        osc.stop(now + delay + 0.38)
      }
      playChime(523.25, 0, 0.17)      // C5
      playChime(659.25, 0.06, 0.18)   // E5
      playChime(783.99, 0.12, 0.19)   // G5
      playChime(1046.50, 0.18, 0.22)  // C6
    } else {
      // Sound 3: Warm Marimba / Kalimba 4-Note Chord Pluck (G4 - B4 - D5 - G5)
      const playPluck = (freq: number, delay: number, vol: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, now + delay)

        gain.gain.setValueAtTime(0.001, now + delay)
        gain.gain.linearRampToValueAtTime(vol, now + delay + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.28)

        const overtone = ctx.createOscillator()
        const overtoneGain = ctx.createGain()
        overtone.type = 'sine'
        overtone.frequency.setValueAtTime(freq * 2.76, now + delay)
        overtoneGain.gain.setValueAtTime(vol * 0.22, now + delay)
        overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.08)

        osc.connect(gain)
        gain.connect(ctx.destination)
        overtone.connect(overtoneGain)
        overtoneGain.connect(ctx.destination)

        osc.start(now + delay)
        osc.stop(now + delay + 0.3)
        overtone.start(now + delay)
        overtone.stop(now + delay + 0.1)
      }
      playPluck(392.00, 0, 0.19)     // G4
      playPluck(493.88, 0.06, 0.19)  // B4
      playPluck(587.33, 0.12, 0.20)  // D5
      playPluck(783.99, 0.18, 0.22)  // G5
    }
  } catch (e) {}
}

const startWelcomeBalloonCycle = () => {
  if (typeof window === 'undefined' || !balloonsEnabled.value) return
  stopWelcomeBalloonCycle()
  welcomeTeamIndex.value = 0
  welcomePairKey.value = 0
  randomizeBalloonPositions()

  if (allTeams.value.length > 0) {
    playBalloonSound()
  }

  welcomeBalloonInterval = setInterval(() => {
    if (allTeams.value.length === 0 || !balloonsEnabled.value) return
    const step = Math.min(4, allTeams.value.length)
    welcomeTeamIndex.value = (welcomeTeamIndex.value + step) % allTeams.value.length
    welcomePairKey.value++
    randomizeBalloonPositions()
    playBalloonSound()
  }, 4800)
}

const stopWelcomeBalloonCycle = () => {
  if (welcomeBalloonInterval) {
    clearInterval(welcomeBalloonInterval)
    welcomeBalloonInterval = null
  }
}

// Free-Roam Floating Bubbles Simulation System
interface FloatingBubbleItem {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
  size: number
  gradientClass: string
  wobbleSpeed: number
  wobbleSeed: number
}

const activeFloatingBubbles = ref<FloatingBubbleItem[]>([])
let thankYouAnimationId: number | null = null
let thankYouSimTime = 0

const startFloatingBubbles = () => {
  if (typeof window === 'undefined') return
  stopFloatingBubbles()

  const screenW = window.innerWidth
  const screenH = window.innerHeight

  const teamsList = allTeams.value.length > 0 ? allTeams.value : [
    { id: 'sample-1', name: 'ขอบคุณผู้เข้าร่วมแข่งขันทุกท่าน' }
  ]

  thankYouSimTime = 0
  activeFloatingBubbles.value = teamsList.map((team, idx) => {
    const size = Math.floor(155 + (idx % 4) * 14) // 155px - 197px
    const angle = Math.random() * Math.PI * 2
    const speed = 0.4 + Math.random() * 0.45 // Gentle smooth speed

    return {
      id: team.id || `team-${idx}`,
      name: team.name || `ทีมที่ ${idx + 1}`,
      x: Math.random() * (screenW - size),
      y: Math.random() * (screenH - size),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      gradientClass: `bubble-gradient-${idx % 12}`,
      wobbleSpeed: 0.7 + Math.random() * 0.5,
      wobbleSeed: Math.random() * 100
    }
  })

  thankYouAnimationId = requestAnimationFrame(updateFloatingBubbles)
}

const updateFloatingBubbles = () => {
  if (typeof window === 'undefined') return
  if (currentRound.value?.presenter_show_state !== 'thank_you') {
    stopFloatingBubbles()
    return
  }

  const screenW = window.innerWidth
  const screenH = window.innerHeight
  thankYouSimTime += 0.016

  activeFloatingBubbles.value.forEach(b => {
    // 2D Organic Wave Wobble
    const wobbleX = Math.sin(thankYouSimTime * b.wobbleSpeed + b.wobbleSeed) * 0.35
    const wobbleY = Math.cos(thankYouSimTime * b.wobbleSpeed * 0.85 + b.wobbleSeed) * 0.35

    b.x += b.vx + wobbleX
    b.y += b.vy + wobbleY

    const margin = b.size + 100

    // Wrap around screen boundaries with fresh random trajectory
    if (b.x < -margin) {
      b.x = screenW + b.size * 0.3
      b.y = Math.random() * (screenH - b.size)
      b.vx = -(0.35 + Math.random() * 0.45)
      b.vy = (Math.random() - 0.5) * 0.5
    } else if (b.x > screenW + margin) {
      b.x = -b.size * 0.8
      b.y = Math.random() * (screenH - b.size)
      b.vx = 0.35 + Math.random() * 0.45
      b.vy = (Math.random() - 0.5) * 0.5
    }

    if (b.y < -margin) {
      b.y = screenH + b.size * 0.3
      b.x = Math.random() * (screenW - b.size)
      b.vy = -(0.35 + Math.random() * 0.45)
      b.vx = (Math.random() - 0.5) * 0.5
    } else if (b.y > screenH + margin) {
      b.y = -b.size * 0.8
      b.x = Math.random() * (screenW - b.size)
      b.vy = 0.35 + Math.random() * 0.45
      b.vx = (Math.random() - 0.5) * 0.5
    }
  })

  thankYouAnimationId = requestAnimationFrame(updateFloatingBubbles)
}

const stopFloatingBubbles = () => {
  if (thankYouAnimationId) {
    cancelAnimationFrame(thankYouAnimationId)
    thankYouAnimationId = null
  }
}

// Joyful Celebratory Music Engine via Web Audio API
let thankYouMusicInterval: any = null
let thankYouMusicGain: GainNode | null = null

const startThankYouMusic = () => {
  if (!soundEnabled.value || typeof window === 'undefined') return
  const ctx = getAudioContext()
  if (!ctx) return

  stopThankYouMusic()

  // Master Gain Node for celebration music
  thankYouMusicGain = ctx.createGain()
  thankYouMusicGain.gain.setValueAtTime(0.001, ctx.currentTime)
  thankYouMusicGain.gain.linearRampToValueAtTime(0.24, ctx.currentTime + 0.8)
  thankYouMusicGain.connect(ctx.destination)

  // Happy celebration melody notes in Hz (Festive upbeat tune)
  const melodyNotes = [
    523.25, 659.25, 783.99, 659.25, 880.00, 783.99, 0, 659.25,
    587.33, 523.25, 587.33, 659.25, 783.99, 1046.50, 0, 880.00,
    783.99, 880.00, 783.99, 659.25, 587.33, 659.25, 587.33, 523.25,
    659.25, 783.99, 1046.50, 1174.66, 1046.50, 783.99, 880.00, 1046.50
  ]

  // Bouncy bassline pattern (C, F, G, Am)
  const bassPattern = [
    130.81, 130.81, 174.61, 174.61, 196.00, 196.00, 220.00, 196.00,
    130.81, 130.81, 174.61, 174.61, 196.00, 196.00, 130.81, 196.00
  ]

  let step = 0

  const playNote = (freq: number, dur: number, time: number) => {
    if (!thankYouMusicGain || freq <= 0) return

    // 1. Marimba / Bell lead tone
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, time)

    g.gain.setValueAtTime(0.001, time)
    g.gain.linearRampToValueAtTime(0.26, time + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, time + dur)

    osc.connect(g)
    g.connect(thankYouMusicGain)

    osc.start(time)
    osc.stop(time + dur + 0.05)

    // 2. Chime harmonic
    const ch = ctx.createOscillator()
    const cg = ctx.createGain()
    ch.type = 'sine'
    ch.frequency.setValueAtTime(freq * 2, time)

    cg.gain.setValueAtTime(0.001, time)
    cg.gain.linearRampToValueAtTime(0.08, time + 0.01)
    cg.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.7)

    ch.connect(cg)
    cg.connect(thankYouMusicGain)

    ch.start(time)
    ch.stop(time + dur * 0.75)
  }

  const playBass = (freq: number, time: number) => {
    if (!thankYouMusicGain || freq <= 0) return

    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, time)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, time + 0.18)

    g.gain.setValueAtTime(0.001, time)
    g.gain.linearRampToValueAtTime(0.24, time + 0.015)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.22)

    osc.connect(g)
    g.connect(thankYouMusicGain)

    osc.start(time)
    osc.stop(time + 0.25)
  }

  const playChirp = (time: number) => {
    if (!thankYouMusicGain) return
    const bufSize = Math.floor(ctx.sampleRate * 0.035)
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.12

    const src = ctx.createBufferSource()
    src.buffer = buf

    const filt = ctx.createBiquadFilter()
    filt.type = 'highpass'
    filt.frequency.setValueAtTime(8000, time)

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.06, time)
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.035)

    src.connect(filt)
    filt.connect(g)
    g.connect(thankYouMusicGain)

    src.start(time)
    src.stop(time + 0.04)
  }

  thankYouMusicInterval = setInterval(() => {
    if (currentRound.value?.presenter_show_state !== 'thank_you' || !soundEnabled.value) {
      stopThankYouMusic()
      return
    }

    const now = ctx.currentTime
    const n = melodyNotes[step % melodyNotes.length]
    if (n > 0) {
      playNote(n, 0.22, now)
    }

    const b = bassPattern[step % bassPattern.length]
    playBass(b, now)

    playChirp(now)

    step++
  }, 210) // ~142 BPM cheerful bounce tempo
}

const stopThankYouMusic = () => {
  if (thankYouMusicInterval) {
    clearInterval(thankYouMusicInterval)
    thankYouMusicInterval = null
  }
  if (thankYouMusicGain && audioCtx) {
    try {
      thankYouMusicGain.gain.cancelScheduledValues(audioCtx.currentTime)
      thankYouMusicGain.gain.setValueAtTime(0, audioCtx.currentTime)
      thankYouMusicGain.disconnect()
    } catch (e) {}
    thankYouMusicGain = null
  }
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

      if (payload.new?.presenter_theme === 'light' || payload.new?.presenter_theme === 'dark') {
        presenterTheme.value = payload.new.presenter_theme
      }

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
      if (payload.new.presenter_show_state !== 'correct_teams' && payload.new.presenter_show_state !== 'question' && payload.new.presenter_show_state !== 'winners' && payload.new.presenter_show_state !== 'thank_you' && typeof window !== 'undefined' && ('speechSynthesis' in window)) {
        window.speechSynthesis.cancel()
      }
    })
    .subscribe()

  // Listen to answers changes (for real-time scoreboard & correct teams)
  answersChannel = supabase.value
    .channel('presenter-answers-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'answers'
    }, (payload: any) => {
      const updated = payload.new as any
      const deleted = payload.old as any
      if (payload.eventType === 'INSERT') {
        allAnswers.value.push(updated)
      } else if (payload.eventType === 'UPDATE') {
        const idx = allAnswers.value.findIndex((a: any) => a.id === updated.id)
        if (idx > -1) {
          allAnswers.value[idx] = updated
        } else {
          allAnswers.value.push(updated)
        }
      } else if (payload.eventType === 'DELETE') {
        allAnswers.value = allAnswers.value.filter((a: any) => a.id !== deleted.id)
      }

      if (currentRound.value?.presenter_show_state === 'correct_teams') {
        fetchCorrectTeams()
      }
    })
    .subscribe()

  // Listen to teams changes (for tie-breaker score or name edits)
  teamsChannel = supabase.value
    .channel('presenter-teams-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'teams',
      filter: `round_id=eq.${selectedRoundId.value}`
    }, async () => {
      if (!supabase.value || !selectedRoundId.value) return
      const { data: tData } = await supabase.value
        .from('teams')
        .select('*')
        .eq('round_id', selectedRoundId.value)
        .order('team_number', { ascending: true })
      allTeams.value = tData || []
    })
    .subscribe()

  // Listen to audio & theme config broadcast channel (Global topic)
  configChannel = supabase.value.channel('presenter-global-config', {
    config: { broadcast: { self: true } }
  })
  configChannel
    .on('broadcast', { event: 'audio_settings' }, ({ payload }: any) => {
      applyConfigPayload(payload)
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
  if (roundChannel && supabase.value) {
    supabase.value.removeChannel(roundChannel)
    roundChannel = null
  }
  if (answersChannel && supabase.value) {
    supabase.value.removeChannel(answersChannel)
    answersChannel = null
  }
  if (teamsChannel && supabase.value) {
    supabase.value.removeChannel(teamsChannel)
    teamsChannel = null
  }
  if (configChannel && supabase.value) {
    supabase.value.removeChannel(configChannel)
    configChannel = null
  }
  if (localConfigBc) {
    try { localConfigBc.close() } catch (e) {}
    localConfigBc = null
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
  getAudioContext()
  
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
    
    <!-- Fireworks Canvas Overlay (Active during Winner Announcement) -->
    <canvas 
      ref="fireworksCanvas" 
      class="fireworks-canvas"
      v-show="currentRound?.presenter_show_state === 'winners'"
    ></canvas>
    
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

          <!-- Dynamic Randomized Team Balloons Overlay (Showing 2 teams at random peripheral spots without covering center text) -->
          <div v-if="allTeams.length > 0 && balloonsEnabled" class="welcome-balloons-arena">
            <Transition name="welcome-balloon-random-transition" mode="out-in">
              <div :key="welcomePairKey" class="welcome-balloons-random-wrapper">
                <!-- Balloon 1 (Top-Left Quadrant) -->
                <div 
                  v-if="currentWelcomeBatch.length > 0"
                  class="welcome-balloon-orb-random"
                  :style="currentBalloonPositions.pos1"
                  :class="['balloon-gradient-' + currentWelcomeBatch[0].gradientIdx]"
                >
                  <div class="welcome-balloon-shine"></div>
                  <div class="welcome-balloon-specular"></div>
                  
                  <div class="welcome-balloon-content">
                    <span class="welcome-balloon-name">{{ currentWelcomeBatch[0].name }}</span>
                  </div>

                  <div class="welcome-balloon-knot"></div>
                  <div class="welcome-balloon-string"></div>
                </div>

                <!-- Balloon 2 (Bottom-Left Quadrant) -->
                <div 
                  v-if="currentWelcomeBatch.length > 1"
                  class="welcome-balloon-orb-random balloon-float-alt1"
                  :style="currentBalloonPositions.pos2"
                  :class="['balloon-gradient-' + currentWelcomeBatch[1].gradientIdx]"
                >
                  <div class="welcome-balloon-shine"></div>
                  <div class="welcome-balloon-specular"></div>
                  
                  <div class="welcome-balloon-content">
                    <span class="welcome-balloon-name">{{ currentWelcomeBatch[1].name }}</span>
                  </div>

                  <div class="welcome-balloon-knot"></div>
                  <div class="welcome-balloon-string"></div>
                </div>

                <!-- Balloon 3 (Top-Right Quadrant) -->
                <div 
                  v-if="currentWelcomeBatch.length > 2"
                  class="welcome-balloon-orb-random balloon-float-alt2"
                  :style="currentBalloonPositions.pos3"
                  :class="['balloon-gradient-' + currentWelcomeBatch[2].gradientIdx]"
                >
                  <div class="welcome-balloon-shine"></div>
                  <div class="welcome-balloon-specular"></div>
                  
                  <div class="welcome-balloon-content">
                    <span class="welcome-balloon-name">{{ currentWelcomeBatch[2].name }}</span>
                  </div>

                  <div class="welcome-balloon-knot"></div>
                  <div class="welcome-balloon-string"></div>
                </div>

                <!-- Balloon 4 (Bottom-Right Quadrant) -->
                <div 
                  v-if="currentWelcomeBatch.length > 3"
                  class="welcome-balloon-orb-random balloon-float-alt3"
                  :style="currentBalloonPositions.pos4"
                  :class="['balloon-gradient-' + currentWelcomeBatch[3].gradientIdx]"
                >
                  <div class="welcome-balloon-shine"></div>
                  <div class="welcome-balloon-specular"></div>
                  
                  <div class="welcome-balloon-content">
                    <span class="welcome-balloon-name">{{ currentWelcomeBatch[3].name }}</span>
                  </div>

                  <div class="welcome-balloon-knot"></div>
                  <div class="welcome-balloon-string"></div>
                </div>
              </div>
            </Transition>
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

        <!-- E. SCOREBOARD ROTATING DISPLAY (14 TEAMS PER PAGE, 3s INTERVAL) -->
        <div v-else-if="currentRound.presenter_show_state === 'scoreboard'" class="presenter-card scoreboard-stage-container">
          <!-- Top Header -->
          <div class="scoreboard-stage-header">
            <div class="scoreboard-header-title-box">
              <h1 class="scoreboard-main-title font-title">
                <span class="scoreboard-title-icon">📊</span>
                <span>สรุปคะแนนการแข่งขัน</span>
              </h1>
              <div class="scoreboard-round-badge" v-if="currentRound.name">
                ระดับ {{ currentRound.name }}
              </div>
            </div>

            <!-- Pagination & Team Count Badge -->
            <div class="scoreboard-pagination-info" v-if="teamsWithScores.length > 0">
              <div class="page-counter-badge">
                หน้า <strong>{{ scoreboardPageIndex + 1 }}</strong> / {{ scoreboardTotalPages }}
              </div>
              <div class="team-range-badge">
                (ทีมที่ {{ scoreboardPageIndex * SCOREBOARD_PAGE_SIZE + 1 }} - {{ Math.min((scoreboardPageIndex + 1) * SCOREBOARD_PAGE_SIZE, teamsWithScores.length) }} จาก {{ teamsWithScores.length }} ทีม)
              </div>
            </div>
          </div>

          <!-- 3-Second Timer Progress Line -->
          <div class="scoreboard-cycle-progress-track" v-if="scoreboardTotalPages > 1">
            <div :key="scoreboardProgressKey" class="scoreboard-cycle-progress-bar"></div>
          </div>

          <!-- Empty State -->
          <div v-if="teamsWithScores.length === 0" class="no-teams-scoreboard">
            ยังไม่มีข้อมูลทีมในรอบนี้
          </div>

          <!-- 14-Team Grid Display (2 Columns x 7 Rows) -->
          <div v-else class="scoreboard-grid-wrapper">
            <Transition name="scoreboard-page-fade" mode="out-in">
              <div :key="scoreboardPageIndex" class="scoreboard-grid-14">
                <div 
                  v-for="team in currentScoreboardTeams" 
                  :key="team.id"
                  class="scoreboard-team-card"
                >
                  <!-- Left side: Team info -->
                  <div class="scoreboard-card-left">
                    <div class="scoreboard-team-num-badge">
                      ทีม {{ team.team_number }}
                    </div>
                    <div class="scoreboard-team-name-box">
                      <div class="scoreboard-team-name font-title" :title="team.name">
                        {{ team.name }}
                      </div>
                      <div v-if="team.school_name && team.school_name !== team.name" class="scoreboard-school-name">
                        {{ formatSchoolName(team.school_name) }}
                      </div>
                    </div>
                  </div>

                  <!-- Right side: Score Points Badge -->
                  <div class="scoreboard-card-right">
                    <div class="scoreboard-score-badge">
                      <span class="scoreboard-score-num">{{ team.totalScore }}</span>
                      <span class="scoreboard-score-unit">คะแนน</span>
                    </div>
                    <div v-if="team.tie_breaker_score > 0" class="scoreboard-tiebreak-pill" title="คะแนนไทเบรก">
                      +{{ team.tie_breaker_score }} ไทเบรก
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
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

        <!-- 1.5 WINNER ANNOUNCEMENT 3-PODIUM STAGE SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'winners'" class="presenter-card winners-stage-container">
          <div class="winners-stage-header">
            <h1 class="winners-congrats-title font-title">
              <Award :size="48" class="text-gold winner-trophy-icon" />
              <span>ขอแสดงความยินดี</span>
              <Award :size="48" class="text-gold winner-trophy-icon" />
            </h1>
            <h2 class="winners-event-subtitle">
              การแข่งขันตอบปัญหาวิทยาศาสตร์ มหาวิทยาลัยราชภัฏบุรีรัมย์
            </h2>
            <div class="winners-round-meta">
              <span>ระดับ {{ currentRound.name }}</span>
              <span v-if="currentRound.round_date || currentRound.date" class="winners-date-text">
                วันที่ {{ currentRound.round_date || currentRound.date }}
              </span>
            </div>
          </div>

          <!-- 3 Podiums Container -->
          <div class="podiums-stage-grid">
            
            <!-- PODIUM 2 (LEFT - SILVER - 2ND PLACE) -->
            <div class="podium-col silver-col">
              <div class="podium-teams-cards">
                <div v-if="!winnerData.rank2 || winnerData.rank2.length === 0" class="no-winner-slot">
                  - ไม่ระบุ -
                </div>
                <div v-for="team in winnerData.rank2" :key="team.id" class="podium-team-card silver-card">
                  <div class="podium-team-name-line">{{ team.name }}</div>
                  <div v-if="team.school_name" class="podium-team-school-line">{{ formatSchoolName(team.school_name) }}</div>
                </div>
              </div>
              <div class="podium-pillar silver-pillar">
                <div class="pillar-rank-badge">🥈</div>
                <div class="pillar-rank-title">รองชนะเลิศ อันดับ 1</div>
              </div>
            </div>

            <!-- PODIUM 1 (CENTER - GOLD - 1ST PLACE HIGHEST) -->
            <div class="podium-col gold-col">
              <div class="podium-crown-icon">👑</div>
              <div class="podium-teams-cards">
                <div v-if="!winnerData.rank1 || winnerData.rank1.length === 0" class="no-winner-slot">
                  - ไม่ระบุ -
                </div>
                <div v-for="team in winnerData.rank1" :key="team.id" class="podium-team-card gold-card">
                  <div class="podium-team-name-line">{{ team.name }}</div>
                  <div v-if="team.school_name" class="podium-team-school-line">{{ formatSchoolName(team.school_name) }}</div>
                </div>
              </div>
              <div class="podium-pillar gold-pillar">
                <div class="pillar-rank-badge">🥇</div>
                <div class="pillar-rank-title">ชนะเลิศ (อันดับ 1)</div>
              </div>
            </div>

            <!-- PODIUM 3 (RIGHT - BRONZE - 3RD PLACE) -->
            <div class="podium-col bronze-col">
              <div class="podium-teams-cards">
                <div v-if="!winnerData.rank3 || winnerData.rank3.length === 0" class="no-winner-slot">
                  - ไม่ระบุ -
                </div>
                <div v-for="team in winnerData.rank3" :key="team.id" class="podium-team-card bronze-card">
                  <div class="podium-team-name-line">{{ team.name }}</div>
                  <div v-if="team.school_name" class="podium-team-school-line">{{ formatSchoolName(team.school_name) }}</div>
                </div>
              </div>
              <div class="podium-pillar bronze-pillar">
                <div class="pillar-rank-badge">🥉</div>
                <div class="pillar-rank-title">รองชนะเลิศ อันดับ 2</div>
              </div>
            </div>

          </div>
        </div>

        <!-- 1.6 THANK YOU TEAMS SCREEN -->
        <div v-else-if="currentRound.presenter_show_state === 'thank_you'" class="presenter-card thank-you-stage-container">
          <!-- Ambient Background Decorative Glows -->
          <div class="thank-you-ambient-glow glow-1"></div>
          <div class="thank-you-ambient-glow glow-2"></div>
          <div class="thank-you-ambient-glow glow-3"></div>

          <!-- Header Section -->
          <div class="thank-you-header">
            <div class="thank-you-org-section">
              <img src="/scibru-logo.png" alt="SciBRU Logo" class="thank-you-logo" />
              <div class="thank-you-org-name">คณะวิทยาศาสตร์ มหาวิทยาลัยราชภัฏบุรีรัมย์</div>
            </div>

            <h1 class="thank-you-main-title">
              <span class="sparkle-icon">✨</span>
              <span>ขอบคุณทุกทีมที่เข้าร่วมแข่งขัน</span>
              <span class="sparkle-icon">✨</span>
            </h1>

            <div class="thank-you-subtitle-box">
              <h2 class="thank-you-subtitle">พบกันใหม่ปีหน้า</h2>
              <div class="thank-you-round-badge" v-if="currentRound.name">
                ระดับ {{ currentRound.name }}
              </div>
            </div>
          </div>

          <!-- Free-Roam Floating Bubbles Arena showing only Team Names for ALL teams -->
          <div class="floating-bubbles-arena-free">
            <div 
              v-for="bubble in activeFloatingBubbles" 
              :key="bubble.id"
              class="floating-bubble-free"
              :class="bubble.gradientClass"
              :style="{
                width: `${bubble.size}px`,
                height: `${bubble.size}px`,
                transform: `translate3d(${bubble.x}px, ${bubble.y}px, 0)`
              }"
            >
              <!-- 3D Glass shine highlight overlay -->
              <div class="bubble-glass-shine"></div>
              
              <div class="bubble-content-free">
                <span class="bubble-team-name-free" :title="bubble.name">
                  {{ bubble.name }}
                </span>
              </div>
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

/* Dynamic Team Balloons Random Overlay on Welcome Screen */
.welcome-balloons-arena {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
  z-index: 12;
}

.welcome-balloons-random-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.welcome-balloon-orb-random {
  position: absolute;
  width: clamp(210px, 19vw, 290px);
  height: clamp(210px, 19vw, 290px);
  border-radius: 50% 50% 50% 50% / 54% 54% 46% 46%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: default;
  user-select: none;
  pointer-events: auto;
  animation: balloonFloat1 3.4s ease-in-out infinite alternate;
  will-change: transform;
  filter: drop-shadow(0 16px 35px rgba(0, 0, 0, 0.5));
  transition: top 0.4s ease, left 0.4s ease, right 0.4s ease;
}

.welcome-balloon-orb-random.balloon-float-alt1 {
  animation: balloonFloat2 3.8s ease-in-out infinite alternate;
  animation-delay: -1.2s;
}

.welcome-balloon-orb-random.balloon-float-alt2 {
  animation: balloonFloat1 3.6s ease-in-out infinite alternate;
  animation-delay: -2.4s;
}

.welcome-balloon-orb-random.balloon-float-alt3 {
  animation: balloonFloat2 4.0s ease-in-out infinite alternate;
  animation-delay: -3.5s;
}

/* 3D Balloon Curvature / Highlights */
.welcome-balloon-shine {
  position: absolute;
  top: 8%;
  left: 14%;
  width: 65%;
  height: 38%;
  border-radius: 50% 50% 40% 40%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(255, 255, 255, 0.08) 80%, transparent 100%);
  pointer-events: none;
  z-index: 3;
}

.welcome-balloon-specular {
  position: absolute;
  top: 14%;
  left: 20%;
  width: 18px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  transform: rotate(-35deg);
  filter: blur(1.5px);
  pointer-events: none;
  z-index: 4;
}

/* Balloon Knot at bottom */
.welcome-balloon-knot {
  position: absolute;
  bottom: -9px;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 14px;
  background: inherit;
  border-radius: 3px 3px 8px 8px;
  filter: brightness(0.85);
  z-index: 2;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

/* Balloon String */
.welcome-balloon-string {
  position: absolute;
  bottom: -46px;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  height: 38px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.15) 100%);
  border-radius: 1px;
  transform-origin: top center;
  animation: stringSway 3s ease-in-out infinite alternate;
  pointer-events: none;
}

.welcome-balloon-content {
  position: relative;
  z-index: 5;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.8rem 0.8rem 0.6rem 0.8rem;
}

.welcome-balloon-name {
  font-family: var(--font-body);
  font-size: clamp(2.0rem, 2.65vw, 3.4rem);
  font-weight: 950;
  color: #ffffff;
  line-height: 1.18;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.95), 0 0 22px rgba(0, 0, 0, 0.8);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  text-align: center;
  letter-spacing: 0.2px;
}

/* Balloon Floating Keyframes */
@keyframes balloonFloat1 {
  0% { transform: translateY(0) rotate(-1.5deg); }
  50% { transform: translateY(-14px) rotate(1deg); }
  100% { transform: translateY(6px) rotate(-1deg); }
}

@keyframes balloonFloat2 {
  0% { transform: translateY(4px) rotate(1.5deg); }
  50% { transform: translateY(-16px) rotate(-1deg); }
  100% { transform: translateY(0) rotate(1deg); }
}

@keyframes stringSway {
  0% { transform: translateX(-50%) rotate(-4deg); }
  100% { transform: translateX(-50%) rotate(4deg); }
}

/* Transition for fading out and popping in new team pairs in random positions */
.welcome-balloon-random-transition-enter-active {
  transition: all 0.75s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.welcome-balloon-random-transition-leave-active {
  transition: all 0.65s cubic-bezier(0.4, 0, 0.2, 1);
}

.welcome-balloon-random-transition-enter-from {
  opacity: 0;
  transform: scale(0.3) translateY(40px);
}

.welcome-balloon-random-transition-leave-to {
  opacity: 0;
  transform: scale(0.6) translateY(-25px);
}

/* 12 Balloon Vibrant Gradients */
.balloon-gradient-0 {
  background: radial-gradient(circle at 35% 30%, #ff5277, #f50057 60%, #a00037 100%);
  box-shadow: 0 14px 35px rgba(245, 0, 87, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-1 {
  background: radial-gradient(circle at 35% 30%, #00e5ff, #0091ea 60%, #01579b 100%);
  box-shadow: 0 14px 35px rgba(0, 145, 234, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-2 {
  background: radial-gradient(circle at 35% 30%, #ff4081, #c51162 60%, #700836 100%);
  box-shadow: 0 14px 35px rgba(197, 17, 98, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-3 {
  background: radial-gradient(circle at 35% 30%, #00e676, #00c853 60%, #00600f 100%);
  box-shadow: 0 14px 35px rgba(0, 200, 83, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-4 {
  background: radial-gradient(circle at 35% 30%, #ff9100, #ff6d00 60%, #bf360c 100%);
  box-shadow: 0 14px 35px rgba(255, 109, 0, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-5 {
  background: radial-gradient(circle at 35% 30%, #b388ff, #7c4dff 60%, #311b92 100%);
  box-shadow: 0 14px 35px rgba(124, 77, 255, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-6 {
  background: radial-gradient(circle at 35% 30%, #64ffda, #00bfa5 60%, #004d40 100%);
  box-shadow: 0 14px 35px rgba(0, 191, 165, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-7 {
  background: radial-gradient(circle at 35% 30%, #ff80ab, #e040fb 60%, #6a0080 100%);
  box-shadow: 0 14px 35px rgba(224, 64, 251, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-8 {
  background: radial-gradient(circle at 35% 30%, #ffd740, #ffab00 60%, #b26a00 100%);
  box-shadow: 0 14px 35px rgba(255, 171, 0, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-9 {
  background: radial-gradient(circle at 35% 30%, #ff5722, #d50000 60%, #7f0000 100%);
  box-shadow: 0 14px 35px rgba(213, 0, 0, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-10 {
  background: radial-gradient(circle at 35% 30%, #40c4ff, #2979ff 60%, #0d47a1 100%);
  box-shadow: 0 14px 35px rgba(41, 121, 255, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
}
.balloon-gradient-11 {
  background: radial-gradient(circle at 35% 30%, #a7ffeb, #1de9b6 60%, #00796b 100%);
  box-shadow: 0 14px 35px rgba(29, 233, 182, 0.5), inset 0 0 20px rgba(255, 255, 255, 0.4);
  border: 2.5px solid rgba(255, 255, 255, 0.65);
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
  .welcome-balloon-orb-random {
    width: clamp(170px, 16vw, 230px);
    height: clamp(170px, 16vw, 230px);
  }
  .welcome-balloon-name {
    font-size: clamp(1.6rem, 2.1vw, 2.6rem);
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
  .welcome-balloon-orb-random {
    width: clamp(140px, 14vw, 180px);
    height: clamp(140px, 14vw, 180px);
  }
  .welcome-balloon-name {
    font-size: clamp(1.3rem, 1.6vw, 1.9rem);
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

/* Fireworks Canvas Overlay */
.fireworks-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 99;
}

/* Winner Podium Stage Styles */
.winners-stage-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem 2rem 2rem 2rem;
  justify-content: space-between;
  text-align: center;
  position: relative;
  z-index: 20;
}

.winners-stage-header {
  margin-bottom: 0.6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}

.winners-congrats-title {
  font-size: clamp(2.4rem, 4.2vw, 3.8rem);
  font-weight: 900;
  color: var(--color-gold, #ffd700);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  text-shadow: 0 0 25px rgba(255, 215, 0, 0.45);
  margin: 0;
}

.winners-event-subtitle {
  font-size: clamp(1.2rem, 1.8vw, 1.65rem);
  font-weight: 700;
  color: #ffffff;
  margin: 0;
  opacity: 0.95;
}

.winners-round-meta {
  font-size: clamp(1.2rem, 1.8vw, 1.65rem);
  font-weight: 600;
  color: var(--color-cyan, #00e5ff);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin: 0;
}

.winners-date-text {
  color: var(--color-cyan, #00e5ff);
}

.podiums-stage-grid {
  display: grid;
  grid-template-columns: 1fr 1.15fr 1fr;
  gap: 1.5rem;
  align-items: flex-end;
  flex: 1;
  padding: 0.5rem 0;
}

.podium-col {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
  position: relative;
}

.gold-col {
  z-index: 10;
}

.podium-crown-icon {
  font-size: clamp(3.5rem, 5vw, 5.2rem);
  margin-bottom: 0.5rem;
  filter: drop-shadow(0 0 15px rgba(255, 215, 0, 0.6));
  animation: bounceCrown 2s infinite ease-in-out;
}

@keyframes bounceCrown {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

/* Horizontal Row layout for tied teams (left to right) */
.podium-teams-cards {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: 0.75rem;
  margin-bottom: 1rem;
  width: 100%;
}

.no-winner-slot {
  font-size: 1rem;
  color: #64748b;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 0.75rem;
  width: 100%;
}

.podium-team-card {
  flex: 1;
  min-width: 160px;
  max-width: 320px;
  padding: 0.85rem 1.15rem;
  border-radius: 0.85rem;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.gold-card {
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.3) 0%, rgba(255, 215, 0, 0.15) 100%);
  border: 2px solid rgba(255, 215, 0, 0.7);
  box-shadow: 0 0 30px rgba(255, 215, 0, 0.35);
}

.silver-card {
  background: linear-gradient(135deg, rgba(226, 232, 240, 0.25) 0%, rgba(148, 163, 184, 0.15) 100%);
  border: 2px solid rgba(226, 232, 240, 0.6);
  box-shadow: 0 0 20px rgba(226, 232, 240, 0.25);
}

.bronze-card {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.25) 0%, rgba(217, 119, 6, 0.15) 100%);
  border: 2px solid rgba(251, 146, 60, 0.6);
  box-shadow: 0 0 20px rgba(251, 146, 60, 0.25);
}

.podium-team-num {
  font-weight: 900;
  font-size: 0.95rem;
  color: var(--color-cyan, #00e5ff);
  font-family: var(--font-title);
}

.podium-team-name-line {
  font-weight: 800;
  font-size: clamp(1.2rem, 1.8vw, 1.7rem);
  color: #ffffff;
  line-height: 1.35;
  word-break: break-word;
}

.podium-team-school-line {
  font-size: clamp(0.9rem, 1.2vw, 1.25rem);
  color: #e2e8f0;
  opacity: 0.95;
  line-height: 1.3;
  margin-top: 0.25rem;
  word-break: break-word;
}

/* Light Theme Font Contrast Fixes */
.light-theme .podium-team-school-line {
  color: var(--text-secondary, #334155);
  opacity: 1;
  font-weight: 600;
}

.light-theme .podium-team-name-line {
  color: var(--text-primary, #0f172a);
}

.light-theme .winners-congrats-title {
  color: var(--color-gold, #d97706);
  text-shadow: 0 0 15px rgba(217, 119, 6, 0.25);
}

.light-theme .winners-event-subtitle {
  color: var(--text-primary, #0f172a);
}

.light-theme .winners-round-meta,
.light-theme .winners-date-text {
  color: var(--color-cyan, #0284c7);
}

.podium-pillar {
  border-radius: 1rem 1rem 0 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: inset 0 2px 10px rgba(255, 255, 255, 0.2), 0 15px 30px rgba(0,0,0,0.5);
}

.gold-pillar {
  height: 190px;
  background: linear-gradient(180deg, rgba(234, 179, 8, 0.65) 0%, rgba(161, 98, 7, 0.85) 100%);
  border: 2px solid #fde047;
}

.silver-pillar {
  height: 140px;
  background: linear-gradient(180deg, rgba(203, 213, 225, 0.55) 0%, rgba(71, 85, 105, 0.75) 100%);
  border: 2px solid #cbd5e1;
}

.bronze-pillar {
  height: 105px;
  background: linear-gradient(180deg, rgba(217, 119, 6, 0.55) 0%, rgba(120, 53, 15, 0.75) 100%);
  border: 2px solid #fb923c;
}

/* Larger Medal Icons (3.2rem - 4.5rem) */
.pillar-rank-badge {
  font-size: clamp(3.2rem, 4.5vw, 4.5rem);
  line-height: 1;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
}

.pillar-rank-title {
  font-weight: 800;
  font-size: 1.05rem;
  color: #ffffff;
  font-family: var(--font-title);
  text-shadow: 0 2px 4px rgba(0,0,0,0.6);
}

/* ==========================================================================
   THANK YOU STAGE SCREEN (ขอบคุณทีมเข้าร่วม)
   ========================================================================== */
.thank-you-stage-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: calc(100vh - 6rem);
  padding: 1.25rem 2rem 2rem 2rem;
  justify-content: flex-start;
  align-items: center;
  text-align: center;
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-lg);
  animation: fadeIn 0.8s ease-out;
}

/* Ambient glow orbs in background */
.thank-you-ambient-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  opacity: 0.25;
  z-index: 1;
}

.glow-1 {
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, #ff2e93, transparent 70%);
  top: -10%;
  left: -5%;
  animation: floatAmbient 18s ease-in-out infinite alternate;
}

.glow-2 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, #00e5ff, transparent 70%);
  bottom: -15%;
  right: -5%;
  animation: floatAmbient 22s ease-in-out infinite alternate-reverse;
}

.glow-3 {
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, #ffd700, transparent 70%);
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: floatAmbient 25s ease-in-out infinite alternate;
}

@keyframes floatAmbient {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(40px, 30px) scale(1.1); }
  100% { transform: translate(-30px, -20px) scale(0.95); }
}

/* Header */
.thank-you-header {
  position: relative;
  z-index: 15;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 1rem;
  padding: 0.65rem 2rem;
  background: rgba(10, 12, 24, 0.45);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  max-width: 92%;
}

.thank-you-org-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.1rem;
}

.thank-you-logo {
  height: 38px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.3));
}

.thank-you-org-name {
  font-size: clamp(1.05rem, 1.4vw, 1.35rem);
  font-weight: 700;
  color: #e2e8f0;
}

.thank-you-main-title {
  font-size: clamp(2.2rem, 3.8vw, 3.8rem);
  font-weight: 900;
  line-height: 1.2;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  background: linear-gradient(135deg, #ff60a8 0%, #ffd700 50%, #00e5ff 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 25px rgba(255, 96, 168, 0.4));
  letter-spacing: 0.5px;
}

.sparkle-icon {
  font-size: clamp(1.6rem, 2.6vw, 2.5rem);
  -webkit-text-fill-color: initial;
  display: inline-block;
  animation: sparkleTwinkle 2.5s infinite ease-in-out;
}

@keyframes sparkleTwinkle {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.9; }
  50% { transform: scale(1.25) rotate(15deg); opacity: 1; filter: drop-shadow(0 0 8px #ffd700); }
}

.thank-you-subtitle-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.thank-you-subtitle {
  font-size: clamp(1.6rem, 2.5vw, 2.5rem);
  font-weight: 800;
  color: #ffffff;
  margin: 0;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.thank-you-round-badge {
  background: rgba(0, 229, 255, 0.15);
  border: 1px solid rgba(0, 229, 255, 0.4);
  color: var(--color-cyan);
  font-size: clamp(1.0rem, 1.4vw, 1.3rem);
  font-weight: 700;
  padding: 0.2rem 0.9rem;
  border-radius: 999px;
}

/* Free-Roam Floating Bubbles Arena (Full Viewport Coverage) */
.floating-bubbles-arena-free {
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  pointer-events: none;
  z-index: 8;
}

/* Individual Free-Roam Floating Bubble */
.floating-bubble-free {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: auto;
  will-change: transform;
  transition: box-shadow 0.35s ease, filter 0.35s ease;
  user-select: none;
  cursor: pointer;
}

.floating-bubble-free:hover {
  filter: brightness(1.15);
  box-shadow: 0 0 35px rgba(255, 255, 255, 0.6) !important;
  z-index: 50;
}

/* 3D Glass Shine highlight on upper hemisphere */
.bubble-glass-shine {
  position: absolute;
  top: 6%;
  left: 15%;
  width: 70%;
  height: 40%;
  border-radius: 50% 50% 35% 35%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.05) 80%, transparent 100%);
  pointer-events: none;
}

.bubble-content-free {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.1rem;
}

.bubble-team-name-free {
  font-size: clamp(1.2rem, 1.6vw, 1.7rem);
  font-weight: 900;
  color: #ffffff;
  line-height: 1.25;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.75), 0 0 15px rgba(0, 0, 0, 0.45);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  text-align: center;
  letter-spacing: 0.3px;
}

/* 12 Modern Colorful Gradients */
.bubble-gradient-0 {
  background: radial-gradient(circle at 30% 30%, #ff6b8b, #ff416c 60%, #c81d45 100%);
  box-shadow: 0 12px 28px rgba(255, 65, 108, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-1 {
  background: radial-gradient(circle at 30% 30%, #38d6fd, #0099ff 60%, #0052cc 100%);
  box-shadow: 0 12px 28px rgba(0, 153, 255, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-2 {
  background: radial-gradient(circle at 30% 30%, #ff4fa8, #d81b60 60%, #880e4f 100%);
  box-shadow: 0 12px 28px rgba(216, 27, 96, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-3 {
  background: radial-gradient(circle at 30% 30%, #20e2d7, #00bfa5 60%, #00695c 100%);
  box-shadow: 0 12px 28px rgba(0, 191, 165, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-4 {
  background: radial-gradient(circle at 30% 30%, #ffab40, #ff6d00 60%, #d84315 100%);
  box-shadow: 0 12px 28px rgba(255, 109, 0, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-5 {
  background: radial-gradient(circle at 30% 30%, #b388ff, #7c4dff 60%, #4a148c 100%);
  box-shadow: 0 12px 28px rgba(124, 77, 255, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-6 {
  background: radial-gradient(circle at 30% 30%, #69f0ae, #00e676 60%, #1b5e20 100%);
  box-shadow: 0 12px 28px rgba(0, 230, 118, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-7 {
  background: radial-gradient(circle at 30% 30%, #ea80fc, #aa00ff 60%, #4a0072 100%);
  box-shadow: 0 12px 28px rgba(170, 0, 255, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-8 {
  background: radial-gradient(circle at 30% 30%, #ffd740, #ffab00 60%, #e65100 100%);
  box-shadow: 0 12px 28px rgba(255, 171, 0, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-9 {
  background: radial-gradient(circle at 30% 30%, #40c4ff, #0091ea 60%, #01579b 100%);
  box-shadow: 0 12px 28px rgba(0, 145, 234, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-10 {
  background: radial-gradient(circle at 30% 30%, #ff80ab, #f50057 60%, #880e4f 100%);
  box-shadow: 0 12px 28px rgba(245, 0, 87, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}
.bubble-gradient-11 {
  background: radial-gradient(circle at 30% 30%, #76ff03, #64dd17 60%, #2e7d32 100%);
  box-shadow: 0 12px 28px rgba(100, 221, 23, 0.45), inset 0 0 18px rgba(255, 255, 255, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.55);
}

/* 8 Slow Organic Floating Paths */
.float-anim-1 { animation-name: float-orbit-1; }
.float-anim-2 { animation-name: float-orbit-2; }
.float-anim-3 { animation-name: float-orbit-3; }
.float-anim-4 { animation-name: float-orbit-4; }
.float-anim-5 { animation-name: float-orbit-5; }
.float-anim-6 { animation-name: float-orbit-6; }
.float-anim-7 { animation-name: float-orbit-7; }
.float-anim-8 { animation-name: float-orbit-8; }

@keyframes float-orbit-1 {
  0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
  25% { transform: translate(30px, -35px) scale(1.04) rotate(2deg); }
  50% { transform: translate(-25px, -60px) scale(0.97) rotate(-2deg); }
  75% { transform: translate(35px, -20px) scale(1.02) rotate(1deg); }
}

@keyframes float-orbit-2 {
  0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
  25% { transform: translate(-35px, -25px) scale(0.96) rotate(-2deg); }
  50% { transform: translate(25px, -55px) scale(1.05) rotate(3deg); }
  75% { transform: translate(-20px, -35px) scale(1.01) rotate(-1deg); }
}

@keyframes float-orbit-3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(40px, 20px) scale(1.03); }
  66% { transform: translate(-35px, -45px) scale(0.97); }
}

@keyframes float-orbit-4 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(-35px, 30px) scale(1.04); }
  50% { transform: translate(30px, -40px) scale(0.96); }
  75% { transform: translate(-25px, -50px) scale(1.02); }
}

@keyframes float-orbit-5 {
  0%, 100% { transform: translate(0, 0) scale(0.98); }
  50% { transform: translate(20px, -65px) scale(1.04); }
}

@keyframes float-orbit-6 {
  0%, 100% { transform: translate(0, 0) scale(1.02); }
  30% { transform: translate(-40px, -30px) scale(0.96); }
  70% { transform: translate(35px, -50px) scale(1.03); }
}

@keyframes float-orbit-7 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  40% { transform: translate(30px, 35px) scale(1.03); }
  80% { transform: translate(-30px, -40px) scale(0.97); }
}

@keyframes float-orbit-8 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  20% { transform: translate(-20px, -40px) scale(1.03); }
  60% { transform: translate(25px, 25px) scale(0.97); }
  85% { transform: translate(-25px, -15px) scale(1.02); }
}

/* Light Theme Overrides for Thank You Screen */
.light-theme .thank-you-header {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(15, 23, 42, 0.15);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
}

.light-theme .thank-you-org-name {
  color: #334155;
}

.light-theme .thank-you-subtitle {
  color: #0f172a;
  text-shadow: none;
}

.light-theme .thank-you-round-badge {
  background: rgba(2, 132, 199, 0.12);
  border-color: rgba(2, 132, 199, 0.35);
  color: #0284c7;
}

.light-theme .thank-you-main-title {
  background: linear-gradient(135deg, #db2777 0%, #d97706 50%, #0284c7 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 2px 10px rgba(219, 39, 119, 0.25));
}

/* ==========================================
   SCOREBOARD ROTATING 14-TEAM STAGE STYLES
   ========================================== */
.scoreboard-stage-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.25rem 2rem 1.25rem 2rem;
  justify-content: flex-start;
  position: relative;
  z-index: 20;
}

.scoreboard-stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
  flex-wrap: nowrap;
  gap: 1rem;
}

.scoreboard-header-title-box {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.scoreboard-main-title {
  font-size: clamp(2rem, 3.2vw, 2.75rem);
  font-weight: 900;
  color: var(--color-cyan, #00e5ff);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-shadow: 0 0 20px rgba(0, 229, 255, 0.45);
}

.scoreboard-title-icon {
  font-size: clamp(1.8rem, 2.8vw, 2.5rem);
}

.scoreboard-round-badge {
  background: rgba(255, 215, 0, 0.15);
  border: 1.5px solid rgba(255, 215, 0, 0.45);
  color: #ffd700;
  font-size: clamp(1.1rem, 1.5vw, 1.35rem);
  font-weight: 700;
  padding: 0.35rem 1rem;
  border-radius: 9999px;
  box-shadow: 0 0 12px rgba(255, 215, 0, 0.2);
}

.scoreboard-pagination-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.page-counter-badge {
  background: rgba(0, 229, 255, 0.18);
  border: 1.5px solid rgba(0, 229, 255, 0.45);
  color: #00e5ff;
  font-size: clamp(1.1rem, 1.5vw, 1.35rem);
  font-weight: 700;
  padding: 0.35rem 1.1rem;
  border-radius: 9999px;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.25);
}

.page-counter-badge strong {
  font-size: 1.25em;
  color: #ffffff;
}

.team-range-badge {
  color: #94a3b8;
  font-size: clamp(0.95rem, 1.3vw, 1.15rem);
  font-weight: 600;
}

.scoreboard-cycle-progress-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.85rem;
}

.scoreboard-cycle-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #00e5ff, #ffd700);
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
  width: 0%;
  animation: progressFillScoreboard 6s linear forwards;
}

@keyframes progressFillScoreboard {
  0% { width: 0%; }
  100% { width: 100%; }
}

.no-teams-scoreboard {
  font-size: 1.5rem;
  color: #64748b;
  text-align: center;
  padding: 4rem;
}

.scoreboard-grid-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  justify-content: center;
}

.scoreboard-grid-14 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(7, 1fr);
  gap: 0.55rem 1.15rem;
  height: 100%;
}

.scoreboard-team-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 1.15rem;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(12px);
  border: 1.5px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.85rem;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  transition: all 0.25s ease;
  min-height: 0;
}

.scoreboard-card-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
  flex: 1;
}

.scoreboard-team-num-badge {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.25), rgba(0, 150, 255, 0.35));
  border: 1.5px solid #00e5ff;
  color: #ffffff;
  font-weight: 800;
  font-size: clamp(1.15rem, 1.6vw, 1.45rem);
  padding: 0.25rem 0.75rem;
  border-radius: 0.65rem;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.3);
}

.scoreboard-team-name-box {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.scoreboard-team-name {
  font-size: clamp(1.2rem, 1.75vw, 1.6rem);
  font-weight: 800;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.scoreboard-school-name {
  font-size: clamp(0.9rem, 1.2vw, 1.05rem);
  color: #94a3b8;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.scoreboard-card-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
  margin-left: 0.75rem;
}

.scoreboard-score-badge {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  background: rgba(255, 215, 0, 0.15);
  border: 1.5px solid rgba(255, 215, 0, 0.5);
  padding: 0.25rem 0.85rem;
  border-radius: 0.75rem;
  box-shadow: 0 0 14px rgba(255, 215, 0, 0.25);
}

.scoreboard-score-num {
  font-size: clamp(1.85rem, 2.8vw, 2.5rem);
  font-weight: 900;
  color: #ffd700;
  line-height: 1;
  text-shadow: 0 0 15px rgba(255, 215, 0, 0.5);
}

.scoreboard-score-unit {
  font-size: clamp(0.9rem, 1.2vw, 1.05rem);
  font-weight: 700;
  color: #e2e8f0;
}

.scoreboard-tiebreak-pill {
  background: rgba(255, 46, 147, 0.2);
  border: 1px solid rgba(255, 46, 147, 0.45);
  color: #ff60a8;
  font-size: 0.85rem;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 0.5rem;
  white-space: nowrap;
}

/* Transitions */
.scoreboard-page-fade-enter-active,
.scoreboard-page-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.scoreboard-page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.99);
}

.scoreboard-page-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.99);
}

/* Light Theme Overrides for Scoreboard Screen */
.light-theme .scoreboard-main-title {
  color: #0284c7;
  text-shadow: none;
}

.light-theme .scoreboard-round-badge {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  color: #b45309;
  box-shadow: none;
}

.light-theme .page-counter-badge {
  background: rgba(2, 132, 199, 0.12);
  border-color: rgba(2, 132, 199, 0.35);
  color: #0284c7;
  box-shadow: none;
}

.light-theme .page-counter-badge strong {
  color: #0284c7;
}

.light-theme .team-range-badge {
  color: #475569;
}

.light-theme .scoreboard-cycle-progress-track {
  background: rgba(15, 23, 42, 0.1);
}

.light-theme .scoreboard-cycle-progress-bar {
  background: linear-gradient(90deg, #0284c7, #d97706);
  box-shadow: none;
}

.light-theme .scoreboard-team-card {
  background: rgba(255, 255, 255, 0.95);
  border-color: rgba(15, 23, 42, 0.14);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
}

.light-theme .scoreboard-team-name {
  color: #0f172a;
  text-shadow: none;
}

.light-theme .scoreboard-school-name {
  color: #64748b;
}

.light-theme .scoreboard-team-num-badge {
  background: linear-gradient(135deg, #0284c7, #0369a1);
  border-color: #0284c7;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(2, 132, 199, 0.25);
}

.light-theme .scoreboard-score-badge {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.35);
  box-shadow: none;
}

.light-theme .scoreboard-score-num {
  color: #b45309;
  text-shadow: none;
}

.light-theme .scoreboard-score-unit {
  color: #334155;
}

.light-theme .scoreboard-tiebreak-pill {
  background: rgba(236, 72, 153, 0.12);
  border-color: rgba(236, 72, 153, 0.35);
  color: #be185d;
}
</style>

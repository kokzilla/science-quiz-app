<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useTheme } from '~/composables/useTheme'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  Tv, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight,
  Pause,
  Play,
  Sun,
  Moon
} from 'lucide-vue-next'
import type { Team, Answer, Question } from '~/types'

const { theme, toggleTheme } = useTheme()
const route = useRoute()
const { supabase, isConfigured } = useSupabase()

const sortBy = ref<'score' | 'team'>('team')
const teams = ref<Team[]>([])
const answers = ref<Answer[]>([])
const questions = ref<Question[]>([])

const loading = ref(true)
const errorMsg = ref('')
const soundEnabled = ref(false)

// Realtime subscriptions references
let answersChannel: any = null
let roundsChannel: any = null
let teamsChannel: any = null

// Smooth Auto-Scrolling State for all teams
const isAutoScrolling = ref(true)
let scrollAnimId: number | null = null
let isPausedForLoop = false
let loopTimeout: any = null
let scrollPos = 0
const scrollSpeed = 0.48 // pixels per frame (smooth, balanced readable scroll)

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!roundId) return
  loading.value = true
  await loadScoreboardData(roundId)
  setupRealtimeSubscriptions(roundId)
}

// Using useRoundSelector composable
const {
  selectedRoundId,
  roundsList,
  currentRound,
  handleRoundChange
} = useRoundSelector(onRoundChanged)

const getMaxScroll = () => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 0
  const doc = document.documentElement
  const body = document.body
  const scrollHeight = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0)
  const clientHeight = window.innerHeight || (doc ? doc.clientHeight : 0)
  return Math.max(0, scrollHeight - clientHeight)
}

const startSmoothScroll = () => {
  stopSmoothScroll()
  if (!isAutoScrolling.value || typeof window === 'undefined') return

  scrollPos = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
  let lastTime = performance.now()

  const step = (time: number) => {
    if (!isAutoScrolling.value) return

    const delta = time - lastTime
    lastTime = time

    if (!isPausedForLoop) {
      const maxScroll = getMaxScroll()

      if (maxScroll > 15) {
        if (scrollPos >= maxScroll - 4) {
          // Reached bottom: Pause at bottom for 3.5s so viewers can see the final teams
          isPausedForLoop = true
          loopTimeout = setTimeout(() => {
            if (!isAutoScrolling.value) {
              isPausedForLoop = false
              return
            }
            // Smoothly scroll back to top
            scrollPos = 0
            window.scrollTo({ top: 0, behavior: 'smooth' })
            
            // Pause at top for 3.0s before restarting scroll down
            loopTimeout = setTimeout(() => {
              isPausedForLoop = false
              scrollPos = 0
              lastTime = performance.now()
              if (isAutoScrolling.value) {
                scrollAnimId = requestAnimationFrame(step)
              }
            }, 3000)
          }, 3500)
          return
        } else {
          // Scroll down continuously using float accumulator so sub-pixel values don't get truncated
          const moveBy = scrollSpeed * Math.min(delta / 16.67, 3)
          scrollPos += moveBy
          window.scrollTo(0, scrollPos)
        }
      }
    }

    if (isAutoScrolling.value) {
      scrollAnimId = requestAnimationFrame(step)
    }
  }

  scrollAnimId = requestAnimationFrame(step)
}

const stopSmoothScroll = () => {
  if (scrollAnimId) {
    cancelAnimationFrame(scrollAnimId)
    scrollAnimId = null
  }
  if (loopTimeout) {
    clearTimeout(loopTimeout)
    loopTimeout = null
  }
  isPausedForLoop = false
}

const toggleAutoScroll = () => {
  isAutoScrolling.value = !isAutoScrolling.value
  if (isAutoScrolling.value) {
    startSmoothScroll()
  } else {
    stopSmoothScroll()
  }
}

watch([sortBy, selectedRoundId, loading], () => {
  if (typeof window !== 'undefined') {
    scrollPos = 0
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  if (isAutoScrolling.value) {
    stopSmoothScroll()
    setTimeout(() => {
      startSmoothScroll()
    }, 1500)
  }
})

onMounted(() => {
  setTimeout(() => {
    startSmoothScroll()
  }, 1200)
})

onUnmounted(() => {
  cleanupSubscriptions()
  stopSmoothScroll()
})

const cleanupSubscriptions = () => {
  if (answersChannel && supabase.value) supabase.value.removeChannel(answersChannel)
  if (roundsChannel && supabase.value) supabase.value.removeChannel(roundsChannel)
  if (teamsChannel && supabase.value) supabase.value.removeChannel(teamsChannel)
}

const loadScoreboardData = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  
  try {
    // 1. Fetch all teams in round
    const { data: tData, error: tErr } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
    
    if (tErr) throw tErr
    teams.value = tData as Team[]

    // 2. Fetch correct answer keys (questions)
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
    questions.value = (qData || []) as Question[]

    // 3. Fetch all answers for these teams
    if (tData && tData.length > 0) {
      const teamIds = tData.map(t => t.id)
      const { data: aData } = await supabase.value
        .from('answers')
        .select('*')
        .in('team_id', teamIds)
      
      answers.value = (aData || []) as Answer[]
    } else {
      answers.value = []
    }
    
    errorMsg.value = ''
  } catch (err: any) {
    console.error('Error loading scoreboard data:', err)
    errorMsg.value = `โหลดข้อมูลบอร์ดคะแนนล้มเหลว: ${err.message}`
  } finally {
    loading.value = false
  }
}

// Synthesize pleasant chime using Web Audio API (completely offline-first)
const playChimeSound = () => {
  if (!soundEnabled.value) return
  if (typeof window === 'undefined') return
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, start)
      
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.2, start + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.start(start)
      osc.stop(start + duration)
    }
    
    const now = ctx.currentTime
    // Double bell chime (E6 then A6)
    playTone(1318.51, now, 0.8)
    playTone(1760.00, now + 0.12, 1.2)
  } catch (e) {
    console.error('Failed to play synthesized sound:', e)
  }
}

// Setup real-time listeners for updates
const setupRealtimeSubscriptions = (roundId: string) => {
  if (!supabase.value || !roundId) return

  cleanupSubscriptions()

  // 1. Listen to answers changes
  answersChannel = supabase.value
    .channel('scoreboard-answers')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'answers' 
    }, (payload: any) => {
      const updated = payload.new as any
      const deleted = payload.old as any
      
      if (payload.eventType === 'INSERT') {
        answers.value.push(updated)
        playChimeSound()
      } else if (payload.eventType === 'UPDATE') {
        const idx = answers.value.findIndex(a => a.id === updated.id)
        if (idx > -1) {
          answers.value[idx] = updated
        } else {
          answers.value.push(updated)
        }
        playChimeSound()
      } else if (payload.eventType === 'DELETE') {
        answers.value = answers.value.filter(a => a.id !== deleted.id)
      }
    })
    .subscribe()

  // 2. Listen to round configuration changes (revealed question number)
  roundsChannel = supabase.value
    .channel('scoreboard-rounds')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'rounds',
      filter: `id=eq.${roundId}`
    }, (payload: any) => {
      currentRound.value = payload.new
      playChimeSound()
    })
    .subscribe()

  // 3. Listen to teams changes (tie_breaker score modifications)
  teamsChannel = supabase.value
    .channel('scoreboard-teams')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'teams',
      filter: `round_id=eq.${roundId}`
    }, () => {
      loadScoreboardData(roundId)
    })
    .subscribe()
}

// ==========================================
// SCORING & LEADERBOARD LOGIC
// ==========================================
const leaderboard = computed(() => {
  if (!currentRound.value || teams.value.length === 0) return []

  const revQuestion = currentRound.value.revealed_question_number

  // Map each team with their score calculated UP TO the revealed question number
  const teamScores = teams.value.map(team => {
    // Filter answers for this team that are <= revealed question and correct
    const correctCount = answers.value.filter(ans => {
      return ans.team_id === team.id && 
             ans.question_number <= revQuestion && 
             ans.is_correct
    }).length

    const finalScore = correctCount + team.tie_breaker_score

    // Detail answers map for rendering dots on TV board
    const answersDetail = Array.from({ length: Math.min(TOTAL_QUESTIONS, revQuestion) }, (_, idx) => {
      const qNum = idx + 1
      const ansRow = answers.value.find(a => a.team_id === team.id && a.question_number === qNum)
      return {
        question_number: qNum,
        submitted: !!ansRow?.submitted_answer,
        is_correct: !!ansRow?.is_correct
      }
    })

    return {
      ...team,
      correctCount,
      finalScore,
      answersDetail
    }
  })

  // Sort: 1) finalScore DESC, 2) tie_breaker_score DESC, 3) team_number ASC
  teamScores.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore
    if (b.tie_breaker_score !== a.tie_breaker_score) return b.tie_breaker_score - a.tie_breaker_score
    return a.team_number - b.team_number
  })

  // Assign Ranks (tied scores share rank)
  let currentRank = 1
  const rankedTeams = teamScores.map((t, idx) => {
    if (idx > 0 && t.finalScore < teamScores[idx - 1].finalScore) {
      currentRank = idx + 1
    }
    return {
      ...t,
      rank: currentRank
    }
  })

  // If sorting by team number, sort the ranked list by team_number ASC
  if (sortBy.value === 'team') {
    rankedTeams.sort((a, b) => a.team_number - b.team_number)
  }

  return rankedTeams
})

const formatSchoolName = (schoolName?: string) => {
  if (!schoolName) return ''
  const trimmed = schoolName.trim()
  if (trimmed.startsWith('โรงเรียน')) return trimmed
  return `โรงเรียน${trimmed}`
}
</script>

<template>
  <div class="scoreboard-view">
    
    <!-- Audio controls & Setup Info (floating no-print controls) -->
    <div class="no-print controls-floating-bar">
      <button @click="toggleTheme" class="btn btn-secondary round-icon-btn" :title="theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'">
        <Sun v-if="theme === 'light'" :size="18" />
        <Moon v-else :size="18" />
      </button>

      <div class="control-pill-dropdown">
        <span class="pill-label">เลือกรอบ:</span>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="pill-dropdown-select">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">
            {{ r.name }}
          </option>
        </select>
      </div>

      <div class="control-pill-group">
        <span class="pill-label">เรียงลำดับ:</span>
        <button @click="sortBy = 'score'" class="btn pill-btn" :class="{ active: sortBy === 'score' }">
          คะแนน
        </button>
        <button @click="sortBy = 'team'" class="btn pill-btn" :class="{ active: sortBy === 'team' }">
          เลขทีม
        </button>
      </div>

      <div class="control-pill-group">
        <span class="pill-label">เลื่อนอัตโนมัติ:</span>
        <button @click="toggleAutoScroll" class="btn pill-btn play-pause-btn">
          <Pause v-if="isAutoScrolling" :size="12" />
          <Play v-else :size="12" />
          <span>{{ isAutoScrolling ? 'เปิด' : 'หยุด' }}</span>
        </button>
      </div>
    </div>

    <!-- Error state -->
    <div v-if="!isConfigured || errorMsg" class="glass-card error-card">
      <AlertCircle :size="64" class="text-error warning-icon" />
      <h2 class="error-title">เกิดข้อผิดพลาดในการโหลดบอร์ด</h2>
      <p class="error-desc">
        {{ errorMsg || 'กรุณาเชื่อมต่อฐานข้อมูลในหน้าแรกของเครื่องโฮสต์ก่อน' }}
      </p>
      <NuxtLink to="/" class="btn btn-primary no-print">ไปหน้าตั้งค่า</NuxtLink>
    </div>

    <div v-else-if="loading" class="loading-state">
      <div class="loading-spin"></div>
      <p>กำลังเตรียมข้อมูลถ่ายทอดสด...</p>
    </div>

    <!-- Main Scoreboard TV Layout -->
    <template v-else-if="currentRound">
      
      <!-- TV Leaderboard Table -->
      <div class="scoreboard-grid">
        <div v-if="leaderboard.length === 0" class="empty-scoreboard-prompt">
          ไม่มีทีมเข้าแข่งในระบบ
        </div>

        <div v-else class="scoreboard-grid-container">
          <div 
            v-for="item in leaderboard" 
            :key="item.id"
            class="scoreboard-row"
            :class="`rank-${item.rank}`"
          >
            <!-- Left: Team number badge -->
            <div class="team-no">
              ทีมที่ {{ item.team_number }}
            </div>

            <!-- Center: Team Name & School Name -->
            <div class="team-name">
              <div class="team-name-text" :title="item.name">{{ item.name }}</div>
              <div v-if="item.school_name && item.school_name !== item.name" class="team-school-text" :title="formatSchoolName(item.school_name)">
                {{ formatSchoolName(item.school_name) }}
              </div>
              <div v-if="item.tie_breaker_score > 0" class="status-pill-tiebreak">
                ไทเบรก +{{ item.tie_breaker_score }}
              </div>
            </div>

            <!-- Right: Score badge & Rank badge -->
            <div class="scoreboard-card-right">
              <div class="team-score">
                <span class="score-num">{{ item.finalScore }}</span>
                <span class="score-label">คะแนน</span>
              </div>

              <div class="rank-badge">
                ลำดับที่ {{ item.rank }}
              </div>
            </div>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.controls-floating-bar {
  position: fixed; 
  top: 1rem; 
  right: 1.5rem; 
  display: flex; 
  gap: 0.5rem; 
  z-index: 100; 
  flex-wrap: wrap;
}

.round-icon-btn {
  padding: 0.5rem; 
  border-radius: 50%; 
  width: 42px; 
  height: 42px; 
  display: flex; 
  align-items: center; 
  justify-content: center;
}

.text-muted { color: var(--text-muted); }
.text-error { color: var(--color-error); }
.text-cyan { color: var(--color-cyan); }
.text-warning { color: var(--color-warning); }

.font-bold { font-weight: 700; }

.control-pill-dropdown {
  background: rgba(0,0,0,0.5); 
  padding: 0.25rem 0.75rem; 
  border-radius: 20px; 
  font-size: 0.85rem; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  border: 1px solid var(--glass-border);
}

.pill-label {
  color: #fff;
}

.pill-dropdown-select {
  background: var(--bg-tertiary); 
  color: var(--text-primary); 
  border: none; 
  font-size: 0.8rem; 
  border-radius: 4px; 
  padding: 0.25rem 0.5rem; 
  outline: none; 
  cursor: pointer; 
  max-width: 150px;
}

.pill-dropdown-select option {
  color: var(--text-primary); 
  background: var(--bg-secondary);
}

.control-pill-group {
  background: rgba(0,0,0,0.5); 
  padding: 0.25rem 0.75rem; 
  border-radius: 20px; 
  font-size: 0.85rem; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  border: 1px solid var(--glass-border);
}

.pill-btn {
  background: var(--bg-tertiary); 
  color: var(--text-primary);
  padding: 0.25rem 0.6rem; 
  font-size: 0.8rem; 
  border: none; 
  border-radius: 4px; 
  cursor: pointer;
}

.pill-btn.active {
  background: var(--color-cyan); 
  color: #000; 
  font-weight: 700;
}

.play-pause-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.error-card {
  max-width: 500px; 
  margin: auto; 
  text-align: center;
}

.warning-icon {
  margin-bottom: 1.5rem;
}

.error-title {
  font-size: 1.5rem; 
  margin-bottom: 0.5rem; 
  color: #fff;
}

.error-desc {
  color: var(--text-secondary); 
  margin-bottom: 2rem;
}

.loading-state {
  margin: auto; 
  text-align: center; 
  color: var(--text-secondary);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-spin {
  width: 50px; 
  height: 50px; 
  border: 4px solid var(--color-cyan); 
  border-top-color: transparent; 
  border-radius: 50%; 
  margin: 0 auto 1.5rem;
  animation: spin 1.2s linear infinite;
  box-shadow: var(--shadow-neon-cyan);
}

.empty-scoreboard-prompt {
  text-align: center; 
  padding: 5rem; 
  color: var(--text-secondary); 
  font-size: 1.5rem;
}

.scoreboard-view {
  position: relative;
  min-height: 100vh;
  padding: 4.5rem 1.25rem 4rem 1.25rem;
  width: 100%;
  max-width: 100vw;
  box-sizing: border-box;
  overflow-x: hidden;
}

.scoreboard-header {
  position: sticky;
  top: 0;
  z-index: 40;
  padding: 1.25rem 1rem 1rem 1rem;
  margin-top: 0;
  background: rgba(10, 12, 22, 0.92);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--glass-border);
  margin-bottom: 1.5rem;
  text-align: center;
}

.scoreboard-title {
  font-size: clamp(2.2rem, 3.5vw, 3.8rem);
  font-weight: 900;
  text-transform: uppercase;
  background: linear-gradient(to right, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.35rem;
  text-shadow: 0 0 25px rgba(0, 229, 255, 0.3);
}

.scoreboard-subtitle {
  font-size: clamp(1.15rem, 1.5vw, 1.65rem);
  color: var(--text-secondary);
  font-family: var(--font-title);
  letter-spacing: 0.05em;
}

.scoreboard-grid-container {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-content: start;
  padding-bottom: 6rem;
  width: 100%;
  box-sizing: border-box;
}

@media (max-width: 1100px) {
  .scoreboard-grid-container {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.85rem;
  }
}

.scoreboard-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: clamp(0.6rem, 1vw, 1.2rem);
  padding: clamp(0.8rem, 1.3vh, 1.15rem) clamp(0.9rem, 1.4vw, 1.5rem);
  background: rgba(15, 23, 42, 0.82);
  backdrop-filter: blur(14px);
  border: 2px solid rgba(255, 255, 255, 0.16);
  border-radius: 1.15rem;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  transition: all 0.25s ease;
  min-width: 0;
  box-sizing: border-box;
}

.team-no {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.35), rgba(0, 150, 255, 0.45));
  border: 2px solid #00e5ff;
  color: #ffffff;
  font-weight: 900;
  font-size: clamp(1.5rem, 2.0vw, 2.3rem);
  padding: 0.4rem 0.9rem;
  border-radius: 0.85rem;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.4);
  text-align: center;
}

.team-name {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.2rem;
}

.team-name-text {
  font-size: clamp(1.55rem, 2.1vw, 2.4rem);
  font-weight: 900;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}

.team-school-text {
  font-size: clamp(1.05rem, 1.35vw, 1.45rem);
  color: #94a3b8;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.status-pill-tiebreak {
  display: inline-block;
  align-self: flex-start;
  background: rgba(255, 46, 147, 0.25);
  border: 1.5px solid rgba(255, 46, 147, 0.55);
  color: #ff60a8;
  font-size: clamp(0.9rem, 1.1vw, 1.2rem);
  font-weight: 800;
  padding: 0.15rem 0.55rem;
  border-radius: 0.45rem;
  margin-top: 0.15rem;
  white-space: nowrap;
}

.scoreboard-card-right {
  display: flex;
  align-items: center;
  gap: clamp(0.5rem, 0.8vw, 0.9rem);
  flex-shrink: 0;
}

.team-score {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  background: rgba(255, 215, 0, 0.18);
  border: 2px solid rgba(255, 215, 0, 0.6);
  padding: 0.35rem 0.95rem;
  border-radius: 0.9rem;
  box-shadow: 0 0 16px rgba(255, 215, 0, 0.35);
  flex-shrink: 0;
}

.score-num {
  font-size: clamp(2.4rem, 3.4vw, 3.8rem);
  font-weight: 950;
  color: #ffd700;
  line-height: 1;
  text-shadow: 0 0 20px rgba(255, 215, 0, 0.65);
}

.score-label {
  font-size: clamp(1.05rem, 1.3vw, 1.45rem);
  font-weight: 800;
  color: #e2e8f0;
}

.rank-badge {
  padding: 0.4rem 0.9rem;
  border-radius: 9999px;
  font-weight: 800;
  font-size: clamp(1.05rem, 1.3vw, 1.4rem);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  white-space: nowrap;
  text-align: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.sort-highlight {
  display: inline-block;
  background: rgba(0, 229, 255, 0.12);
  border: 1px solid rgba(0, 229, 255, 0.3);
  padding: 0.15rem 0.6rem;
  border-radius: 6px;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.15);
  margin: 0 0.25rem;
}
</style>

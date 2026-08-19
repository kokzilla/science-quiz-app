<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useTheme } from '~/composables/useTheme'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { useAnswers } from '~/composables/useAnswers'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  AlertCircle, 
  Pause,
  Play,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Radio
} from 'lucide-vue-next'
import type { Team, Answer, Question } from '~/types'

const { theme, toggleTheme } = useTheme()
const route = useRoute()
const { supabase, isConfigured } = useSupabase()
const { fetchAllRoundAnswers } = useAnswers()

const sortBy = ref<'score' | 'team'>('score')
const teams = ref<Team[]>([])
const answers = ref<Answer[]>([])
const questions = ref<Question[]>([])

const loading = ref(true)
const errorMsg = ref('')
const soundEnabled = ref(false)

// Set of team IDs that recently received a real-time update (for flash animation)
const recentlyUpdatedTeams = ref<Set<string>>(new Set())
const updateTimeouts = new Map<string, any>()

const flashUpdatedTeam = (teamId: string) => {
  if (!teamId) return
  recentlyUpdatedTeams.value.add(teamId)
  
  if (updateTimeouts.has(teamId)) {
    clearTimeout(updateTimeouts.get(teamId))
  }
  
  const timer = setTimeout(() => {
    recentlyUpdatedTeams.value.delete(teamId)
    updateTimeouts.delete(teamId)
  }, 1600)
  
  updateTimeouts.set(teamId, timer)
}

// Realtime subscriptions references
let answersChannel: any = null
let roundsChannel: any = null
let teamsChannel: any = null
let questionsChannel: any = null

// Smooth Auto-Scrolling State for all teams
const isAutoScrolling = ref(true)
let scrollAnimId: number | null = null
let isPausedForLoop = false
let loopTimeout: any = null
const scrollSpeed = 0.85 // pixels per frame (smooth slow scroll)

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

const startSmoothScroll = () => {
  stopSmoothScroll()
  if (!isAutoScrolling.value || typeof window === 'undefined') return

  let lastTime = performance.now()

  const step = (time: number) => {
    if (!isAutoScrolling.value) return

    const delta = time - lastTime
    lastTime = time

    if (!isPausedForLoop) {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight

      if (maxScroll > 20) {
        const currentScroll = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
        
        if (currentScroll >= maxScroll - 3) {
          // Reached bottom: Pause at bottom for 3.5s so viewers can see the final teams
          isPausedForLoop = true
          loopTimeout = setTimeout(() => {
            if (!isAutoScrolling.value) {
              isPausedForLoop = false
              return
            }
            // Smoothly scroll back to top
            window.scrollTo({ top: 0, behavior: 'smooth' })
            
            // Pause at top for 3s before restarting scroll down
            loopTimeout = setTimeout(() => {
              isPausedForLoop = false
              lastTime = performance.now()
              if (isAutoScrolling.value) {
                scrollAnimId = requestAnimationFrame(step)
              }
            }, 3000)
          }, 3500)
          return
        } else {
          // Scroll down continuously
          const moveBy = scrollSpeed * Math.min(delta / 16.67, 3)
          window.scrollBy(0, moveBy)
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

watch([sortBy, selectedRoundId], () => {
  if (typeof window !== 'undefined') {
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
  updateTimeouts.forEach(t => clearTimeout(t))
  updateTimeouts.clear()
})

const cleanupSubscriptions = () => {
  if (answersChannel && supabase.value) {
    supabase.value.removeChannel(answersChannel)
    answersChannel = null
  }
  if (roundsChannel && supabase.value) {
    supabase.value.removeChannel(roundsChannel)
    roundsChannel = null
  }
  if (teamsChannel && supabase.value) {
    supabase.value.removeChannel(teamsChannel)
    teamsChannel = null
  }
  if (questionsChannel && supabase.value) {
    supabase.value.removeChannel(questionsChannel)
    questionsChannel = null
  }
}

const loadScoreboardData = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  
  try {
    // 1. Fetch all teams in round
    const { data: tData, error: tErr } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
      .order('team_number', { ascending: true })
    
    if (tErr) throw tErr
    teams.value = (tData || []) as Team[]

    // 2. Fetch correct answer keys (questions)
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
      .order('question_number', { ascending: true })
    questions.value = (qData || []) as Question[]

    // 3. Fetch all answers for these teams
    if (tData && tData.length > 0) {
      const teamIds = tData.map(t => t.id)
      answers.value = await fetchAllRoundAnswers(roundId, teamIds)
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

  // 1. Listen to answers changes in real-time
  answersChannel = supabase.value
    .channel('scoreboard-answers-channel')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'answers' 
    }, (payload: any) => {
      const updated = payload.new as any
      const deleted = payload.old as any
      
      if (payload.eventType === 'INSERT') {
        const idx = answers.value.findIndex(a => a.id === updated.id)
        if (idx > -1) {
          answers.value.splice(idx, 1, updated)
        } else {
          answers.value.push(updated)
        }
        flashUpdatedTeam(updated.team_id)
        playChimeSound()
      } else if (payload.eventType === 'UPDATE') {
        const idx = answers.value.findIndex(a => a.id === updated.id)
        if (idx > -1) {
          answers.value.splice(idx, 1, updated)
        } else {
          answers.value.push(updated)
        }
        flashUpdatedTeam(updated.team_id)
        playChimeSound()
      } else if (payload.eventType === 'DELETE') {
        answers.value = answers.value.filter(a => a.id !== deleted.id)
      }
    })
    .subscribe()

  // 2. Listen to round configuration changes
  roundsChannel = supabase.value
    .channel('scoreboard-rounds-channel')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'rounds',
      filter: `id=eq.${roundId}`
    }, (payload: any) => {
      currentRound.value = payload.new
    })
    .subscribe()

  // 3. Listen to teams changes (tie_breaker score modifications, name edits, additions)
  teamsChannel = supabase.value
    .channel('scoreboard-teams-channel')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'teams',
      filter: `round_id=eq.${roundId}`
    }, () => {
      loadScoreboardData(roundId)
    })
    .subscribe()

  // 4. Listen to questions changes (correct answer changes)
  questionsChannel = supabase.value
    .channel('scoreboard-questions-channel')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'questions',
      filter: `round_id=eq.${roundId}`
    }, () => {
      loadScoreboardData(roundId)
    })
    .subscribe()
}

// ==========================================
// SCORING & LEADERBOARD LOGIC (REAL-TIME)
// ==========================================
const leaderboard = computed(() => {
  if (!currentRound.value || teams.value.length === 0) return []

  // Build map of correct answers from questions for instant evaluation fallback
  const answerKeyMap = new Map<number, string>()
  questions.value.forEach(q => {
    if (q.correct_answer) {
      answerKeyMap.set(q.question_number, q.correct_answer)
    }
  })

  // Calculate real-time scores for all teams
  const teamScores = teams.value.map(team => {
    const teamAnswers = answers.value.filter(ans => ans.team_id === team.id)
    let correctCount = 0
    let answeredCount = 0

    teamAnswers.forEach(ans => {
      if (ans.submitted_answer) {
        answeredCount++
        if (ans.is_correct) {
          correctCount++
        } else {
          const expected = answerKeyMap.get(ans.question_number)
          if (expected && ans.submitted_answer === expected) {
            correctCount++
          }
        }
      }
    })

    const finalScore = correctCount + (team.tie_breaker_score || 0)

    return {
      ...team,
      correctCount,
      answeredCount,
      finalScore
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

      <button @click="soundEnabled = !soundEnabled" class="btn btn-secondary round-icon-btn" :title="soundEnabled ? 'ปิดเสียงแจ้งเตือนคะแนน' : 'เปิดเสียงแจ้งเตือนคะแนน'">
        <Volume2 v-if="soundEnabled" :size="18" class="text-cyan" />
        <VolumeX v-else :size="18" />
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
      
      <!-- Top Title Bar (Sticky at top) -->
      <div class="scoreboard-header">
        <div class="scoreboard-header-top">
          <h1 class="scoreboard-title">Scoreboard การแข่งขัน {{ currentRound.name }}</h1>
          <div class="live-status-pill">
            <span class="live-dot"></span>
            <span class="live-text">ถ่ายทอดสดแบบ REALTIME</span>
          </div>
        </div>
        <div class="scoreboard-subtitle">
          ผลคะแนนสะสมแบบเรียลไทม์
          - <span class="sort-highlight">เรียงลำดับตาม <span class="text-cyan font-bold">{{ sortBy === 'score' ? 'คะแนนสูงสุด' : 'หมายเลขทีม' }}</span></span>
          - รวมทั้งสิ้น {{ leaderboard.length }} ทีม (เลื่อนหน้าจออัตโนมัติ)
        </div>
      </div>

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
            :class="[`rank-${item.rank}`, { 'score-updated-flash': recentlyUpdatedTeams.has(item.id) }]"
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
  padding: 1rem 1.25rem 4rem 1.25rem;
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
  background: rgba(10, 12, 22, 0.94);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--glass-border);
  margin-bottom: 1.5rem;
  text-align: center;
}

.scoreboard-header-top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.live-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: rgba(0, 230, 118, 0.15);
  border: 1.5px solid var(--color-success);
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  box-shadow: 0 0 12px rgba(0, 230, 118, 0.3);
}

.live-dot {
  width: 10px;
  height: 10px;
  background-color: var(--color-success);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--color-success);
  animation: pulse-dot 1.4s ease-in-out infinite;
}

@keyframes pulse-dot {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.7; }
}

.live-text {
  font-size: 0.85rem;
  font-weight: 800;
  color: var(--color-success);
  letter-spacing: 0.06em;
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
  transition: all 0.3s ease;
  min-width: 0;
  box-sizing: border-box;
}

/* Flash animation on real-time score update */
.score-updated-flash {
  animation: flash-pulse 1.5s ease-out;
}

@keyframes flash-pulse {
  0% {
    transform: scale(1.02);
    border-color: var(--color-cyan);
    box-shadow: 0 0 35px rgba(0, 229, 255, 0.8);
  }
  50% {
    transform: scale(1.01);
    border-color: var(--color-cyan);
    box-shadow: 0 0 20px rgba(0, 229, 255, 0.4);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }
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

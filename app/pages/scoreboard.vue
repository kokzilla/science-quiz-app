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
  Volume2, 
  VolumeX, 
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

const sortBy = ref<'score' | 'team'>('score')
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

// Pagination / Scrolling State for 30-40 teams
const currentPage = ref(0)
const teamsPerPage = 10
const isAutoScrolling = ref(true)
let scrollInterval: any = null

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

onMounted(() => {
  // Auto-scrolling timer
  startScrollTimer()
})

onUnmounted(() => {
  cleanupSubscriptions()
  stopScrollTimer()
})

const startScrollTimer = () => {
  stopScrollTimer()
  scrollInterval = setInterval(() => {
    if (isAutoScrolling.value && totalPages.value > 1) {
      currentPage.value = (currentPage.value + 1) % totalPages.value
    }
  }, 8000) // Change page every 8 seconds
}

const stopScrollTimer = () => {
  if (scrollInterval) clearInterval(scrollInterval)
}

const toggleAutoScroll = () => {
  isAutoScrolling.value = !isAutoScrolling.value
  if (isAutoScrolling.value) startScrollTimer()
  else stopScrollTimer()
}

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

// Pagination
const totalPages = computed(() => Math.ceil(leaderboard.value.length / teamsPerPage))

const paginatedLeaderboard = computed(() => {
  const start = currentPage.value * teamsPerPage
  return leaderboard.value.slice(start, start + teamsPerPage)
})
</script>

<template>
  <div class="scoreboard-view">
    
    <!-- Audio controls & Setup Info (floating no-print controls) -->
    <div class="no-print controls-floating-bar">
      <button @click="toggleTheme" class="btn btn-secondary round-icon-btn" :title="theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'">
        <Sun v-if="theme === 'light'" :size="18" />
        <Moon v-else :size="18" />
      </button>

      <button @click="soundEnabled = !soundEnabled" class="btn btn-secondary round-icon-btn">
        <Volume2 v-if="soundEnabled" :size="18" />
        <VolumeX v-else :size="18" class="text-muted" />
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
        <span class="pill-label">เลื่อนหน้าจออัตโนมัติ:</span>
        <button @click="toggleAutoScroll" class="btn pill-btn play-pause-btn">
          <Pause v-if="isAutoScrolling" :size="12" />
          <Play v-else :size="12" />
          <span>{{ isAutoScrolling ? 'เปิด' : 'ปิด' }}</span>
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
      
      <!-- Top Title Bar -->
      <div class="scoreboard-header">
        <h1 class="scoreboard-title">{{ currentRound.name }}</h1>
        <div class="scoreboard-subtitle">
          วิทยาศาสตร์แห่งอนาคต • SCOREBOARD • ผลคะแนนสะสม
          <span v-if="currentRound.revealed_question_number > 0" class="text-cyan font-bold">
            (ข้อที่ 1 - {{ currentRound.revealed_question_number }})
          </span>
          <span v-else class="text-warning font-bold">
            (ซ่อนคะแนนการแข่งชั่วคราว)
          </span>
        </div>
      </div>

      <!-- TV Leaderboard Table -->
      <div class="scoreboard-grid">
        <div v-if="leaderboard.length === 0" class="empty-scoreboard-prompt">
          ไม่มีทีมเข้าแข่งในระบบ
        </div>

        <Transition v-else name="fade" mode="out-in">
          <div :key="currentPage" class="scoreboard-grid-container">
            <TransitionGroup name="flip-list">
              <div 
                v-for="item in paginatedLeaderboard" 
                :key="item.id"
                class="scoreboard-row"
                :class="`rank-${item.rank}`"
              >
                <!-- Team number (Outstanding) -->
                <div class="team-no">
                  TEAM {{ String(item.team_number).padStart(2, '0') }}
                </div>

                <!-- Team Name -->
                <div class="team-name">
                  <span class="team-name-text" :title="item.name">{{ item.name }}</span>
                  <span v-if="item.tie_breaker_score > 0" class="status-pill-tiebreak">
                    ไทเบรก +{{ item.tie_breaker_score }}
                  </span>
                </div>

                <!-- Points display -->
                <div class="team-score">
                  {{ item.finalScore }} <span class="score-label">คะแนน</span>
                </div>

                <!-- Rank badge (Moved behind score) -->
                <div class="rank-badge">
                  {{ item.rank }}
                </div>
              </div>
            </TransitionGroup>
          </div>
        </Transition>
      </div>

      <!-- Bottom Pager Indicator (TV view pagination progress) -->
      <div v-if="totalPages > 1" class="no-print pagination-footer">
        <button 
          @click="currentPage = (currentPage - 1 + totalPages) % totalPages" 
          class="btn btn-secondary pager-nav-btn"
        >
          <ChevronLeft :size="16" />
        </button>
        
        <span class="pagination-indicator-text">
          หน้า {{ currentPage + 1 }} / {{ totalPages }} (ทีมที่ {{ currentPage * teamsPerPage + 1 }} - {{ Math.min((currentPage + 1) * teamsPerPage, leaderboard.length) }})
        </span>

        <button 
          @click="currentPage = (currentPage + 1) % totalPages" 
          class="btn btn-secondary pager-nav-btn"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

    </template>
  </div>
</template>

<style scoped>
.controls-floating-bar {
  position: absolute; 
  top: 1rem; 
  right: 1rem; 
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
  font-size: 0.8rem; 
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
  font-size: 0.75rem; 
  border-radius: 4px; 
  padding: 0.2rem 0.5rem; 
  outline: none; 
  cursor: pointer; 
  max-width: 140px;
}

.pill-dropdown-select option {
  color: var(--text-primary); 
  background: var(--bg-secondary);
}

.control-pill-group {
  background: rgba(0,0,0,0.5); 
  padding: 0.25rem 0.75rem; 
  border-radius: 20px; 
  font-size: 0.8rem; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  border: 1px solid var(--glass-border);
}

.pill-btn {
  background: var(--bg-tertiary); 
  color: var(--text-primary);
  padding: 0.25rem 0.5rem; 
  font-size: 0.75rem; 
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

.pagination-footer {
  display: flex; 
  justify-content: center; 
  align-items: center; 
  gap: 1rem; 
  margin-top: 1.5rem; 
  padding-bottom: 0.5rem;
}

.pager-nav-btn {
  padding: 0.25rem 0.5rem;
}

.pagination-indicator-text {
  font-family: var(--font-title); 
  font-size: 1rem; 
  color: var(--text-secondary);
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
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
import { useTheme } from '~/composables/useTheme'

const { theme, toggleTheme } = useTheme()

const route = useRoute()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const sortBy = ref<'score' | 'team'>('score')
const currentRound = ref<any>(null)
const teams = ref<any[]>([])
const answers = ref<any[]>([])
const questions = ref<any[]>([])

const loading = ref(true)
const errorMsg = ref('')

// Sound effect options
const soundEnabled = ref(false)
let cheerAudio: HTMLAudioElement | null = null

// Realtime subscriptions references
let answersChannel: any = null
let roundsChannel: any = null
let teamsChannel: any = null

// Pagination / Scrolling State for 30-40 teams
const currentPage = ref(0)
const teamsPerPage = 10
const isAutoScrolling = ref(true)
let scrollInterval: any = null

onMounted(() => {
  selectedRoundId.value = route.query.round as string || ''
  
  if (isConfigured.value) {
    fetchRounds()
  } else {
    loading.value = false
  }

  // Auto-scrolling timer
  startScrollTimer()

  if (typeof window !== 'undefined') {
    cheerAudio = new Audio('https://assets.mixkit.co/active_storage/sfx/2018/2018-84.wav')
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
    loadScoreboardData()
    setupRealtimeSubscriptions()
  } else {
    errorMsg.value = 'ยังไม่มีรอบการแข่งขันในระบบ กรุณาเปิดผ่านทางหน้าตั้งค่าหรือบอร์ดแอดมิน'
    loading.value = false
  }
}

const handleRoundChange = () => {
  loading.value = true
  loadScoreboardData()
  setupRealtimeSubscriptions()
}

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
  if (answersChannel) supabase.value?.removeChannel(answersChannel)
  if (roundsChannel) supabase.value?.removeChannel(roundsChannel)
  if (teamsChannel) supabase.value?.removeChannel(teamsChannel)
}

const loadScoreboardData = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  try {
    // 1. Fetch round configuration
    const { data: rData, error: rErr } = await supabase.value
      .from('rounds')
      .select('*')
      .eq('id', selectedRoundId.value)
      .single()

    if (rErr) throw rErr
    currentRound.value = rData

    // 2. Fetch all teams in round
    const { data: tData, error: tErr } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
    
    if (tErr) throw tErr
    teams.value = tData

    // 3. Fetch correct answer keys (questions)
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', selectedRoundId.value)
    questions.value = qData || []

    // 4. Fetch all answers for these teams
    if (tData.length > 0) {
      const teamIds = tData.map(t => t.id)
      const { data: aData } = await supabase.value
        .from('answers')
        .select('*')
        .in('team_id', teamIds)
      
      answers.value = aData || []
    }
    
    errorMsg.value = ''
  } catch (err: any) {
    console.error('Error loading scoreboard data:', err)
    errorMsg.value = `โหลดข้อมูลบอร์ดคะแนนล้มเหลว: ${err.message}`
  } finally {
    loading.value = false
  }
}

const playBeep = () => {
  if (soundEnabled.value && cheerAudio) {
    cheerAudio.play().catch(e => console.log('Audio playback blocked:', e))
  }
}

// Setup real-time listeners for updates
const setupRealtimeSubscriptions = () => {
  if (!supabase.value || !selectedRoundId.value) return

  cleanupSubscriptions()

  // 1. Listen to answers changes (as staff enters them)
  answersChannel = supabase.value
    .channel('scoreboard-answers')
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'answers' 
    }, (payload) => {
      // Find and update local answers state
      const updated = payload.new as any
      const deleted = payload.old as any
      
      if (payload.eventType === 'INSERT') {
        answers.value.push(updated)
        playBeep()
      } else if (payload.eventType === 'UPDATE') {
        const idx = answers.value.findIndex(a => a.id === updated.id)
        if (idx > -1) {
          answers.value[idx] = updated
        } else {
          answers.value.push(updated)
        }
        playBeep()
      } else if (payload.eventType === 'DELETE') {
        answers.value = answers.value.filter(a => a.id !== deleted.id)
      }
    })
    .subscribe()

  // 2. Listen to round configuration changes (e.g. reveal_question_number modified by admin)
  roundsChannel = supabase.value
    .channel('scoreboard-rounds')
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'rounds',
      filter: `id=eq.${selectedRoundId.value}`
    }, (payload) => {
      currentRound.value = payload.new
      playBeep()
    })
    .subscribe()

  // 3. Listen to teams changes (e.g., tie_breaker score modifications)
  teamsChannel = supabase.value
    .channel('scoreboard-teams')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'teams',
      filter: `round_id=eq.${selectedRoundId.value}`
    }, () => {
      loadScoreboardData() // Reload everything to ensure consistency
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

    // Final score = correct answers + tie breaker manual points
    const finalScore = correctCount + team.tie_breaker_score

    // Detail answers map for rendering dots on TV board
    const answersDetail = Array.from({ length: Math.min(20, revQuestion) }, (_, idx) => {
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
    <div class="no-print" style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem; z-index: 100; flex-wrap: wrap;">
      <button @click="toggleTheme" class="btn btn-secondary" style="padding: 0.5rem; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;" :title="theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'">
        <Sun v-if="theme === 'light'" :size="18" />
        <Moon v-else :size="18" />
      </button>

      <button @click="soundEnabled = !soundEnabled" class="btn btn-secondary" style="padding: 0.5rem; border-radius: 50%; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center;">
        <Volume2 v-if="soundEnabled" :size="18" />
        <VolumeX v-else :size="18" style="color: var(--text-muted);" />
      </button>

      <div style="background: rgba(0,0,0,0.5); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--glass-border);">
        <span style="color: #fff;">เลือกรอบ:</span>
        <select v-model="selectedRoundId" @change="handleRoundChange" style="background: var(--bg-tertiary); color: var(--text-primary); border: none; font-size: 0.75rem; border-radius: 4px; padding: 0.2rem 0.5rem; outline: none; cursor: pointer; max-width: 140px;">
          <option v-for="r in roundsList" :key="r.id" :value="r.id" style="color: var(--text-primary); background: var(--bg-secondary);">
            {{ r.name }}
          </option>
        </select>
      </div>

      <div style="background: rgba(0,0,0,0.5); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--glass-border);">
        <span style="color: #fff;">เรียงลำดับ:</span>
        <button @click="sortBy = 'score'" class="btn" :style="sortBy === 'score' ? 'background: var(--color-cyan); color: #000; font-weight: 700;' : 'background: var(--bg-tertiary); color: var(--text-primary);'" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border: none; border-radius: 4px; cursor: pointer;">
          คะแนน
        </button>
        <button @click="sortBy = 'team'" class="btn" :style="sortBy === 'team' ? 'background: var(--color-cyan); color: #000; font-weight: 700;' : 'background: var(--bg-tertiary); color: var(--text-primary);'" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border: none; border-radius: 4px; cursor: pointer;">
          เลขทีม
        </button>
      </div>

      <div style="background: rgba(0,0,0,0.5); padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; border: 1px solid var(--glass-border);">
        <span style="color: #fff;">เลื่อนหน้าจออัตโนมัติ:</span>
        <button @click="toggleAutoScroll" class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; background: var(--bg-tertiary); color: var(--text-primary);">
          <Pause v-if="isAutoScrolling" :size="12" />
          <Play v-else :size="12" />
          {{ isAutoScrolling ? 'เปิด' : 'ปิด' }}
        </button>
      </div>
    </div>

    <!-- Error state -->
    <div v-if="!isConfigured || errorMsg" style="max-width: 500px; margin: auto; text-align: center;" class="glass-card">
      <AlertCircle :size="64" class="text-error" style="margin-bottom: 1.5rem;" />
      <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff;">เกิดข้อผิดพลาดในการโหลดบอร์ด</h2>
      <p style="color: var(--text-secondary); margin-bottom: 2rem;">
        {{ errorMsg || 'กรุณาเชื่อมต่อฐานข้อมูลในหน้าแรกของเครื่องโฮสต์ก่อน' }}
      </p>
      <NuxtLink to="/" class="btn btn-primary no-print">ไปหน้าตั้งค่า</NuxtLink>
    </div>

    <div v-else-if="loading" style="margin: auto; text-align: center; color: var(--text-secondary);">
      <div class="loading-spin" style="width: 50px; height: 50px; border: 4px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%; margin: 0 auto 1.5rem;"></div>
      <p>กำลังเตรียมข้อมูลถ่ายทอดสด...</p>
    </div>

    <!-- Main Scoreboard TV Layout -->
    <template v-else-if="currentRound">
      
      <!-- Top Title Bar -->
      <div class="scoreboard-header">
        <h1 class="scoreboard-title">{{ currentRound.name }}</h1>
        <div class="scoreboard-subtitle">
          วิทยาศาสตร์แห่งอนาคต • SCOREBOARD • ผลคะแนนสะสม
          <span v-if="currentRound.revealed_question_number > 0" style="color: var(--color-cyan); font-weight: 700;">
            (ข้อที่ 1 - {{ currentRound.revealed_question_number }})
          </span>
          <span v-else style="color: var(--color-warning); font-weight: 700;">
            (ซ่อนคะแนนการแข่งชั่วคราว)
          </span>
        </div>
      </div>

      <!-- TV Leaderboard Table -->
      <div class="scoreboard-grid">
        <div v-if="leaderboard.length === 0" style="text-align: center; padding: 5rem; color: var(--text-secondary); font-size: 1.5rem;">
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
      <div v-if="totalPages > 1" style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1.5rem; padding-bottom: 0.5rem;" class="no-print">
        <button 
          @click="currentPage = (currentPage - 1 + totalPages) % totalPages" 
          class="btn btn-secondary" 
          style="padding: 0.25rem 0.5rem;"
        >
          <ChevronLeft :size="16" />
        </button>
        
        <span style="font-family: var(--font-title); font-size: 1rem; color: var(--text-secondary);">
          หน้า {{ currentPage + 1 }} / {{ totalPages }} (ทีมที่ {{ currentPage * teamsPerPage + 1 }} - {{ Math.min((currentPage + 1) * teamsPerPage, leaderboard.length) }})
        </span>

        <button 
          @click="currentPage = (currentPage + 1) % totalPages" 
          class="btn btn-secondary" 
          style="padding: 0.25rem 0.5rem;"
        >
          <ChevronRight :size="16" />
        </button>
      </div>

    </template>
  </div>
</template>

<style scoped>
.text-error {
  color: var(--color-error);
}

/* Vue flip list transition for smooth ranking updates */
.flip-list-move {
  transition: transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* Glowing animation for loader */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-spin {
  animation: spin 1.2s linear infinite;
  box-shadow: var(--shadow-neon-cyan);
}

/* 2-Column Grid Layout for Scoreboard */
.scoreboard-grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: repeat(5, auto);
  grid-auto-flow: column;
  gap: 1rem;
}

.scoreboard-row {
  display: grid !important;
  grid-template-columns: 180px 1fr 180px 70px !important;
  align-items: center !important;
  padding: 1rem 1.5rem !important;
  background: rgba(20, 24, 48, 0.5);
  border-left: 4px solid transparent;
  border-radius: var(--radius-sm);
  transition: all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.team-no {
  font-family: var(--font-title) !important;
  font-size: 2.2rem !important;
  font-weight: 800 !important;
  color: var(--color-cyan) !important;
  text-shadow: var(--shadow-neon-cyan) !important;
  white-space: nowrap;
}

.team-name {
  color: var(--text-primary) !important;
  font-size: 1.8rem !important;
  display: flex !important;
  align-items: center !important;
  gap: 1rem !important;
  font-weight: 700 !important;
  min-width: 0 !important;
  flex: 1 !important;
}

.status-pill-tiebreak {
  background: rgba(255, 214, 0, 0.15);
  color: var(--color-gold);
  font-size: 0.85rem;
  padding: 0.15rem 0.5rem;
  font-weight: 800;
  border-radius: 20px;
  text-transform: uppercase;
}

.team-score {
  font-size: 2.5rem !important;
  font-weight: 800 !important;
  color: var(--text-primary) !important;
  text-align: right !important;
}

.score-label {
  font-size: 1.2rem !important;
  font-weight: 400 !important;
  color: var(--text-secondary) !important;
  margin-left: 0.25rem !important;
}

.rank-badge {
  width: 52px !important;
  height: 52px !important;
  font-size: 1.4rem !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 50% !important;
  font-family: var(--font-title) !important;
  font-weight: 800 !important;
  background: var(--bg-tertiary) !important;
  color: var(--text-primary) !important;
  justify-self: end;
}

/* Media Queries for responsive scaling and vertical stack on small screens */
@media (max-width: 1400px) {
  .scoreboard-row {
    grid-template-columns: 165px 1fr 160px 60px !important;
    padding: 0.85rem 1.25rem !important;
  }
  .team-no {
    font-size: 1.8rem !important;
  }
  .team-name {
    font-size: 1.5rem !important;
  }
  .team-score {
    font-size: 2rem !important;
  }
  .score-label {
    font-size: 1rem !important;
  }
  .rank-badge {
    width: 44px !important;
    height: 44px !important;
    font-size: 1.2rem !important;
  }
}

@media (max-width: 992px) {
  .scoreboard-grid-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    grid-auto-flow: row;
  }
  .scoreboard-row {
    grid-template-columns: 140px 1fr 140px 50px !important;
    padding: 0.75rem 1rem !important;
  }
  .team-no {
    font-size: 1.5rem !important;
  }
  .team-name {
    font-size: 1.3rem !important;
  }
  .team-score {
    font-size: 1.75rem !important;
  }
  .score-label {
    font-size: 0.9rem !important;
  }
  .rank-badge {
    width: 38px !important;
    height: 38px !important;
    font-size: 1rem !important;
  }
}

@media (max-width: 576px) {
  .scoreboard-row {
    grid-template-columns: 95px 1fr 100px 36px !important;
    padding: 0.6rem 0.75rem !important;
    gap: 0.5rem !important;
  }
  .team-no {
    font-size: 1.1rem !important;
  }
  .team-name {
    font-size: 1rem !important;
    gap: 0.25rem !important;
  }
  .team-score {
    font-size: 1.3rem !important;
  }
  .score-label {
    font-size: 0.75rem !important;
  }
  .rank-badge {
    width: 30px !important;
    height: 30px !important;
    font-size: 0.9rem !important;
  }
}

/* Page fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Team name text truncation */
.team-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
</style>

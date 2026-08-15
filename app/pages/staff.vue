<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  Users, 
  Settings, 
  CheckCircle,
  AlertCircle,
  Filter,
  LogOut
} from 'lucide-vue-next'
import type { Team, Answer } from '~/types'

const route = useRoute()
const { supabase, isConfigured } = useSupabase()
const { validateStaffOrAdmin, getActivePasskey, logout } = useAuth()

// Questions & Teams
const teams = ref<Team[]>([])
const selectedQuestion = ref(1)
const answersMap = ref<Record<string, string>>({}) // key: teamId-questionNo, val: submitted_answer

let answersChannel: any = null

const setupAnswersSubscription = () => {
  if (!supabase.value || teams.value.length === 0) return
  
  if (answersChannel) {
    supabase.value.removeChannel(answersChannel)
  }
  
  const teamIds = teams.value.map(t => t.id)
  
  answersChannel = supabase.value
    .channel('staff-answers')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'answers'
    }, (payload: any) => {
      const updated = payload.new as any
      const deleted = payload.old as any
      
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        if (teamIds.includes(updated.team_id)) {
          answersMap.value[`${updated.team_id}-${updated.question_number}`] = updated.submitted_answer || ''
        }
      } else if (payload.eventType === 'DELETE') {
        fetchAnswers()
      }
    })
    .subscribe()
}

onUnmounted(() => {
  if (answersChannel && supabase.value) {
    supabase.value.removeChannel(answersChannel)
  }
})

// Staff setup / Filtering
const staffName = ref('')
const staffPasskey = ref('')
const passkeyValid = ref(false)
const filterMode = ref<'all' | 'custom'>('all')
const customTeamIds = ref<string[]>([]) // List of team IDs this staff is responsible for
const showFilterModal = ref(false)

// Loading / saving indicators
const loading = ref(false)
const savingStatus = ref<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})

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

    await fetchAnswers()
    setupAnswersSubscription()
  } catch (err) {
    console.error('Error loading round details in staff view:', err)
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

onMounted(async () => {
  const isValid = await validateStaffOrAdmin()
  if (!isValid) return
  
  staffPasskey.value = getActivePasskey()
  passkeyValid.value = true

  const qParam = (route.query.question || route.query.q) as string
  if (qParam) {
    const parsedQ = parseInt(qParam)
    if (!isNaN(parsedQ) && parsedQ >= 1 && parsedQ <= TOTAL_QUESTIONS) {
      selectedQuestion.value = parsedQ
    }
  }

  if (isConfigured.value) {
    // Load local storage preferences
    if (typeof window !== 'undefined') {
      staffName.value = localStorage.getItem('staff_name') || ''
      const savedFilterMode = localStorage.getItem('staff_filter_mode') as 'all' | 'custom'
      if (savedFilterMode) filterMode.value = savedFilterMode
      
      const savedTeams = localStorage.getItem('staff_custom_teams')
      if (savedTeams) {
        try {
          customTeamIds.value = JSON.parse(savedTeams)
        } catch (e) {
          console.error(e)
        }
      }
    }
  }
})

// Save staff profile settings
watch(staffName, (val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('staff_name', val)
  }
})

watch(filterMode, (val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('staff_filter_mode', val)
  }
})

watch(customTeamIds, (val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('staff_custom_teams', JSON.stringify(val))
  }
}, { deep: true })

watch(staffPasskey, (val) => {
  if (typeof window !== 'undefined' && val) {
    localStorage.setItem('staff_key', val)
  }
})

const fetchAnswers = async () => {
  if (!supabase.value || teams.value.length === 0) return
  
  const teamIds = teams.value.map(t => t.id)
  const { data } = await supabase.value
    .from('answers')
    .select('team_id, question_number, submitted_answer')
    .in('team_id', teamIds)
    
  if (data) {
    const map: Record<string, string> = {}
    data.forEach(row => {
      map[`${row.team_id}-${row.question_number}`] = row.submitted_answer || ''
    })
    answersMap.value = map
  }
}

// Teams displayed based on filter
const filteredTeams = computed(() => {
  if (filterMode.value === 'all') return teams.value
  return teams.value.filter(t => customTeamIds.value.includes(t.id))
})

// Toggle selection of custom teams
const toggleCustomTeam = (id: string) => {
  const index = customTeamIds.value.indexOf(id)
  if (index > -1) {
    customTeamIds.value.splice(index, 1)
  } else {
    customTeamIds.value.push(id)
  }
}

// Record/Submit answer using secure RPC
const submitAnswer = async (teamId: string, choice: string) => {
  if (!supabase.value) return
  if (!staffPasskey.value) {
    alert('กรุณากรอกรหัสผ่านเจ้าหน้าที่ก่อนบันทึกคะแนน')
    return
  }
  
  const currentKey = `${teamId}-${selectedQuestion.value}`
  const existingAns = answersMap.value[currentKey]
  
  // Toggle off if clicking the same choice
  const finalChoice = existingAns === choice ? null : choice
  
  // Set saving state
  savingStatus.value[currentKey] = 'saving'
  
  // optimistically update local map
  answersMap.value[currentKey] = finalChoice || ''

  try {
    const { error } = await supabase.value.rpc('submit_answer_secure', {
      p_team_id: teamId,
      p_question_number: selectedQuestion.value,
      p_submitted_answer: finalChoice,
      p_recorded_by: staffName.value || (localStorage.getItem('admin_passkey') ? 'Admin' : 'Staff'),
      p_staff_passkey: staffPasskey.value
    })

    if (error) throw error
    savingStatus.value[currentKey] = 'saved'
  } catch (err: any) {
    console.error('Error saving answer:', err)
    savingStatus.value[currentKey] = 'error'
    // revert
    answersMap.value[currentKey] = existingAns || ''
    alert(`บันทึกคะแนนล้มเหลว: ${err.message || err}`)
  }
}

// Check if a question is fully answered for ALL filtered teams
const isQuestionCompleted = (qNum: number) => {
  if (filteredTeams.value.length === 0) return false
  return filteredTeams.value.every(t => {
    return !!answersMap.value[`${t.id}-${qNum}`]
  })
}
</script>

<template>
  <div class="container mobile-view" v-if="passkeyValid">
    
    <!-- Header -->
    <div class="staff-header-row">
      <div>
        <h1 class="staff-title">
          บันทึกคะแนนคำตอบ
        </h1>
        <p class="staff-subtitle">
          กรอกข้อมูลคำตอบจากกระดาษของทีมเข้าแข่ง
        </p>
      </div>
      
      <button @click="logout" class="btn btn-secondary logout-btn">
        <LogOut :size="16" />
        <span>ออกจากระบบ</span>
      </button>
    </div>

    <!-- DB Warning -->
    <div v-if="!isConfigured" class="glass-card unconfigured-card">
      <AlertCircle :size="48" class="text-error warning-icon" />
      <h2 class="warning-title">ไม่ได้เชื่อมต่อฐานข้อมูล</h2>
      <p class="warning-desc">
        กรุณาขอ URL และ API Key จากผู้จัดการแข่งขัน เพื่อตั้งค่าในหน้าแรก
      </p>
      <NuxtLink to="/" class="btn btn-primary">ไปหน้าตั้งค่าเชื่อมต่อ</NuxtLink>
    </div>

    <template v-else>
      
      <!-- Top Configurations / Filter Bar -->
      <div class="glass-card config-bar">
        <div class="controls-row">
          <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input select-round">
            <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          
          <button @click="showFilterModal = true" class="btn btn-secondary filter-toggle-btn">
            <Filter :size="18" :class="{ 'text-cyan-active': filterMode === 'custom' }" />
          </button>
        </div>

        <div class="name-input-row">
          <input 
            v-model="staffName" 
            type="text" 
            class="form-input" 
            placeholder="ชื่อผู้บันทึก (เช่น Admin / Staff A)" 
          />
        </div>
        
        <div class="status-summary">
          <span class="summary-text">
            {{ filterMode === 'all' ? 'กำลังบันทึก: ทุกทีม' : `กำลังบันทึก: ${filteredTeams.length} ทีม` }}
          </span>
        </div>
      </div>

      <!-- Question Selector (Horizontal Slider) -->
      <div class="question-selector-section">
        <div class="selector-header">
          <span>เลือกข้อคำถาม:</span>
          <span class="active-question-label">ข้อที่ {{ selectedQuestion }}</span>
        </div>
        <div class="question-selector">
          <div 
            v-for="i in TOTAL_QUESTIONS" 
            :key="i"
            @click="selectedQuestion = i"
            class="q-chip"
            :class="{ 
              active: selectedQuestion === i, 
              completed: isQuestionCompleted(i)
            }"
          >
            <span>Q{{ i }}</span>
            <span class="dot"></span>
          </div>
        </div>
      </div>

      <!-- Teams Input List -->
      <div v-if="loading" class="loading-state">
        กำลังโหลดข้อมูลทีม...
      </div>

      <div v-else-if="filteredTeams.length === 0" class="glass-card empty-teams-card">
        <Users :size="48" class="prompt-icon" />
        <h2 class="empty-title">ยังไม่มีทีมในรายการดูแล</h2>
        <p class="empty-desc">
          กรุณากดปุ่มตัวกรองขวาบน เพื่อเลือกทีมที่คุณรับผิดชอบคะแนน (6-7 ทีม)
        </p>
        <button @click="showFilterModal = true" class="btn btn-primary">เลือกทีมดูแล</button>
      </div>

      <div v-else class="staff-entry-list">
        <div 
          v-for="team in filteredTeams" 
          :key="team.id" 
          class="team-entry-card"
        >
          <div class="team-entry-info">
            <span class="team-identity">
              <span class="team-number-badge">
                {{ String(team.team_number).padStart(2, '0') }}
              </span>
              <span>{{ team.name }}</span>
            </span>

            <!-- Status Indicator -->
            <div class="save-status-indicator">
              <template v-if="savingStatus[`${team.id}-${selectedQuestion}`] === 'saving'">
                <span class="loading-spin small-spin"></span>
                <span>กำลังบันทึก...</span>
              </template>
              <template v-else-if="savingStatus[`${team.id}-${selectedQuestion}`] === 'saved'">
                <CheckCircle :size="12" class="text-success" />
                <span class="text-success font-semibold">บันทึกแล้ว</span>
              </template>
              <template v-else-if="answersMap[`${team.id}-${selectedQuestion}`]">
                <CheckCircle :size="12" class="text-muted" />
                <span>บันทึกแล้ว</span>
              </template>
              <template v-else>
                <span>ยังไม่มีคำตอบ</span>
              </template>
            </div>
          </div>

          <!-- Large Choice Buttons -->
          <div class="options-row">
            <button 
              v-for="choice in ['ก', 'ข', 'ค', 'ง']" 
              :key="choice"
              @click="submitAnswer(team.id, choice)"
              class="option-btn"
              :class="answersMap[`${team.id}-${selectedQuestion}`] === choice ? `selected-${choice}` : ''"
            >
              {{ choice }}
            </button>
          </div>
        </div>
      </div>

      <!-- Filter Selection Overlay Modal -->
      <div v-if="showFilterModal" class="no-print modal-backdrop">
        <div class="glass-card modal-card">
          
          <div class="modal-header">
            <h3 class="modal-title">
              <Filter class="text-cyan modal-header-icon" :size="20" />
              <span>เลือกทีมที่คุณรับผิดชอบ</span>
            </h3>
            <button @click="showFilterModal = false" class="close-btn">&times;</button>
          </div>

          <div class="modal-tabs">
            <button 
              @click="filterMode = 'all'" 
              class="btn tab-btn" 
              :class="filterMode === 'all' ? 'btn-primary' : 'btn-secondary'"
            >
              ดูแลทุกทีม ({{ teams.length }})
            </button>
            <button 
              @click="filterMode = 'custom'" 
              class="btn tab-btn" 
              :class="filterMode === 'custom' ? 'btn-primary' : 'btn-secondary'"
            >
              เลือกเฉพาะบางทีม
            </button>
          </div>

          <!-- Custom selection grid -->
          <div v-if="filterMode === 'custom'" class="selection-scroll-container">
            <p class="selection-desc">
              ทำเครื่องหมายเลือก 6-7 ทีมที่คุณต้องทำหน้าที่กรอกข้อมูล:
            </p>
            <div class="selection-list">
              <div 
                v-for="t in teams" 
                :key="t.id"
                @click="toggleCustomTeam(t.id)"
                class="glass-card team-selection-item"
                :class="{ active: customTeamIds.includes(t.id) }"
              >
                <span class="selection-team-label">
                  <span class="text-cyan font-bold">{{ String(t.team_number).padStart(2, '0') }}</span>
                  <span>{{ t.name }}</span>
                </span>
                
                <input 
                  type="checkbox" 
                  :checked="customTeamIds.includes(t.id)"
                  class="selection-checkbox"
                  @click.stop="toggleCustomTeam(t.id)"
                />
              </div>
            </div>
          </div>

          <button @click="showFilterModal = false" class="btn btn-primary save-filter-btn">
            ตกลง (บันทึกตัวกรอง)
          </button>

        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.staff-header-row {
  margin-bottom: 1.5rem; 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  gap: 1rem;
}

.staff-title {
  font-size: 1.8rem; 
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); 
  -webkit-background-clip: text; 
  -webkit-text-fill-color: transparent; 
  margin-bottom: 0.25rem;
}

.staff-subtitle {
  color: var(--text-secondary); 
  font-size: 0.9rem;
}

.logout-btn {
  display: flex; 
  align-items: center; 
  gap: 0.25rem; 
  padding: 0.5rem 0.75rem; 
  font-size: 0.85rem;
}

.text-error { color: var(--color-error); }
.text-cyan { color: var(--color-cyan); }
.text-success { color: var(--color-success); }
.text-muted { color: var(--text-muted); }

.warning-icon {
  margin-bottom: 1rem;
}

.unconfigured-card {
  text-align: center; 
  padding: 4rem 1rem;
}

.warning-title {
  font-size: 1.25rem; 
  margin-bottom: 0.5rem;
}

.warning-desc {
  color: var(--text-secondary); 
  margin-bottom: 1.5rem;
}

.config-bar {
  padding: 1rem; 
  margin-bottom: 1rem; 
  display: flex; 
  flex-direction: column; 
  gap: 0.75rem;
}

.controls-row {
  display: flex; 
  gap: 0.5rem; 
  width: 100%;
}

.select-round {
  flex: 1;
}

.filter-toggle-btn {
  padding: 0.75rem; 
  border-radius: var(--radius-sm);
}

.text-cyan-active {
  color: var(--color-cyan);
}

.name-input-row {
  display: block; 
  width: 100%;
}

.status-summary {
  text-align: right;
}

.summary-text {
  font-size: 0.8rem; 
  color: var(--text-muted); 
  white-space: nowrap;
}

.question-selector-section {
  margin-bottom: 1.25rem;
}

.selector-header {
  font-family: var(--font-title); 
  font-size: 0.85rem; 
  font-weight: 700; 
  color: var(--text-secondary); 
  margin-bottom: 0.25rem; 
  display: flex; 
  justify-content: space-between;
}

.active-question-label {
  color: var(--color-cyan);
}

.loading-state {
  text-align: center; 
  color: var(--text-secondary); 
  padding: 4rem;
}

.empty-teams-card {
  text-align: center; 
  padding: 4rem 1rem;
}

.prompt-icon {
  color: var(--text-muted); 
  margin-bottom: 1rem;
}

.empty-title {
  font-size: 1.15rem; 
  margin-bottom: 0.5rem;
}

.empty-desc {
  color: var(--text-secondary); 
  font-size: 0.9rem; 
  margin-bottom: 1.5rem;
}

.team-identity {
  font-weight: 700; 
  font-size: 1.1rem; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.team-number-badge {
  color: var(--color-cyan); 
  font-family: var(--font-title);
}

.save-status-indicator {
  font-size: 0.75rem; 
  color: var(--text-muted); 
  display: flex; 
  align-items: center; 
  gap: 0.25rem;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.small-spin {
  display: inline-block; 
  width: 10px; 
  height: 10px; 
  border: 2px solid var(--color-cyan); 
  border-top-color: transparent; 
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.font-semibold {
  font-weight: 600;
}

.modal-backdrop {
  position: fixed; 
  inset: 0; 
  background: rgba(0,0,0,0.85); 
  backdrop-filter: blur(8px); 
  z-index: 1000; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  padding: 1rem;
}

.modal-card {
  width: 100%; 
  max-width: 500px; 
  max-height: 90vh; 
  display: flex; 
  flex-direction: column; 
  border-color: var(--glass-border-glow);
}

.modal-header {
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 1.5rem; 
  border-bottom: 1px solid var(--glass-border); 
  padding-bottom: 0.75rem;
}

.modal-title {
  font-size: 1.2rem; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.modal-header-icon {
  vertical-align: middle;
}

.close-btn {
  padding: 0.25rem 0.5rem; 
  background: none; 
  border: none; 
  font-size: 1.5rem;
  color: var(--text-primary);
  cursor: pointer;
}

.modal-tabs {
  display: flex; 
  gap: 0.5rem; 
  margin-bottom: 1.5rem;
}

.tab-btn {
  flex: 1;
}

.selection-scroll-container {
  flex: 1; 
  overflow-y: auto; 
  margin-bottom: 1.5rem; 
  padding-right: 0.5rem;
}

.selection-desc {
  font-size: 0.8rem; 
  color: var(--text-secondary); 
  margin-bottom: 1rem;
}

.selection-list {
  display: flex; 
  flex-direction: column; 
  gap: 0.5rem;
}

.team-selection-item {
  padding: 0.75rem 1rem; 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  cursor: pointer; 
  background: rgba(255,255,255,0.01);
}

.team-selection-item.active {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.05) !important;
}

.selection-team-label {
  font-weight: 600; 
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.font-bold {
  font-weight: 700;
}

.selection-checkbox {
  width: 18px; 
  height: 18px; 
  accent-color: var(--color-cyan); 
  cursor: pointer;
}

.save-filter-btn {
  width: 100%;
}
</style>

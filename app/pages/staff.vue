<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { 
  Users, 
  HelpCircle, 
  Settings, 
  CheckCircle,
  AlertCircle,
  Filter,
  LogOut
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)

// Questions & Teams
const teams = ref<any[]>([])
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
    }, (payload) => {
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

onMounted(async () => {
  if (typeof window !== 'undefined') {
    const staffKey = localStorage.getItem('staff_key') || ''
    const adminKey = localStorage.getItem('admin_passkey') || ''
    
    if (!staffKey && !adminKey) {
      router.push('/')
      return
    }
    
    // Verify
    let isValid = false
    if (supabase.value) {
      if (staffKey) {
        const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'staff', p_passkey: staffKey })
        if (data) isValid = true
      }
      if (!isValid && adminKey) {
        const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'admin', p_passkey: adminKey })
        if (data) isValid = true
      }
    }
    
    if (!isValid) {
      router.push('/')
      return
    }
    
    staffPasskey.value = staffKey || adminKey // Use whichever is present
    passkeyValid.value = true
  }

  if (isConfigured.value) {
    fetchRounds()
    
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
  
  // Load round
  const { data: rData } = await supabase.value
    .from('rounds')
    .select('*')
    .eq('id', selectedRoundId.value)
    .single()
  if (rData) {
    currentRound.value = rData
    await fetchTeams()
    await fetchAnswers()
    setupAnswersSubscription()
  }
  loading.value = false
}

const fetchTeams = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  const { data } = await supabase.value
    .from('teams')
    .select('*')
    .eq('round_id', selectedRoundId.value)
    .order('team_number', { ascending: true })
  if (data) {
    teams.value = data
  }
}

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
      p_recorded_by: staffName.value || 'Staff',
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

const handleLogout = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('staff_key')
    localStorage.removeItem('admin_passkey')
  }
  router.push('/')
}
</script>

<template>
  <div class="container mobile-view" v-if="passkeyValid">
    
    <!-- Header -->
    <div style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
      <div>
        <h1 style="font-size: 1.8rem; background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.25rem;">
          บันทึกคะแนนคำตอบ
        </h1>
        <p style="color: var(--text-secondary); font-size: 0.9rem;">
          กรอกข้อมูลคำตอบจากกระดาษของทีมเข้าแข่ง
        </p>
      </div>
      
      <button @click="handleLogout" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem; padding: 0.5rem 0.75rem; font-size: 0.85rem;">
        <LogOut :size="16" />
        <span>ออกจากระบบ</span>
      </button>
    </div>

    <!-- DB Warning -->
    <div v-if="!isConfigured" style="text-align: center; padding: 4rem 1rem;" class="glass-card">
      <AlertCircle :size="48" class="text-error" style="margin-bottom: 1rem;" />
      <h2 style="font-size: 1.25rem; margin-bottom: 0.5rem;">ไม่ได้เชื่อมต่อฐานข้อมูล</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
        กรุณาขอ URL และ API Key จากผู้จัดการแข่งขัน เพื่อตั้งค่าในหน้าแรก
      </p>
      <NuxtLink to="/" class="btn btn-primary">ไปหน้าตั้งค่าเชื่อมต่อ</NuxtLink>
    </div>

    <template v-else>
      
      <!-- Top Configurations / Filter Bar -->
      <div class="glass-card" style="padding: 1rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
        <div style="display: flex; gap: 0.5rem; width: 100%;">
          <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input" style="flex: 1;">
            <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          
          <button @click="showFilterModal = true" class="btn btn-secondary" style="padding: 0.75rem; border-radius: var(--radius-sm);">
            <Filter :size="18" :style="filterMode === 'custom' ? 'color: var(--color-cyan);' : ''" />
          </button>
        </div>

        <div style="display: block; width: 100%;">
          <input 
            v-model="staffName" 
            type="text" 
            class="form-input" 
            placeholder="ชื่อผู้บันทึก (เช่น Staff A)" 
            style="font-size: 0.9rem; padding: 0.5rem 0.75rem;"
          />
        </div>
        
        <div style="text-align: right;">
          <span style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap;">
            {{ filterMode === 'all' ? 'กำลังบันทึก: ทุกทีม' : `กำลังบันทึก: ${filteredTeams.length} ทีม` }}
          </span>
        </div>
      </div>

      <!-- Question Selector (Horizontal Slider) -->
      <div style="margin-bottom: 1.25rem;">
        <div style="font-family: var(--font-title); font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.25rem; display: flex; justify-content: space-between;">
          <span>เลือกข้อคำถาม:</span>
          <span style="color: var(--color-cyan);">ข้อที่ {{ selectedQuestion }}</span>
        </div>
        <div class="question-selector">
          <div 
            v-for="i in 20" 
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
      <div v-if="loading" style="text-align: center; color: var(--text-secondary); padding: 4rem;">
        กำลังโหลดข้อมูลทีม...
      </div>

      <div v-else-if="filteredTeams.length === 0" style="text-align: center; padding: 4rem 1rem;" class="glass-card">
        <Users :size="48" style="color: var(--text-muted); margin-bottom: 1rem;" />
        <h2 style="font-size: 1.15rem; margin-bottom: 0.5rem;">ยังไม่มีทีมในรายการดูแล</h2>
        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
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
            <span style="font-weight: 700; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
              <span style="color: var(--color-cyan); font-family: var(--font-title);">
                {{ String(team.team_number).padStart(2, '0') }}
              </span>
              <span>{{ team.name }}</span>
            </span>

            <!-- Status Indicator -->
            <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.25rem;">
              <template v-if="savingStatus[`${team.id}-${selectedQuestion}`] === 'saving'">
                <span class="loading-spin" style="display: inline-block; width: 10px; height: 10px; border: 2px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%;"></span>
                <span>กำลังบันทึก...</span>
              </template>
              <template v-else-if="savingStatus[`${team.id}-${selectedQuestion}`] === 'saved'">
                <CheckCircle :size="12" style="color: var(--color-success);" />
                <span style="color: var(--color-success);">บันทึกแล้ว</span>
              </template>
              <template v-else-if="answersMap[`${team.id}-${selectedQuestion}`]">
                <CheckCircle :size="12" style="color: var(--text-muted);" />
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
      <div v-if="showFilterModal" class="no-print" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem;">
        <div class="glass-card" style="width: 100%; max-width: 500px; max-height: 90vh; display: flex; flex-direction: column; border-color: var(--glass-border-glow);">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.75rem;">
            <h3 style="font-size: 1.2rem; display: flex; align-items: center; gap: 0.5rem;">
              <Filter class="text-cyan" :size="20" />
              <span>เลือกทีมที่คุณรับผิดชอบ</span>
            </h3>
            <button @click="showFilterModal = false" class="btn" style="padding: 0.25rem 0.5rem; background: none; border: none; font-size: 1.5rem;">&times;</button>
          </div>

          <div style="margin-bottom: 1.5rem; display: flex; gap: 0.5rem;">
            <button 
              @click="filterMode = 'all'" 
              class="btn" 
              :class="filterMode === 'all' ? 'btn-primary' : 'btn-secondary'"
              style="flex: 1;"
            >
              ดูแลทุกทีม ({{ teams.length }})
            </button>
            <button 
              @click="filterMode = 'custom'" 
              class="btn" 
              :class="filterMode === 'custom' ? 'btn-primary' : 'btn-secondary'"
              style="flex: 1;"
            >
              เลือกเฉพาะบางทีม
            </button>
          </div>

          <!-- Custom selection grid -->
          <div v-if="filterMode === 'custom'" style="flex: 1; overflow-y: auto; margin-bottom: 1.5rem; padding-right: 0.5rem;">
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem;">
              ทำเครื่องหมายเลือก 6-7 ทีมที่คุณต้องทำหน้าที่กรอกข้อมูล:
            </p>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <div 
                v-for="t in teams" 
                :key="t.id"
                @click="toggleCustomTeam(t.id)"
                class="glass-card"
                :class="{ active: customTeamIds.includes(t.id) }"
                style="padding: 0.75rem 1rem; display: flex; align-items: center; justify-content: space-between; cursor: pointer; background: rgba(255,255,255,0.01);"
              >
                <span style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
                  <span style="color: var(--color-cyan); font-family: var(--font-title);">{{ String(t.team_number).padStart(2, '0') }}</span>
                  <span>{{ t.name }}</span>
                </span>
                
                <input 
                  type="checkbox" 
                  :checked="customTeamIds.includes(t.id)"
                  style="width: 18px; height: 18px; accent-color: var(--color-cyan); cursor: pointer;"
                  @click.stop="toggleCustomTeam(t.id)"
                />
              </div>
            </div>
          </div>

          <button @click="showFilterModal = false" class="btn btn-primary" style="width: 100%;">
            ตกลง (บันทึกตัวกรอง)
          </button>

        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.text-cyan {
  color: var(--color-cyan);
}
.text-error {
  color: var(--color-error);
}
.text-success {
  color: var(--color-success);
}
.text-muted {
  color: var(--text-muted);
}
.glass-card.active {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.05) !important;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-spin {
  animation: spin 1s linear infinite;
}
</style>

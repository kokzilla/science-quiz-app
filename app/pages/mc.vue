<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
import { 
  Award, 
  HelpCircle, 
  ChevronLeft, 
  ChevronRight,
  LogOut,
  RefreshCw,
  Users,
  CheckCircle
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)

const teams = ref<any[]>([])
const questions = ref<any[]>([])
const answers = ref<any[]>([])
const dataEntryProgress = ref<any[]>([])

const selectedQuestion = ref(1)
const loading = ref(true)
const passkeyValid = ref(false)

onMounted(async () => {
  // 1. Check Passkey Authorization Guard
  if (typeof window !== 'undefined') {
    const adminKey = localStorage.getItem('admin_passkey') || ''
    const staffKey = localStorage.getItem('staff_key') || ''
    
    if (!adminKey && !staffKey) {
      router.push('/')
      return
    }
    
    // Verify passkey against DB
    const validated = await verifyAuth(adminKey, staffKey)
    if (!validated) {
      router.push('/')
      return
    }
    passkeyValid.value = true
  }

  if (isConfigured.value) {
    fetchRounds()
  }
})

const verifyAuth = async (adminKey: string, staffKey: string) => {
  if (!supabase.value) return false
  
  if (adminKey) {
    const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'admin', p_passkey: adminKey })
    if (data) return true
  }
  if (staffKey) {
    const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'staff', p_passkey: staffKey })
    if (data) return true
  }
  return false
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
  
  try {
    const { data: rData } = await supabase.value
      .from('rounds')
      .select('*')
      .eq('id', selectedRoundId.value)
      .single()
    currentRound.value = rData

    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('team_number', { ascending: true })
    teams.value = tData || []

    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', selectedRoundId.value)
    questions.value = qData || []

    await fetchAnswers()
    await fetchProgress()
    
    // Subscribe to realtime answer updates
    supabase.value
      .channel('mc-answers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => {
        fetchAnswers()
        fetchProgress()
      })
      .subscribe()
      
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

const fetchProgress = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  const { data: countData } = await supabase.value
    .rpc('get_answers_progress', { r_id: selectedRoundId.value })
  
  if (countData) {
    dataEntryProgress.value = countData
  } else {
    // Fallback
    const roundTeamIds = teams.value.map(t => t.id)
    if (roundTeamIds.length === 0) {
      dataEntryProgress.value = Array.from({ length: 20 }, (_, i) => ({
        question_number: i + 1,
        submitted_count: 0
      }))
      return
    }

    const { data: answersData } = await supabase.value
      .from('answers')
      .select('question_number, submitted_answer')
      .in('team_id', roundTeamIds)
      
    const counts: Record<number, number> = {}
    for (let i = 1; i <= 20; i++) counts[i] = 0
    
    if (answersData) {
      answersData.forEach(ans => {
        if (ans.submitted_answer) {
          counts[ans.question_number] = (counts[ans.question_number] || 0) + 1
        }
      })
    }
    
    dataEntryProgress.value = Object.keys(counts).map(k => ({
      question_number: parseInt(k),
      submitted_count: counts[parseInt(k)]
    }))
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

// ==========================================
// PRESENTATION CALCULATIONS
// ==========================================

// Correct answer choice for current question
const currentQuestionCorrectAnswer = computed(() => {
  const q = questions.value.find(item => item.question_number === selectedQuestion.value)
  return q ? q.correct_answer : 'ยังไม่ระบุ'
})

// List of teams who answered CORRECTLY for current question
const correctTeamsList = computed(() => {
  if (teams.value.length === 0) return []
  return teams.value.filter(team => {
    const ansRow = answers.value.find(a => a.team_id === team.id && a.question_number === selectedQuestion.value)
    return ansRow && ansRow.is_correct
  })
})

const handleExit = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('staff_key')
    localStorage.removeItem('admin_passkey')
  }
  router.push('/')
}
</script>

<template>
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Configuration / Action Bar -->
    <div class="glass-card" style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
      <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 280px;">
        <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">เลือกรอบการแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input" style="max-width: 320px;">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <button @click="handleExit" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem;">
        <LogOut :size="16" />
        <span>ออกจากระบบ MC</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" style="text-align: center; color: var(--text-secondary); padding: 5rem;">
      <div class="loading-spin" style="width: 40px; height: 40px; border: 3px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%; margin: 0 auto 1.5rem;"></div>
      <p>กำลังเตรียมสถิติรายข้อสำหรับพิธีกร...</p>
    </div>

    <template v-else-if="currentRound">
      <div style="text-align: center; margin-bottom: 2rem;">
        <h1 style="font-size: 2.2rem; background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.25rem;">
          หน้าจอควบคุมสำหรับพิธีกร (MC View)
        </h1>
        <p style="color: var(--text-secondary); font-size: 1.05rem;">
          {{ currentRound.name }} • คัดกรองรายข้อแบบเรียลไทม์
        </p>
      </div>

      <!-- Main MC Layout Split Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; align-items: start;">
        
        <!-- Left: Question Selector and Answer Key -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          
          <div class="glass-card" style="border-color: var(--glass-border-glow); padding: 2rem; text-align: center;">
            <h2 style="font-size: 1.4rem; color: var(--text-secondary); margin-bottom: 1rem;">แสดงรายชื่อผู้ตอบถูก</h2>
            
            <div style="display: flex; align-items: center; justify-content: center; gap: 1.5rem; margin-bottom: 1.5rem;">
              <button 
                @click="selectedQuestion = Math.max(1, selectedQuestion - 1)" 
                class="btn btn-secondary" 
                style="width: 46px; height: 46px; border-radius: 50%; font-size: 1.25rem; padding: 0;"
                :disabled="selectedQuestion === 1"
              >
                <ChevronLeft :size="20" />
              </button>
              
              <div style="font-size: 3.5rem; font-family: var(--font-title); font-weight: 800; color: var(--color-cyan); text-shadow: var(--shadow-neon-cyan); min-width: 140px;">
                ข้อที่ {{ selectedQuestion }}
              </div>
              
              <button 
                @click="selectedQuestion = Math.min(20, selectedQuestion + 1)" 
                class="btn btn-secondary" 
                style="width: 46px; height: 46px; border-radius: 50%; font-size: 1.25rem; padding: 0;"
                :disabled="selectedQuestion === 20"
              >
                <ChevronRight :size="20" />
              </button>
            </div>

            <!-- Answer Key banner -->
            <div style="background: rgba(255,255,255,0.02); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border);">
              <span style="font-size: 0.9rem; color: var(--text-secondary); display: block; margin-bottom: 0.25rem;">เฉลยที่ถูกต้อง:</span>
              <span class="status-pill completed" style="background: rgba(0, 229, 255, 0.15); font-size: 1.5rem; font-weight: 800; padding: 0.4rem 1.5rem;">
                {{ currentQuestionCorrectAnswer }}
              </span>
            </div>

            <!-- Stats -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1.5rem;">
              <div style="background: rgba(0, 230, 118, 0.05); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid rgba(0, 230, 118, 0.15);">
                <span style="font-size: 0.8rem; color: var(--text-secondary); display: block;">ตอบถูก</span>
                <span style="font-size: 1.5rem; font-family: var(--font-title); font-weight: 800; color: var(--color-success);">
                  {{ correctTeamsList.length }} ทีม
                </span>
              </div>
              <div style="background: rgba(255, 255, 255, 0.02); padding: 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--glass-border);">
                <span style="font-size: 0.8rem; color: var(--text-secondary); display: block;">คิดเป็น</span>
                <span style="font-size: 1.5rem; font-family: var(--font-title); font-weight: 800; color: var(--color-cyan);">
                  {{ teams.length > 0 ? Math.round((correctTeamsList.length / teams.length) * 100) : 0 }}%
                </span>
              </div>
            </div>
          </div>

          <!-- Q1-Q20 Grid Selector -->
          <div class="glass-card">
            <h3 style="margin-bottom: 1rem; font-size: 1.1rem; color: var(--text-primary);">รายการคำถามทั้งหมด</h3>
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem;">
              <button 
                v-for="i in 20" 
                :key="i"
                @click="selectedQuestion = i"
                class="btn"
                :class="selectedQuestion === i ? 'btn-primary' : 'btn-secondary'"
                style="padding: 0.5rem 0; font-size: 0.9rem; font-family: var(--font-title); font-weight: 700; height: 42px; border-radius: 6px;"
              >
                Q{{ i }}
              </button>
            </div>
          </div>

        </div>

        <!-- Right: Correct Teams List -->
        <div class="glass-card" style="min-height: 480px; display: flex; flex-direction: column;">
          <h2 style="font-size: 1.3rem; margin-bottom: 1rem; color: var(--color-cyan); display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.75rem;">
            <Award :size="22" style="color: var(--color-gold);" />
            <span>ทีมที่ตอบถูกในข้อนี้ ({{ correctTeamsList.length }} ทีม)</span>
          </h2>

          <div v-if="correctTeamsList.length === 0" style="margin: auto; text-align: center; color: var(--text-secondary);">
            <Users :size="48" style="color: var(--text-muted); margin-bottom: 1rem;" />
            <p>ยังไม่มีทีมที่ตอบถูกในข้อนี้</p>
          </div>

          <div v-else style="display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; flex: 1; max-height: 500px; padding-right: 0.5rem;">
            <div 
              v-for="team in correctTeamsList" 
              :key="team.id"
              class="glass-card"
              style="background: rgba(0, 230, 118, 0.05); border-color: rgba(0, 230, 118, 0.2); padding: 1.5rem 2.5rem; display: flex; align-items: center; justify-content: space-between;"
            >
              <div style="display: flex; align-items: center; gap: 2rem;">
                <span style="font-family: var(--font-title); font-weight: 800; font-size: 2.6rem; color: var(--color-gold); text-shadow: var(--shadow-neon-cyan);">
                  TEAM {{ String(team.team_number).padStart(2, '0') }}
                </span>
                <span style="font-size: 2.4rem; font-weight: 700; color: var(--text-primary);">{{ team.name }}</span>
              </div>
              <CheckCircle :size="48" style="color: var(--color-success);" />
            </div>
          </div>
        </div>

      </div>

      <!-- Bottom: Data Entry Progress for MC -->
      <div class="glass-card" style="margin-top: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h3 style="font-size: 1.25rem; color: var(--text-primary);">ความคืบหน้าการบันทึกข้อมูลคำตอบ (คีย์ครบถ้วนแสดงเป็นสีเขียว)</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">
              ตรวจสอบว่าคำตอบถูกบันทึกเข้าระบบครบทุกทีมแล้วหรือไม่ (มีทีมทั้งหมด {{ teams.length }} ทีม)
            </p>
          </div>
          <button @click="fetchProgress" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem;">
            <RefreshCw :size="14" />
            <span>รีเฟรชความคืบหน้า</span>
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem;">
          <div 
            v-for="prog in dataEntryProgress" 
            :key="prog.question_number" 
            class="glass-card" 
            :style="prog.submitted_count === teams.length 
              ? 'border-color: rgba(0, 230, 118, 0.4); background: rgba(0, 230, 118, 0.04); display: flex; flex-direction: column; gap: 0.5rem;' 
              : 'display: flex; flex-direction: column; gap: 0.5rem;'"
          >
            <div style="display: flex; justify-content: space-between; font-weight: 700;">
              <span :style="prog.submitted_count === teams.length ? 'color: var(--color-success);' : 'color: var(--color-cyan);'">ข้อที่ {{ prog.question_number }}</span>
              <span :style="prog.submitted_count === teams.length ? 'color: var(--color-success); font-weight: 800;' : ''">
                {{ prog.submitted_count }} / {{ teams.length }} ทีม
              </span>
            </div>
            
            <!-- Progress Bar -->
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
              <div 
                :style="`width: ${teams.length > 0 ? (prog.submitted_count / teams.length) * 100 : 0}%`"
                :class="prog.submitted_count === teams.length ? 'bg-success' : 'bg-cyan'"
                style="height: 100%; border-radius: 3px;"
              ></div>
            </div>

            <div style="font-size: 0.75rem; text-align: right;" :style="prog.submitted_count === teams.length ? 'color: var(--color-success); font-weight: 800;' : 'color: var(--text-secondary);'">
              {{ prog.submitted_count === teams.length ? 'บันทึกครบถ้วนแล้ว' : 'ยังบันทึกไม่ครบ' }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-spin {
  animation: spin 1.2s linear infinite;
}
</style>

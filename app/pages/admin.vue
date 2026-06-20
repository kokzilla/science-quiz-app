<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { 
  Tv, 
  Users, 
  Settings, 
  BookOpen, 
  Plus, 
  Trash2, 
  Eye, 
  RefreshCw, 
  Grid,
  FileSpreadsheet,
  LogOut
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { supabase, isConfigured } = useSupabase()

const passkeyValid = ref(false)
const selectedRoundId = ref<string>('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)
const adminPasskey = ref('')

// Tab state: 'teams' | 'questions' | 'reveal' | 'progress'
const activeTab = ref<'teams' | 'questions' | 'reveal' | 'progress'>('teams')

// Teams State
const teams = ref<any[]>([])
const newTeamName = ref('')
const newTeamNumber = ref<number | ''>('')
const bulkTeamInput = ref('')
const isAddingTeam = ref(false)

// Questions / Answer Keys State
const questions = ref<any[]>([])

// Progress State
const dataEntryProgress = ref<any[]>([])

// Progress Detail Modal State
const showProgressModal = ref(false)
const modalQuestionNumber = ref(1)
const unansweredTeams = ref<any[]>([])
const modalLoading = ref(false)

// Fetch all rounds on mount
onMounted(async () => {
  if (typeof window !== 'undefined') {
    const key = localStorage.getItem('admin_passkey') || ''
    if (!key) {
      router.push('/')
      return
    }
    // Verify key
    if (supabase.value) {
      const { data } = await supabase.value.rpc('validate_passkey', { p_role: 'admin', p_passkey: key })
      if (!data) {
        router.push('/')
        return
      }
    } else {
      router.push('/')
      return
    }
    adminPasskey.value = key
    passkeyValid.value = true
  }
  
  if (isConfigured.value) {
    fetchRounds()
  }
})

// Save admin passkey to localstorage when it changes
watch(adminPasskey, (val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('admin_passkey', val)
  }
})

// Set active round from URL query param if present
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
  const { data, error } = await supabase.value
    .from('rounds')
    .select('*')
    .order('created_at', { ascending: false })
  if (!error && data) {
    roundsList.value = data
  }
}

const handleRoundChange = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  // Load round details
  const { data: roundData } = await supabase.value
    .from('rounds')
    .select('*')
    .eq('id', selectedRoundId.value)
    .single()
    
  if (roundData) {
    currentRound.value = roundData
    fetchTeams()
    fetchQuestions()
    fetchProgress()
  }
}

// ==========================================
// TEAMS MANAGEMENT
// ==========================================
const fetchTeams = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  const { data } = await supabase.value
    .from('teams')
    .select('*')
    .eq('round_id', selectedRoundId.value)
    .order('team_number', { ascending: true })
  if (data) {
    teams.value = data
    // Compute next team number suggestion
    if (data.length > 0) {
      newTeamNumber.value = Math.max(...data.map(t => t.team_number)) + 1
    } else {
      newTeamNumber.value = 1
    }
  }
}

const handleAddTeam = async () => {
  if (!supabase.value || !selectedRoundId.value || !newTeamName.value || newTeamNumber.value === '') return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  isAddingTeam.value = true
  const { error } = await supabase.value.rpc('manage_team_secure', {
    p_action: 'insert',
    p_round_id: selectedRoundId.value,
    p_team_number: newTeamNumber.value,
    p_name: newTeamName.value,
    p_tie_breaker_score: 0,
    p_team_id: '00000000-0000-0000-0000-000000000000', // dummy
    p_admin_passkey: adminPasskey.value
  })
  isAddingTeam.value = false
  if (!error) {
    newTeamName.value = ''
    fetchTeams()
    fetchProgress()
  } else {
    alert(`ข้อผิดพลาด: ${error.message}`)
  }
}

const handleBulkImportTeams = async () => {
  if (!supabase.value || !selectedRoundId.value || !bulkTeamInput.value.trim()) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const lines = bulkTeamInput.value.split('\n').map(l => l.trim()).filter(Boolean)
  
  const startNum = teams.value.length > 0 ? Math.max(...teams.value.map(t => t.team_number)) + 1 : 1
  const insertData = lines.map((line, index) => {
    let num = startNum + index
    let name = line
    
    // Try to split on tab or comma
    const match = line.match(/^(\d+)[\s,\t]+(.+)$/)
    if (match) {
      num = parseInt(match[1])
      name = match[2].trim()
    }
    
    return {
      team_number: num,
      name: name
    }
  })
  
  let successCount = 0
  let lastError = ''
  
  for (const team of insertData) {
    const { error } = await supabase.value.rpc('manage_team_secure', {
      p_action: 'insert',
      p_round_id: selectedRoundId.value,
      p_team_number: team.team_number,
      p_name: team.name,
      p_tie_breaker_score: 0,
      p_team_id: '00000000-0000-0000-0000-000000000000', // dummy
      p_admin_passkey: adminPasskey.value
    })
    if (error) {
      lastError = error.message
    } else {
      successCount++
    }
  }
  
  if (successCount > 0) {
    bulkTeamInput.value = ''
    fetchTeams()
    fetchProgress()
    alert(`นำเข้าทีมเข้าแข่งสำเร็จ ${successCount} ทีม!${lastError ? ` (ล้มเหลวบางส่วน: ${lastError})` : ''}`)
  } else if (lastError) {
    alert(`ข้อผิดพลาดการนำเข้า: ${lastError}`)
  }
}

const handleDeleteTeam = async (id: string) => {
  if (!supabase.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  if (confirm('คุณต้องการลบทีมนี้พร้อมข้อมูลคำตอบทั้งหมดของทีมนี้ใช่หรือไม่?')) {
    const { error } = await supabase.value.rpc('manage_team_secure', {
      p_action: 'delete',
      p_round_id: selectedRoundId.value,
      p_team_number: 0,
      p_name: '',
      p_tie_breaker_score: 0,
      p_team_id: id,
      p_admin_passkey: adminPasskey.value
    })
    if (!error) {
      fetchTeams()
      fetchProgress()
    } else {
      alert(`ลบไม่สำเร็จ: ${error.message}`)
    }
  }
}

const handleEditTeamName = async (teamId: string, currentName: string) => {
  const newName = prompt('แก้ไขชื่อโรงเรียน / ชื่อทีม:', currentName)
  if (newName === null) return
  const trimmed = newName.trim()
  if (!trimmed) {
    alert('ชื่อทีมต้องไม่เป็นค่าว่าง')
    return
  }

  if (!supabase.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  const { error } = await supabase.value.rpc('manage_team_secure', {
    p_action: 'update_name',
    p_round_id: selectedRoundId.value,
    p_team_number: 0,
    p_name: trimmed,
    p_tie_breaker_score: 0,
    p_team_id: teamId,
    p_admin_passkey: adminPasskey.value
  })

  if (!error) {
    fetchTeams()
  } else {
    alert(`แก้ไขชื่อทีมล้มเหลว: ${error.message}`)
  }
}

const handleUpdateTieBreaker = async (teamId: string, currentScore: number, amount: number) => {
  if (!supabase.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const newScore = Math.max(0, currentScore + amount)
  const { error } = await supabase.value.rpc('manage_team_secure', {
    p_action: 'tie_breaker',
    p_round_id: selectedRoundId.value,
    p_team_number: 0,
    p_name: '',
    p_tie_breaker_score: newScore,
    p_team_id: teamId,
    p_admin_passkey: adminPasskey.value
  })
  if (!error) {
    fetchTeams()
  } else {
    alert(`เกิดข้อผิดพลาด: ${error.message}`)
  }
}

// ==========================================
// QUESTIONS / ANSWER KEY SETUP
// ==========================================
const fetchQuestions = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  // Fetch questions - they are auto-created when the round is created
  const { data } = await supabase.value
    .from('questions')
    .select('*')
    .eq('round_id', selectedRoundId.value)
    .order('question_number', { ascending: true })
    
  if (data) {
    questions.value = data
  }
}

const handleUpdateCorrectAnswer = async (questionId: string, answer: string) => {
  if (!supabase.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const { error } = await supabase.value.rpc('manage_question_secure', {
    p_question_id: questionId,
    p_correct_answer: answer,
    p_admin_passkey: adminPasskey.value
  })
  if (!error) {
    questions.value = questions.value.map(q => q.id === questionId ? { ...q, correct_answer: answer } : q)
  } else {
    alert(`เกิดข้อผิดพลาด: ${error.message}`)
  }
}

// ==========================================
// SCORE REVEAL CONTROL
// ==========================================
const handleUpdateReveal = async (val: number) => {
  if (!supabase.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const targetVal = Math.min(20, Math.max(0, val))
  const { error } = await supabase.value.rpc('manage_round_secure', {
    p_action: 'update_reveal',
    p_round_name: '',
    p_status: '',
    p_reveal_q: targetVal,
    p_round_id: selectedRoundId.value,
    p_admin_passkey: adminPasskey.value
  })
  if (!error) {
    currentRound.value.revealed_question_number = targetVal
  } else {
    alert(`เกิดข้อผิดพลาด: ${error.message}`)
  }
}

const handleUpdateStatus = async (status: string) => {
  if (!supabase.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const { error } = await supabase.value.rpc('manage_round_secure', {
    p_action: 'update_status',
    p_round_name: '',
    p_status: status,
    p_reveal_q: 0,
    p_round_id: selectedRoundId.value,
    p_admin_passkey: adminPasskey.value
  })
  if (!error) {
    currentRound.value.status = status
    fetchRounds()
  } else {
    alert(`เกิดข้อผิดพลาด: ${error.message}`)
  }
}

// ==========================================
// PROGRESS & DATA ENTRY STATISTICS
// ==========================================
const fetchProgress = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  
  // Get counts of answers by question_number for this round
  const { data: countData } = await supabase.value
    .rpc('get_answers_progress', { r_id: selectedRoundId.value })
  
  if (countData) {
    dataEntryProgress.value = countData
  } else {
    // Fallback: Fetch count using standard queries
    const { data: teamsInRound } = await supabase.value
      .from('teams')
      .select('id')
      .eq('round_id', selectedRoundId.value)
      
    const teamIds = (teamsInRound || []).map(t => t.id)
    
    if (teamIds.length === 0) {
      dataEntryProgress.value = Array.from({ length: 20 }, (_, i) => ({
        question_number: i + 1,
        submitted_count: 0
      }))
      return
    }

    const { data: answersData } = await supabase.value
      .from('answers')
      .select('question_number, submitted_answer')
      .in('team_id', teamIds)
      
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

const handleShowProgressDetails = async (qNum: number) => {
  modalQuestionNumber.value = qNum
  showProgressModal.value = true
  modalLoading.value = true
  unansweredTeams.value = []

  try {
    if (!supabase.value || !selectedRoundId.value) return

    const roundTeamIds = teams.value.map(t => t.id)
    if (roundTeamIds.length === 0) return

    const { data: answeredRows } = await supabase.value
      .from('answers')
      .select('team_id, submitted_answer')
      .in('team_id', roundTeamIds)
      .eq('question_number', qNum)

    const answeredTeamIds = (answeredRows || [])
      .filter(r => r.submitted_answer)
      .map(r => r.team_id)

    unansweredTeams.value = teams.value.filter(t => !answeredTeamIds.includes(t.id))
  } catch (err) {
    console.error('Error fetching progress details:', err)
  } finally {
    modalLoading.value = false
  }
}

// Create new Round
const newRoundName = ref('')
const handleCreateRound = async () => {
  if (!supabase.value || !newRoundName.value.trim()) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  const { data, error } = await supabase.value.rpc('manage_round_secure', {
    p_action: 'create',
    p_round_name: newRoundName.value.trim(),
    p_status: 'pending',
    p_reveal_q: 0,
    p_round_id: '00000000-0000-0000-0000-000000000000', // dummy
    p_admin_passkey: adminPasskey.value
  })
  
  if (!error && data && data.length > 0) {
    newRoundName.value = ''
    await fetchRounds()
    selectedRoundId.value = data[0].round_id
    handleRoundChange()
  } else {
    alert(`ข้อผิดพลาด: ${error?.message || 'รหัสผ่านแอดมินไม่ถูกต้อง หรือเกิดข้อผิดพลาดในการสร้าง'}`)
  }
}

const handleDeleteRound = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  if (confirm(`คุณต้องการลบรอบการแข่งขัน "${currentRound.value.name}" และข้อมูลที่เกี่ยวข้องทั้งหมดใช่หรือไม่? (การกระทำนี้ย้อนคืนไม่ได้!)`)) {
    const { error } = await supabase.value.rpc('manage_round_secure', {
      p_action: 'delete',
      p_round_name: '',
      p_status: '',
      p_reveal_q: 0,
      p_round_id: selectedRoundId.value,
      p_admin_passkey: adminPasskey.value
    })
    if (!error) {
      currentRound.value = null
      fetchRounds()
    } else {
      alert(`ลบไม่สำเร็จ: ${error.message}`)
    }
  }
}

const handleLogout = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('admin_passkey')
  }
  router.push('/')
}
</script>

<template>
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Selector -->
    <div class="glass-card" style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
      <div style="display: flex; align-items: center; gap: 1rem; flex: 1.5; min-width: 280px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
          <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">เลือกรอบ:</label>
          <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input">
            <option v-for="r in roundsList" :key="r.id" :value="r.id">
              {{ r.name }} ({{ r.status }})
            </option>
          </select>
        </div>
        
        <!-- Admin Passkey input removed to keep UI simple -->
      </div>
      
      <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
        <button @click="handleLogout" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem; height: 42px;">
          <LogOut :size="16" />
          <span>ออกจากระบบ</span>
        </button>
        
        <input 
          v-model="newRoundName" 
          type="text" 
          class="form-input" 
          placeholder="เพิ่มรอบใหม่ เช่น รอบมัธยมต้น" 
          style="max-width: 220px;"
          @keyup.enter="handleCreateRound"
        />
        <button @click="handleCreateRound" class="btn btn-primary" style="padding: 0.5rem 1rem;">
          <Plus :size="16" />
          สร้างรอบใหม่
        </button>
      </div>
    </div>

    <!-- Active Round Display -->
    <div v-if="currentRound" class="glass-card" style="margin-bottom: 2rem; border-color: var(--glass-border-glow);">
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: 1.5rem; margin-bottom: 1.5rem;">
        <div>
          <h1 style="font-size: 2rem; margin-bottom: 0.25rem; color: #fff;">{{ currentRound.name }}</h1>
          <p style="color: var(--text-secondary); display: flex; align-items: center; gap: 0.5rem;">
            <span>สถานะ: </span>
            <span class="status-pill" :class="currentRound.status">{{ currentRound.status }}</span>
            <span>| เผยแพร่ถึงข้อที่: </span>
            <span class="status-pill completed" style="background: rgba(0, 229, 255, 0.15)">{{ currentRound.revealed_question_number }}</span>
          </p>
        </div>

        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button 
            @click="handleUpdateStatus(currentRound.status === 'active' ? 'completed' : 'active')" 
            class="btn"
            :class="currentRound.status === 'active' ? 'btn-secondary' : 'btn-success'"
          >
            {{ currentRound.status === 'active' ? 'สิ้นสุดการแข่ง' : 'เริ่มการแข่งขัน' }}
          </button>
          
          <NuxtLink :to="`/scoreboard?round=${currentRound.id}`" target="_blank" class="btn btn-primary">
            <Tv :size="16" />
            เปิดหน้าจอ TV Scoreboard
          </NuxtLink>

          <button @click="handleDeleteRound" class="btn btn-danger" style="padding: 0.5rem 1rem;">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <!-- Tabs Navigation -->
      <div style="display: flex; border-bottom: 1px solid var(--glass-border); margin-bottom: 1.5rem; overflow-x: auto; gap: 0.5rem;">
        <button 
          @click="activeTab = 'teams'" 
          class="btn" 
          :style="activeTab === 'teams' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <Users :size="16" />
          จัดการทีมเข้าแข่ง ({{ teams.length }})
        </button>
        
        <button 
          @click="activeTab = 'questions'" 
          class="btn" 
          :style="activeTab === 'questions' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <BookOpen :size="16" />
          ตั้งค่าเฉลยคำตอบ (20 ข้อ)
        </button>

        <button 
          @click="activeTab = 'reveal'" 
          class="btn" 
          :style="activeTab === 'reveal' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <Eye :size="16" />
          ควบคุมการเปิดเผยคะแนน (Reveal)
        </button>

        <button 
          @click="activeTab = 'progress'" 
          @click.capture="fetchProgress"
          class="btn" 
          :style="activeTab === 'progress' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <Grid :size="16" />
          ความคืบหน้าการคีย์ข้อมูล
        </button>
      </div>

      <!-- Tab Content: Teams Management -->
      <div v-if="activeTab === 'teams'">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem;">
          
          <!-- Add Single & Bulk Teams -->
          <div>
            <div class="glass-card" style="background: rgba(255,255,255,0.02); margin-bottom: 1.5rem;">
              <h3 style="margin-bottom: 1rem; font-size: 1.1rem; color: var(--color-cyan);">เพิ่มทีมทีละข้อ</h3>
              <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                <input 
                  v-model="newTeamNumber" 
                  type="number" 
                  class="form-input" 
                  placeholder="เลขที่ทีม" 
                  style="max-width: 80px;"
                />
                <input 
                  v-model="newTeamName" 
                  type="text" 
                  class="form-input" 
                  placeholder="ชื่อทีม / ชื่อโรงเรียน" 
                  @keyup.enter="handleAddTeam"
                />
              </div>
              <button @click="handleAddTeam" :disabled="isAddingTeam" class="btn btn-primary" style="width: 100%;">
                <Plus :size="16" />
                {{ isAddingTeam ? 'กำลังเพิ่ม...' : 'เพิ่มทีมเข้าแข่ง' }}
              </button>
            </div>

            <div class="glass-card" style="background: rgba(255,255,255,0.02);">
              <h3 style="margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--color-cyan); display: flex; align-items: center; gap: 0.5rem;">
                <FileSpreadsheet :size="18" />
                <span>นำเข้าข้อมูลแบบกลุ่ม (Bulk Import)</span>
              </h3>
              <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem;">
                กรอกรายชื่อทีม 1 บรรทัดต่อ 1 ทีม (สามารถระบุเลขทีมนำหน้าได้ เช่น "01, โรงเรียนวัดราษฎร์ A" หรือเพียงแค่ "โรงเรียนวัดราษฎร์ A")
              </p>
              <textarea 
                v-model="bulkTeamInput" 
                rows="6" 
                class="form-input" 
                placeholder="โรงเรียนวัดราษฎร์ ทีม A&#10;โรงเรียนวัดราษฎร์ ทีม B&#10;โรงเรียนวิทยาศาสตร์"
                style="resize: vertical; font-family: monospace; font-size: 0.9rem; margin-bottom: 1rem;"
              ></textarea>
              <button @click="handleBulkImportTeams" class="btn btn-secondary" style="width: 100%;">
                นำเข้าข้อมูลรายชื่อทีม
              </button>
            </div>
          </div>

          <!-- Teams List & Tie Breaker Ajustment -->
          <div style="flex: 1.5;">
            <h3 style="margin-bottom: 1rem; font-size: 1.2rem; color: #fff;">รายชื่อทีมเข้าแข่งทั้งหมด ({{ teams.length }} ทีม)</h3>
            
            <div v-if="teams.length === 0" style="color: var(--text-secondary); text-align: center; padding: 3rem;">
              ไม่พบทีมเข้าแข่งในระบบ
            </div>
            
            <div v-else class="table-responsive">
              <table class="report-table">
                <thead>
                  <tr>
                    <th style="width: 70px;">เลขทีม</th>
                    <th>ชื่อโรงเรียน/ทีม</th>
                    <th style="width: 160px; text-align: center;">คะแนนไทเบรกเกอร์ (เสมอกัน)</th>
                    <th style="width: 70px; text-align: right;">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="team in teams" :key="team.id">
                    <td style="font-family: var(--font-title); font-weight: 700; color: var(--color-cyan);">
                      {{ String(team.team_number).padStart(2, '0') }}
                    </td>
                    <td style="font-weight: 600; cursor: pointer; text-decoration: underline dotted var(--color-cyan);" @click="handleEditTeamName(team.id, team.name)">
                      {{ team.name }}
                      <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-left: 0.25rem;">(แก้ไข)</span>
                    </td>
                    <td>
                      <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
                        <button @click="handleUpdateTieBreaker(team.id, team.tie_breaker_score, -1)" class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">
                          -
                        </button>
                        <span style="font-family: var(--font-title); font-weight: 800; min-width: 24px; text-align: center; color: var(--color-gold);">
                          {{ team.tie_breaker_score }}
                        </span>
                        <button @click="handleUpdateTieBreaker(team.id, team.tie_breaker_score, 1)" class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">
                          +
                        </button>
                      </div>
                    </td>
                    <td style="text-align: right;">
                      <button @click="handleDeleteTeam(team.id)" class="btn btn-danger" style="padding: 0.35rem; border-radius: 4px;">
                        <Trash2 :size="14" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Questions & Correct Answers Setup -->
      <div v-if="activeTab === 'questions'">
        <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; color: #fff;">ตั้งค่ากุญแจเฉลยคำตอบ (Answer Key)</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">
          กรุณากำหนดคำเฉลยข้อที่ถูกต้อง (ก, ข, ค, ง) สำหรับคำถามทั้ง 20 ข้อ ระบบจะนำไปคำนวณคะแนนให้อัตโนมัติ
        </p>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem;">
          <div 
            v-for="q in questions" 
            :key="q.id" 
            class="glass-card" 
            style="background: rgba(255,255,255,0.02); display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.25rem;"
          >
            <span style="font-family: var(--font-title); font-weight: 700; font-size: 1.1rem; color: var(--color-cyan);">
              ข้อที่ {{ String(q.question_number).padStart(2, '0') }}
            </span>
            
            <div style="display: flex; gap: 0.25rem;">
              <button 
                v-for="ans in ['ก', 'ข', 'ค', 'ง']" 
                :key="ans"
                @click="handleUpdateCorrectAnswer(q.id, ans)"
                class="btn"
                :class="q.correct_answer === ans ? `option-btn selected-${ans}` : 'btn-secondary'"
                style="width: 38px; height: 38px; padding: 0; font-size: 0.95rem; border-radius: 4px;"
              >
                {{ ans }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Reveal Score Control -->
      <div v-if="activeTab === 'reveal'">
        <h3 style="margin-bottom: 0.5rem; font-size: 1.25rem; color: #fff;">ควบคุมการเปิดเผยคะแนนบนหน้าจอ TV</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">
          ผู้ควบคุมสามารถเลื่อนสไลด์ด้านล่างเพื่อควบคุมว่า หน้าจอ TV Scoreboard จะคำนวณคะแนนแสดงผลถึงข้อที่เท่าใด (สร้างความลุ้นระทึกให้ผู้แข่ง!)
        </p>

        <div class="glass-card" style="background: rgba(255,255,255,0.02); padding: 3rem 2rem; text-align: center;">
          <div style="font-size: 4rem; font-family: var(--font-title); font-weight: 800; color: var(--color-cyan); margin-bottom: 1rem; text-shadow: var(--shadow-neon-cyan);">
            ข้อที่ {{ currentRound.revealed_question_number }}
          </div>
          
          <p style="color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.05rem;">
            หน้าจอ TV จะแสดงอันดับคะแนนรวมของคำตอบตั้งแต่ <strong>ข้อที่ 1 ถึงข้อที่ {{ currentRound.revealed_question_number }}</strong> เท่านั้น
          </p>

          <div style="max-width: 600px; margin: 0 auto; display: flex; align-items: center; gap: 1.5rem;">
            <button 
              @click="handleUpdateReveal(currentRound.revealed_question_number - 1)" 
              class="btn btn-secondary" 
              style="width: 50px; height: 50px; border-radius: 50%; font-size: 1.5rem; padding: 0;"
              :disabled="currentRound.revealed_question_number === 0"
            >
              -
            </button>
            
            <input 
              type="range" 
              min="0" 
              max="20" 
              :value="currentRound.revealed_question_number" 
              @input="e => handleUpdateReveal(parseInt((e.target as HTMLInputElement).value))"
              style="flex: 1; accent-color: var(--color-cyan); height: 8px; border-radius: 4px; cursor: pointer;"
            />
            
            <button 
              @click="handleUpdateReveal(currentRound.revealed_question_number + 1)" 
              class="btn btn-secondary" 
              style="width: 50px; height: 50px; border-radius: 50%; font-size: 1.5rem; padding: 0;"
              :disabled="currentRound.revealed_question_number === 20"
            >
              +
            </button>
          </div>

          <div style="display: flex; justify-content: center; gap: 0.75rem; margin-top: 3rem;">
            <button @click="handleUpdateReveal(0)" class="btn btn-secondary">
              ซ่อนคะแนนทั้งหมด (ข้อ 0)
            </button>
            <button @click="handleUpdateReveal(10)" class="btn btn-secondary">
              แสดงครึ่งแรก (ข้อ 10)
            </button>
            <button @click="handleUpdateReveal(20)" class="btn btn-primary">
              แสดงผลคะแนนทั้งหมด (ข้อ 20)
            </button>
          </div>
        </div>
      </div>

      <!-- Tab Content: Progress Monitoring -->
      <div v-if="activeTab === 'progress'">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h3 style="font-size: 1.25rem; color: #fff;">ตรวจสอบความคืบหน้าการบันทึกข้อมูล</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">
              ตรวจสอบว่าเจ้าหน้าที่บันทึกคะแนนกรอกคำตอบครบถ้วนของแต่ละข้อหรือยัง (มีทีมทั้งหมด {{ teams.length }} ทีม)
            </p>
          </div>
          <button @click="fetchProgress" class="btn btn-secondary" style="display: flex; align-items: center; gap: 0.25rem;">
            <RefreshCw :size="14" />
            <span>รีเฟรชข้อมูล</span>
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem;">
          <div 
            v-for="prog in dataEntryProgress" 
            :key="prog.question_number" 
            class="glass-card" 
            style="background: rgba(255,255,255,0.02); display: flex; flex-direction: column; gap: 0.5rem; cursor: pointer; transition: transform 0.2s, border-color 0.2s;"
            @click="handleShowProgressDetails(prog.question_number)"
            onmouseover="this.style.borderColor='var(--color-cyan)';" 
            onmouseout="this.style.borderColor='var(--glass-border)';"
          >
            <div style="display: flex; justify-content: space-between; font-weight: 700;">
              <span style="color: var(--color-cyan);">ข้อที่ {{ prog.question_number }}</span>
              <span>{{ prog.submitted_count }} / {{ teams.length }} ทีม</span>
            </div>
            
            <!-- Progress Bar -->
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
              <div 
                :style="`width: ${teams.length > 0 ? (prog.submitted_count / teams.length) * 100 : 0}%`"
                :class="prog.submitted_count === teams.length ? 'bg-success' : 'bg-cyan'"
                style="height: 100%; border-radius: 3px;"
              ></div>
            </div>

            <div style="font-size: 0.75rem; text-align: right;" :style="prog.submitted_count === teams.length ? 'color: var(--color-success);' : 'color: var(--text-secondary);'">
              {{ prog.submitted_count === teams.length ? 'บันทึกครบแล้ว' : 'ยังบันทึกไม่ครบ' }}
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- No active round selected -->
    <div v-else style="text-align: center; padding: 5rem 0;">
      <p style="color: var(--text-secondary);">กรุณาเลือกหรือสร้างรอบการแข่งขันเพื่อเปิดใช้งานระบบควบคุม</p>
    </div>

    <!-- Progress Details Modal -->
    <div v-if="showProgressModal" class="modal-backdrop no-print" @click.self="showProgressModal = false">
      <div class="glass-card modal-content" style="max-width: 500px; width: 90%; margin: 10% auto; position: relative; padding: 2.2rem; background: var(--bg-secondary); border: 1px solid var(--glass-border-glow); box-shadow: 0 0 30px rgba(0,229,255,0.25);">
        <button @click="showProgressModal = false" class="btn btn-secondary" style="position: absolute; top: 1rem; right: 1rem; padding: 0; width: 32px; height: 32px; border-radius: 50%; font-size: 1rem; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05);">
          ✕
        </button>

        <h2 style="font-size: 1.4rem; color: var(--color-cyan); margin-bottom: 0.5rem; font-family: var(--font-title);">
          รายละเอียด ความคืบหน้าข้อที่ {{ modalQuestionNumber }}
        </h2>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">
          รายชื่อทีมที่ยังไม่ได้คีย์ตัวเลือกคำตอบลงระบบในข้อนี้
        </p>

        <div v-if="modalLoading" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
          <div class="loading-spin" style="width: 32px; height: 32px; border: 3px solid var(--color-cyan); border-top-color: transparent; border-radius: 50%; margin: 0 auto 1rem; animation: spin 1s linear infinite;"></div>
          กำลังโหลดรายละเอียด...
        </div>

        <div v-else>
          <div v-if="unansweredTeams.length === 0" style="text-align: center; color: var(--color-success); padding: 2.5rem; font-weight: 600; font-size: 1.1rem;">
            ✓ คีย์คะแนนครบถ้วนหมดทุกทีมแล้ว
          </div>
          <div v-else style="display: flex; flex-direction: column; gap: 0.65rem; max-height: 320px; overflow-y: auto; padding-right: 0.5rem;">
            <div 
              v-for="team in unansweredTeams" 
              :key="team.id"
              class="glass-card"
              style="background: rgba(255, 23, 68, 0.04); border-color: rgba(255, 23, 68, 0.15); padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center;"
            >
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-family: var(--font-title); font-weight: 800; color: var(--color-gold);">
                  TEAM {{ String(team.team_number).padStart(2, '0') }}
                </span>
                <span style="font-weight: 600; color: #fff;">
                  {{ team.name }}
                </span>
              </div>
              <span class="status-pill pending" style="background: rgba(255, 23, 68, 0.08); color: var(--color-error); font-size: 0.7rem; padding: 0.2rem 0.5rem;">
                ยังไม่ได้คีย์
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.text-cyan {
  color: var(--color-cyan);
}
.bg-cyan {
  background: var(--color-cyan);
  box-shadow: 0 0 5px rgba(0, 229, 255, 0.5);
}
.bg-success {
  background: var(--color-success);
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-spin {
  animation: spin 1s linear infinite;
}
</style>

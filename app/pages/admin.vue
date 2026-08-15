<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { TOTAL_QUESTIONS } from '~/utils/constants'
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
  LogOut,
  Upload,
  Database,
  Sliders,
  Presentation,
  Pencil,
  Award
} from 'lucide-vue-next'
import type { Team, Question, ProgressSummary } from '~/types'

const route = useRoute()
const { supabase, isConfigured } = useSupabase()
const { validateAdminOnly, getActivePasskey, logout } = useAuth()

const passkeyValid = ref(false)
const adminPasskey = ref('')

// Tab state: 'teams' | 'questions' | 'reveal' | 'progress' | 'bank'
const activeTab = ref<'teams' | 'questions' | 'reveal' | 'progress' | 'bank'>('teams')

// Teams State
const teams = ref<Team[]>([])
const newTeamName = ref('')
const newTeamSchoolName = ref('')
const newTeamNumber = ref<number | ''>('')
const bulkTeamInput = ref('')
const isAddingTeam = ref(false)

// Edit Team Modal State
const showEditTeamModal = ref(false)
const editingTeam = ref<Team | null>(null)
const editTeamNumber = ref<number | ''>('')
const editTeamName = ref('')
const editTeamSchoolName = ref('')
const editTeamError = ref('')
const isSavingEditTeam = ref(false)

// Questions / Answer Keys State
const questions = ref<Question[]>([])

// Progress State
const dataEntryProgress = ref<ProgressSummary[]>([])

// Progress Detail Modal State
const showProgressModal = ref(false)
const modalQuestionNumber = ref(1)
const unansweredTeams = ref<Team[]>([])
const modalLoading = ref(false)

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  
  await fetchTeams()
  await fetchQuestions()
  await fetchProgress()
}

// Using useRoundSelector composable
const {
  selectedRoundId,
  roundsList,
  currentRound,
  fetchRounds,
  handleRoundChange
} = useRoundSelector(onRoundChanged)

// Fetch all rounds and check credentials on mount
onMounted(async () => {
  const isValid = await validateAdminOnly()
  if (!isValid) return
  
  adminPasskey.value = getActivePasskey()
  passkeyValid.value = true
})

// Save admin passkey to localstorage when it changes
watch(adminPasskey, (val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('admin_passkey', val)
  }
})

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
    teams.value = data as Team[]
    // Compute next team number suggestion
    if (data.length > 0) {
      newTeamNumber.value = Math.max(...data.map(t => t.team_number)) + 1
    } else {
      newTeamNumber.value = 1
    }
  }
}

const handleAddTeam = async () => {
  if (!supabase.value || !selectedRoundId.value || !newTeamName.value.trim() || newTeamNumber.value === '') return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  const targetNum = Number(newTeamNumber.value)
  if (teams.value.some(t => t.team_number === targetNum)) {
    alert(`เลขทีม ${targetNum} ถูกใช้งานแล้วในการแข่งขันนี้ กรุณาใช้เลขทีมอื่น`)
    return
  }

  isAddingTeam.value = true
  const { error } = await supabase.value.rpc('manage_team_secure', {
    p_action: 'insert',
    p_round_id: selectedRoundId.value,
    p_team_number: targetNum,
    p_name: newTeamName.value.trim(),
    p_tie_breaker_score: 0,
    p_team_id: '00000000-0000-0000-0000-000000000000', // dummy
    p_admin_passkey: adminPasskey.value,
    p_school_name: newTeamSchoolName.value.trim() || null
  })
  isAddingTeam.value = false
  if (!error) {
    newTeamName.value = ''
    newTeamSchoolName.value = ''
    fetchTeams()
    fetchProgress()
  } else {
    if (error.message?.includes('Could not find the function')) {
      alert('เกิดข้อผิดพลาด: ฐานข้อมูล Supabase ยังไม่ได้อัปเดตฟังก์ชันใหม่\n\nกรุณานำคอลัมน์และฟังก์ชันจาก supabase_schema.sql ไปรันใน Supabase SQL Editor ก่อนครับ')
    } else {
      alert(`ข้อผิดพลาด: ${error.message}`)
    }
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
    let school: string | null = null
    
    // Try to split on tab or comma
    const parts = line.split(/[\t,]+/).map(p => p.trim())
    if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
      num = parseInt(parts[0])
      name = parts[1]
      if (parts[2]) school = parts[2]
    } else {
      const match = line.match(/^(\d+)[\s,\t]+(.+)$/)
      if (match) {
        num = parseInt(match[1])
        name = match[2].trim()
      }
    }
    
    return {
      team_number: num,
      name: name,
      school_name: school
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
      p_admin_passkey: adminPasskey.value,
      p_school_name: team.school_name
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
    if (lastError.includes('Could not find the function')) {
      alert('เกิดข้อผิดพลาด: ฐานข้อมูล Supabase ยังไม่ได้อัปเดตฟังก์ชันใหม่\n\nกรุณานำคอลัมน์และฟังก์ชันจาก supabase_schema.sql ไปรันใน Supabase SQL Editor ก่อนครับ')
    } else {
      alert(`ข้อผิดพลาดการนำเข้า: ${lastError}`)
    }
  }
}

const openEditTeamModal = (team: Team) => {
  editingTeam.value = team
  editTeamNumber.value = team.team_number
  editTeamName.value = team.name
  editTeamSchoolName.value = team.school_name || ''
  editTeamError.value = ''
  showEditTeamModal.value = true
}

const handleSaveEditTeam = async () => {
  if (!editingTeam.value || editTeamNumber.value === '' || !editTeamName.value.trim()) {
    editTeamError.value = 'กรุณากรอกเลขทีมและชื่อทีมให้ครบถ้วน'
    return
  }

  const targetNum = Number(editTeamNumber.value)
  const trimmedName = editTeamName.value.trim()
  const trimmedSchool = editTeamSchoolName.value.trim() || null

  // Check duplicate team number in current round (excluding current team)
  const isDuplicate = teams.value.some(
    t => t.id !== editingTeam.value!.id && t.team_number === targetNum
  )

  if (isDuplicate) {
    editTeamError.value = `เลขทีม ${targetNum} ถูกใช้งานแล้วในการแข่งขันนี้ กรุณาใช้เลขทีมอื่น`
    return
  }

  if (!supabase.value || !selectedRoundId.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  isSavingEditTeam.value = true
  editTeamError.value = ''

  try {
    const { error } = await supabase.value.rpc('manage_team_secure', {
      p_action: 'update_team',
      p_round_id: selectedRoundId.value,
      p_team_number: targetNum,
      p_name: trimmedName,
      p_tie_breaker_score: 0,
      p_team_id: editingTeam.value.id,
      p_admin_passkey: adminPasskey.value,
      p_school_name: trimmedSchool
    })

    if (error) {
      if (error.message?.includes('Could not find the function')) {
        editTeamError.value = 'ฐานข้อมูล Supabase ยังไม่ได้อัปเดตฟังก์ชันใหม่ กรุณารันคำสั่ง SQL ใน Supabase SQL Editor ก่อนครับ'
      } else {
        editTeamError.value = `เกิดข้อผิดพลาด: ${error.message}`
      }
    } else {
      showEditTeamModal.value = false
      await fetchTeams()
    }
  } catch (err: any) {
    editTeamError.value = `เกิดข้อผิดพลาด: ${err.message}`
  } finally {
    isSavingEditTeam.value = false
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
  const { data } = await supabase.value
    .from('questions')
    .select('*')
    .eq('round_id', selectedRoundId.value)
    .order('question_number', { ascending: true })
    
  if (data) {
    questions.value = data as Question[]
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
    questions.value = questions.value.map(q => q.id === questionId ? { ...q, correct_answer: answer as any } : q)
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
  const targetVal = Math.min(TOTAL_QUESTIONS, Math.max(0, val))
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
    currentRound.value.status = status as any
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
  
  const { data: countData } = await supabase.value
    .rpc('get_answers_progress', { r_id: selectedRoundId.value })
  
  if (countData) {
    dataEntryProgress.value = countData as ProgressSummary[]
  } else {
    // Fallback: Fetch count using standard queries
    const { data: teamsInRound } = await supabase.value
      .from('teams')
      .select('id')
      .eq('round_id', selectedRoundId.value)
      
    const teamIds = (teamsInRound || []).map(t => t.id)
    
    if (teamIds.length === 0) {
      dataEntryProgress.value = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => ({
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
    for (let i = 1; i <= TOTAL_QUESTIONS; i++) counts[i] = 0
    
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
  if (confirm(`คุณต้องการลบรอบการแข่งขัน "${currentRound.value?.name}" และข้อมูลที่เกี่ยวข้องทั้งหมดใช่หรือไม่? (การกระทำนี้ย้อนคืนไม่ได้!)`)) {
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

const handleEditRoundDetails = async () => {
  if (!supabase.value || !selectedRoundId.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  const newName = prompt('แก้ไขชื่อรอบการแข่งขัน:', currentRound.value.name)
  if (newName === null) return
  const trimmedName = newName.trim()
  if (!trimmedName) {
    alert('ชื่อรอบการแข่งขันต้องไม่เป็นค่าว่าง')
    return
  }

  const newDate = prompt('แก้ไขวันที่แข่งขัน (เช่น 3 กรกฎาคม 2569):', currentRound.value.round_date || '')
  if (newDate === null) return
  const trimmedDate = newDate.trim()

  const { error } = await supabase.value.rpc('manage_round_secure', {
    p_action: 'update_details',
    p_round_name: trimmedName,
    p_status: trimmedDate,
    p_reveal_q: 0,
    p_round_id: selectedRoundId.value,
    p_admin_passkey: adminPasskey.value
  })

  if (!error) {
    currentRound.value.name = trimmedName
    currentRound.value.round_date = trimmedDate
    await fetchRounds()
  } else {
    alert(`เกิดข้อผิดพลาดในการแก้ไขข้อมูลรอบ: ${error.message}`)
  }
}

const handleResetRound = async () => {
  if (!supabase.value || !selectedRoundId.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  
  const confirmed1 = confirm(`คำเตือน: คุณกำลังจะเริ่มการแข่งขันใหม่สำหรับรอบ "${currentRound.value.name}"\n\nการกระทำนี้จะลบคำตอบและการบันทึกคะแนนทั้งหมดของทุกทีมในรอบนี้! คุณต้องการดำเนินการต่อหรือไม่?`)
  if (!confirmed1) return

  const confirmed2 = confirm(`กรุณายืนยันอีกครั้งว่าต้องการลบข้อมูลคะแนนทั้งหมดและเริ่มการแข่งขันใหม่ตั้งแต่ข้อที่ 1`)
  if (!confirmed2) return

  try {
    const { error } = await supabase.value.rpc('manage_round_secure', {
      p_action: 'reset',
      p_round_name: '',
      p_status: '',
      p_reveal_q: 0,
      p_round_id: selectedRoundId.value,
      p_admin_passkey: adminPasskey.value
    })

    if (error) throw error
    
    alert('รีเซ็ตรอบการแข่งขันเรียบร้อยแล้ว คะแนนทั้งหมดถูกล้าง และรอบถูกย้ายไปที่ข้อที่ 1')
    await handleRoundChange()
  } catch (err: any) {
    alert(`ไม่สามารถรีเซ็ตรอบการแข่งขันได้: ${err.message}`)
  }
}

// ==========================================
// QUESTION BANK MANAGEMENT
// ==========================================
const selectedQuestionNumber = ref(1)
const questionForm = ref({
  correct_answer: 'ก',
  is_image_only: false,
  question_text: '',
  choice_a: '',
  choice_b: '',
  choice_c: '',
  choice_d: '',
  question_image_url: '',
  answer_image_url: '',
  choices_layout: '2_col'
})

const loadQuestionForm = () => {
  const existing = questions.value.find(q => q.question_number === selectedQuestionNumber.value)
  if (existing) {
    questionForm.value = {
      correct_answer: existing.correct_answer || 'ก',
      is_image_only: !!existing.is_image_only,
      question_text: existing.question_text || '',
      choice_a: existing.choice_a || '',
      choice_b: existing.choice_b || '',
      choice_c: existing.choice_c || '',
      choice_d: existing.choice_d || '',
      question_image_url: existing.question_image_url || '',
      answer_image_url: existing.answer_image_url || '',
      choices_layout: existing.choices_layout || '2_col'
    }
  } else {
    questionForm.value = {
      correct_answer: 'ก',
      is_image_only: false,
      question_text: '',
      choice_a: '',
      choice_b: '',
      choice_c: '',
      choice_d: '',
      question_image_url: '',
      answer_image_url: '',
      choices_layout: '2_col'
    }
  }
}

watch([selectedQuestionNumber, questions], loadQuestionForm, { immediate: true })

const isSavingQuestion = ref(false)
const handleSaveQuestion = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }
  isSavingQuestion.value = true
  try {
    const { error } = await supabase.value.rpc('save_question_secure', {
      p_round_id: selectedRoundId.value,
      p_question_number: selectedQuestionNumber.value,
      p_correct_answer: questionForm.value.correct_answer,
      p_is_image_only: questionForm.value.is_image_only,
      p_question_text: questionForm.value.question_text,
      p_choice_a: questionForm.value.choice_a,
      p_choice_b: questionForm.value.choice_b,
      p_choice_c: questionForm.value.choice_c,
      p_choice_d: questionForm.value.choice_d,
      p_question_image_url: questionForm.value.question_image_url,
      p_answer_image_url: questionForm.value.answer_image_url,
      p_choices_layout: questionForm.value.choices_layout,
      p_passkey: adminPasskey.value
    })
    if (error) throw error
    alert('บันทึกข้อมูลคำถามสำเร็จ!')
    await fetchQuestions()
  } catch (err: any) {
    alert(`เกิดข้อผิดพลาดในการบันทึก: ${err.message}`)
  } finally {
    isSavingQuestion.value = false
  }
}

const handleImageUpload = async (event: Event, targetField: 'question_image_url' | 'answer_image_url') => {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return

  const file = input.files[0]
  const formData = new FormData()
  formData.append('file', file)
  // Secure: Append admin passkey to form data
  formData.append('passkey', adminPasskey.value)

  try {
    const res = await $fetch<{ success: boolean; url: string }>('/api/upload', {
      method: 'POST',
      body: formData
    })

    if (res.success && res.url) {
      questionForm.value[targetField] = res.url
      alert('อัพโหลดรูปภาพสำเร็จแล้ว!')
    }
  } catch (err: any) {
    console.error('Upload error:', err)
    alert(`อัพโหลดรูปภาพล้มเหลว: ${err.message || err}`)
  } finally {
    input.value = ''
  }
}

const parseCSV = (text: string) => {
  const lines = [];
  let row = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i+1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        row[row.length - 1] += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      lines.push(row);
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] !== "") {
    lines.push(row);
  }
  return lines;
}

const isImportingCSV = ref(false)
const handleCSVImport = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (!supabase.value || !selectedRoundId.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  isImportingCSV.value = true
  const reader = new FileReader()
  
  reader.onload = async (e) => {
    const text = e.target?.result as string
    if (!text) {
      isImportingCSV.value = false;
      return
    }

    try {
      const csvLines = parseCSV(text)
      if (csvLines.length < 2) {
        throw new Error('ไฟล์ CSV ไม่มีข้อมูลเพียงพอ หรือว่างเปล่า')
      }

      // Parse headers
      const rawHeaders = csvLines[0];
      const headers = rawHeaders.map(h => h.trim().toLowerCase());
      
      const expectedFields = [
        'question_number', 'correct_answer', 'is_image_only', 
        'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 
        'question_image_url', 'answer_image_url'
      ];
      
      const indexMap: Record<string, number> = {};
      expectedFields.forEach(field => {
        const idx = headers.indexOf(field);
        if (idx !== -1) {
          indexMap[field] = idx;
        }
      });

      const hasHeaders = expectedFields.some(f => indexMap[f] !== undefined);
      
      const startIndex = hasHeaders ? 1 : 0;
      const dataRows = csvLines.slice(startIndex).filter(row => row.length > 1 || (row.length === 1 && row[0] !== ''));

      // Add 'choices_layout' to parsed expected fields if it exists in CSV headers
      const csvExpectedFields = [
        'question_number', 'correct_answer', 'is_image_only', 
        'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 
        'question_image_url', 'answer_image_url', 'choices_layout'
      ];
      
      const csvIndexMap: Record<string, number> = {};
      csvExpectedFields.forEach(field => {
        const idx = headers.indexOf(field);
        if (idx !== -1) {
          csvIndexMap[field] = idx;
        }
      });
      const csvHasHeaders = csvExpectedFields.some(f => csvIndexMap[f] !== undefined);
      const csvStartIndex = csvHasHeaders ? 1 : 0;
      const csvDataRows = csvLines.slice(csvStartIndex).filter(row => row.length > 1 || (row.length === 1 && row[0] !== ''));

      const parsedQuestions = csvDataRows.map((row, lineNum) => {
        let qNum = lineNum + 1;
        let correctAns = 'ก';
        let isImg = false;
        let textVal = '';
        let cA = '';
        let cB = '';
        let cC = '';
        let cD = '';
        let qImg = '';
        let aImg = '';
        let layoutVal = '2_col';

        if (csvHasHeaders) {
          if (csvIndexMap['question_number'] !== undefined) qNum = parseInt(row[csvIndexMap['question_number']]) || qNum;
          if (csvIndexMap['correct_answer'] !== undefined) correctAns = (row[csvIndexMap['correct_answer']] || 'ก').trim();
          if (csvIndexMap['is_image_only'] !== undefined) {
            const val = (row[csvIndexMap['is_image_only']] || '').trim().toLowerCase();
            isImg = val === 'true' || val === '1' || val === 'yes';
          }
          if (csvIndexMap['question_text'] !== undefined) textVal = row[csvIndexMap['question_text']] || '';
          if (csvIndexMap['choice_a'] !== undefined) cA = row[csvIndexMap['choice_a']] || '';
          if (csvIndexMap['choice_b'] !== undefined) cB = row[csvIndexMap['choice_b']] || '';
          if (csvIndexMap['choice_c'] !== undefined) cC = row[csvIndexMap['choice_c']] || '';
          if (csvIndexMap['choice_d'] !== undefined) cD = row[csvIndexMap['choice_d']] || '';
          if (csvIndexMap['question_image_url'] !== undefined) qImg = row[csvIndexMap['question_image_url']] || '';
          if (csvIndexMap['answer_image_url'] !== undefined) aImg = row[csvIndexMap['answer_image_url']] || '';
          if (csvIndexMap['choices_layout'] !== undefined) {
            const val = (row[csvIndexMap['choices_layout']] || '').trim().toLowerCase();
            layoutVal = val === '1_col' || val === '1' || val === '1_column' ? '1_col' : '2_col';
          }
        } else {
          // Default positional fallback
          qNum = parseInt(row[0]) || qNum;
          correctAns = (row[1] || 'ก').trim();
          const val = (row[2] || '').trim().toLowerCase();
          isImg = val === 'true' || val === '1' || val === 'yes';
          textVal = row[3] || '';
          cA = row[4] || '';
          cB = row[5] || '';
          cC = row[6] || '';
          cD = row[7] || '';
          qImg = row[8] || '';
          aImg = row[9] || '';
          if (row[10]) {
            const lVal = row[10].trim().toLowerCase();
            layoutVal = lVal === '1_col' || lVal === '1' || lVal === '1_column' ? '1_col' : '2_col';
          }
        }

        if (!['ก', 'ข', 'ค', 'ง'].includes(correctAns)) {
          correctAns = 'ก';
        }

        return {
          question_number: qNum,
          correct_answer: correctAns,
          is_image_only: isImg,
          question_text: textVal,
          choice_a: cA,
          choice_b: cB,
          choice_c: cC,
          choice_d: cD,
          question_image_url: qImg,
          answer_image_url: aImg,
          choices_layout: layoutVal
        };
      });

      if (parsedQuestions.length === 0) {
        throw new Error('ไม่พบข้อมูลข้อสอบที่จะนำเข้า');
      }

      // Import to database
      const { error } = await supabase.value.rpc('import_questions_secure', {
        p_round_id: selectedRoundId.value,
        p_questions: parsedQuestions,
        p_passkey: adminPasskey.value
      });

      if (error) throw error;
      alert(`นำเข้าคลังข้อสอบสำเร็จ จำนวน ${parsedQuestions.length} ข้อ!`);
      await fetchQuestions();
    } catch (err: any) {
      alert(`ข้อผิดพลาดการนำเข้าคลังข้อสอบ: ${err.message}`);
    } finally {
      isImportingCSV.value = false;
      target.value = '';
    }
  };

  reader.readAsText(file);
}
</script>

<template>
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Selector Bar -->
    <div class="glass-card header-bar">
      <div class="rounds-selector-group">
        <label class="form-label selector-label">เลือกรอบการแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input selector-dropdown">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">
            {{ r.name }} ({{ r.status }})
          </option>
        </select>
      </div>
      
      <div class="actions-group">
        <button @click="logout" class="btn btn-secondary action-btn">
          <LogOut :size="16" />
          <span>ออกจากระบบ</span>
        </button>
        
        <input 
          v-model="newRoundName" 
          type="text" 
          class="form-input new-round-input" 
          placeholder="เพิ่มรอบใหม่ เช่น รอบมัธยมต้น" 
          @keyup.enter="handleCreateRound"
        />
        <button @click="handleCreateRound" class="btn btn-primary action-btn">
          <Plus :size="16" />
          <span>สร้างรอบใหม่</span>
        </button>
        
        <button 
          v-if="currentRound"
          @click="handleResetRound" 
          class="btn btn-danger action-btn reset-btn"
        >
          <RefreshCw :size="16" />
          <span>เริ่มแข่งขันใหม่</span>
        </button>
      </div>
    </div>

    <!-- Active Round Display -->
    <div v-if="currentRound" class="glass-card active-round-card">
      <div class="round-details-header">
        <div>
          <h1 class="round-name-title">
            <span>{{ currentRound.name }}</span>
            <button @click="handleEditRoundDetails" class="btn btn-secondary edit-round-btn">
              แก้ไขข้อมูลรอบ
            </button>
          </h1>
          <p class="round-meta-desc">
            <span>วันที่แข่งขัน: </span>
            <span class="text-cyan font-bold">{{ currentRound.round_date || 'ไม่ได้กำหนด' }}</span>
            <span class="meta-divider">|</span>
            <span>สถานะ: </span>
            <span class="status-pill" :class="currentRound.status">{{ currentRound.status }}</span>
            <span class="meta-divider">|</span>
            <span>เผยแพร่ถึงข้อที่: </span>
            <span class="status-pill completed reveal-pill">{{ currentRound.revealed_question_number }}</span>
          </p>
        </div>

        <div class="round-quick-portals">
          <button 
            @click="handleUpdateStatus(currentRound.status === 'active' ? 'completed' : 'active')" 
            class="btn"
            :class="currentRound.status === 'active' ? 'btn-secondary' : 'btn-success'"
          >
            {{ currentRound.status === 'active' ? 'สิ้นสุดการแข่ง' : 'เริ่มการแข่งขัน' }}
          </button>
          
          <NuxtLink :to="`/scoreboard?round=${currentRound.id}`" target="_blank" class="btn btn-secondary portal-link">
            <Tv :size="16" />
            <span>เปิดจอ TV Scoreboard</span>
          </NuxtLink>

          <NuxtLink :to="`/presenter?round=${currentRound.id}`" target="_blank" class="btn btn-secondary portal-link stage-led-link">
            <Presentation :size="16" />
            <span>เปิดจอเวที LED</span>
          </NuxtLink>

          <NuxtLink :to="`/presenter-admin?round=${currentRound.id}`" target="_blank" class="btn btn-primary portal-link control-led-link">
            <Sliders :size="16" />
            <span>แผงควบคุมจอเวที</span>
          </NuxtLink>

          <NuxtLink :to="`/winner-settings?round=${currentRound.id}`" target="_blank" class="btn btn-primary portal-link winner-settings-link">
            <Award :size="16" />
            <span>ตั้งค่าประกาศผู้ชนะ</span>
          </NuxtLink>

          <button @click="handleDeleteRound" class="btn btn-danger delete-round-btn">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <!-- Tabs Navigation -->
      <div class="tabs-navigation">
        <button 
          @click="activeTab = 'teams'" 
          class="btn tab-nav-btn" 
          :class="{ active: activeTab === 'teams' }"
        >
          <Users :size="16" />
          <span>จัดการทีมเข้าแข่ง ({{ teams.length }})</span>
        </button>
        
        <button 
          @click="activeTab = 'questions'" 
          class="btn tab-nav-btn" 
          :class="{ active: activeTab === 'questions' }"
        >
          <BookOpen :size="16" />
          <span>ตั้งค่าเฉลยคำตอบ ({{ TOTAL_QUESTIONS }} ข้อ)</span>
        </button>

        <button 
          @click="activeTab = 'reveal'" 
          class="btn tab-nav-btn" 
          :class="{ active: activeTab === 'reveal' }"
        >
          <Eye :size="16" />
          <span>ควบคุมการเปิดเผยคะแนน (Reveal)</span>
        </button>

        <button 
          @click="activeTab = 'progress'; fetchProgress()" 
          class="btn tab-nav-btn" 
          :class="{ active: activeTab === 'progress' }"
        >
          <Grid :size="16" />
          <span>ความคืบหน้าการคีย์ข้อมูล</span>
        </button>

        <button 
          @click="activeTab = 'bank'" 
          class="btn tab-nav-btn" 
          :class="{ active: activeTab === 'bank' }"
        >
          <Database :size="16" />
          <span>คลังข้อสอบ (Question Bank)</span>
        </button>
      </div>

      <!-- Tab Content: Teams Management -->
      <div v-if="activeTab === 'teams'">
        <div class="teams-split-layout">
          
          <!-- Add Single & Bulk Teams -->
          <div class="teams-forms">
            <div class="glass-card inner-card">
              <h3 class="inner-card-title">เพิ่มทีมทีละข้อ</h3>
              <div class="add-team-inputs">
                <input 
                  v-model="newTeamNumber" 
                  type="number" 
                  class="form-input team-num-input" 
                  placeholder="เลขที่ทีม *" 
                />
                <input 
                  v-model="newTeamName" 
                  type="text" 
                  class="form-input team-name-input" 
                  placeholder="ชื่อทีม / ชื่อกลุ่ม *" 
                  @keyup.enter="handleAddTeam"
                />
                <input 
                  v-model="newTeamSchoolName" 
                  type="text" 
                  class="form-input team-school-input" 
                  placeholder="ชื่อโรงเรียน (ไม่บังคับ)" 
                  @keyup.enter="handleAddTeam"
                />
              </div>
              <button @click="handleAddTeam" :disabled="isAddingTeam" class="btn btn-primary w-full">
                <Plus :size="16" />
                <span>{{ isAddingTeam ? 'กำลังเพิ่ม...' : 'เพิ่มทีมเข้าแข่ง' }}</span>
              </button>
            </div>

            <div class="glass-card inner-card">
              <h3 class="inner-card-title bulk-title">
                <FileSpreadsheet :size="18" />
                <span>นำเข้าข้อมูลแบบกลุ่ม (Bulk Import)</span>
              </h3>
              <p class="bulk-desc">
                กรอกรายชื่อทีม 1 บรรทัดต่อ 1 ทีม (ระบุแบบ "01, ชื่อทีม, ชื่อโรงเรียน" หรือ "01, ชื่อทีม" หรือเพียงแค่ "ชื่อทีม")
              </p>
              <textarea 
                v-model="bulkTeamInput" 
                rows="6" 
                class="form-input bulk-textarea" 
                placeholder="1, ทีมสปุตนิก, โรงเรียนวิทยาศาสตร์&#10;2, ทีมซูเปอร์โนวา, โรงเรียนวัดราษฎร์&#10;ทีมอุกกาบาต"
              ></textarea>
              <button @click="handleBulkImportTeams" class="btn btn-secondary w-full">
                นำเข้าข้อมูลรายชื่อทีม
              </button>
            </div>
          </div>

          <!-- Teams List & Tie Breaker Adjustment -->
          <div class="teams-list-container">
            <h3 class="list-title">รายชื่อทีมเข้าแข่งทั้งหมด ({{ teams.length }} ทีม)</h3>
            
            <div v-if="teams.length === 0" class="empty-list-prompt">
              ไม่พบทีมเข้าแข่งในระบบ
            </div>
            
            <div v-else class="table-responsive">
              <table class="report-table">
                <thead>
                  <tr>
                    <th class="team-num-col">เลขทีม</th>
                    <th>ชื่อทีม / โรงเรียน</th>
                    <th class="tie-breaker-col">คะแนนไทเบรกเกอร์ (เสมอกัน)</th>
                    <th class="actions-col">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="team in teams" :key="team.id">
                    <td class="team-num-cell">
                      {{ String(team.team_number).padStart(2, '0') }}
                    </td>
                    <td class="team-name-cell" @click="openEditTeamModal(team)">
                      <div class="team-name-wrapper">
                        <span class="team-name-primary">{{ team.name }}</span>
                        <span v-if="team.school_name" class="team-school-secondary">({{ team.school_name }})</span>
                      </div>
                      <span class="edit-hint">(แก้ไข)</span>
                    </td>
                    <td>
                      <div class="tie-breaker-controls">
                        <button @click="handleUpdateTieBreaker(team.id, team.tie_breaker_score, -1)" class="btn btn-secondary adjust-btn">
                          -
                        </button>
                        <span class="tie-breaker-value">
                          {{ team.tie_breaker_score }}
                        </span>
                        <button @click="handleUpdateTieBreaker(team.id, team.tie_breaker_score, 1)" class="btn btn-secondary adjust-btn">
                          +
                        </button>
                      </div>
                    </td>
                    <td class="actions-cell">
                      <div class="team-actions-btns">
                        <button @click="openEditTeamModal(team)" class="btn btn-secondary edit-btn" title="แก้ไขข้อมูลทีม">
                          <Pencil :size="14" />
                          <span>แก้ไข</span>
                        </button>
                        <button @click="handleDeleteTeam(team.id)" class="btn btn-danger delete-btn" title="ลบทีม">
                          <Trash2 :size="14" />
                        </button>
                      </div>
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
        <h3 class="tab-title">ตั้งค่ากุญแจเฉลยคำตอบ (Answer Key)</h3>
        <p class="tab-desc">
          กรุณากำหนดคำเฉลยข้อที่ถูกต้อง (ก, ข, ค, ง) สำหรับคำถามทั้ง {{ TOTAL_QUESTIONS }} ข้อ ระบบจะนำไปคำนวณคะแนนให้อัตโนมัติ
        </p>

        <div class="questions-grid">
          <div 
            v-for="q in questions" 
            :key="q.id" 
            class="glass-card question-item-card"
          >
            <span class="question-number-label">
              ข้อที่ {{ String(q.question_number).padStart(2, '0') }}
            </span>
            
            <div class="choices-buttons-group">
              <button 
                v-for="ans in ['ก', 'ข', 'ค', 'ง']" 
                :key="ans"
                @click="handleUpdateCorrectAnswer(q.id, ans)"
                class="btn q-choice-btn"
                :class="q.correct_answer === ans ? `option-btn selected-${ans}` : 'btn-secondary'"
              >
                {{ ans }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Reveal Score Control -->
      <div v-if="activeTab === 'reveal'">
        <h3 class="tab-title">ควบคุมการเปิดเผยคะแนนบนหน้าจอ TV</h3>
        <p class="tab-desc">
          ผู้ควบคุมสามารถเลื่อนสไลด์ด้านล่างเพื่อควบคุมว่า หน้าจอ TV Scoreboard จะคำนวณคะแนนแสดงผลถึงข้อที่เท่าใด (สร้างความลุ้นระทึกให้ผู้แข่ง!)
        </p>

        <div class="glass-card slider-control-card">
          <div class="reveal-question-display">
            ข้อที่ {{ currentRound.revealed_question_number }}
          </div>
          
          <p class="reveal-explain-text">
            หน้าจอ TV จะแสดงอันดับคะแนนรวมของคำตอบตั้งแต่ <strong>ข้อที่ 1 ถึงข้อที่ {{ currentRound.revealed_question_number }}</strong> เท่านั้น
          </p>

          <div class="slider-wrapper">
            <button 
              @click="handleUpdateReveal(currentRound.revealed_question_number - 1)" 
              class="btn btn-secondary range-nav-btn" 
              :disabled="currentRound.revealed_question_number === 0"
            >
              -
            </button>
            
            <input 
              type="range" 
              min="0" 
              :max="TOTAL_QUESTIONS" 
              :value="currentRound.revealed_question_number" 
              @input="e => handleUpdateReveal(parseInt((e.target as HTMLInputElement).value))"
              class="reveal-range-slider"
            />
            
            <button 
              @click="handleUpdateReveal(currentRound.revealed_question_number + 1)" 
              class="btn btn-secondary range-nav-btn" 
              :disabled="currentRound.revealed_question_number === TOTAL_QUESTIONS"
            >
              +
            </button>
          </div>

          <div class="slider-quick-buttons">
            <button @click="handleUpdateReveal(0)" class="btn btn-secondary">
              ซ่อนคะแนนทั้งหมด (ข้อ 0)
            </button>
            <button @click="handleUpdateReveal(TOTAL_QUESTIONS / 2)" class="btn btn-secondary">
              แสดงครึ่งแรก (ข้อ {{ TOTAL_QUESTIONS / 2 }})
            </button>
            <button @click="handleUpdateReveal(TOTAL_QUESTIONS)" class="btn btn-primary">
              แสดงผลคะแนนทั้งหมด (ข้อ {{ TOTAL_QUESTIONS }})
            </button>
          </div>
        </div>
      </div>

      <!-- Tab Content: Progress Monitoring -->
      <div v-if="activeTab === 'progress'">
        <div class="progress-tab-header">
          <div>
            <h3 class="progress-title">ตรวจสอบความคืบหน้าการบันทึกข้อมูล</h3>
            <p class="progress-subtitle">
              ตรวจสอบว่าเจ้าหน้าที่บันทึกคะแนนกรอกคำตอบครบถ้วนของแต่ละข้อหรือยัง (มีทีมทั้งหมด {{ teams.length }} ทีม)
            </p>
          </div>
          <button @click="fetchProgress" class="btn btn-secondary refresh-progress-btn">
            <RefreshCw :size="14" />
            <span>รีเฟรชข้อมูล</span>
          </button>
        </div>

        <div class="progress-cards-grid">
          <div 
            v-for="prog in dataEntryProgress" 
            :key="prog.question_number" 
            class="glass-card progress-info-card" 
            @click="handleShowProgressDetails(prog.question_number)"
          >
            <div class="progress-item-header">
              <span class="text-cyan">ข้อที่ {{ prog.question_number }}</span>
              <span>{{ prog.submitted_count }} / {{ teams.length }} ทีม</span>
            </div>
            
            <!-- Progress Bar -->
            <div class="progress-bar-track">
              <div 
                :style="`width: ${teams.length > 0 ? (prog.submitted_count / teams.length) * 100 : 0}%`"
                :class="prog.submitted_count === teams.length ? 'bg-success' : 'bg-cyan'"
                class="progress-bar-fill"
              ></div>
            </div>

            <div class="progress-status-text" :class="prog.submitted_count === teams.length ? 'text-success' : 'text-secondary'">
              {{ prog.submitted_count === teams.length ? 'บันทึกครบแล้ว' : 'ยังบันทึกไม่ครบ' }}
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Question Bank (CSV Import & Manual Editor) -->
      <div v-if="activeTab === 'bank'">
        <div class="bank-split-cards">
          
          <!-- CSV Import section -->
          <div class="glass-card bank-import-card">
            <div>
              <h3 class="bank-card-title">
                <FileSpreadsheet :size="20" />
                <span>นำเข้าคลังข้อสอบผ่านไฟล์ CSV</span>
              </h3>
              <p class="bank-card-desc">
                คุณสามารถนำเข้าคำถามและเฉลยแบบกลุ่ม {{ TOTAL_QUESTIONS }} ข้อ โดยสร้างไฟล์ CSV ที่มีส่วนหัว (Header) หรือเรียงลำดับคอลัมน์ดังนี้:
              </p>
              <div class="csv-format-header">
                question_number, correct_answer, is_image_only, question_text, choice_a, choice_b, choice_c, choice_d, question_image_url, answer_image_url
              </div>
              <ul class="csv-rules-list">
                <li><strong class="text-white">question_number:</strong> 1 ถึง {{ TOTAL_QUESTIONS }}</li>
                <li><strong class="text-white">correct_answer:</strong> ก, ข, ค, หรือ ง</li>
                <li><strong class="text-white">is_image_only:</strong> true (ใช้สไลด์เต็มหน้าจอ) หรือ false (แสดงตัวหนังสือปกติ)</li>
                <li><strong class="text-white">question_image_url / answer_image_url:</strong> พาธไฟล์รูป เช่น <code class="text-cyan">/questions/q1_question.png</code> หรือ URL</li>
              </ul>
            </div>
            
            <div class="upload-btn-container">
              <input 
                type="file" 
                accept=".csv" 
                @change="handleCSVImport" 
                class="form-input" 
                style="display: none;" 
                id="csv-bank-input" 
                :disabled="isImportingCSV"
              />
              <label 
                for="csv-bank-input" 
                class="btn btn-secondary csv-upload-label"
              >
                <Upload :size="16" />
                <span>{{ isImportingCSV ? 'กำลังนำเข้าไฟล์...' : 'เลือกไฟล์ CSV และเริ่มนำเข้า' }}</span>
              </label>
            </div>
          </div>

          <!-- Quick instructions or active status -->
          <div class="glass-card bank-info-card">
            <div>
              <h3 class="bank-card-title text-gold">
                <BookOpen :size="20" />
                <span>รายละเอียดข้อมูลรอบปัจจุบัน</span>
              </h3>
              <p class="bank-card-desc">
                คลังข้อสอบนี้จะผูกกับรอบการแข่งขันที่เลือกอยู่ เมื่อเจ้าหน้าที่หรือ mc มีการเปลี่ยนสถานะ หน้าจอเวที LED จะทำการดึงข้อมูลเหล่านี้ไปแสดงผลแบบเรียลไทม์
              </p>
              
              <div class="bank-stats-grid">
                <div class="bank-stat-box">
                  <span class="stat-lbl">คำถามที่กำหนดแล้ว</span>
                  <span class="stat-val">
                    {{ questions.length }} ข้อ
                  </span>
                </div>
                <div class="bank-stat-box">
                  <span class="stat-lbl">โหมดใช้สไลด์ภาพ</span>
                  <span class="stat-val text-purple">
                    {{ questions.filter(q => q.is_image_only).length }} ข้อ
                  </span>
                </div>
              </div>
            </div>
            
            <div class="bank-footer-note">
              * การอัปโหลดไฟล์ใหม่ทับ จะทำการอัปเดตข้อมูลข้อสอบเดิมที่ข้อตรงกัน
            </div>
          </div>
        </div>

        <!-- Manual Editor Section -->
        <div class="glass-card manual-editor-section">
          <h3 class="manual-editor-title">
            <span>แก้ไขข้อมูลคำถามรายข้อ (Manual Question Editor)</span>
          </h3>

          <div class="manual-editor-grid">
            <!-- Left side: Q1-Q20 side selector buttons -->
            <div class="question-list-sidebar">
              <button
                v-for="i in TOTAL_QUESTIONS"
                :key="i"
                @click="selectedQuestionNumber = i"
                class="btn sidebar-q-btn"
                :class="selectedQuestionNumber === i ? 'btn-primary' : 'btn-secondary'"
              >
                <span>ข้อที่ {{ String(i).padStart(2, '0') }}</span>
                <span class="sidebar-q-status">
                  {{ questions.some(q => q.question_number === i) ? (questions.find(q => q.question_number === i)?.is_image_only ? 'สไลด์' : 'เฉลย ' + questions.find(q => q.question_number === i)?.correct_answer) : 'ยังไม่มีข้อมูล' }}
                </span>
              </button>
            </div>

            <!-- Right side: Form -->
            <div class="editor-form-fields">
              <div class="form-row-three-cols">
                <div>
                  <label class="form-label">คำตอบที่ถูกต้อง (Correct Answer)</label>
                  <select v-model="questionForm.correct_answer" class="form-input">
                    <option value="ก">ตัวเลือก ก</option>
                    <option value="ข">ตัวเลือก ข</option>
                    <option value="ค">ตัวเลือก ค</option>
                    <option value="ง">ตัวเลือก ง</option>
                  </select>
                </div>

                <div>
                  <label class="form-label">รูปแบบแสดงคำตอบ (Choices Layout)</label>
                  <select v-model="questionForm.choices_layout" class="form-input">
                    <option value="2_col">2 คอลัมน์ (2 Columns - Default)</option>
                    <option value="1_col">1 คอลัมน์ (1 Column)</option>
                  </select>
                </div>

                <div class="checkbox-form-group">
                  <input
                    type="checkbox"
                    id="is-image-only-checkbox"
                    v-model="questionForm.is_image_only"
                    class="large-checkbox"
                  />
                  <label for="is-image-only-checkbox" class="checkbox-label">
                    ใช้โหมดสไลด์รูปภาพเต็มจอ
                  </label>
                </div>
              </div>

              <!-- Conditional Fields based on is_image_only -->
              <div v-if="!questionForm.is_image_only" class="conditional-question-text anim-fade-in">
                <div>
                  <label class="form-label">โจทย์คำถาม (Question Text)</label>
                  <textarea
                    v-model="questionForm.question_text"
                    rows="3"
                    class="form-input text-textarea"
                    placeholder="พิมพ์โจทย์คำถามที่ต้องการแสดงบนเวที..."
                  ></textarea>
                </div>

                <div class="choices-input-grid">
                  <div>
                    <label class="form-label">ตัวเลือก ก (Choice A)</label>
                    <input v-model="questionForm.choice_a" type="text" class="form-input" placeholder="ตัวเลือก ก" />
                  </div>
                  <div>
                    <label class="form-label">ตัวเลือก ข (Choice B)</label>
                    <input v-model="questionForm.choice_b" type="text" class="form-input" placeholder="ตัวเลือก ข" />
                  </div>
                  <div>
                    <label class="form-label">ตัวเลือก ค (Choice C)</label>
                    <input v-model="questionForm.choice_c" type="text" class="form-input" placeholder="ตัวเลือก ค" />
                  </div>
                  <div>
                    <label class="form-label">ตัวเลือก ง (Choice D)</label>
                    <input v-model="questionForm.choice_d" type="text" class="form-input" placeholder="ตัวเลือก ง" />
                  </div>
                </div>
              </div>

              <!-- Image fields -->
              <div class="images-upload-grid">
                <div>
                  <label class="form-label">พาธรูปภาพคำถาม (Question Image URL)</label>
                  <div class="upload-field-row">
                    <input
                      v-model="questionForm.question_image_url"
                      type="text"
                      class="form-input path-input"
                      placeholder="เช่น /questions/q1_question.png (หรือปล่อยว่าง)"
                    />
                    <label class="btn btn-secondary upload-btn-label">
                      อัพโหลด
                      <input 
                        type="file" 
                        accept="image/*" 
                        style="display: none;" 
                        @change="(e) => handleImageUpload(e, 'question_image_url')"
                      />
                    </label>
                  </div>
                  <span class="field-hint-text">
                    * สำหรับแสดงแผนภาพ แผนภูมิ หรือสไลด์รูปคำถาม
                  </span>
                </div>
                <div>
                  <label class="form-label">พาธรูปภาพเฉลย (Answer Image URL)</label>
                  <div class="upload-field-row">
                    <input
                      v-model="questionForm.answer_image_url"
                      type="text"
                      class="form-input path-input"
                      placeholder="เช่น /questions/q1_answer.png (หรือปล่อยว่าง)"
                    />
                    <label class="btn btn-secondary upload-btn-label">
                      อัพโหลด
                      <input 
                        type="file" 
                        accept="image/*" 
                        style="display: none;" 
                        @change="(e) => handleImageUpload(e, 'answer_image_url')"
                      />
                    </label>
                  </div>
                  <span class="field-hint-text">
                    * สำหรับเฉลยด้วยสไลด์คำเฉลยเต็มจอ
                  </span>
                </div>
              </div>

              <!-- Save Action -->
              <div class="save-button-row">
                <button
                  @click="handleSaveQuestion"
                  :disabled="isSavingQuestion"
                  class="btn btn-primary save-btn-large"
                >
                  {{ isSavingQuestion ? 'กำลังบันทึก...' : 'บันทึกข้อมูลข้อที่ ' + selectedQuestionNumber }}
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- No active round selected -->
    <div v-else class="no-round-selected">
      <p>กรุณาเลือกหรือสร้างรอบการแข่งขันเพื่อเปิดใช้งานระบบควบคุม</p>
    </div>

    <!-- Progress Details Modal -->
    <div v-if="showProgressModal" class="modal-backdrop no-print" @click.self="showProgressModal = false">
      <div class="glass-card modal-progress-content">
        <button @click="showProgressModal = false" class="close-progress-modal-btn">
          ✕
        </button>

        <h2 class="modal-progress-title">
          รายละเอียด ความคืบหน้าข้อที่ {{ modalQuestionNumber }}
        </h2>
        <p class="modal-progress-subtitle">
          รายชื่อทีมที่ยังไม่ได้คีย์ตัวเลือกคำตอบลงระบบในข้อนี้
        </p>

        <div v-if="modalLoading" class="modal-loading-state">
          <div class="loading-spin small-spin"></div>
          <span>กำลังโหลดรายละเอียด...</span>
        </div>

        <div v-else>
          <div v-if="unansweredTeams.length === 0" class="completed-progress-notice">
            ✓ คีย์คะแนนครบถ้วนหมดทุกทีมแล้ว
          </div>
          <div v-else class="unanswered-teams-list">
            <div 
              v-for="team in unansweredTeams" 
              :key="team.id"
              class="glass-card unanswered-team-item"
            >
              <div class="unanswered-team-details">
                <span class="unanswered-team-number">
                  TEAM {{ String(team.team_number).padStart(2, '0') }}
                </span>
                <span class="unanswered-team-name">
                  {{ team.name }}
                </span>
              </div>
              <span class="status-pill pending unanswered-badge">
                ยังไม่ได้คีย์
              </span>
            </div>
          </div>

          <div style="margin-top: 1.25rem; text-align: center;">
            <NuxtLink 
              :to="`/staff?round=${selectedRoundId}&question=${modalQuestionNumber}`" 
              class="btn btn-primary"
              style="display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none;"
            >
              <Pencil :size="16" />
              ไปที่หน้าบันทึกคะแนนข้อที่ {{ modalQuestionNumber }}
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Team Modal -->
    <div v-if="showEditTeamModal" class="modal-backdrop no-print" @click.self="showEditTeamModal = false">
      <div class="glass-card modal-edit-team-content">
        <button @click="showEditTeamModal = false" class="close-edit-modal-btn">
          ✕
        </button>

        <h2 class="modal-edit-team-title">
          <Pencil :size="20" />
          <span>แก้ไขข้อมูลทีม</span>
        </h2>
        <p class="modal-edit-team-subtitle">
          แก้ไขเลขทีม ชื่อทีม และชื่อโรงเรียนสำหรับรอบการแข่งขันนี้
        </p>

        <form @submit.prevent="handleSaveEditTeam" class="edit-team-form">
          <div class="form-group">
            <label class="form-label">เลขทีม (Team Number) <span class="required-star">*</span></label>
            <input 
              v-model.number="editTeamNumber" 
              type="number" 
              min="1" 
              class="form-input" 
              placeholder="เลขที่ทีม เช่น 1" 
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">ชื่อทีม (Team Name) <span class="required-star">*</span></label>
            <input 
              v-model="editTeamName" 
              type="text" 
              class="form-input" 
              placeholder="ชื่อทีม หรือ ชื่อกลุ่มเข้าแข่ง" 
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">ชื่อโรงเรียน / สถาบัน (School Name) <span class="optional-text">(ไม่บังคับ)</span></label>
            <input 
              v-model="editTeamSchoolName" 
              type="text" 
              class="form-input" 
              placeholder="เช่น โรงเรียนวิทยาศาสตร์..." 
            />
          </div>

          <div v-if="editTeamError" class="edit-team-error-banner">
            {{ editTeamError }}
          </div>

          <div class="edit-team-modal-actions">
            <button type="button" @click="showEditTeamModal = false" class="btn btn-secondary">
              ยกเลิก
            </button>
            <button type="submit" :disabled="isSavingEditTeam" class="btn btn-primary">
              {{ isSavingEditTeam ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข' }}
            </button>
          </div>
        </form>
      </div>
    </div>

  </div>
</template>

<style scoped>
.header-bar {
  margin-bottom: 2rem; 
  display: flex; 
  flex-wrap: wrap; 
  justify-content: space-between; 
  align-items: center; 
  gap: 1rem;
}

.rounds-selector-group {
  display: flex; 
  align-items: center; 
  gap: 1rem; 
  flex: 1.5; 
  min-width: 280px; 
  flex-wrap: wrap;
}

.selector-label {
  margin-bottom: 0; 
  white-space: nowrap;
}

.selector-dropdown {
  flex: 1;
}

.actions-group {
  display: flex; 
  gap: 0.75rem; 
  flex-wrap: wrap; 
  align-items: center;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: 42px;
}

.new-round-input {
  max-width: 220px;
}

.reset-btn {
  font-weight: 600;
}

.active-round-card {
  margin-bottom: 2rem; 
  border-color: var(--glass-border-glow);
}

.round-details-header {
  display: flex; 
  flex-wrap: wrap; 
  justify-content: space-between; 
  align-items: start; 
  gap: 1.5rem; 
  margin-bottom: 1.5rem;
}

.round-name-title {
  font-size: 2rem; 
  margin-bottom: 0.25rem; 
  color: var(--text-primary); 
  display: inline-flex; 
  align-items: center; 
  gap: 0.75rem;
}

.edit-round-btn {
  padding: 0.25rem 0.6rem; 
  font-size: 0.75rem; 
  height: 28px; 
  display: inline-flex; 
  align-items: center; 
  justify-content: center; 
  font-weight: normal;
}

.round-meta-desc {
  color: var(--text-secondary); 
  display: flex; 
  flex-wrap: wrap; 
  align-items: center; 
  gap: 0.5rem; 
  font-size: 0.95rem; 
  margin-top: 0.25rem;
}

.text-cyan { color: var(--color-cyan); }
.text-gold { color: var(--color-gold); }
.text-purple { color: var(--color-purple); }
.text-white { color: #fff; }

.font-bold { font-weight: 700; }

.meta-divider {
  color: var(--text-muted);
}

.reveal-pill {
  background: rgba(0, 229, 255, 0.15);
}

.round-quick-portals {
  display: flex; 
  gap: 0.5rem; 
  flex-wrap: wrap;
}

.portal-link {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.stage-led-link {
  border-color: var(--color-cyan); 
  color: var(--color-cyan); 
  background: rgba(0, 229, 255, 0.05);
}

.control-led-link {
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); 
  border: none; 
  font-weight: 600; 
  color: #fff !important; 
  box-shadow: var(--shadow-neon-cyan);
}

.delete-round-btn {
  padding: 0.5rem 1rem;
}

.tabs-navigation {
  display: flex; 
  border-bottom: 1px solid var(--glass-border); 
  margin-bottom: 1.5rem; 
  overflow-x: auto; 
  gap: 0.5rem;
}

.tab-nav-btn {
  border-radius: 0; 
  background: none; 
  box-shadow: none;
  color: var(--text-secondary);
}

.tab-nav-btn.active {
  border-bottom: 2px solid var(--color-cyan); 
  color: var(--color-cyan) !important; 
  font-weight: 700;
}

.teams-split-layout {
  display: grid; 
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
  gap: 2rem;
}

.teams-forms {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.inner-card {
  background: rgba(255, 255, 255, 0.02);
}

.inner-card-title {
  margin-bottom: 1rem; 
  font-size: 1.1rem; 
  color: var(--color-cyan);
}

.bulk-title {
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.add-team-inputs {
  display: flex; 
  gap: 0.5rem; 
  margin-bottom: 1rem;
}

.team-num-input {
  max-width: 80px;
}

.team-name-input {
  flex: 1;
}

.w-full {
  width: 100%;
}

.bulk-desc {
  font-size: 0.8rem; 
  color: var(--text-secondary); 
  margin-bottom: 1rem;
}

.bulk-textarea {
  resize: vertical; 
  font-family: monospace; 
  font-size: 0.9rem; 
  margin-bottom: 1rem;
}

.teams-list-container {
  flex: 1.5;
}

.list-title {
  margin-bottom: 1rem; 
  font-size: 1.2rem; 
  color: var(--text-primary);
}

.empty-list-prompt {
  color: var(--text-secondary); 
  text-align: center; 
  padding: 3rem;
}

.team-num-col {
  width: 70px;
}

.tie-breaker-col {
  width: 160px; 
  text-align: center;
}

.delete-col {
  width: 70px; 
  text-align: right;
}

.team-num-cell {
  font-family: var(--font-title); 
  font-weight: 700; 
  color: var(--color-cyan);
}

.team-name-cell {
  font-weight: 600; 
  cursor: pointer; 
  text-decoration: underline dotted var(--color-cyan);
}

.edit-hint {
  font-size: 0.75rem; 
  color: var(--text-muted); 
  font-weight: normal; 
  margin-left: 0.25rem;
}

.tie-breaker-controls {
  display: flex; 
  align-items: center; 
  justify-content: center; 
  gap: 0.5rem;
}

.adjust-btn {
  padding: 0.2rem 0.5rem; 
  font-size: 0.8rem;
}

.tie-breaker-value {
  font-family: var(--font-title); 
  font-weight: 800; 
  min-width: 24px; 
  text-align: center; 
  color: var(--color-gold);
}

.delete-cell {
  text-align: right;
}

.delete-btn {
  padding: 0.35rem; 
  border-radius: 4px;
}

.tab-title {
  margin-bottom: 0.5rem; 
  font-size: 1.25rem; 
  color: var(--text-primary);
}

.tab-desc {
  color: var(--text-secondary); 
  font-size: 0.85rem; 
  margin-bottom: 1.5rem;
}

.questions-grid {
  display: grid; 
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); 
  gap: 1rem;
}

.question-item-card {
  background: rgba(255,255,255,0.02); 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  padding: 0.75rem 1.25rem;
}

.question-number-label {
  font-family: var(--font-title); 
  font-weight: 700; 
  font-size: 1.1rem; 
  color: var(--color-cyan);
}

.choices-buttons-group {
  display: flex; 
  gap: 0.25rem;
}

.q-choice-btn {
  width: 38px; 
  height: 38px; 
  padding: 0; 
  font-size: 0.95rem; 
  border-radius: 4px;
}

.slider-control-card {
  background: rgba(255,255,255,0.02); 
  padding: 3rem 2rem; 
  text-align: center;
}

.reveal-question-display {
  font-size: 4rem; 
  font-family: var(--font-title); 
  font-weight: 800; 
  color: var(--color-cyan); 
  margin-bottom: 1rem; 
  text-shadow: var(--shadow-neon-cyan);
}

.reveal-explain-text {
  color: var(--text-secondary); 
  margin-bottom: 2rem; 
  font-size: 1.05rem;
}

.slider-wrapper {
  max-width: 600px; 
  margin: 0 auto; 
  display: flex; 
  align-items: center; 
  gap: 1.5rem;
}

.range-nav-btn {
  width: 50px; 
  height: 50px; 
  border-radius: 50%; 
  font-size: 1.5rem; 
  padding: 0;
}

.reveal-range-slider {
  flex: 1; 
  accent-color: var(--color-cyan); 
  height: 8px; 
  border-radius: 4px; 
  cursor: pointer;
}

.slider-quick-buttons {
  display: flex; 
  justify-content: center; 
  gap: 0.75rem; 
  margin-top: 3rem;
}

.progress-tab-header {
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 1.5rem;
}

.progress-title {
  font-size: 1.25rem; 
  color: var(--text-primary);
}

.progress-subtitle {
  color: var(--text-secondary); 
  font-size: 0.85rem;
}

.refresh-progress-btn {
  display: flex; 
  align-items: center; 
  gap: 0.25rem;
}

.progress-cards-grid {
  display: grid; 
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); 
  gap: 1rem;
}

.progress-info-card {
  background: rgba(255,255,255,0.02); 
  display: flex; 
  flex-direction: column; 
  gap: 0.5rem; 
  cursor: pointer; 
  transition: transform 0.2s, border-color 0.2s;
}

.progress-info-card:hover {
  border-color: var(--color-cyan);
  transform: translateY(-2px);
}

.progress-item-header {
  display: flex; 
  justify-content: space-between; 
  font-weight: 700;
}

.progress-bar-track {
  width: 100%; 
  height: 6px; 
  background: rgba(255,255,255,0.05); 
  border-radius: 3px; 
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%; 
  border-radius: 3px;
}

.progress-status-text {
  font-size: 0.75rem; 
  text-align: right;
}

.bg-success {
  background-color: var(--color-success);
}

.bg-cyan {
  background-color: var(--color-cyan);
}

.bank-split-cards {
  display: grid; 
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
  gap: 2rem; 
  margin-bottom: 2rem;
}

.bank-import-card {
  background: rgba(255,255,255,0.02); 
  display: flex; 
  flex-direction: column; 
  justify-content: space-between;
}

.bank-card-title {
  margin-bottom: 0.5rem; 
  font-size: 1.2rem; 
  color: var(--color-cyan); 
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.bank-card-desc {
  font-size: 0.85rem; 
  color: var(--text-secondary); 
  margin-bottom: 1rem; 
  line-height: 1.5;
}

.csv-format-header {
  background: rgba(0,0,0,0.2); 
  padding: 0.75rem; 
  border-radius: var(--radius-sm); 
  font-size: 0.75rem; 
  font-family: monospace; 
  color: var(--text-secondary); 
  margin-bottom: 1rem; 
  border: 1px solid var(--glass-border); 
  line-height: 1.4; 
  overflow-x: auto; 
  white-space: nowrap;
}

.csv-rules-list {
  font-size: 0.8rem; 
  color: var(--text-secondary); 
  margin-left: 1.2rem; 
  margin-bottom: 1.5rem; 
  line-height: 1.4;
}

.upload-btn-container {
  width: 100%;
}

.csv-upload-label {
  display: inline-flex; 
  align-items: center; 
  justify-content: center; 
  gap: 0.5rem; 
  cursor: pointer; 
  width: 100%; 
  height: 46px; 
  font-weight: 600;
}

.bank-info-card {
  background: rgba(255,255,255,0.02); 
  display: flex; 
  flex-direction: column; 
  justify-content: space-between;
}

.bank-stats-grid {
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 1rem; 
  text-align: center;
}

.bank-stat-box {
  background: rgba(255,255,255,0.01); 
  border: 1px solid var(--glass-border); 
  padding: 0.75rem; 
  border-radius: var(--radius-sm);
}

.stat-lbl {
  font-size: 0.75rem; 
  color: var(--text-muted); 
  display: block;
}

.stat-val {
  font-family: var(--font-title); 
  font-size: 1.5rem; 
  font-weight: 800; 
  color: var(--color-cyan);
}

.bank-footer-note {
  font-size: 0.8rem; 
  color: var(--text-muted); 
  text-align: center; 
  border-top: 1px solid var(--glass-border); 
  padding-top: 1rem; 
  margin-top: 1rem;
}

.manual-editor-section {
  background: rgba(255,255,255,0.01); 
  border-color: rgba(255,255,255,0.05); 
  padding: 2rem;
}

.manual-editor-title {
  margin-bottom: 1.5rem; 
  font-size: 1.25rem; 
  color: var(--text-primary); 
  display: flex; 
  align-items: center; 
  gap: 0.5rem;
}

.manual-editor-grid {
  display: grid; 
  grid-template-columns: 240px 1fr; 
  gap: 2rem;
}

.question-list-sidebar {
  display: flex; 
  flex-direction: column; 
  gap: 0.4rem; 
  max-height: 520px; 
  overflow-y: auto; 
  padding-right: 0.5rem;
}

.sidebar-q-btn {
  justify-content: space-between; 
  font-weight: 600; 
  width: 100%; 
  text-align: left; 
  padding: 0.6rem 1rem;
}

.sidebar-q-status {
  font-size: 0.75rem; 
  opacity: 0.8;
}

.editor-form-fields {
  display: flex;
  flex-direction: column;
}

.form-row-three-cols {
  display: grid; 
  grid-template-columns: 1fr 1fr 1fr; 
  gap: 1.5rem; 
  margin-bottom: 1.5rem; 
  align-items: center;
}

.checkbox-form-group {
  display: flex; 
  align-items: center; 
  gap: 0.5rem; 
  padding-top: 1.5rem;
}

.large-checkbox {
  width: 18px; 
  height: 18px; 
  accent-color: var(--color-cyan); 
  cursor: pointer;
}

.checkbox-label {
  color: var(--text-primary); 
  font-weight: 600; 
  cursor: pointer; 
  user-select: none;
}

.conditional-question-text {
  display: flex; 
  flex-direction: column; 
  gap: 1.2rem; 
  margin-bottom: 1.5rem;
}

.anim-fade-in {
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.text-textarea {
  width: 100%;
}

.choices-input-grid {
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 1rem;
}

.images-upload-grid {
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 1.5rem; 
  margin-bottom: 1.5rem;
}

.upload-field-row {
  display: flex; 
  gap: 0.5rem; 
  align-items: center;
}

.path-input {
  flex: 1;
}

.upload-btn-label {
  margin: 0; 
  padding: 0 1rem; 
  height: 42px; 
  display: inline-flex; 
  align-items: center; 
  justify-content: center; 
  cursor: pointer; 
  font-size: 0.85rem; 
  font-weight: 600; 
  white-space: nowrap; 
  flex-shrink: 0; 
  border-radius: var(--radius-sm);
}

.field-hint-text {
  font-size: 0.75rem; 
  color: var(--text-muted); 
  display: block; 
  margin-top: 0.25rem;
}

.save-button-row {
  display: flex; 
  justify-content: flex-end; 
  border-top: 1px solid var(--glass-border); 
  padding-top: 1.5rem;
}

.save-btn-large {
  min-width: 160px; 
  font-weight: 600; 
  height: 42px;
}

.no-round-selected {
  text-align: center; 
  padding: 5rem 0;
  color: var(--text-secondary);
}

.modal-progress-content {
  max-width: 500px; 
  width: 90%; 
  margin: 10% auto; 
  position: relative; 
  padding: 2.2rem; 
  background: var(--bg-secondary); 
  border: 1px solid var(--glass-border-glow); 
  box-shadow: 0 0 30px rgba(0,229,255,0.25);
}

.close-progress-modal-btn {
  position: absolute; 
  top: 1rem; 
  right: 1rem; 
  padding: 0; 
  width: 32px; 
  height: 32px; 
  border-radius: 50%; 
  font-size: 1rem; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  background: rgba(255,255,255,0.05);
  border: none;
  color: var(--text-primary);
  cursor: pointer;
}

.modal-progress-title {
  font-size: 1.4rem; 
  color: var(--color-cyan); 
  margin-bottom: 0.5rem; 
  font-family: var(--font-title);
}

.modal-progress-subtitle {
  color: var(--text-secondary); 
  font-size: 0.85rem; 
  margin-bottom: 1.5rem;
}

.modal-loading-state {
  text-align: center; 
  padding: 3rem; 
  color: var(--text-secondary);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.small-spin {
  width: 32px; 
  height: 32px; 
  border: 3px solid var(--color-cyan); 
  border-top-color: transparent; 
  border-radius: 50%; 
  margin: 0 auto 1rem; 
  animation: spin 1s linear infinite;
}

.completed-progress-notice {
  text-align: center; 
  color: var(--color-success); 
  padding: 2.5rem; 
  font-weight: 600; 
  font-size: 1.1rem;
}

.unanswered-teams-list {
  display: flex; 
  flex-direction: column; 
  gap: 0.65rem; 
  max-height: 320px; 
  overflow-y: auto; 
  padding-right: 0.5rem;
}

.unanswered-team-item {
  background: rgba(255, 23, 68, 0.04); 
  border-color: rgba(255, 23, 68, 0.15); 
  padding: 0.75rem 1rem; 
  display: flex; 
  justify-content: space-between; 
  align-items: center;
}

.unanswered-team-details {
  display: flex; 
  align-items: center; 
  gap: 0.75rem;
}

.unanswered-team-number {
  font-family: var(--font-title); 
  font-weight: 800; 
  color: var(--color-gold);
}

.unanswered-team-name {
  font-weight: 600; 
  color: var(--text-primary);
}

.unanswered-badge {
  background: rgba(255, 23, 68, 0.08); 
  color: var(--color-error); 
  font-size: 0.7rem; 
  padding: 0.2rem 0.5rem;
}

.add-team-inputs {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.team-name-wrapper {
  display: flex;
  flex-direction: column;
}

.team-name-primary {
  font-weight: 600;
  color: var(--text-primary);
}

.team-school-secondary {
  font-size: 0.85rem;
  color: #94a3b8;
}

.actions-col {
  width: 140px;
  text-align: center;
}

.actions-cell {
  text-align: center;
}

.team-actions-btns {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.85rem;
}

/* Edit Team Modal */
.modal-edit-team-content {
  position: relative;
  width: 90%;
  max-width: 500px;
  padding: 2rem;
  background: var(--glass-bg, rgba(15, 23, 42, 0.92));
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.15));
  border-radius: 1rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
}

.close-edit-modal-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: transparent;
  border: none;
  color: var(--text-secondary, #94a3b8);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  transition: all 0.2s;
}

.close-edit-modal-btn:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.modal-edit-team-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.5rem;
  color: var(--text-primary, #ffffff);
  margin-bottom: 0.25rem;
}

.modal-edit-team-subtitle {
  font-size: 0.9rem;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 1.5rem;
}

.edit-team-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.required-star {
  color: #f87171;
}

.optional-text {
  font-size: 0.8rem;
  color: #94a3b8;
  font-weight: normal;
}

.edit-team-error-banner {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
}

.edit-team-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 0.5rem;
}
</style>

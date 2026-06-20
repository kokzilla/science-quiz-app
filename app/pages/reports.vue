<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { 
  BarChart3, 
  Printer, 
  Download, 
  Check, 
  X, 
  AlertCircle,
  Award,
  Grid
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { supabase, isConfigured } = useSupabase()

const selectedRoundId = ref('')
const roundsList = ref<any[]>([])
const currentRound = ref<any>(null)
const teams = ref<any[]>([])
const questions = ref<any[]>([])
const answers = ref<any[]>([])

const loading = ref(true)
const activeReportTab = ref<'rankings' | 'crosstab' | 'item-analysis'>('rankings')
const passkeyValid = ref(false)

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
    passkeyValid.value = true
  }

  if (isConfigured.value) {
    fetchRounds()
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
  
  try {
    // 1. Fetch round details
    const { data: rData } = await supabase.value
      .from('rounds')
      .select('*')
      .eq('id', selectedRoundId.value)
      .single()
    currentRound.value = rData

    // 2. Fetch all teams
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('team_number', { ascending: true })
    teams.value = tData || []

    // 3. Fetch questions answer key
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', selectedRoundId.value)
      .order('question_number', { ascending: true })
    questions.value = qData || []

    // 4. Fetch all answers
    if (teams.value.length > 0) {
      const teamIds = teams.value.map(t => t.id)
      const { data: aData } = await supabase.value
        .from('answers')
        .select('*')
        .in('team_id', teamIds)
      answers.value = aData || []
    }
  } catch (err) {
    console.error('Error fetching reports data:', err)
  } finally {
    loading.value = false
  }
}

// ==========================================
// REPORT CALCULATIONS
// ==========================================

// 1. Leaderboard / Rankings calculation (Sums all 20 questions)
const rankings = computed(() => {
  if (teams.value.length === 0) return []

  const list = teams.value.map(team => {
    // Correct answers count
    const correctCount = answers.value.filter(ans => {
      return ans.team_id === team.id && ans.is_correct
    }).length

    const wrongCount = answers.value.filter(ans => {
      return ans.team_id === team.id && ans.submitted_answer && !ans.is_correct
    }).length

    const unansweredCount = 20 - (correctCount + wrongCount)
    const finalScore = correctCount + team.tie_breaker_score

    return {
      ...team,
      correctCount,
      wrongCount,
      unansweredCount,
      finalScore
    }
  })

  // Sort: finalScore DESC, tie_breaker_score DESC, team_number ASC
  list.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore
    if (b.tie_breaker_score !== a.tie_breaker_score) return b.tie_breaker_score - a.tie_breaker_score
    return a.team_number - b.team_number
  })

  // Assign ranks
  let currentRank = 1
  return list.map((item, idx) => {
    if (idx > 0 && item.finalScore < list[idx - 1].finalScore) {
      currentRank = idx + 1
    }
    return {
      ...item,
      rank: currentRank
    }
  })
})

// 2. Cross Table (Teams x Questions 1-20 grid)
const crossTable = computed(() => {
  return teams.value.map(team => {
    const qDetails = Array.from({ length: 20 }, (_, idx) => {
      const qNum = idx + 1
      const ansRow = answers.value.find(a => a.team_id === team.id && a.question_number === qNum)
      return {
        submitted: !!ansRow?.submitted_answer,
        answer: ansRow?.submitted_answer || '',
        is_correct: !!ansRow?.is_correct
      }
    })

    const correctCount = qDetails.filter(qd => qd.submitted && qd.is_correct).length
    const finalScore = correctCount + team.tie_breaker_score

    return {
      ...team,
      finalScore,
      questions: qDetails
    }
  }).sort((a, b) => b.finalScore - a.finalScore)
})

// 3. Item Analysis (Difficulty/Correctness statistics per question)
const itemAnalysis = computed(() => {
  if (teams.value.length === 0) return []

  return Array.from({ length: 20 }, (_, idx) => {
    const qNum = idx + 1
    const qKey = questions.value.find(q => q.question_number === qNum)
    
    // Count answers
    const qAnswers = answers.value.filter(a => a.question_number === qNum)
    const correctCount = qAnswers.filter(a => a.is_correct).length
    const wrongCount = qAnswers.filter(a => a.submitted_answer && !a.is_correct).length
    const unansweredCount = teams.value.length - (correctCount + wrongCount)
    
    const correctPercent = teams.value.length > 0 
      ? Math.round((correctCount / teams.value.length) * 100) 
      : 0

    return {
      question_number: qNum,
      correct_answer: qKey?.correct_answer || 'N/A',
      correctCount,
      wrongCount,
      unansweredCount,
      correctPercent
    }
  })
})

// ==========================================
// EXPORTS & PRINT
// ==========================================
const handlePrint = () => {
  window.print()
}

const handleExportCSV = () => {
  if (rankings.value.length === 0) return

  let csvContent = 'data:text/csv;charset=utf-8,\uFEFF' // UTF-8 BOM
  
  if (activeReportTab.value === 'rankings') {
    csvContent += 'Rank,Team Number,Team Name,Correct Answers,Tie-Breaker Points,Total Score\n'
    rankings.value.forEach(row => {
      csvContent += `${row.rank},${row.team_number},"${row.name.replace(/"/g, '""')}",${row.correctCount},${row.tie_breaker_score},${row.finalScore}\n`
    })
  } else if (activeReportTab.value === 'item-analysis') {
    csvContent += 'Question Number,Correct Choice,Correct Answers,Wrong Answers,Unanswered Count,Correctness Percentage\n'
    itemAnalysis.value.forEach(row => {
      csvContent += `${row.question_number},${row.correct_answer},${row.correctCount},${row.wrongCount},${row.unansweredCount},${row.correctPercent}%\n`
    })
  } else {
    // Cross table
    csvContent += 'Team Number,Team Name,' + Array.from({ length: 20 }, (_, i) => `Q${i + 1}`).join(',') + ',Total Score\n'
    crossTable.value.forEach(row => {
      const qAnswers = row.questions.map(q => q.is_correct ? 'Correct' : q.answer ? `Incorrect(${q.answer})` : 'Unanswered').join(',')
      csvContent += `${row.team_number},"${row.name.replace(/"/g, '""')}",${qAnswers},${row.finalScore}\n`
    })
  }

  const encodedUri = encodeURI(csvContent)
  const link = document.createElement('a')
  link.setAttribute('href', encodedUri)
  link.setAttribute('download', `quiz_report_${currentRound.value?.name || 'export'}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Configuration / Action Bar -->
    <div class="glass-card no-print" style="margin-bottom: 2rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
      <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 280px;">
        <label class="form-label" style="margin-bottom: 0; white-space: nowrap;">เลือกรอบรายงาน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input" style="max-width: 320px;">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div style="display: flex; gap: 0.5rem;" v-if="currentRound">
        <button @click="handleExportCSV" class="btn btn-secondary">
          <Download :size="16" />
          <span>ส่งออกไฟล์ CSV</span>
        </button>

        <button @click="handlePrint" class="btn btn-primary">
          <Printer :size="16" />
          <span>พิมพ์รายงาน (Print / Save PDF)</span>
        </button>
      </div>
    </div>

    <!-- Error/Unconfigured state -->
    <div v-if="!isConfigured" style="text-align: center; padding: 4rem 1rem;" class="glass-card">
      <AlertCircle :size="48" class="text-error" style="margin-bottom: 1rem;" />
      <h2 style="font-size: 1.25rem; margin-bottom: 0.5rem;">ไม่ได้เชื่อมต่อฐานข้อมูล</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
        กรุณาเชื่อมต่อและใส่รหัสความปลอดภัยของฐานข้อมูลในหน้าแรกก่อน
      </p>
      <NuxtLink to="/" class="btn btn-primary">ไปหน้าตั้งค่าเชื่อมต่อ</NuxtLink>
    </div>

    <!-- Main Content -->
    <template v-else-if="currentRound">
      
      <!-- Report Header (Print friendly) -->
      <div style="text-align: center; margin-bottom: 2rem;">
        <h1 style="font-size: 2.2rem; margin-bottom: 0.25rem; color: #fff;">รายงานผลการแข่งขันอย่างเป็นทางการ</h1>
        <p style="color: var(--text-secondary); font-size: 1.05rem;">
          {{ currentRound.name }} • วันที่แข่ง: {{ currentRound.date }}
        </p>
      </div>

      <!-- Report Tabs (No Print) -->
      <div class="no-print" style="display: flex; border-bottom: 1px solid var(--glass-border); margin-bottom: 1.5rem; overflow-x: auto; gap: 0.5rem;">
        <button 
          @click="activeReportTab = 'rankings'" 
          class="btn" 
          :style="activeReportTab === 'rankings' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <Award :size="16" />
          สรุปทำเนียบผู้ชนะและอันดับ
        </button>

        <button 
          @click="activeReportTab = 'crosstab'" 
          class="btn" 
          :style="activeReportTab === 'crosstab' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <Grid :size="16" />
          ตารางคะแนนแบบละเอียด (Cross Grid)
        </button>

        <button 
          @click="activeReportTab = 'item-analysis'" 
          class="btn" 
          :style="activeReportTab === 'item-analysis' ? 'border-bottom: 2px solid var(--color-cyan); color: var(--color-cyan); font-weight: 700;' : 'color: var(--text-secondary);'"
          style="border-radius: 0; background: none; box-shadow: none;"
        >
          <BarChart3 :size="16" />
          สถิติวิเคราะห์ข้อสอบ (Item Analysis)
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="loading" style="text-align: center; color: var(--text-secondary); padding: 5rem;">
        กำลังรวบรวมข้อมูลสถิติ...
      </div>

      <div v-else class="glass-card" style="background: rgba(255,255,255,0.015);">
        
        <!-- Tab 1: Leaderboard and Rankings -->
        <div v-if="activeReportTab === 'rankings'">
          <h2 style="font-size: 1.3rem; margin-bottom: 1rem; color: var(--color-cyan);" class="no-print">ทำเนียบอันดับคะแนนรวม (ข้อ 1-20)</h2>
          
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 80px;">อันดับ</th>
                  <th style="width: 100px;">เลขประจำทีม</th>
                  <th>ชื่อทีม / สังกัดโรงเรียน</th>
                  <th style="text-align: center;">ตอบถูก (ข้อ)</th>
                  <th style="text-align: center;">ตอบผิด (ข้อ)</th>
                  <th style="text-align: center;">ไม่ตอบ (ข้อ)</th>
                  <th style="text-align: center; width: 140px;">คะแนนไทเบรกเกอร์</th>
                  <th style="text-align: right; width: 120px; font-weight: 800;">คะแนนรวมสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="row in rankings" 
                  :key="row.id"
                  :style="row.rank <= 3 ? 'background: rgba(255, 255, 255, 0.02);' : ''"
                >
                  <td>
                    <span 
                      v-if="row.rank <= 3" 
                      class="status-pill"
                      :class="row.rank === 1 ? 'active' : row.rank === 2 ? 'completed' : 'pending'"
                      style="font-family: var(--font-title); font-weight: 800;"
                      :style="row.rank === 1 ? 'background: rgba(255, 214, 0, 0.2); color: var(--color-gold);' : ''"
                    >
                      อันดับ {{ row.rank }}
                    </span>
                    <span v-else style="font-family: var(--font-title); font-weight: 600; padding-left: 0.6rem;">
                      {{ row.rank }}
                    </span>
                  </td>
                  <td style="font-family: var(--font-title); color: var(--color-cyan); font-weight: 700;">
                    {{ String(row.team_number).padStart(2, '0') }}
                  </td>
                  <td style="font-weight: 600;">{{ row.name }}</td>
                  <td style="text-align: center; color: var(--color-success); font-weight: 700;">{{ row.correctCount }}</td>
                  <td style="text-align: center; color: var(--color-error);">{{ row.wrongCount }}</td>
                  <td style="text-align: center; color: var(--text-muted);">{{ row.unansweredCount }}</td>
                  <td style="text-align: center; color: var(--color-gold); font-weight: 700;">{{ row.tie_breaker_score }}</td>
                  <td style="text-align: right; font-family: var(--font-title); font-weight: 800; font-size: 1.25rem; color: #fff;">
                    {{ row.finalScore }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 2: Detailed Cross-Grid Table -->
        <div v-if="activeReportTab === 'crosstab'">
          <h2 style="font-size: 1.3rem; margin-bottom: 0.5rem; color: var(--color-cyan);" class="no-print">ตารางวิเคราะห์คำตอบรายข้อแบบละเอียด</h2>
          <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 1.5rem;" class="no-print">
            สัญลักษณ์: <span style="color: var(--color-success);">✓ (ตอบถูก)</span>, <span style="color: var(--color-error);">X (ตอบผิด)</span>, <span style="color: var(--text-muted);">- (ไม่บันทึกคำตอบ)</span>
          </p>

          <div class="table-responsive">
            <table class="report-table" style="font-size: 0.85rem;">
              <thead>
                <tr>
                  <th style="width: 50px;">เลขทีม</th>
                  <th style="min-width: 180px;">ชื่อทีม</th>
                  <th 
                    v-for="i in 20" 
                    :key="i" 
                    style="width: 38px; text-align: center; padding: 0.5rem 0.25rem; font-family: var(--font-title);"
                  >
                    Q{{ i }}
                  </th>
                  <th style="text-align: right; font-weight: 700; width: 60px;">คะแนน</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in crossTable" :key="row.id">
                  <td style="font-family: var(--font-title); font-weight: 700; color: var(--color-cyan);">
                    {{ String(row.team_number).padStart(2, '0') }}
                  </td>
                  <td style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {{ row.name }}
                  </td>
                  <td 
                    v-for="(qDetail, idx) in row.questions" 
                    :key="idx"
                    style="text-align: center; padding: 0.5rem 0.15rem;"
                  >
                    <Check v-if="qDetail.submitted && qDetail.is_correct" :size="14" style="color: var(--color-success); margin: 0 auto;" />
                    <span v-else-if="qDetail.submitted" style="color: var(--color-error); font-weight: 700;">
                      {{ qDetail.answer }}
                    </span>
                    <span v-else style="color: var(--text-muted);">-</span>
                  </td>
                  <td style="text-align: right; font-family: var(--font-title); font-weight: 800; font-size: 1.1rem; color: #fff;">
                    {{ row.finalScore }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 3: Item Analysis -->
        <div v-if="activeReportTab === 'item-analysis'">
          <h2 style="font-size: 1.3rem; margin-bottom: 1rem; color: var(--color-cyan);" class="no-print">สถิติวิเคราะห์รายข้อ (ข้อคำถามที่ 1 - 20)</h2>
          
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th style="width: 100px;">ข้อที่</th>
                  <th style="width: 140px; text-align: center;">เฉลยที่ถูกต้อง</th>
                  <th style="text-align: center;">จำนวนตอบถูก (ทีม)</th>
                  <th style="text-align: center;">จำนวนตอบผิด (ทีม)</th>
                  <th style="text-align: center;">จำนวนไม่ตอบ (ทีม)</th>
                  <th style="text-align: right; font-weight: 700;">เปอร์เซ็นต์ตอบถูก</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in itemAnalysis" :key="row.question_number">
                  <td style="font-family: var(--font-title); font-weight: 700; color: var(--color-cyan);">
                    ข้อที่ {{ String(row.question_number).padStart(2, '0') }}
                  </td>
                  <td style="text-align: center;">
                    <span class="status-pill completed" style="background: rgba(0, 229, 255, 0.15); font-weight: 800; padding: 0.25rem 0.8rem; font-size: 0.95rem;">
                      {{ row.correct_answer }}
                    </span>
                  </td>
                  <td style="text-align: center; color: var(--color-success); font-weight: 600;">{{ row.correctCount }}</td>
                  <td style="text-align: center; color: var(--color-error);">{{ row.wrongCount }}</td>
                  <td style="text-align: center; color: var(--text-muted);">{{ row.unansweredCount }}</td>
                  <td style="text-align: right; font-family: var(--font-title); font-weight: 800; font-size: 1.15rem;" :style="row.correctPercent >= 80 ? 'color: var(--color-success);' : row.correctPercent <= 30 ? 'color: var(--color-error);' : 'color: #fff;'">
                    {{ row.correctPercent }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<style scoped>
.text-error {
  color: var(--color-error);
}
</style>

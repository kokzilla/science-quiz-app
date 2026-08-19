<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { useAnswers } from '~/composables/useAnswers'
import { TOTAL_QUESTIONS } from '~/utils/constants'
import { 
  BarChart3, 
  Printer, 
  Download, 
  Check, 
  AlertCircle, 
  Award, 
  Grid, 
  Sparkles, 
  LogOut 
} from 'lucide-vue-next'
import type { Team, Question, Answer } from '~/types'

const route = useRoute()
const { supabase, isConfigured } = useSupabase()
const { validateStaffOrAdmin, logout } = useAuth()
const { fetchAllRoundAnswers } = useAnswers()

const teams = ref<Team[]>([])
const questions = ref<Question[]>([])
const answers = ref<Answer[]>([])

const loading = ref(true)
const activeReportTab = ref<'winners' | 'rankings' | 'crosstab' | 'item-analysis'>('winners')
const passkeyValid = ref(false)

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!supabase.value || !roundId) return
  loading.value = true
  
  try {
    // 1. Fetch all teams
    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
      .order('team_number', { ascending: true })
    teams.value = (tData || []) as Team[]

    // 2. Fetch questions answer key
    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
      .order('question_number', { ascending: true })
    questions.value = (qData || []) as Question[]

    // 3. Fetch all answers
    if (teams.value.length > 0) {
      const teamIds = teams.value.map(t => t.id)
      answers.value = await fetchAllRoundAnswers(roundId, teamIds)
    } else {
      answers.value = []
    }
  } catch (err) {
    console.error('Error fetching reports data:', err)
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
  passkeyValid.value = true
})

const formatSchoolName = (schoolName?: string | null) => {
  if (!schoolName) return ''
  const trimmed = schoolName.trim()
  if (trimmed.startsWith('โรงเรียน')) return trimmed
  return `โรงเรียน${trimmed}`
}

// ==========================================
// REPORT CALCULATIONS
// ==========================================

const rankingsSortBy = ref<'rank' | 'team'>('rank')

// 1. Leaderboard / Rankings calculation (Sums all TOTAL_QUESTIONS questions)
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

    const unansweredCount = TOTAL_QUESTIONS - (correctCount + wrongCount)
    const finalScore = correctCount + team.tie_breaker_score

    return {
      ...team,
      correctCount,
      wrongCount,
      unansweredCount,
      finalScore
    }
  })

  // Sort: finalScore DESC, tie_breaker_score DESC, team_number ASC to determine ranks
  list.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore
    if (b.tie_breaker_score !== a.tie_breaker_score) return b.tie_breaker_score - a.tie_breaker_score
    return a.team_number - b.team_number
  })

  // Assign ranks
  let currentRank = 1
  const rankedList = list.map((item, idx) => {
    if (idx > 0 && item.finalScore < list[idx - 1].finalScore) {
      currentRank = idx + 1
    }
    return {
      ...item,
      rank: currentRank
    }
  })

  if (rankingsSortBy.value === 'team') {
    return rankedList.sort((a, b) => a.team_number - b.team_number)
  }

  return rankedList
})

// 0. Winners & Honorable mentions calculation (from winner_data or auto-scores)
const winnersReport = computed(() => {
  const wd = currentRound.value?.winner_data
  
  // Helper to enrich a team list with latest scores from rankings
  const enrichTeams = (teamList: any[]) => {
    return (teamList || []).map(t => {
      const match = rankings.value.find(r => r.id === (t.id || t))
      return {
        id: t.id || t,
        team_number: match?.team_number ?? t.team_number,
        name: match?.name ?? t.name,
        school_name: match?.school_name ?? t.school_name,
        correctCount: match?.correctCount ?? 0,
        wrongCount: match?.wrongCount ?? 0,
        unansweredCount: match?.unansweredCount ?? 0,
        tie_breaker_score: match?.tie_breaker_score ?? t.tie_breaker_score ?? 0,
        finalScore: match?.finalScore ?? (match?.correctCount || 0)
      }
    })
  }

  if (wd && (
    (wd.rank1 && wd.rank1.length > 0) || 
    (wd.rank2 && wd.rank2.length > 0) || 
    (wd.rank3 && wd.rank3.length > 0) || 
    (wd.honorable && wd.honorable.length > 0) ||
    ((wd as any).rankHonorable && (wd as any).rankHonorable.length > 0)
  )) {
    return {
      isCustomSet: true,
      rank1: enrichTeams(wd.rank1 || []),
      rank2: enrichTeams(wd.rank2 || []),
      rank3: enrichTeams(wd.rank3 || []),
      honorable: enrichTeams(wd.honorable || (wd as any).rankHonorable || [])
    }
  }

  // Fallback to top score groups from rankings if winner_data is not set
  const sorted = [...rankings.value]
  const scores = Array.from(new Set(sorted.map(t => t.finalScore))).sort((a, b) => b - a)

  const top1Score = scores[0]
  const top2Score = scores[1]
  const top3Score = scores[2]
  const top4Score = scores[3]

  return {
    isCustomSet: false,
    rank1: top1Score !== undefined ? sorted.filter(t => t.finalScore === top1Score) : [],
    rank2: top2Score !== undefined ? sorted.filter(t => t.finalScore === top2Score) : [],
    rank3: top3Score !== undefined ? sorted.filter(t => t.finalScore === top3Score) : [],
    honorable: top4Score !== undefined ? sorted.filter(t => t.finalScore === top4Score) : []
  }
})

const hasAnyWinners = computed(() => {
  return winnersReport.value.rank1.length > 0 ||
         winnersReport.value.rank2.length > 0 ||
         winnersReport.value.rank3.length > 0 ||
         winnersReport.value.honorable.length > 0
})

const crosstabSortBy = ref<'score' | 'team'>('score')

// 2. Cross Table (Teams x Questions 1-TOTAL_QUESTIONS grid)
const crossTable = computed(() => {
  const list = teams.value.map(team => {
    const qDetails = Array.from({ length: TOTAL_QUESTIONS }, (_, idx) => {
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
  })

  if (crosstabSortBy.value === 'team') {
    return list.sort((a, b) => a.team_number - b.team_number)
  } else {
    return list.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore
      return a.team_number - b.team_number
    })
  }
})

// 3. Item Analysis (Difficulty/Correctness statistics per question)
const itemAnalysis = computed(() => {
  if (teams.value.length === 0) return []

  return Array.from({ length: TOTAL_QUESTIONS }, (_, idx) => {
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
  
  if (activeReportTab.value === 'winners') {
    csvContent += 'Award Category,Rank,Team Number,Team Name,School Name,Correct Answers,Wrong Answers,Unanswered,Total Score\n'
    const addCategory = (categoryName: string, rankNum: number | string, list: any[]) => {
      list.forEach(row => {
        csvContent += `"${categoryName}",${rankNum},${row.team_number},"${(row.name || '').replace(/"/g, '""')}","${(row.school_name || '').replace(/"/g, '""')}",${row.correctCount || 0},${row.wrongCount || 0},${row.unansweredCount || 0},${row.finalScore || 0}\n`
      })
    }
    addCategory('ชนะเลิศ (อันดับ 1)', 1, winnersReport.value.rank1)
    addCategory('รองชนะเลิศ อันดับ 1', 2, winnersReport.value.rank2)
    addCategory('รองชนะเลิศ อันดับ 2', 3, winnersReport.value.rank3)
    addCategory('รางวัลชมเชย', 'ชมเชย', winnersReport.value.honorable)
  } else if (activeReportTab.value === 'rankings') {
    csvContent += 'Rank,Team Number,Team Name,School Name,Correct Answers,Wrong Answers,Unanswered,Total Score\n'
    rankings.value.forEach(row => {
      csvContent += `${row.rank},${row.team_number},"${row.name.replace(/"/g, '""')}","${(row.school_name || '').replace(/"/g, '""')}",${row.correctCount},${row.wrongCount},${row.unansweredCount},${row.finalScore}\n`
    })
  } else if (activeReportTab.value === 'item-analysis') {
    csvContent += 'Question Number,Correct Choice,Correct Answers,Wrong Answers,Unanswered Count,Correctness Percentage\n'
    itemAnalysis.value.forEach(row => {
      csvContent += `${row.question_number},${row.correct_answer},${row.correctCount},${row.wrongCount},${row.unansweredCount},${row.correctPercent}%\n`
    })
  } else {
    // Cross table
    csvContent += 'Team Number,Team Name,' + Array.from({ length: TOTAL_QUESTIONS }, (_, i) => `Q${i + 1}`).join(',') + ',Total Score\n'
    crossTable.value.forEach(row => {
      const qAnswers = row.questions.map(q => q.is_correct ? 'Correct' : q.answer ? `Incorrect(${q.answer})` : 'Unanswered').join(',')
      csvContent += `${row.team_number},"${row.name.replace(/"/g, '""')}",${qAnswers},${row.finalScore}\n`
    })
  }

  const encodedUri = encodeURI(csvContent)
  const link = document.createElement('a')
  link.setAttribute('href', encodedUri)
  link.setAttribute('download', `quiz_report_${activeReportTab.value}_${currentRound.value?.name || 'export'}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div class="container" v-if="passkeyValid">
    
    <!-- Top Configuration / Action Bar -->
    <div class="glass-card no-print action-bar">
      <div class="selector-group">
        <label class="form-label selector-label">เลือกรอบรายงาน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input round-select">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div class="buttons-group" v-if="currentRound">
        <button @click="handleExportCSV" class="btn btn-secondary">
          <Download :size="16" />
          <span>ส่งออกไฟล์ CSV</span>
        </button>

        <button @click="handlePrint" class="btn btn-primary">
          <Printer :size="16" />
          <span>พิมพ์รายงาน (Print / Save PDF)</span>
        </button>
        
        <button @click="logout" class="btn btn-secondary logout-btn">
          <LogOut :size="16" />
          <span>ออกจากระบบ</span>
        </button>
      </div>
    </div>

    <!-- Error/Unconfigured state -->
    <div v-if="!isConfigured" class="glass-card unconfigured-card">
      <AlertCircle :size="48" class="text-error warning-icon" />
      <h2 class="warning-title">ไม่ได้เชื่อมต่อฐานข้อมูล</h2>
      <p class="warning-desc">
        กรุณาเชื่อมต่อและใส่รหัสความปลอดภัยของฐานข้อมูลในหน้าแรกก่อน
      </p>
      <NuxtLink to="/" class="btn btn-primary">ไปหน้าตั้งค่าเชื่อมต่อ</NuxtLink>
    </div>

    <!-- Main Content -->
    <template v-else-if="currentRound">
      
      <!-- Report Header (Print friendly) -->
      <div class="report-header">
        <h1 class="report-title">รายงานผลการแข่งขันอย่างเป็นทางการ</h1>
        <p class="report-subtitle">
          {{ currentRound.name }} • วันที่แข่ง: {{ currentRound.round_date || currentRound.date }}
        </p>
      </div>

      <!-- Report Tabs (No Print) -->
      <div class="no-print tabs-row">
        <button 
          @click="activeReportTab = 'winners'" 
          class="btn tab-btn" 
          :class="{ active: activeReportTab === 'winners' }"
        >
          <Award :size="16" />
          <span>🏆 ผู้ชนะเลิศและรางวัลชมเชย</span>
        </button>

        <button 
          @click="activeReportTab = 'rankings'" 
          class="btn tab-btn" 
          :class="{ active: activeReportTab === 'rankings' }"
        >
          <BarChart3 :size="16" />
          <span>สรุปทำเนียบอันดับคะแนน</span>
        </button>

        <button 
          @click="activeReportTab = 'crosstab'" 
          class="btn tab-btn" 
          :class="{ active: activeReportTab === 'crosstab' }"
        >
          <Grid :size="16" />
          <span>ตารางคะแนนแบบละเอียด (Cross Grid)</span>
        </button>

        <button 
          @click="activeReportTab = 'item-analysis'" 
          class="btn tab-btn" 
          :class="{ active: activeReportTab === 'item-analysis' }"
        >
          <BarChart3 :size="16" />
          <span>สถิติวิเคราะห์ข้อสอบ (Item Analysis)</span>
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-state">
        กำลังรวบรวมข้อมูลสถิติ...
      </div>

      <div v-else class="glass-card report-data-card">
        
        <!-- Tab 0: Winners & Honorable Mentions (Compact View without column headers) -->
        <div v-if="activeReportTab === 'winners'" class="compact-winners-container">
          <div class="winners-top-bar no-print">
            <h2 class="section-title">🏆 สรุปผลรางวัลการแข่งขัน</h2>
            <div class="winner-source-tag">
              <span v-if="winnersReport.isCustomSet" class="source-badge custom-badge">
                <Check :size="14" />
                <span>ผลรางวัลอย่างเป็นทางการ</span>
              </span>
              <span v-else class="source-badge auto-badge">
                <Sparkles :size="14" />
                <span>คำนวณตามคะแนนรวมอัตโนมัติ</span>
              </span>
            </div>
          </div>

          <div v-if="!hasAnyWinners" class="no-award-teams">
            - ยังไม่มีข้อมูลทีมในรอบนี้ -
          </div>

          <div v-else class="table-responsive">
            <table class="report-table compact-winners-table">
              <tbody>
                <!-- 1. ชนะเลิศ -->
                <tr v-for="team in winnersReport.rank1" :key="'r1-'+team.id" class="gold-award-row">
                  <td class="award-cell">
                    <span class="award-pill gold-pill">🥇 รางวัลชนะเลิศ</span>
                  </td>
                  <td class="team-num-cell">
                    <span class="team-badge gold-team-badge">TEAM {{ String(team.team_number).padStart(2, '0') }}</span>
                  </td>
                  <td class="team-info-cell">
                    <span class="winner-team-name">{{ team.name }}</span>
                    <span v-if="team.school_name" class="winner-school-name">{{ formatSchoolName(team.school_name) }}</span>
                  </td>
                  <td class="score-cell right-text gold-score">
                    {{ team.finalScore }} คะแนน
                  </td>
                </tr>

                <!-- 2. รองชนะเลิศ อันดับ 1 -->
                <tr v-for="team in winnersReport.rank2" :key="'r2-'+team.id" class="silver-award-row">
                  <td class="award-cell">
                    <span class="award-pill silver-pill">🥈 รองชนะเลิศ อันดับ 1</span>
                  </td>
                  <td class="team-num-cell">
                    <span class="team-badge silver-team-badge">TEAM {{ String(team.team_number).padStart(2, '0') }}</span>
                  </td>
                  <td class="team-info-cell">
                    <span class="winner-team-name">{{ team.name }}</span>
                    <span v-if="team.school_name" class="winner-school-name">{{ formatSchoolName(team.school_name) }}</span>
                  </td>
                  <td class="score-cell right-text silver-score">
                    {{ team.finalScore }} คะแนน
                  </td>
                </tr>

                <!-- 3. รองชนะเลิศ อันดับ 2 -->
                <tr v-for="team in winnersReport.rank3" :key="'r3-'+team.id" class="bronze-award-row">
                  <td class="award-cell">
                    <span class="award-pill bronze-pill">🥉 รองชนะเลิศ อันดับ 2</span>
                  </td>
                  <td class="team-num-cell">
                    <span class="team-badge bronze-team-badge">TEAM {{ String(team.team_number).padStart(2, '0') }}</span>
                  </td>
                  <td class="team-info-cell">
                    <span class="winner-team-name">{{ team.name }}</span>
                    <span v-if="team.school_name" class="winner-school-name">{{ formatSchoolName(team.school_name) }}</span>
                  </td>
                  <td class="score-cell right-text bronze-score">
                    {{ team.finalScore }} คะแนน
                  </td>
                </tr>

                <!-- 4. รางวัลชมเชย -->
                <tr v-for="team in winnersReport.honorable" :key="'rh-'+team.id" class="honorable-award-row">
                  <td class="award-cell">
                    <span class="award-pill honorable-pill">🎖️ รางวัลชมเชย</span>
                  </td>
                  <td class="team-num-cell">
                    <span class="team-badge honorable-team-badge">TEAM {{ String(team.team_number).padStart(2, '0') }}</span>
                  </td>
                  <td class="team-info-cell">
                    <span class="winner-team-name">{{ team.name }}</span>
                    <span v-if="team.school_name" class="winner-school-name">{{ formatSchoolName(team.school_name) }}</span>
                  </td>
                  <td class="score-cell right-text honorable-score">
                    {{ team.finalScore }} คะแนน
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 1: Leaderboard and Rankings -->
        <div v-if="activeReportTab === 'rankings'">
          <div class="crosstab-header-row">
            <h2 class="section-title no-print">ทำเนียบอันดับคะแนนรวม (ข้อ 1-{{ TOTAL_QUESTIONS }})</h2>

            <div class="sort-control-group no-print">
              <span class="sort-label">เรียงลำดับตาม:</span>
              <button 
                @click="rankingsSortBy = 'rank'" 
                class="btn sort-pill-btn" 
                :class="{ active: rankingsSortBy === 'rank' }"
              >
                เรียงตามอันดับ
              </button>
              <button 
                @click="rankingsSortBy = 'team'" 
                class="btn sort-pill-btn" 
                :class="{ active: rankingsSortBy === 'team' }"
              >
                เรียงตามเลขทีม
              </button>
            </div>
          </div>
          
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th 
                    class="rank-col crosstab-header-sortable center-text"
                    :class="{ 'active-sort': rankingsSortBy === 'rank' }"
                    @click="rankingsSortBy = 'rank'"
                    title="คลิกเพื่อเรียงตามอันดับ"
                  >
                    อันดับ {{ rankingsSortBy === 'rank' ? '▲' : '' }}
                  </th>
                  <th 
                    class="team-col crosstab-header-sortable"
                    :class="{ 'active-sort': rankingsSortBy === 'team' }"
                    @click="rankingsSortBy = 'team'"
                    title="คลิกเพื่อเรียงตามเลขทีม"
                  >
                    เลขประจำทีม {{ rankingsSortBy === 'team' ? '▲' : '' }}
                  </th>
                  <th>ชื่อทีม / สังกัดโรงเรียน</th>
                  <th class="center-text">ตอบถูก (ข้อ)</th>
                  <th class="center-text">ตอบผิด (ข้อ)</th>
                  <th class="center-text">ไม่ตอบ (ข้อ)</th>
                  <th class="right-text total-score-col">คะแนนรวมสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                <tr 
                  v-for="row in rankings" 
                  :key="row.id"
                  :class="{ 'rank-highlight': row.rank <= 3 }"
                >
                  <td class="center-text">
                    <span 
                      class="rank-circle" 
                      :class="{
                        'rank-1-circle': row.rank === 1,
                        'rank-2-circle': row.rank === 2,
                        'rank-3-circle': row.rank === 3
                      }"
                    >
                      {{ row.rank }}
                    </span>
                  </td>
                  <td class="team-number-highlight">
                    {{ String(row.team_number).padStart(2, '0') }}
                  </td>
                  <td class="team-name-bold">
                    {{ row.name }}
                    <span v-if="row.school_name" class="team-school-text">({{ row.school_name }})</span>
                  </td>
                  <td class="center-text text-success font-bold">{{ row.correctCount }}</td>
                  <td class="center-text text-error">{{ row.wrongCount }}</td>
                  <td class="center-text text-muted">{{ row.unansweredCount }}</td>
                  <td class="right-text final-score-cell">
                    {{ row.finalScore }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 2: Detailed Cross-Grid Table -->
        <div v-if="activeReportTab === 'crosstab'">
          <div class="crosstab-header-row">
            <div>
              <h2 class="section-title no-print">ตารางวิเคราะห์คำตอบรายข้อแบบละเอียด</h2>
              <p class="section-desc no-print">
                สัญลักษณ์: <span class="text-success">✓ (ตอบถูก)</span>, <span class="text-error">X (ตอบผิด)</span>, <span class="text-muted">- (ไม่บันทึกคำตอบ)</span>
              </p>
            </div>

            <div class="sort-control-group no-print">
              <span class="sort-label">เรียงลำดับตาม:</span>
              <button 
                @click="crosstabSortBy = 'score'" 
                class="btn sort-pill-btn" 
                :class="{ active: crosstabSortBy === 'score' }"
              >
                เรียงตามคะแนน
              </button>
              <button 
                @click="crosstabSortBy = 'team'" 
                class="btn sort-pill-btn" 
                :class="{ active: crosstabSortBy === 'team' }"
              >
                เรียงตามเลขทีม
              </button>
            </div>
          </div>

          <div class="table-responsive">
            <table class="report-table crosstab-table">
              <thead>
                <tr>
                  <th 
                    class="crosstab-team-col crosstab-header-sortable" 
                    :class="{ 'active-sort': crosstabSortBy === 'team' }"
                    @click="crosstabSortBy = 'team'"
                    title="คลิกเพื่อเรียงตามเลขทีม"
                  >
                    เลขทีม {{ crosstabSortBy === 'team' ? '▲' : '' }}
                  </th>
                  <th class="crosstab-name-col">ชื่อทีม</th>
                  <th 
                    v-for="i in TOTAL_QUESTIONS" 
                    :key="i" 
                    class="crosstab-q-header"
                  >
                    Q{{ i }}
                  </th>
                  <th 
                    class="right-text crosstab-score-col crosstab-header-sortable" 
                    :class="{ 'active-sort': crosstabSortBy === 'score' }"
                    @click="crosstabSortBy = 'score'"
                    title="คลิกเพื่อเรียงตามคะแนน"
                  >
                    คะแนน {{ crosstabSortBy === 'score' ? '▼' : '' }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in crossTable" :key="row.id">
                  <td class="team-number-highlight">
                    {{ String(row.team_number).padStart(2, '0') }}
                  </td>
                  <td class="team-name-ellipsis">
                    {{ row.name }}
                  </td>
                  <td 
                    v-for="(qDetail, idx) in row.questions" 
                    :key="idx"
                    class="crosstab-cell"
                  >
                    <Check v-if="qDetail.submitted && qDetail.is_correct" :size="14" class="text-success centered-icon" />
                    <span v-else-if="qDetail.submitted" class="text-error font-bold">
                      {{ qDetail.answer }}
                    </span>
                    <span v-else class="text-muted">-</span>
                  </td>
                  <td class="right-text final-score-bold">
                    {{ row.finalScore }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tab 3: Item Analysis -->
        <div v-if="activeReportTab === 'item-analysis'">
          <h2 class="section-title no-print">สถิติวิเคราะห์รายข้อ (ข้อคำถามที่ 1 - {{ TOTAL_QUESTIONS }})</h2>
          
          <div class="table-responsive">
            <table class="report-table">
              <thead>
                <tr>
                  <th class="q-num-col">ข้อที่</th>
                  <th class="correct-choice-col">เฉลยที่ถูกต้อง</th>
                  <th class="center-text">จำนวนตอบถูก (ทีม)</th>
                  <th class="center-text">จำนวนตอบผิด (ทีม)</th>
                  <th class="center-text">จำนวนไม่ตอบ (ทีม)</th>
                  <th class="right-text">เปอร์เซ็นต์ตอบถูก</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in itemAnalysis" :key="row.question_number">
                  <td class="team-number-highlight">
                    ข้อที่ {{ String(row.question_number).padStart(2, '0') }}
                  </td>
                  <td class="center-text">
                    <span class="status-pill completed answer-key-pill">
                      {{ row.correct_answer }}
                    </span>
                  </td>
                  <td class="center-text text-success font-semibold">{{ row.correctCount }}</td>
                  <td class="center-text text-error">{{ row.wrongCount }}</td>
                  <td class="center-text text-muted">{{ row.unansweredCount }}</td>
                  <td 
                    class="right-text percentage-cell" 
                    :class="{ 
                      'high-correct': row.correctPercent >= 80, 
                      'low-correct': row.correctPercent <= 30 
                    }"
                  >
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
.action-bar {
  margin-bottom: 2rem; 
  display: flex; 
  flex-wrap: wrap; 
  justify-content: space-between; 
  align-items: center; 
  gap: 1rem;
}

.selector-group {
  display: flex; 
  align-items: center; 
  gap: 1rem; 
  flex: 1; 
  min-width: 280px;
}

.selector-label {
  margin-bottom: 0; 
  white-space: nowrap;
}

.round-select {
  max-width: 320px;
}

.buttons-group {
  display: flex; 
  gap: 0.5rem;
}

.logout-btn {
  display: flex; 
  align-items: center; 
  gap: 0.25rem;
}

.text-error { color: var(--color-error); }
.text-cyan { color: var(--color-cyan); }
.text-gold { color: var(--color-gold); }
.text-success { color: var(--color-success); }
.text-muted { color: var(--text-muted); }
.font-bold { font-weight: 700; }
.font-semibold { font-weight: 600; }

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

.report-header {
  text-align: center; 
  margin-bottom: 2rem;
}

.report-title {
  font-size: 2.2rem; 
  margin-bottom: 0.25rem; 
  color: var(--text-primary);
}

.report-subtitle {
  color: var(--text-secondary); 
  font-size: 1.05rem;
}

.tabs-row {
  display: flex; 
  border-bottom: 1px solid var(--glass-border); 
  margin-bottom: 1.5rem; 
  overflow-x: auto; 
  gap: 0.5rem;
}

.tab-btn {
  border-radius: 0; 
  background: none; 
  box-shadow: none;
  color: var(--text-secondary);
}

.tab-btn.active {
  border-bottom: 2px solid var(--color-cyan); 
  color: var(--color-cyan) !important; 
  font-weight: 700;
}

.loading-state {
  text-align: center; 
  color: var(--text-secondary); 
  padding: 5rem;
}

.report-data-card {
  background: rgba(255,255,255,0.015);
}

:global(.light-theme) .report-data-card {
  background: var(--glass-bg);
}

.section-title {
  font-size: 1.3rem; 
  margin-bottom: 1rem; 
  color: var(--color-cyan);
}

.section-desc {
  color: var(--text-secondary); 
  font-size: 0.8rem; 
  margin-bottom: 1.5rem;
}

.rank-col { width: 80px; }
.team-col { width: 100px; }
.center-text { text-align: center; }
.right-text { text-align: right; }
.tiebreak-score-col { width: 140px; }
.total-score-col { width: 120px; font-weight: 800; }

.rank-highlight {
  background: rgba(255, 255, 255, 0.02);
}

:global(.light-theme) .rank-highlight {
  background: rgba(0, 0, 0, 0.03);
}

.rank-pill {
  font-family: var(--font-title); 
  font-weight: 800;
}

.regular-rank {
  font-family: var(--font-title); 
  font-weight: 600; 
  padding-left: 0.6rem;
}

.team-number-highlight {
  font-family: var(--font-title); 
  color: var(--color-cyan); 
  font-weight: 700;
}

.team-name-bold {
  font-weight: 600;
}

.team-school-text {
  font-weight: 400;
  color: var(--text-secondary);
  margin-left: 0.35rem;
}

.rank-circle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-title);
  font-weight: 700;
  font-size: 0.95rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  margin: 0 auto;
}

.rank-1-circle {
  background: rgba(255, 214, 0, 0.18);
  border: 2px solid var(--color-gold);
  color: var(--color-gold);
  box-shadow: 0 0 10px rgba(255, 214, 0, 0.25);
  font-weight: 800;
}

.rank-2-circle {
  background: rgba(224, 224, 224, 0.18);
  border: 2px solid var(--color-silver);
  color: var(--color-silver);
  font-weight: 800;
}

.rank-3-circle {
  background: rgba(205, 127, 50, 0.18);
  border: 2px solid var(--color-bronze);
  color: var(--color-bronze);
  font-weight: 800;
}

:global(.light-theme) .rank-circle {
  background: #e2e8f0;
  border-color: rgba(15, 23, 42, 0.15);
  color: #334155;
}

:global(.light-theme) .rank-1-circle {
  background: rgba(245, 127, 23, 0.15);
  border-color: #f57f17;
  color: #d97706;
}

:global(.light-theme) .rank-2-circle {
  background: rgba(148, 163, 184, 0.2);
  border-color: #64748b;
  color: #475569;
}

:global(.light-theme) .rank-3-circle {
  background: rgba(205, 127, 50, 0.15);
  border-color: #cd7f32;
  color: #b45309;
}

.final-score-cell {
  font-family: var(--font-title); 
  font-weight: 800; 
  font-size: 1.25rem; 
  color: var(--text-primary);
}

.crosstab-team-col { width: 50px; }
.crosstab-name-col { min-width: 180px; }
.crosstab-score-col { font-weight: 700; width: 60px; }

.crosstab-q-header {
  width: 38px; 
  text-align: center; 
  padding: 0.5rem 0.25rem; 
  font-family: var(--font-title);
}

.team-name-ellipsis {
  font-weight: 600; 
  overflow: hidden; 
  text-overflow: ellipsis; 
  white-space: nowrap;
}

.crosstab-cell {
  text-align: center; 
  padding: 0.5rem 0.15rem;
}

.centered-icon {
  margin: 0 auto;
}

.final-score-bold {
  font-family: var(--font-title); 
  font-weight: 800; 
  font-size: 1.1rem; 
  color: var(--text-primary);
}

.q-num-col { width: 100px; }
.correct-choice-col { width: 140px; text-align: center; }

.answer-key-pill {
  background: rgba(0, 229, 255, 0.15); 
  font-weight: 800; 
  padding: 0.25rem 0.8rem; 
  font-size: 0.95rem;
}

.percentage-cell {
  font-family: var(--font-title); 
  font-weight: 800; 
  font-size: 1.15rem; 
  color: var(--text-primary);
}

.high-correct {
  color: var(--color-success) !important;
}

.low-correct {
  color: var(--color-error) !important;
}

/* Crosstab Sort Controls */
.crosstab-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.sort-control-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(10, 12, 22, 0.6);
  border: 1px solid var(--glass-border);
  padding: 0.35rem 0.65rem;
  border-radius: var(--radius-sm);
}

.sort-label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.sort-pill-btn {
  padding: 0.3rem 0.75rem;
  font-size: 0.85rem;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sort-pill-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.sort-pill-btn.active {
  background: var(--color-cyan);
  color: #000;
  font-weight: 700;
}

:global(.light-theme) .sort-control-group {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.15);
}

:global(.light-theme) .sort-pill-btn {
  color: var(--text-secondary);
}

:global(.light-theme) .sort-pill-btn.active {
  background: var(--color-cyan);
  color: #ffffff;
}

.crosstab-header-sortable {
  cursor: pointer;
  user-select: none;
  transition: color var(--transition-fast);
}

.crosstab-header-sortable:hover {
  color: var(--color-cyan);
}

.crosstab-header-sortable.active-sort {
  color: var(--color-cyan);
  font-weight: 800;
}

/* ==========================================================================
   COMPACT WINNERS & HONORABLE MENTION REPORT TAB STYLES
   ========================================================================== */
.compact-winners-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.winners-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.winner-source-tag {
  display: flex;
  align-items: center;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 600;
}

.source-badge.custom-badge {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #4ade80;
}

.source-badge.auto-badge {
  background: rgba(0, 229, 255, 0.15);
  border: 1px solid rgba(0, 229, 255, 0.4);
  color: var(--color-cyan);
}

.no-award-teams {
  padding: 2.5rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 1rem;
}

.compact-winners-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 0.6rem;
  margin-bottom: 0;
}

.compact-winners-table tbody tr {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--glass-border);
  transition: all var(--transition-fast);
}

.compact-winners-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.06);
}

.compact-winners-table td {
  padding: 0.85rem 1.25rem;
  vertical-align: middle;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.compact-winners-table td:first-child {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  border-top-left-radius: var(--radius-md);
  border-bottom-left-radius: var(--radius-md);
}

.compact-winners-table td:last-child {
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  border-top-right-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}

.award-cell {
  width: 230px;
  white-space: nowrap;
}

.award-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 800;
  font-size: 0.95rem;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  border: 1px solid transparent;
}

.gold-pill {
  background: rgba(255, 214, 0, 0.15);
  border-color: rgba(255, 214, 0, 0.45);
  color: var(--color-gold, #fde047);
}

.silver-pill {
  background: rgba(224, 224, 224, 0.15);
  border-color: rgba(224, 224, 224, 0.4);
  color: var(--color-silver, #e2e8f0);
}

.bronze-pill {
  background: rgba(205, 127, 50, 0.15);
  border-color: rgba(205, 127, 50, 0.4);
  color: var(--color-bronze, #fdba74);
}

.honorable-pill {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: #38bdf8;
}

.team-num-cell {
  width: 120px;
  white-space: nowrap;
}

.team-badge {
  font-family: var(--font-title);
  font-weight: 800;
  font-size: 0.95rem;
  padding: 0.25rem 0.65rem;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-cyan, #00e5ff);
}

.gold-team-badge { color: var(--color-gold, #fde047); }
.silver-team-badge { color: var(--color-silver, #e2e8f0); }
.bronze-team-badge { color: var(--color-bronze, #fdba74); }
.honorable-team-badge { color: #38bdf8; }

.team-info-cell {
  min-width: 250px;
}

.winner-team-name {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--text-primary);
  margin-right: 0.5rem;
}

.winner-school-name {
  font-weight: 400;
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.score-cell {
  width: 140px;
  font-family: var(--font-title);
  font-weight: 800;
  font-size: 1.15rem;
  white-space: nowrap;
}

.gold-score { color: var(--color-gold, #fde047) !important; }
.silver-score { color: var(--color-silver, #e2e8f0) !important; }
.bronze-score { color: var(--color-bronze, #fdba74) !important; }
.honorable-score { color: #38bdf8 !important; }

.gold-award-row {
  border-left: 3px solid var(--color-gold) !important;
}

.silver-award-row {
  border-left: 3px solid var(--color-silver) !important;
}

.bronze-award-row {
  border-left: 3px solid var(--color-bronze) !important;
}

.honorable-award-row {
  border-left: 3px solid #38bdf8 !important;
}

/* Light Theme support */
:global(.light-theme) .compact-winners-table tbody tr {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.1);
}

:global(.light-theme) .compact-winners-table tbody tr:hover {
  background: #f8fafc;
}

:global(.light-theme) .gold-pill {
  background: rgba(245, 127, 23, 0.15);
  border-color: #f57f17;
  color: #d97706;
}

:global(.light-theme) .silver-pill {
  background: rgba(148, 163, 184, 0.2);
  border-color: #64748b;
  color: #475569;
}

:global(.light-theme) .bronze-pill {
  background: rgba(205, 127, 50, 0.15);
  border-color: #cd7f32;
  color: #b45309;
}

:global(.light-theme) .honorable-pill {
  background: rgba(2, 132, 199, 0.15);
  border-color: rgba(2, 132, 199, 0.35);
  color: #0284c7;
}

:global(.light-theme) .winner-school-name {
  color: #64748b;
}

:global(.light-theme) .team-badge {
  background: #f1f5f9;
}

:global(.light-theme) .gold-team-badge { color: #d97706; }
:global(.light-theme) .silver-team-badge { color: #475569; }
:global(.light-theme) .bronze-team-badge { color: #b45309; }
:global(.light-theme) .honorable-team-badge { color: #0284c7; }

:global(.light-theme) .gold-score { color: #d97706 !important; }
:global(.light-theme) .silver-score { color: #475569 !important; }
:global(.light-theme) .bronze-score { color: #b45309 !important; }
:global(.light-theme) .honorable-score { color: #0284c7 !important; }
</style>

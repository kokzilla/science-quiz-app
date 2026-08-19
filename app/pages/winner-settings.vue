<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useTheme } from '~/composables/useTheme'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { useAnswers } from '~/composables/useAnswers'
import { 
  Award, 
  Tv, 
  Check, 
  Sparkles, 
  RefreshCw, 
  LogOut, 
  CheckCircle,
  AlertCircle,
  ChevronLeft,
  Sun,
  Moon,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from 'lucide-vue-next'
import type { Team, Question, Answer } from '~/types'

const router = useRouter()
const { supabase, isConfigured } = useSupabase()
const { validateAdminOnly, getActivePasskey } = useAuth()
const { theme, initTheme } = useTheme()
const { fetchAllRoundAnswers } = useAnswers()

const passkeyValid = ref(false)
const adminPasskey = ref('')
const loading = ref(true)
const isSaving = ref(false)
const isBroadcasting = ref(false)
const message = ref({ text: '', type: 'success' })

const teams = ref<Team[]>([])
const questions = ref<Question[]>([])
const answers = ref<Answer[]>([])

// Selected team IDs for each rank
const selectedRank1 = ref<string[]>([])
const selectedRank2 = ref<string[]>([])
const selectedRank3 = ref<string[]>([])
const selectedHonorable = ref<string[]>([])

// Audio & Presenter Theme settings refs
const soundEnabled = ref(true)
const ttsEnabled = ref(true)
const presenterTheme = ref<'dark' | 'light'>('dark')
let configChannel: any = null

const setupConfigChannel = () => {
  if (!supabase.value) return
  if (configChannel) {
    supabase.value.removeChannel(configChannel)
    configChannel = null
  }
  configChannel = supabase.value.channel('presenter-global-config', {
    config: { broadcast: { self: true } }
  })
  configChannel
    .on('broadcast', { event: 'request_audio_settings' }, () => {
      sendAudioSettings()
    })
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        sendAudioSettings()
      }
    })
}

const sendAudioSettings = () => {
  const payload = {
    soundEnabled: soundEnabled.value,
    ttsEnabled: ttsEnabled.value,
    presenterTheme: presenterTheme.value
  }

  if (configChannel) {
    configChannel.send({
      type: 'broadcast',
      event: 'audio_settings',
      payload
    })
  }

  if (typeof window !== 'undefined' && ('BroadcastChannel' in window)) {
    try {
      const bc = new BroadcastChannel('presenter_config_channel')
      bc.postMessage({ event: 'audio_settings', payload })
      setTimeout(() => bc.close(), 200)
    } catch (e) {}
  }
}

const togglePresenterTheme = async () => {
  presenterTheme.value = presenterTheme.value === 'dark' ? 'light' : 'dark'
  if (typeof window !== 'undefined') {
    localStorage.setItem('presenter_theme', presenterTheme.value)
  }
  sendAudioSettings()

  if (supabase.value && currentRound.value?.id) {
    try {
      await supabase.value.rpc('update_presenter_theme_secure', {
        p_round_id: currentRound.value.id,
        p_presenter_theme: presenterTheme.value,
        p_passkey: adminPasskey.value
      })
    } catch (e) {
      console.error('Error updating presenter theme in DB:', e)
    }
  }
}

const toggleSound = () => {
  soundEnabled.value = !soundEnabled.value
  sendAudioSettings()
}

const toggleTts = () => {
  ttsEnabled.value = !ttsEnabled.value
  sendAudioSettings()
}

// Callback when selected round changes
const onRoundChanged = async (roundId: string) => {
  if (!supabase.value || !roundId) {
    loading.value = false
    return
  }
  loading.value = true
  message.value = { text: '', type: 'success' }
  
  try {
    if (currentRound.value?.presenter_theme) {
      presenterTheme.value = currentRound.value.presenter_theme
    }
    setupConfigChannel()

    const { data: tData } = await supabase.value
      .from('teams')
      .select('*')
      .eq('round_id', roundId)
      .order('team_number', { ascending: true })
    teams.value = (tData || []) as Team[]

    const { data: qData } = await supabase.value
      .from('questions')
      .select('*')
      .eq('round_id', roundId)
    questions.value = (qData || []) as Question[]

    if (teams.value.length > 0) {
      const teamIds = teams.value.map(t => t.id)
      answers.value = await fetchAllRoundAnswers(roundId, teamIds)
    } else {
      answers.value = []
    }

    // Load existing winner_data if present
    if (currentRound.value?.winner_data) {
      const wd = currentRound.value.winner_data
      selectedRank1.value = (wd.rank1 || []).map((t: any) => t.id || t)
      selectedRank2.value = (wd.rank2 || []).map((t: any) => t.id || t)
      selectedRank3.value = (wd.rank3 || []).map((t: any) => t.id || t)
      selectedHonorable.value = (wd.honorable || (wd as any).rankHonorable || []).map((t: any) => t.id || t)
    } else {
      // Auto populate initial suggestions if no winner_data saved yet
      autoCalculateWinners()
    }
  } catch (err: any) {
    console.error('Error loading round data:', err)
  } finally {
    loading.value = false
  }
}

const {
  selectedRoundId,
  roundsList,
  currentRound,
  loadingRounds,
  handleRoundChange
} = useRoundSelector(onRoundChanged)

watch(loadingRounds, (isLoading) => {
  if (!isLoading && roundsList.value.length === 0) {
    loading.value = false
  }
})

onUnmounted(() => {
  if (configChannel && supabase.value) {
    supabase.value.removeChannel(configChannel)
    configChannel = null
  }
})

onMounted(async () => {
  initTheme()

  if (typeof window !== 'undefined') {
    const savedTheme = localStorage.getItem('presenter_theme') as 'dark' | 'light' | null
    if (savedTheme) {
      presenterTheme.value = savedTheme
    }
  }

  setupConfigChannel()

  const isValid = await validateAdminOnly()
  if (!isValid) return
  
  adminPasskey.value = getActivePasskey()
  passkeyValid.value = true
})

const formatSchoolName = (schoolName?: string) => {
  if (!schoolName) return ''
  const trimmed = schoolName.trim()
  if (trimmed.startsWith('โรงเรียน')) return trimmed
  return `โรงเรียน${trimmed}`
}

// Calculate team scores for display and auto-ranking
const teamsWithScores = computed(() => {
  const answerKeyMap = new Map<number, string>()
  questions.value.forEach(q => {
    if (q.correct_answer) {
      answerKeyMap.set(q.question_number, q.correct_answer)
    }
  })

  return teams.value.map(team => {
    const teamAnswers = answers.value.filter(a => a.team_id === team.id)
    let score = 0
    teamAnswers.forEach(ans => {
      const correct = answerKeyMap.get(ans.question_number)
      if (correct && ans.submitted_answer === correct) {
        score++
      }
    })
    const totalScore = score + (team.tie_breaker_score || 0)
    return {
      ...team,
      rawScore: score,
      totalScore
    }
  }).sort((a, b) => b.totalScore - a.totalScore || a.team_number - b.team_number)
})

// Auto-fill top ranks and honorable mentions from highest scores
const autoCalculateWinners = () => {
  const sorted = [...teamsWithScores.value]
  if (sorted.length === 0) {
    selectedRank1.value = []
    selectedRank2.value = []
    selectedRank3.value = []
    selectedHonorable.value = []
    return
  }

  // Get distinct score levels
  const scores = Array.from(new Set(sorted.map(t => t.totalScore))).sort((a, b) => b - a)

  const top1Score = scores[0]
  const top2Score = scores[1]
  const top3Score = scores[2]
  const top4Score = scores[3]

  selectedRank1.value = top1Score !== undefined ? sorted.filter(t => t.totalScore === top1Score).map(t => t.id) : []
  selectedRank2.value = top2Score !== undefined ? sorted.filter(t => t.totalScore === top2Score).map(t => t.id) : []
  selectedRank3.value = top3Score !== undefined ? sorted.filter(t => t.totalScore === top3Score).map(t => t.id) : []
  selectedHonorable.value = top4Score !== undefined ? sorted.filter(t => t.totalScore === top4Score).map(t => t.id) : []

  message.value = { text: 'คำนวณและดึงรายชื่อผู้ชนะและรางวัลชมเชยจากคะแนนโดยอัตโนมัติเรียบร้อยแล้ว', type: 'success' }
}

const toggleTeamSelection = (rankList: 'rank1' | 'rank2' | 'rank3' | 'honorable', teamId: string) => {
  let targetRef = selectedRank1
  if (rankList === 'rank2') targetRef = selectedRank2
  if (rankList === 'rank3') targetRef = selectedRank3
  if (rankList === 'honorable') targetRef = selectedHonorable

  const index = targetRef.value.indexOf(teamId)
  if (index > -1) {
    targetRef.value.splice(index, 1)
  } else {
    targetRef.value.push(teamId)
  }
}

const isTeamSelected = (rankList: 'rank1' | 'rank2' | 'rank3' | 'honorable', teamId: string) => {
  if (rankList === 'rank1') return selectedRank1.value.includes(teamId)
  if (rankList === 'rank2') return selectedRank2.value.includes(teamId)
  if (rankList === 'rank3') return selectedRank3.value.includes(teamId)
  if (rankList === 'honorable') return selectedHonorable.value.includes(teamId)
  return false
}

// Prepare JSON payload for DB
const buildWinnerDataPayload = () => {
  const getObjects = (ids: string[]) => {
    return teams.value
      .filter(t => ids.includes(t.id))
      .map(t => ({
        id: t.id,
        team_number: t.team_number,
        name: t.name,
        school_name: t.school_name || null,
        tie_breaker_score: t.tie_breaker_score
      }))
  }

  return {
    rank1: getObjects(selectedRank1.value),
    rank2: getObjects(selectedRank2.value),
    rank3: getObjects(selectedRank3.value),
    honorable: getObjects(selectedHonorable.value)
  }
}

const saveWinnerData = async () => {
  if (!supabase.value || !selectedRoundId.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  isSaving.value = true
  message.value = { text: '', type: 'success' }

  try {
    const payload = buildWinnerDataPayload()
    const { error } = await supabase.value.rpc('update_winner_data_secure', {
      p_round_id: selectedRoundId.value,
      p_winner_data: payload,
      p_passkey: adminPasskey.value
    })

    if (error) throw error
    message.value = { text: 'บันทึกการตั้งค่าผู้ชนะเลิศเรียบร้อยแล้ว!', type: 'success' }
  } catch (err: any) {
    message.value = { text: `บันทึกไม่สำเร็จ: ${err.message}`, type: 'error' }
  } finally {
    isSaving.value = false
  }
}

const broadcastWinners = async () => {
  if (!supabase.value || !selectedRoundId.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  isBroadcasting.value = true
  message.value = { text: '', type: 'success' }

  try {
    // 1. Save winner data first
    const payload = buildWinnerDataPayload()
    const { error: saveErr } = await supabase.value.rpc('update_winner_data_secure', {
      p_round_id: selectedRoundId.value,
      p_winner_data: payload,
      p_passkey: adminPasskey.value
    })
    if (saveErr) throw saveErr

    // 2. Broadcast presenter state to 'winners'
    const { error: stateErr } = await supabase.value.rpc('update_presenter_state_secure', {
      p_round_id: selectedRoundId.value,
      p_active_question: currentRound.value.presenter_active_question || 1,
      p_show_state: 'winners',
      p_timer_started_at: null,
      p_passkey: adminPasskey.value
    })
    if (stateErr) throw stateErr

    currentRound.value.presenter_show_state = 'winners'
    message.value = { text: '🚀 ส่งการแสดงผลประกาศผู้ชนะไปยังจอเวที LED เรียบร้อยแล้ว!', type: 'success' }
  } catch (err: any) {
    message.value = { text: `ส่งการแสดงผลล้มเหลว: ${err.message}`, type: 'error' }
  } finally {
    isBroadcasting.value = false
  }
}

const hideWinners = async () => {
  if (!supabase.value || !selectedRoundId.value || !currentRound.value) return
  if (!adminPasskey.value) {
    alert('กรุณากรอกรหัสผ่านแอดมินก่อนดำเนินการ')
    return
  }

  try {
    const { error } = await supabase.value.rpc('update_presenter_state_secure', {
      p_round_id: selectedRoundId.value,
      p_active_question: currentRound.value.presenter_active_question || 1,
      p_show_state: 'welcome',
      p_timer_started_at: null,
      p_passkey: adminPasskey.value
    })

    if (error) throw error
    currentRound.value.presenter_show_state = 'welcome'
    message.value = { text: 'ซ่อนการแสดงผลประกาศผู้ชนะบนจอเวทีแล้ว', type: 'success' }
  } catch (err: any) {
    alert(`เกิดข้อผิดพลาด: ${err.message}`)
  }
}

const goBackAdmin = () => {
  router.push('/admin')
}
</script>

<template>
  <div class="container winner-settings-page" v-if="passkeyValid">
    
    <!-- Top Action Bar -->
    <div class="glass-card header-bar">
      <div class="rounds-selector-group">
        <button @click="goBackAdmin" class="btn btn-secondary back-btn">
          <ChevronLeft :size="18" />
          <span>กลับหน้า Admin</span>
        </button>
        <label class="form-label selector-label">เลือกรอบการแข่งขัน:</label>
        <select v-model="selectedRoundId" @change="handleRoundChange" class="form-input selector-dropdown">
          <option v-for="r in roundsList" :key="r.id" :value="r.id">
            {{ r.name }} ({{ r.status }})
          </option>
        </select>
      </div>

      <div class="header-portal-actions">
        <!-- Audio & Theme Toggles -->
        <div class="audio-controls-group">
          <button 
            @click="togglePresenterTheme" 
            class="btn toggle-audio-btn" 
            :class="presenterTheme === 'light' ? 'btn-primary' : 'btn-secondary'"
            :title="presenterTheme === 'dark' ? 'ธีมจอเวที (Presenter): โหมดมืด (คลิกเปลี่ยนเป็นสว่าง)' : 'ธีมจอเวที (Presenter): โหมดสว่าง (คลิกเปลี่ยนเป็นมืด)'"
          >
            <Sun v-if="presenterTheme === 'light'" :size="15" />
            <Moon v-else :size="15" />
          </button>

          <button 
            @click="toggleTts" 
            class="btn toggle-audio-btn" 
            :class="ttsEnabled ? 'btn-primary' : 'btn-secondary'"
            :title="ttsEnabled ? 'เสียงพูดอ่านโจทย์/ผู้ชนะ: เปิด' : 'เสียงพูดอ่านโจทย์/ผู้ชนะ: ปิด'"
          >
            <Mic v-if="ttsEnabled" :size="15" />
            <MicOff v-else :size="15" />
          </button>

          <button 
            @click="toggleSound" 
            class="btn toggle-audio-btn" 
            :class="soundEnabled ? 'btn-primary' : 'btn-secondary'"
            :title="soundEnabled ? 'เสียงเตือนเวลานับถอยหลัง: เปิด' : 'เสียงเตือนเวลานับถอยหลัง: ปิด'"
          >
            <Volume2 v-if="soundEnabled" :size="15" />
            <VolumeX v-else :size="15" />
          </button>
        </div>

        <NuxtLink :to="`/presenter?round=${selectedRoundId}`" target="_blank" class="btn btn-secondary portal-btn">
          <Tv :size="16" />
          <span>เปิดจอ LED ใหญ่</span>
        </NuxtLink>
      </div>
    </div>

    <!-- Active Status Card -->
    <div v-if="currentRound" class="glass-card round-banner">
      <div class="banner-info">
        <h1 class="page-title">
          <Award :size="28" class="text-gold" />
          <span>ตั้งค่าและประกาศผลผู้ชนะเลิศ</span>
        </h1>
        <p class="page-subtitle">
          กำหนดทีมชนะเลิศ 1-3 และรางวัลชมเชย ประจำรอบ <strong>{{ currentRound.name }}</strong> เพื่อแสดงบนแท่นรับรางวัลและจอเวที LED
        </p>
      </div>

      <div class="banner-state-badge">
        <span class="state-label">สถานะจอเวทีปัจจุบัน:</span>
        <span 
          class="status-pill" 
          :class="currentRound.presenter_show_state === 'winners' ? 'active-winner-pill' : 'normal-pill'"
        >
          {{ currentRound.presenter_show_state === 'winners' ? '🏆 กำลังแสดงผลประกาศผู้ชนะบนจอ' : currentRound.presenter_show_state }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="loading-box">
      <div class="loading-spin"></div>
      <p>กำลังดึงข้อมูลทีมและคำนวณคะแนน...</p>
    </div>

    <template v-else-if="currentRound">
      <!-- Alert Message Banner -->
      <div v-if="message.text" class="msg-banner" :class="message.type">
        <CheckCircle v-if="message.type === 'success'" :size="18" />
        <AlertCircle v-else :size="18" />
        <span>{{ message.text }}</span>
      </div>

      <!-- Quick Action Controls -->
      <div class="glass-card controls-toolbar">
        <button @click="autoCalculateWinners" class="btn btn-secondary auto-calc-btn">
          <Sparkles :size="16" />
          <span>คำนวณอันดับจากคะแนนอัตโนมัติ</span>
        </button>

        <div class="action-btn-group">
          <button @click="saveWinnerData" :disabled="isSaving" class="btn btn-secondary">
            <span>{{ isSaving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า' }}</span>
          </button>

          <button @click="broadcastWinners" :disabled="isBroadcasting" class="btn btn-primary broadcast-btn">
            <Award :size="18" />
            <span>{{ isBroadcasting ? 'กำลังส่งข้อมูล...' : '🏆 แสดงประกาศผู้ชนะบนจอเวที (Broadcast)' }}</span>
          </button>

          <button 
            v-if="currentRound.presenter_show_state === 'winners'" 
            @click="hideWinners" 
            class="btn btn-danger hide-btn"
          >
            ✕ ซ่อนประกาศผู้ชนะ
          </button>
        </div>
      </div>

      <!-- Main Selection Grid: 4 Rank Columns -->
      <div class="ranks-grid">
        
        <!-- RANK 1 COLUMN (GOLD) -->
        <div class="glass-card rank-card rank-1-card">
          <div class="rank-card-header gold-header">
            <span class="rank-badge gold-badge">🥇 อันดับ 1 (ชนะเลิศ)</span>
            <span class="rank-count-tag">เลือกแล้ว {{ selectedRank1.length }} ทีม</span>
          </div>
          <p class="rank-desc">ทีมที่เลือกจะถูกแสดงบนแท่นรับรางวัลตรงกลาง (แท่นสูงสุด)</p>

          <div class="teams-checklist">
            <div 
              v-for="t in teamsWithScores" 
              :key="t.id"
              class="team-check-item"
              :class="{ selected: isTeamSelected('rank1', t.id) }"
              @click="toggleTeamSelection('rank1', t.id)"
            >
              <input 
                type="checkbox" 
                :checked="isTeamSelected('rank1', t.id)" 
                class="rank-checkbox"
                @click.stop="toggleTeamSelection('rank1', t.id)"
              />
              <div class="team-info-box">
                <div class="team-header-row">
                  <span class="team-num-badge">TEAM {{ String(t.team_number).padStart(2, '0') }}</span>
                  <span class="team-score-tag">{{ t.totalScore }} คะแนน</span>
                </div>
                <span class="team-title-name">{{ t.name }}</span>
                <span v-if="t.school_name" class="team-school-name">{{ formatSchoolName(t.school_name) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- RANK 2 COLUMN (SILVER) -->
        <div class="glass-card rank-card rank-2-card">
          <div class="rank-card-header silver-header">
            <span class="rank-badge silver-badge">🥈 อันดับ 2 (รองชนะเลิศ อันดับ 1)</span>
            <span class="rank-count-tag">เลือกแล้ว {{ selectedRank2.length }} ทีม</span>
          </div>
          <p class="rank-desc">ทีมที่เลือกจะถูกแสดงบนแท่นรับรางวัลด้านซ้าย</p>

          <div class="teams-checklist">
            <div 
              v-for="t in teamsWithScores" 
              :key="t.id"
              class="team-check-item"
              :class="{ selected: isTeamSelected('rank2', t.id) }"
              @click="toggleTeamSelection('rank2', t.id)"
            >
              <input 
                type="checkbox" 
                :checked="isTeamSelected('rank2', t.id)" 
                class="rank-checkbox"
                @click.stop="toggleTeamSelection('rank2', t.id)"
              />
              <div class="team-info-box">
                <div class="team-header-row">
                  <span class="team-num-badge">TEAM {{ String(t.team_number).padStart(2, '0') }}</span>
                  <span class="team-score-tag">{{ t.totalScore }} คะแนน</span>
                </div>
                <span class="team-title-name">{{ t.name }}</span>
                <span v-if="t.school_name" class="team-school-name">{{ formatSchoolName(t.school_name) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- RANK 3 COLUMN (BRONZE) -->
        <div class="glass-card rank-card rank-3-card">
          <div class="rank-card-header bronze-header">
            <span class="rank-badge bronze-badge">🥉 อันดับ 3 (รองชนะเลิศ อันดับ 2)</span>
            <span class="rank-count-tag">เลือกแล้ว {{ selectedRank3.length }} ทีม</span>
          </div>
          <p class="rank-desc">ทีมที่เลือกจะถูกแสดงบนแท่นรับรางวัลด้านขวา</p>

          <div class="teams-checklist">
            <div 
              v-for="t in teamsWithScores" 
              :key="t.id"
              class="team-check-item"
              :class="{ selected: isTeamSelected('rank3', t.id) }"
              @click="toggleTeamSelection('rank3', t.id)"
            >
              <input 
                type="checkbox" 
                :checked="isTeamSelected('rank3', t.id)" 
                class="rank-checkbox"
                @click.stop="toggleTeamSelection('rank3', t.id)"
              />
              <div class="team-info-box">
                <div class="team-header-row">
                  <span class="team-num-badge">TEAM {{ String(t.team_number).padStart(2, '0') }}</span>
                  <span class="team-score-tag">{{ t.totalScore }} คะแนน</span>
                </div>
                <span class="team-title-name">{{ t.name }}</span>
                <span v-if="t.school_name" class="team-school-name">{{ formatSchoolName(t.school_name) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- HONORABLE MENTION COLUMN -->
        <div class="glass-card rank-card rank-honorable-card">
          <div class="rank-card-header honorable-header">
            <span class="rank-badge honorable-badge">🎖️ รางวัลชมเชย</span>
            <span class="rank-count-tag">เลือกแล้ว {{ selectedHonorable.length }} ทีม</span>
          </div>
          <p class="rank-desc">ทีมที่ได้รับรางวัลชมเชย ประจำรอบการแข่งขัน</p>

          <div class="teams-checklist">
            <div 
              v-for="t in teamsWithScores" 
              :key="t.id"
              class="team-check-item"
              :class="{ selected: isTeamSelected('honorable', t.id) }"
              @click="toggleTeamSelection('honorable', t.id)"
            >
              <input 
                type="checkbox" 
                :checked="isTeamSelected('honorable', t.id)" 
                class="rank-checkbox honorable-checkbox"
                @click.stop="toggleTeamSelection('honorable', t.id)"
              />
              <div class="team-info-box">
                <div class="team-header-row">
                  <span class="team-num-badge honorable-team-num">TEAM {{ String(t.team_number).padStart(2, '0') }}</span>
                  <span class="team-score-tag">{{ t.totalScore }} คะแนน</span>
                </div>
                <span class="team-title-name">{{ t.name }}</span>
                <span v-if="t.school_name" class="team-school-name">{{ formatSchoolName(t.school_name) }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>

    </template>
  </div>
</template>

<style scoped>
.winner-settings-page {
  padding-bottom: 4rem;
}

.header-bar {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.rounds-selector-group {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 300px;
}

.selector-label {
  margin-bottom: 0;
  white-space: nowrap;
}

.selector-dropdown {
  flex: 1;
}

.round-banner {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  border-color: rgba(255, 215, 0, 0.3);
}

.page-title {
  font-size: 1.75rem;
  margin-bottom: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-primary);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin: 0;
}

.banner-state-badge {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.state-label {
  color: var(--text-primary);
  font-weight: 600;
}

.active-winner-pill {
  background: rgba(234, 179, 8, 0.2);
  border: 1px solid rgba(234, 179, 8, 0.5);
  color: #fde047;
  font-weight: 700;
}

.normal-pill {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--text-primary);
  border: 1px solid var(--glass-border);
}

.msg-banner {
  padding: 0.85rem 1.25rem;
  border-radius: 0.75rem;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 600;
}

.msg-banner.success {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #4ade80;
}

.msg-banner.error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.controls-toolbar {
  margin-bottom: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.action-btn-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.broadcast-btn {
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 0 15px rgba(234, 179, 8, 0.3);
}

.ranks-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.25rem;
}

@media (max-width: 1280px) {
  .ranks-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .ranks-grid {
    grid-template-columns: 1fr;
  }
}

.rank-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.rank-1-card {
  border-color: rgba(253, 224, 71, 0.35);
}

.rank-2-card {
  border-color: rgba(226, 232, 240, 0.35);
}

.rank-3-card {
  border-color: rgba(253, 186, 116, 0.35);
}

.rank-honorable-card {
  border-color: rgba(56, 189, 248, 0.35);
}

.rank-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.rank-badge {
  font-weight: 800;
  font-size: 1.05rem;
}

.gold-badge { color: #fde047; }
.silver-badge { color: #e2e8f0; }
.bronze-badge { color: #fdba74; }
.honorable-badge { color: #38bdf8; }

.rank-count-tag {
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  color: #cbd5e1;
}

.rank-desc {
  font-size: 0.85rem;
  color: #94a3b8;
  margin-bottom: 1rem;
}

.teams-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 0.35rem;
}

.team-check-item {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.65rem;
  cursor: pointer;
  transition: all 0.2s;
}

.team-check-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.rank-1-card .team-check-item.selected {
  background: rgba(234, 179, 8, 0.14);
  border-color: rgba(234, 179, 8, 0.5);
}

.rank-2-card .team-check-item.selected {
  background: rgba(226, 232, 240, 0.12);
  border-color: rgba(226, 232, 240, 0.45);
}

.rank-3-card .team-check-item.selected {
  background: rgba(251, 146, 60, 0.14);
  border-color: rgba(251, 146, 60, 0.45);
}

.rank-honorable-card .team-check-item.selected {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.5);
}

.rank-checkbox {
  margin-top: 0.25rem;
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #eab308;
}

.honorable-checkbox {
  accent-color: #38bdf8;
}

.honorable-team-num {
  color: #38bdf8;
}

.rank-count-tag {
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  color: #cbd5e1;
}

.rank-desc {
  font-size: 0.85rem;
  color: #94a3b8;
  margin-bottom: 1rem;
}

.teams-checklist {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 0.35rem;
}

.team-check-item {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.65rem;
  cursor: pointer;
  transition: all 0.2s;
}

.team-check-item:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.team-check-item.selected {
  background: rgba(234, 179, 8, 0.12);
  border-color: rgba(234, 179, 8, 0.4);
}

.rank-checkbox {
  margin-top: 0.25rem;
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #eab308;
}

.team-info-box {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
}

.team-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.team-num-badge {
  font-weight: 800;
  font-size: 0.85rem;
  color: var(--color-cyan, #00e5ff);
}

.team-score-tag {
  font-size: 0.8rem;
  color: #fde047;
  font-weight: 600;
}

.team-title-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.team-school-name {
  font-size: 0.82rem;
  color: var(--text-secondary);
  font-weight: 500;
  opacity: 0.95;
}

.loading-box {
  text-align: center;
  padding: 4rem;
  color: #94a3b8;
}

.header-portal-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.audio-controls-group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.toggle-audio-btn {
  padding: 0.4rem 0.6rem;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
}
</style>

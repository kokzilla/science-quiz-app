<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
import { useAuth } from '~/composables/useAuth'
import { useRoundSelector } from '~/composables/useRoundSelector'
import { 
  Tv, 
  Users, 
  Sliders, 
  BarChart3, 
  Award,
  AlertCircle,
  Key,
  Database
} from 'lucide-vue-next'
import type { Round } from '~/types'

const router = useRouter()
const { isConfigured } = useSupabase()
const { verifyPasskey } = useAuth()

// Using useRoundSelector composable
const {
  selectedRoundId,
  roundsList: rounds,
  currentRound: selectedRound,
  loadingRounds,
  fetchRounds,
  handleRoundChange
} = useRoundSelector()

// Portal authorization state
const showPasskeyModal = ref(false)
const targetRole = ref<'admin' | 'staff' | 'mc' | 'reports' | 'presenter-admin'>('staff')
const enteredPasskey = ref('')
const passkeyError = ref('')
const passkeyChecking = ref(false)

const handleRoundSelect = (round: Round) => {
  selectedRoundId.value = round.id
}

const openPortal = async (role: 'admin' | 'staff' | 'mc' | 'reports' | 'presenter' | 'presenter-admin') => {
  if (!selectedRound.value) return
  
  passkeyError.value = ''
  enteredPasskey.value = ''

  // If it's a public page, go directly (no password)
  if (role as any === 'scoreboard') {
    window.open(`/scoreboard?round=${selectedRound.value.id}`, '_blank')
    return
  }
  if (role as any === 'presenter') {
    window.open(`/presenter?round=${selectedRound.value.id}`, '_blank')
    return
  }

  targetRole.value = role as any

  // Check if we already have a valid passkey in localStorage
  let savedKey = ''
  if (role === 'admin' || role === 'presenter-admin') {
    savedKey = localStorage.getItem('admin_passkey') || ''
  } else {
    // staff, mc, reports can use staff_key (or admin_passkey as superuser)
    savedKey = localStorage.getItem('staff_key') || localStorage.getItem('admin_passkey') || ''
  }

  if (savedKey) {
    // Quick test if saved key is valid
    const checkRole = (role === 'admin' || role === 'presenter-admin') ? 'admin' : 'staff'
    const isValid = await verifyPasskey(checkRole as any, savedKey)
    const isAdminValid = checkRole !== 'admin' ? await verifyPasskey('admin', savedKey) : false
    
    if (isValid || isAdminValid) {
      navigateToRole(role as any, selectedRound.value.id)
      return
    }
  }

  // Otherwise, prompt for password
  showPasskeyModal.value = true
}

const handlePasskeySubmit = async () => {
  if (!enteredPasskey.value) {
    passkeyError.value = 'กรุณากรอกรหัสผ่าน'
    return
  }

  passkeyChecking.value = true
  passkeyError.value = ''

  try {
    const checkRole = (targetRole.value === 'admin' || targetRole.value === 'presenter-admin') ? 'admin' : 'staff'
    let isValid = await verifyPasskey(checkRole as any, enteredPasskey.value)
    
    // Admin passkey can bypass staff checks
    if (!isValid && checkRole === 'staff') {
      isValid = await verifyPasskey('admin', enteredPasskey.value)
      
      if (isValid) {
        // Save as admin key
        localStorage.setItem('admin_passkey', enteredPasskey.value)
      } else {
        passkeyError.value = 'รหัสผ่านไม่ถูกต้อง! กรุณาลองอีกครั้ง'
      }
    } else if (isValid) {
      if (checkRole === 'admin') {
        localStorage.setItem('admin_passkey', enteredPasskey.value)
      } else {
        localStorage.setItem('staff_key', enteredPasskey.value)
      }
    }

    if (isValid) {
      showPasskeyModal.value = false
      navigateToRole(targetRole.value, selectedRound.value.id)
    } else {
      if (!passkeyError.value) {
        passkeyError.value = 'รหัสผ่านไม่ถูกต้อง! กรุณาลองอีกครั้ง'
      }
    }
  } catch (err: any) {
    passkeyError.value = `เกิดข้อผิดพลาดในการตรวจสอบ: ${err.message}`
  } finally {
    passkeyChecking.value = false
  }
}

const navigateToRole = (role: 'admin' | 'staff' | 'mc' | 'reports' | 'presenter-admin', roundId: string) => {
  if (role === 'admin') {
    router.push(`/admin?round=${roundId}`)
  } else if (role === 'staff') {
    router.push(`/staff?round=${roundId}`)
  } else if (role === 'mc') {
    router.push(`/mc?round=${roundId}`)
  } else if (role === 'reports') {
    router.push(`/reports?round=${roundId}`)
  } else if (role === 'presenter-admin') {
    router.push(`/presenter-admin?round=${roundId}`)
  }
}

// Generate demo rounds
const createDemoData = async () => {
  const { supabase } = useSupabase()
  if (!supabase.value) return
  loadingRounds.value = true
  try {
    const { data: rData, error: rErr } = await supabase.value.rpc('manage_round_secure', {
      p_action: 'create',
      p_round_name: 'ตัวอย่าง: การแข่งตอบปัญหาวิทยาศาสตร์ รอบสาธิต',
      p_status: 'active',
      p_reveal_q: 0,
      p_round_id: '00000000-0000-0000-0000-000000000000',
      p_admin_passkey: 'admin123'
    })

    if (rErr) throw rErr
    if (!rData || rData.length === 0) throw new Error('ไม่สามารถสร้างรอบการแข่งขันได้')
    const roundId = rData[0].round_id

    const { data: qData, error: fetchQErr } = await supabase.value
      .from('questions')
      .select('id, question_number')
      .eq('round_id', roundId)
      
    if (fetchQErr) throw fetchQErr
    
    if (qData) {
      for (const q of qData) {
        const correctAns = ['ก', 'ข', 'ค', 'ง'][(q.question_number - 1) % 4]
        await supabase.value.rpc('manage_question_secure', {
          p_question_id: q.id,
          p_correct_answer: correctAns,
          p_admin_passkey: 'admin123'
        })
      }
    }

    const teamsData = [
      { num: 1, name: 'ทีมดาวหางสีแดง' },
      { num: 2, name: 'ทีมอุกกาบาตทลายฟ้า' },
      { num: 3, name: 'ทีมซูเปอร์โนวา' },
      { num: 4, name: 'ทีมหลุมดำมหาภัย' },
      { num: 5, name: 'ทีมยานอวกาศสปุตนิก' }
    ]
    
    for (const t of teamsData) {
      await supabase.value.rpc('manage_team_secure', {
        p_action: 'insert',
        p_round_id: roundId,
        p_team_number: t.num,
        p_name: t.name,
        p_tie_breaker_score: 0,
        p_team_id: '00000000-0000-0000-0000-000000000000',
        p_admin_passkey: 'admin123'
      })
    }
    
    alert('สร้างรอบการแข่งขันตัวอย่างสำเร็จ! (รหัสแอดมินสาธิตคือ admin123, รหัสเจ้าหน้าที่คือ staff123)')
    fetchRounds()
  } catch (err: any) {
    alert(`สร้างข้อมูลทดสอบล้มเหลว: ${err.message}`)
  } finally {
    loadingRounds.value = false
  }
}
</script>

<template>
  <div class="container">
    <div class="header-banner">
      <h1 class="main-title">
        ระบบจัดการแข่งขันตอบปัญหาวิทยาศาสตร์
      </h1>
      <p class="subtitle">
        คณะวิทยาศาสตร์ มหาวิทยาลัยราชภัฏบุรีรัมย์
      </p>
    </div>

    <!-- DB Unconfigured State Warning -->
    <div v-if="!isConfigured" class="glass-card error-card">
      <AlertCircle class="text-error warning-icon" :size="64" />
      <h2 class="error-title">ตรวจพบการตั้งค่าฐานข้อมูลไม่ถูกต้อง</h2>
      <p class="error-desc">
        กรุณาตรวจสอบว่ามีไฟล์ <strong class="text-cyan">.env</strong> ในโฟลเดอร์หลักของโปรแกรม และระบุค่า <strong class="text-cyan">SUPABASE_URL</strong> และ <strong class="text-cyan">SUPABASE_KEY</strong> ครบถ้วนแล้ว จากนั้นรีสตาร์ทเซิร์ฟเวอร์
      </p>
    </div>

    <!-- Main Portal Dashboard -->
    <div v-else class="portal-grid">
      
      <!-- Left Card: List of Competition Rounds -->
      <div class="glass-card round-list-card">
        <h2 class="card-title">
          <span>เลือกรอบการแข่งขัน</span>
          <button @click="fetchRounds" class="btn btn-secondary btn-sm">
            รีเฟรช
          </button>
        </h2>

        <div v-if="loadingRounds" class="loading-state">
          <p>กำลังโหลดข้อมูล...</p>
        </div>

        <div v-else-if="rounds.length === 0" class="empty-state">
          <p class="empty-text">ยังไม่มีรอบการแข่งขันในระบบ</p>
          <button @click="createDemoData" class="btn btn-primary">
            สร้างรอบการแข่งขันตัวอย่าง (Demo Sandbox)
          </button>
        </div>

        <div v-else class="rounds-container">
          <div 
            v-for="round in rounds" 
            :key="round.id" 
            class="glass-card round-item" 
            :class="{ active: selectedRound && selectedRound.id === round.id }"
            @click="handleRoundSelect(round)"
          >
            <div class="round-item-content">
              <div>
                <h3 class="round-name">{{ round.name }}</h3>
                <p class="round-date">วันที่แข่ง: {{ round.round_date || round.date }}</p>
              </div>
              <span class="status-pill" :class="round.status">
                {{ round.status === 'active' ? 'กำลังแข่ง' : round.status === 'completed' ? 'สิ้นสุดแล้ว' : 'เตรียมตัว' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Card: Portal Roles Gate -->
      <div class="glass-card portal-gate-card">
        <h2 class="card-title">
          <span>ระบบทางเข้าใช้งาน (Portal Gateway)</span>
        </h2>

        <div v-if="!selectedRound" class="select-prompt">
          <Database :size="48" class="text-muted prompt-icon" />
          <p>กรุณาเลือกรอบการแข่งขันทางซ้ายมือ เพื่อเข้าสู่ระบบทางเข้า</p>
        </div>

        <div v-else class="portal-items-list">
          <div class="selected-round-banner">
            <span class="banner-label">รอบการแข่งขันที่เลือก:</span>
            <strong class="banner-value">{{ selectedRound.name }}</strong>
          </div>

          <!-- Scoreboard TV Portal (Public, no password) -->
          <div @click="openPortal('scoreboard' as any)" class="glass-card portal-item tv-portal">
            <Tv :size="24" class="text-cyan" />
            <div class="portal-info">
              <h3 class="portal-title">หน้าจอถ่ายทอดสด TV Scoreboard</h3>
              <p class="portal-desc">เปิดแสดงผลจัดอันดับบนจอทีวีขนาดใหญ่ (สาธารณะ ไม่ต้องระบุรหัสผ่าน)</p>
            </div>
          </div>

          <!-- MC Portal (Staff/Admin Password) -->
          <div @click="openPortal('mc')" class="glass-card portal-item">
            <Award :size="24" class="text-gold" />
            <div class="portal-info">
              <h3 class="portal-title">หน้าจอผู้ดำเนินรายการ (MC Screen)</h3>
              <p class="portal-desc">แสดงรายชื่อทีมที่ตอบถูกเรียบลไทม์รายข้อ (สงวนเฉพาะพิธีกร/เจ้าหน้าที่)</p>
            </div>
          </div>

          <!-- Staff Portal (Staff Password) -->
          <div @click="openPortal('staff')" class="glass-card portal-item">
            <Users :size="24" class="text-success" />
            <div class="portal-info">
              <h3 class="portal-title">เจ้าหน้าที่บันทึกข้อมูล (Staff Input)</h3>
              <p class="portal-desc">คีย์ตัวเลือกคำตอบ ก-ง จากกระดาษคำตอบส่งเข้าฐานข้อมูล</p>
            </div>
          </div>

          <!-- Admin Portal (Admin Password) -->
          <div @click="openPortal('admin')" class="glass-card portal-item">
            <Sliders :size="24" class="text-purple" />
            <div class="portal-info">
              <h3 class="portal-title">ระบบควบคุมหลักของแอดมิน (Admin Panel)</h3>
              <p class="portal-desc">จัดการรายชื่อทีม ตั้งค่าเฉลย ควบคุม Reveal ปล่อยคะแนน และจัดการไทเบรก</p>
            </div>
          </div>

          <!-- Reports Portal (Staff/Admin Password) -->
          <div @click="openPortal('reports')" class="glass-card portal-item">
            <BarChart3 :size="24" class="text-warning" />
            <div class="portal-info">
              <h3 class="portal-title">รายงานผลการแข่งขัน (Reports & Stats)</h3>
              <p class="portal-desc">ดูตารางคะแนนโดยละเอียด สถิติวิเคราะห์รายข้อข้อสอบ และสั่งพิมพ์ PDF</p>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Passkey Input Modal -->
    <div v-if="showPasskeyModal" class="no-print modal-backdrop">
      <div class="glass-card modal-card">
        
        <div class="modal-header">
          <Key class="text-cyan modal-icon" :size="48" />
          <h3 class="modal-title">
            ระบุรหัสผ่านเข้าใช้งาน
          </h3>
          <p class="modal-subtitle">
            กรุณาระบุรหัสผ่านสำหรับ {{ targetRole === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'เจ้าหน้าที่ปฏิบัติงาน (Staff)' }}
          </p>
        </div>

        <div class="form-group modal-input-group">
          <input 
            v-model="enteredPasskey" 
            type="password" 
            class="form-input modal-input" 
            placeholder="กรอกรหัสผ่านเข้าหน้าจอ..." 
            @keyup.enter="handlePasskeySubmit"
            autofocus
          />
          <div v-if="passkeyError" class="modal-error-msg">
            {{ passkeyError }}
          </div>
        </div>

        <div class="modal-actions">
          <button @click="showPasskeyModal = false" class="btn btn-secondary modal-btn">
            ยกเลิก
          </button>
          <button @click="handlePasskeySubmit" :disabled="passkeyChecking" class="btn btn-primary modal-btn submit-btn">
            {{ passkeyChecking ? 'กำลังตรวจสอบ...' : 'เข้าสู่หน้าจอ' }}
          </button>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
.header-banner {
  text-align: center;
  margin-bottom: 2.5rem;
  margin-top: 1.5rem;
}

.main-title {
  font-size: 2.8rem;
  font-weight: 800;
  background: linear-gradient(135deg, var(--color-cyan), var(--color-purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

.text-cyan { color: var(--color-cyan); }
.text-gold { color: var(--color-gold); }
.text-success { color: var(--color-success); }
.text-purple { color: var(--color-purple); }
.text-warning { color: var(--color-warning); }
.text-error { color: var(--color-error); }
.text-muted { color: var(--text-muted); }

.error-card {
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
  padding: 3rem;
}

.warning-icon {
  margin-bottom: 1.5rem;
}

.error-title {
  font-size: 1.5rem;
  color: var(--text-primary);
  margin-bottom: 1rem;
}

.error-desc {
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
  line-height: 1.6;
}

.portal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 2rem;
  align-items: start;
}

.round-list-card {
  min-height: 400px;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  font-size: 1.4rem;
}

.btn-sm {
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
}

.loading-state {
  text-align: center;
  padding: 4rem;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
}

.empty-text {
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}

.rounds-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.round-item {
  background: rgba(255, 255, 255, 0.02);
  padding: 1.25rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.round-item-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.round-name {
  font-size: 1.15rem;
  color: var(--text-primary);
}

.round-date {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.round-item.active {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.05) !important;
  box-shadow: 0 0 10px rgba(0,229,255,0.1);
}

.portal-gate-card {
  min-height: 400px;
  border-color: var(--glass-border-glow);
}

.select-prompt {
  text-align: center;
  color: var(--text-secondary);
  padding: 6rem 1rem;
}

.prompt-icon {
  margin-bottom: 1rem;
}

.portal-items-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.selected-round-banner {
  background: rgba(0, 229, 255, 0.05);
  padding: 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 229, 255, 0.15);
  margin-bottom: 0.5rem;
}

.banner-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  display: block;
}

.banner-value {
  font-size: 1.2rem;
  color: var(--text-primary);
}

.portal-item {
  transition: all var(--transition-fast);
  border-color: rgba(255,255,255,0.05);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.1rem;
  cursor: pointer;
}

.portal-item:hover {
  border-color: var(--color-cyan);
  transform: translateX(4px);
  background: rgba(255,255,255,0.02);
}

.tv-portal {
  background: rgba(0, 229, 255, 0.03);
}

.portal-info {
  flex: 1;
}

.portal-title {
  font-size: 1.15rem;
  color: var(--text-primary);
}

.portal-desc {
  font-size: 0.85rem;
  color: var(--text-secondary);
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
  max-width: 420px;
  border-color: var(--glass-border-glow);
}

.modal-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.modal-icon {
  margin-bottom: 0.75rem;
  filter: drop-shadow(0 0 5px rgba(0,229,255,0.3));
}

.modal-title {
  font-size: 1.25rem;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.modal-subtitle {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.modal-input-group {
  margin-bottom: 1.5rem;
}

.modal-input {
  text-align: center;
  font-size: 1.2rem;
  height: 48px;
}

.modal-error-msg {
  color: var(--color-error);
  font-size: 0.85rem;
  text-align: center;
  margin-top: 0.5rem;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
}

.modal-btn {
  flex: 1;
}

.submit-btn {
  flex: 1.5;
}
</style>

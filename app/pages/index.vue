<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from '#imports'
import { useSupabase } from '~/composables/useSupabase'
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

const router = useRouter()
const { isConfigured, supabase } = useSupabase()

const rounds = ref<any[]>([])
const loadingRounds = ref(false)

// Portal authorization state
const selectedRound = ref<any>(null)
const showPasskeyModal = ref(false)
const targetRole = ref<'admin' | 'staff' | 'mc' | 'reports'>('staff')
const enteredPasskey = ref('')
const passkeyError = ref('')
const passkeyChecking = ref(false)

onMounted(() => {
  if (isConfigured.value) {
    fetchRounds()
  }
})

const fetchRounds = async () => {
  if (!supabase.value) return
  loadingRounds.value = true
  try {
    const { data, error } = await supabase.value
      .from('rounds')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    
    if (!error && data) {
      rounds.value = data
    }
  } catch (err) {
    console.error('Error fetching rounds:', err)
  } finally {
    loadingRounds.value = false
  }
}

const handleRoundSelect = (round: any) => {
  selectedRound.value = round
}

const openPortal = async (role: 'admin' | 'staff' | 'mc' | 'reports') => {
  if (!supabase.value || !selectedRound.value) return
  
  targetRole.value = role
  passkeyError.value = ''
  enteredPasskey.value = ''

  // If it's the TV Scoreboard, go directly (no password)
  if (role as any === 'scoreboard') {
    window.open(`/scoreboard?round=${selectedRound.value.id}`, '_blank')
    return
  }

  // Check if we already have a valid passkey in localStorage
  let savedKey = ''
  if (role === 'admin') {
    savedKey = localStorage.getItem('admin_passkey') || ''
  } else {
    // staff, mc, reports can use staff_key (or admin_passkey as superuser)
    savedKey = localStorage.getItem('staff_key') || localStorage.getItem('admin_passkey') || ''
  }

  if (savedKey) {
    // Quick test if saved key is valid
    const isValid = await verifyPasskeyOnServer(role === 'admin' ? 'admin' : 'staff', savedKey)
    const isAdminValid = role !== 'admin' ? await verifyPasskeyOnServer('admin', savedKey) : false
    
    if (isValid || isAdminValid) {
      navigateToRole(role, selectedRound.value.id)
      return
    }
  }

  // Otherwise, prompt for password
  showPasskeyModal.value = true
}

const verifyPasskeyOnServer = async (role: 'admin' | 'staff', passkey: string): Promise<boolean> => {
  if (!supabase.value || !passkey) return false
  try {
    const { data, error } = await supabase.value.rpc('validate_passkey', {
      p_role: role,
      p_passkey: passkey
    })
    if (error) {
      console.error('RPC validate_passkey error:', error)
      passkeyError.value = `ข้อผิดพลาดจากฐานข้อมูล: ${error.message} (รหัส: ${error.code})`
      return false
    }
    return data === true
  } catch (e: any) {
    console.error('validate_passkey exception:', e)
    passkeyError.value = `การเชื่อมต่อขัดข้อง: ${e.message || e}`
    return false
  }
}

const handlePasskeySubmit = async () => {
  if (!enteredPasskey.value) {
    passkeyError.value = 'กรุณากรอกรหัสผ่าน'
    return
  }

  passkeyChecking.value = true
  passkeyError.value = ''

  try {
    const checkRole = targetRole.value === 'admin' ? 'admin' : 'staff'
    let isValid = await verifyPasskeyOnServer(checkRole, enteredPasskey.value)
    
    // Admin passkey can bypass staff checks
    if (!isValid && checkRole === 'staff') {
      // Clear previous error to run admin check
      const prevError = passkeyError.value
      passkeyError.value = ''
      isValid = await verifyPasskeyOnServer('admin', enteredPasskey.value)
      
      if (isValid) {
        // Save as admin key
        localStorage.setItem('admin_passkey', enteredPasskey.value)
      } else {
        // Restore error if it was a DB failure, otherwise set simple invalid passkey message
        passkeyError.value = prevError || 'รหัสผ่านไม่ถูกต้อง! กรุณาลองอีกครั้ง'
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

const navigateToRole = (role: 'admin' | 'staff' | 'mc' | 'reports', roundId: string) => {
  if (role === 'admin') {
    router.push(`/admin?round=${roundId}`)
  } else if (role === 'staff') {
    router.push(`/staff?round=${roundId}`)
  } else if (role === 'mc') {
    router.push(`/mc?round=${roundId}`)
  } else if (role === 'reports') {
    router.push(`/reports?round=${roundId}`)
  }
}

// Generate demo rounds (admin123 and staff123 passkeys bypass RLS)
const createDemoData = async () => {
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
    <div style="text-align: center; margin-bottom: 2.5rem; margin-top: 1.5rem;">
      <h1 style="font-size: 2.8rem; font-weight: 800; background: linear-gradient(135deg, var(--color-cyan), var(--color-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem;">
        ระบบจัดการแข่งขันตอบปัญหาวิทยาศาสตร์
      </h1>
      <p style="color: var(--text-secondary); font-size: 1.1rem;">
        สถาบันวิจัยวิทยาศาสตร์และเทคโนโลยีแห่งชาติ
      </p>
    </div>

    <!-- DB Unconfigured State Warning -->
    <div v-if="!isConfigured" class="glass-card" style="max-width: 600px; margin: 0 auto; text-align: center; padding: 3rem;">
      <AlertCircle class="text-error" :size="64" style="margin-bottom: 1.5rem;" />
      <h2 style="font-size: 1.5rem; color: #fff; margin-bottom: 1rem;">ตรวจพบการตั้งค่าฐานข้อมูลไม่ถูกต้อง</h2>
      <p style="color: var(--text-secondary); margin-bottom: 1.5rem; line-height: 1.6;">
        กรุณาตรวจสอบว่ามีไฟล์ <strong style="color:var(--color-cyan)">.env</strong> ในโฟลเดอร์หลักของโปรแกรม และระบุค่า <strong style="color:var(--color-cyan)">SUPABASE_URL</strong> และ <strong style="color:var(--color-cyan)">SUPABASE_KEY</strong> ครบถ้วนแล้ว จากนั้นรีสตาร์ทเซิร์ฟเวอร์
      </p>
    </div>

    <!-- Main Portal Dashboard -->
    <div v-else style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 2rem; align-items: start;">
      
      <!-- Left Card: List of Competition Rounds -->
      <div class="glass-card" style="min-height: 400px;">
        <h2 style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; font-size: 1.4rem;">
          <span>เลือกรอบการแข่งขัน</span>
          <button @click="fetchRounds" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">
            รีเฟรช
          </button>
        </h2>

        <div v-if="loadingRounds" style="text-align: center; padding: 4rem;">
          <p>กำลังโหลดข้อมูล...</p>
        </div>

        <div v-else-if="rounds.length === 0" style="text-align: center; padding: 3rem 1rem;">
          <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">ยังไม่มีรอบการแข่งขันในระบบ</p>
          <button @click="createDemoData" class="btn btn-primary">
            สร้างรอบการแข่งขันตัวอย่าง (Demo Sandbox)
          </button>
        </div>

        <div v-else style="display: flex; flex-direction: column; gap: 0.75rem;">
          <div 
            v-for="round in rounds" 
            :key="round.id" 
            class="glass-card" 
            :class="{ active: selectedRound && selectedRound.id === round.id }"
            style="background: rgba(255, 255, 255, 0.02); padding: 1.25rem; cursor: pointer; transition: all var(--transition-fast);"
            @click="handleRoundSelect(round)"
          >
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-size: 1.15rem; color: #fff;">{{ round.name }}</h3>
                <p style="font-size: 0.85rem; color: var(--text-secondary);">วันที่แข่ง: {{ round.date }}</p>
              </div>
              <span class="status-pill" :class="round.status">
                {{ round.status === 'active' ? 'กำลังแข่ง' : round.status === 'completed' ? 'สิ้นสุดแล้ว' : 'เตรียมตัว' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Card: Portal Roles Gate -->
      <div class="glass-card" style="min-height: 400px; border-color: var(--glass-border-glow);">
        <h2 style="margin-bottom: 1.5rem; font-size: 1.4rem;">
          <span>ระบบทางเข้าใช้งาน (Portal Gateway)</span>
        </h2>

        <div v-if="!selectedRound" style="text-align: center; color: var(--text-secondary); padding: 6rem 1rem;">
          <Database :size="48" style="color: var(--text-muted); margin-bottom: 1rem;" />
          <p>กรุณาเลือกรอบการแข่งขันทางซ้ายมือ เพื่อเข้าสู่ระบบทางเข้า</p>
        </div>

        <div v-else style="display: flex; flex-direction: column; gap: 1rem;">
          <div style="background: rgba(0, 229, 255, 0.05); padding: 1rem; border-radius: var(--radius-sm); border: 1px solid rgba(0, 229, 255, 0.15); margin-bottom: 0.5rem;">
            <span style="font-size: 0.8rem; color: var(--text-secondary); display: block;">รอบการแข่งขันที่เลือก:</span>
            <strong style="font-size: 1.2rem; color: #fff;">{{ selectedRound.name }}</strong>
          </div>

          <!-- Scoreboard TV Portal (Public, no password) -->
          <div @click="openPortal('scoreboard' as any)" class="glass-card portal-item" style="background: rgba(0, 229, 255, 0.03); display: flex; align-items: center; gap: 1rem; padding: 1.1rem; cursor: pointer;">
            <Tv :size="24" style="color: var(--color-cyan);" />
            <div style="flex: 1;">
              <h3 style="font-size: 1.15rem; color: #fff;">หน้าจอถ่ายทอดสด TV Scoreboard</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">เปิดแสดงผลจัดอันดับบนจอทีวีขนาดใหญ่ (สาธารณะ ไม่ต้องระบุรหัสผ่าน)</p>
            </div>
          </div>

          <!-- MC Portal (Staff/Admin Password) -->
          <div @click="openPortal('mc')" class="glass-card portal-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.1rem; cursor: pointer;">
            <Award :size="24" style="color: var(--color-gold);" />
            <div style="flex: 1;">
              <h3 style="font-size: 1.15rem; color: #fff;">หน้าจอผู้ดำเนินรายการ (MC Screen)</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">แสดงรายชื่อทีมที่ตอบถูกเรียบลไทม์รายข้อ (สงวนเฉพาะพิธีกร/เจ้าหน้าที่)</p>
            </div>
          </div>

          <!-- Staff Portal (Staff Password) -->
          <div @click="openPortal('staff')" class="glass-card portal-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.1rem; cursor: pointer;">
            <Users :size="24" style="color: var(--color-success);" />
            <div style="flex: 1;">
              <h3 style="font-size: 1.15rem; color: #fff;">เจ้าหน้าที่บันทึกข้อมูล (Staff Input)</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">คีย์ตัวเลือกคำตอบ ก-ง จากกระดาษคำตอบส่งเข้าฐานข้อมูล</p>
            </div>
          </div>

          <!-- Admin Portal (Admin Password) -->
          <div @click="openPortal('admin')" class="glass-card portal-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.1rem; cursor: pointer;">
            <Sliders :size="24" style="color: var(--color-purple);" />
            <div style="flex: 1;">
              <h3 style="font-size: 1.15rem; color: #fff;">ระบบควบคุมหลักของแอดมิน (Admin Panel)</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">จัดการรายชื่อทีม ตั้งค่าเฉลย ควบคุม Reveal ปล่อยคะแนน และจัดการไทเบรก</p>
            </div>
          </div>

          <!-- Reports Portal (Staff/Admin Password) -->
          <div @click="openPortal('reports')" class="glass-card portal-item" style="display: flex; align-items: center; gap: 1rem; padding: 1.1rem; cursor: pointer;">
            <BarChart3 :size="24" style="color: var(--color-warning);" />
            <div style="flex: 1;">
              <h3 style="font-size: 1.15rem; color: #fff;">รายงานผลการแข่งขัน (Reports & Stats)</h3>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">ดูตารางคะแนนโดยละเอียด สถิติวิเคราะห์รายข้อข้อสอบ และสั่งพิมพ์ PDF</p>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Passkey Input Modal -->
    <div v-if="showPasskeyModal" class="no-print" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem;">
      <div class="glass-card" style="width: 100%; max-width: 420px; border-color: var(--glass-border-glow);">
        
        <div style="text-align: center; margin-bottom: 1.5rem;">
          <Key class="text-cyan" :size="48" style="margin-bottom: 0.75rem; filter: drop-shadow(0 0 5px rgba(0,229,255,0.3));" />
          <h3 style="font-size: 1.25rem; color: #fff; margin-bottom: 0.25rem;">
            ระบุรหัสผ่านเข้าใช้งาน
          </h3>
          <p style="color: var(--text-secondary); font-size: 0.85rem;">
            กรุณาระบุรหัสผ่านสำหรับ {{ targetRole === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'เจ้าหน้าที่ปฏิบัติงาน (Staff)' }}
          </p>
        </div>

        <div class="form-group" style="margin-bottom: 1.5rem;">
          <input 
            v-model="enteredPasskey" 
            type="password" 
            class="form-input" 
            placeholder="กรอกรหัสผ่านเข้าหน้าจอ..." 
            style="text-align: center; font-size: 1.2rem; height: 48px;"
            @keyup.enter="handlePasskeySubmit"
            autofocus
          />
          <div v-if="passkeyError" style="color: var(--color-error); font-size: 0.85rem; text-align: center; margin-top: 0.5rem; font-weight: 600;">
            {{ passkeyError }}
          </div>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button @click="showPasskeyModal = false" class="btn btn-secondary" style="flex: 1;">
            ยกเลิก
          </button>
          <button @click="handlePasskeySubmit" :disabled="passkeyChecking" class="btn btn-primary" style="flex: 1.5;">
            {{ passkeyChecking ? 'กำลังตรวจสอบ...' : 'เข้าสู่หน้าจอ' }}
          </button>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
.text-cyan { color: var(--color-cyan); }
.text-error { color: var(--color-error); }
.glass-card.active {
  border-color: var(--color-cyan);
  background: rgba(0, 229, 255, 0.05) !important;
  box-shadow: 0 0 10px rgba(0,229,255,0.1);
}
.portal-item {
  transition: all var(--transition-fast);
  border-color: rgba(255,255,255,0.05);
}
.portal-item:hover {
  border-color: var(--color-cyan);
  transform: translateX(4px);
  background: rgba(255,255,255,0.02);
}
</style>

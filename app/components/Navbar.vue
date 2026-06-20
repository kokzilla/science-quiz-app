<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSupabase } from '#imports'
import { 
  Database, 
  Settings, 
  Users, 
  Sliders, 
  Tv, 
  BarChart3,
  Award,
  Sun,
  Moon
} from 'lucide-vue-next'
import { useTheme } from '~/composables/useTheme'

const route = useRoute()
const { isConfigured } = useSupabase()
const { theme, toggleTheme } = useTheme()

// Compute selected round ID from route query or localStorage
const currentRoundId = computed(() => {
  let roundId = route.query.round as string
  if (!roundId && typeof window !== 'undefined') {
    roundId = localStorage.getItem('selected_round_id') || ''
  }
  return roundId
})

const staffUrl = computed(() => currentRoundId.value ? `/staff?round=${currentRoundId.value}` : '/staff')
const adminUrl = computed(() => currentRoundId.value ? `/admin?round=${currentRoundId.value}` : '/admin')
const scoreboardUrl = computed(() => currentRoundId.value ? `/scoreboard?round=${currentRoundId.value}` : '/scoreboard')
const reportsUrl = computed(() => currentRoundId.value ? `/reports?round=${currentRoundId.value}` : '/reports')
const mcUrl = computed(() => currentRoundId.value ? `/mc?round=${currentRoundId.value}` : '/mc')
</script>

<template>
  <nav class="navbar no-print">
    <div class="nav-container">
      <NuxtLink to="/" class="logo">
        <Database :size="22" class="text-cyan" />
        <span>SCI-QUIZ System</span>
      </NuxtLink>
      
      <div style="display: flex; align-items: center; gap: 1.5rem; justify-content: space-between; flex-wrap: wrap;">
        <div class="nav-links">
          <NuxtLink to="/" class="nav-link" :class="{ active: route.path === '/' }">
            <Settings :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
            ตั้งค่าเชื่อมต่อ
          </NuxtLink>
          
          <template v-if="isConfigured">
            <NuxtLink :to="staffUrl" class="nav-link" :class="{ active: route.path === '/staff' }">
              <Users :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
              เจ้าหน้าที่บันทึก
            </NuxtLink>
            
            <NuxtLink :to="mcUrl" class="nav-link" :class="{ active: route.path === '/mc' }">
              <Award :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
              พิธีกร (MC)
            </NuxtLink>
            
            <NuxtLink :to="adminUrl" class="nav-link" :class="{ active: route.path === '/admin' }">
              <Sliders :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
              ระบบแอดมิน
            </NuxtLink>
            
            <NuxtLink :to="scoreboardUrl" target="_blank" class="nav-link">
              <Tv :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
              จอ TV (เปิดแท็บใหม่)
            </NuxtLink>
            
            <NuxtLink :to="reportsUrl" class="nav-link" :class="{ active: route.path === '/reports' }">
              <BarChart3 :size="16" style="margin-right: 4px; vertical-align: text-bottom;" />
              รายงานผล
            </NuxtLink>
          </template>
        </div>

        <button 
          @click="toggleTheme" 
          class="btn-theme-toggle"
          :title="theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'"
          aria-label="Toggle theme"
        >
          <Sun v-if="theme === 'light'" :size="18" />
          <Moon v-else :size="18" />
        </button>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.text-cyan {
  color: var(--color-cyan);
}

.btn-theme-toggle {
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  outline: none;
}

.btn-theme-toggle:hover {
  border-color: var(--color-cyan);
  box-shadow: var(--shadow-neon-cyan);
  color: var(--color-cyan);
}

@media (max-width: 1024px) {
  .btn-theme-toggle {
    margin: 0 auto;
  }
}
</style>

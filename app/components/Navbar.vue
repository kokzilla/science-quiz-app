<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
  Moon,
  Menu,
  X
} from 'lucide-vue-next'
import { useTheme } from '~/composables/useTheme'

const route = useRoute()
const { isConfigured } = useSupabase()
const { theme, toggleTheme } = useTheme()

const isMenuOpen = ref(false)
const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value
}

// Auto close menu when route changes
watch(() => route.path, () => {
  isMenuOpen.value = false
})

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
      <div class="nav-brand">
        <NuxtLink to="/" class="logo">
          <Database :size="22" class="text-cyan" />
          <span>SCI-QUIZ System</span>
        </NuxtLink>
        
        <button 
          @click="toggleMenu" 
          class="btn-menu-toggle" 
          :class="{ 'is-active': isMenuOpen }"
          aria-label="Toggle navigation menu"
        >
          <Menu v-if="!isMenuOpen" :size="22" />
          <X v-else :size="22" />
        </button>
      </div>
      
      <div class="nav-content" :class="{ 'menu-open': isMenuOpen }">
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
  flex-shrink: 0;
}

.btn-theme-toggle:hover {
  border-color: var(--color-cyan);
  box-shadow: var(--shadow-neon-cyan);
  color: var(--color-cyan);
}

/* BRAND GROUP (Logo & Toggle Button) */
.nav-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: auto;
}

/* HAMBURGER TOGGLE BUTTON */
.btn-menu-toggle {
  display: none;
  background: transparent;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0.5rem;
  transition: color var(--transition-fast);
  outline: none;
}

.btn-menu-toggle:hover {
  color: var(--color-cyan);
}

/* NAV CONTENT CONTAINER */
.nav-content {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

/* RESPONSIVE DESIGN (TABLETS & MOBILE) */
@media (max-width: 1024px) {
  .nav-container {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }

  .nav-brand {
    width: 100%;
    height: 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .btn-menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* COLLAPSIBLE NAV CONTENT */
  .nav-content {
    display: none;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    margin-top: 1rem;
    gap: 1.25rem;
    border-top: 1px solid var(--glass-border);
    padding-top: 1rem;
  }

  .nav-content.menu-open {
    display: flex;
  }

  .nav-links {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .nav-link {
    width: 100%;
    text-align: center;
    padding: 0.6rem 1rem;
    font-size: 0.9rem;
    display: block;
  }

  .btn-theme-toggle {
    align-self: center;
    margin-top: 0.25rem;
  }
}

@media (max-width: 640px) {
  .logo {
    font-size: 1.2rem;
  }
  .nav-link {
    font-size: 0.85rem;
    padding: 0.5rem 0.8rem;
  }
}
</style>

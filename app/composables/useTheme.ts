import { ref } from 'vue'

const theme = ref<'dark' | 'light'>('dark')

export function useTheme() {
  const toggleTheme = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    updateClass()
  }

  const updateClass = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', theme.value)
      const root = document.documentElement
      if (theme.value === 'light') {
        root.classList.add('light-theme')
      } else {
        root.classList.remove('light-theme')
      }
    }
  }

  const initTheme = () => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
      if (saved) {
        theme.value = saved
      } else {
        theme.value = 'dark'
      }
      updateClass()
    }
  }

  return {
    theme,
    toggleTheme,
    initTheme
  }
}

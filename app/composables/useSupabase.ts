import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { ref, computed } from 'vue'
import { useRuntimeConfig } from '#imports'

const clientRef = ref<SupabaseClient | null>(null)

export function useSupabase() {
  const initClient = () => {
    // Only execute on client side
    if (typeof window === 'undefined') return null

    if (clientRef.value) return clientRef.value

    const config = useRuntimeConfig()
    const url = config.public.supabaseUrl as string
    const key = config.public.supabaseKey as string

    if (url && key) {
      try {
        clientRef.value = createClient(url, key, {
          auth: {
            persistSession: false
          }
        })
        return clientRef.value
      } catch (err) {
        console.error('Failed to initialize Supabase client:', err)
        clientRef.value = null
        return null
      }
    } else {
      clientRef.value = null
      return null
    }
  }

  // Initialize on load
  if (typeof window !== 'undefined' && !clientRef.value) {
    initClient()
  }

  const isConfigured = computed(() => !!clientRef.value)

  return {
    supabase: clientRef,
    isConfigured,
    refreshConfig: initClient
  }
}

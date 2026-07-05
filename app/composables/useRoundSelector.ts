import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from '#imports'
import { useSupabase } from './useSupabase'
import type { Round } from '~/types'

export function useRoundSelector(onRoundChanged?: (roundId: string) => void | Promise<void>) {
  const route = useRoute()
  const router = useRouter()
  const { supabase, isConfigured } = useSupabase()

  const selectedRoundId = ref<string>('')
  const roundsList = ref<Round[]>([])
  const currentRound = ref<Round | null>(null)
  const loadingRounds = ref(false)

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
        roundsList.value = data as Round[]
      }
    } catch (err) {
      console.error('Error fetching rounds:', err)
    } finally {
      loadingRounds.value = false
    }
  }

  const handleRoundChange = async () => {
    if (!selectedRoundId.value) {
      currentRound.value = null
      return
    }

    // Save selection to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('selected_round_id', selectedRoundId.value)
    }

    if (!supabase.value) return

    try {
      const { data, error } = await supabase.value
        .from('rounds')
        .select('*')
        .eq('id', selectedRoundId.value)
        .single()
      
      if (!error && data) {
        currentRound.value = data as Round
      }
    } catch (err) {
      console.error('Error fetching round detail:', err)
    }

    if (onRoundChanged) {
      await onRoundChanged(selectedRoundId.value)
    }
  }

  // Watch roundsList to set the initial selected round
  watch(roundsList, () => {
    if (roundsList.value.length > 0) {
      const queryId = route.query.round as string
      const savedId = typeof window !== 'undefined' ? localStorage.getItem('selected_round_id') || '' : ''
      
      if (queryId && roundsList.value.some(r => r.id === queryId)) {
        selectedRoundId.value = queryId
      } else if (savedId && roundsList.value.some(r => r.id === savedId)) {
        selectedRoundId.value = savedId
      } else {
        selectedRoundId.value = roundsList.value[0].id
      }
      handleRoundChange()
    }
  })

  // Watch selectedRoundId to trigger handleRoundChange
  watch(selectedRoundId, (newId, oldId) => {
    if (newId && newId !== oldId) {
      // Sync URL query param
      const currentQuery = { ...route.query }
      if (currentQuery.round !== newId) {
        router.replace({ query: { ...currentQuery, round: newId } })
      }
      handleRoundChange()
    }
  })

  onMounted(() => {
    if (isConfigured.value) {
      fetchRounds()
    }
  })

  return {
    selectedRoundId,
    roundsList,
    currentRound,
    loadingRounds,
    fetchRounds,
    handleRoundChange
  }
}

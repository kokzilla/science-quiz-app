import type { Answer } from '~/types'
import { useSupabase } from './useSupabase'

export function useAnswers() {
  const { supabase } = useSupabase()

  /**
   * Fetch all answers for the given team IDs using pagination chunks
   * to ensure no rows are dropped when answers exceed 1,000 rows.
   */
  const fetchAllAnswersByTeamIds = async (
    teamIds: string[],
    selectFields: string = '*'
  ): Promise<Answer[]> => {
    if (!supabase.value || !teamIds || teamIds.length === 0) return []

    const allAnswers: Answer[] = []
    const PAGE_SIZE = 1000
    const TEAM_CHUNK_SIZE = 50 // Process 50 teams at a time to prevent URL length overflow

    for (let i = 0; i < teamIds.length; i += TEAM_CHUNK_SIZE) {
      const chunkTeamIds = teamIds.slice(i, i + TEAM_CHUNK_SIZE)
      let from = 0
      let hasMore = true

      while (hasMore) {
        const to = from + PAGE_SIZE - 1
        const { data, error } = await supabase.value
          .from('answers')
          .select(selectFields)
          .in('team_id', chunkTeamIds)
          .range(from, to)

        if (error) {
          console.error('Error in fetchAllAnswersByTeamIds pagination:', error)
          break
        }

        if (data && data.length > 0) {
          allAnswers.push(...(data as Answer[]))
          if (data.length < PAGE_SIZE) {
            hasMore = false
          } else {
            from += PAGE_SIZE
          }
        } else {
          hasMore = false
        }
      }
    }

    return allAnswers
  }

  /**
   * Fetch all answers for a specific round.
   * Attempts fast RPC `get_round_answers` first, falling back to paginated chunking.
   */
  const fetchAllRoundAnswers = async (
    roundId: string,
    teamIds?: string[],
    selectFields: string = '*'
  ): Promise<Answer[]> => {
    if (!supabase.value || !roundId) return []

    // 1. Try fast RPC method first (bypasses 1,000 limit via single JSONB payload)
    try {
      const { data, error } = await supabase.value.rpc('get_round_answers', {
        p_round_id: roundId
      })
      if (!error && data && Array.isArray(data)) {
        return data as Answer[]
      }
    } catch (e) {
      // RPC might not be migrated yet; ignore and fallback
    }

    // 2. Fallback: If teamIds were not provided, fetch teams for this round first
    let targetTeamIds = teamIds
    if (!targetTeamIds || targetTeamIds.length === 0) {
      const { data: teamsData } = await supabase.value
        .from('teams')
        .select('id')
        .eq('round_id', roundId)
      targetTeamIds = (teamsData || []).map((t: { id: string }) => t.id)
    }

    if (!targetTeamIds || targetTeamIds.length === 0) return []

    return await fetchAllAnswersByTeamIds(targetTeamIds, selectFields)
  }

  return {
    fetchAllAnswersByTeamIds,
    fetchAllRoundAnswers
  }
}

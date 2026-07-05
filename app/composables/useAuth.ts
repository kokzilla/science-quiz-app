import { useRouter } from '#imports'
import { useSupabase } from './useSupabase'

export function useAuth() {
  const router = useRouter()
  const { supabase } = useSupabase()

  const verifyPasskey = async (role: 'admin' | 'staff', passkey: string): Promise<boolean> => {
    if (!supabase.value || !passkey) return false
    try {
      const { data, error } = await supabase.value.rpc('validate_passkey', {
        p_role: role,
        p_passkey: passkey
      })
      if (error) {
        console.error(`RPC validate_passkey (${role}) error:`, error)
        return false
      }
      return data === true
    } catch (e) {
      console.error(`validate_passkey exception for ${role}:`, e)
      return false
    }
  }

  const validateStaffOrAdmin = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false

    const staffKey = localStorage.getItem('staff_key') || ''
    const adminKey = localStorage.getItem('admin_passkey') || ''

    if (!staffKey && !adminKey) {
      router.push('/')
      return false
    }

    let isValid = false
    if (staffKey) {
      isValid = await verifyPasskey('staff', staffKey)
    }
    if (!isValid && adminKey) {
      isValid = await verifyPasskey('admin', adminKey)
      if (isValid) {
        // If admin passkey is used as staff bypass, save it as admin key
        localStorage.setItem('admin_passkey', adminKey)
      }
    }

    if (!isValid) {
      router.push('/')
      return false
    }

    return true
  }

  const validateAdminOnly = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false

    const adminKey = localStorage.getItem('admin_passkey') || ''

    if (!adminKey) {
      router.push('/')
      return false
    }

    const isValid = await verifyPasskey('admin', adminKey)
    if (!isValid) {
      router.push('/')
      return false
    }

    return true
  }

  const getActivePasskey = (): string => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('admin_passkey') || localStorage.getItem('staff_key') || ''
  }

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('staff_key')
      localStorage.removeItem('admin_passkey')
    }
    router.push('/')
  }

  return {
    verifyPasskey,
    validateStaffOrAdmin,
    validateAdminOnly,
    getActivePasskey,
    logout
  }
}

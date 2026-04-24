import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create(set => ({
  user: null, loading: true,
  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    set({ user: session?.user ?? null, loading: false })
    supabase.auth.onAuthStateChange((_, s) => set({ user: s?.user ?? null }))
  },
  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    set({ user: data.user })
  },
  signOut: async () => { await supabase.auth.signOut(); set({ user: null }) },
}))

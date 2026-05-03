import { create } from 'zustand'
import type { CadFile } from '@/types'

interface CompareStore {
  items: CadFile[]
  toggle: (item: CadFile) => void
  clear: () => void
}

export const useCompareStore = create<CompareStore>((set) => ({
  items: [],
  toggle: (item) =>
    set((s) => {
      const idx = s.items.findIndex((c) => c.id === item.id)
      if (idx >= 0) return { items: s.items.filter((_, i) => i !== idx) }
      const next = [...s.items, item]
      return { items: next.length > 2 ? next.slice(1) : next }
    }),
  clear: () => set({ items: [] }),
}))

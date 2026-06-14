import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Board } from '../data/models'

type BoardStore = {
  boards: Board[]
  activeBoardId: string | null
  saveBoard: (board: Board) => Board
  setActiveBoard: (id: string) => void
  deleteBoard: (id: string) => void
  duplicateBoard: (id: string) => Board | null
  getActiveBoard: () => Board | null
}

export const useBoards = create<BoardStore>()(
  persist(
    (set, get) => ({
      boards: [],
      activeBoardId: null,
      saveBoard: (board) => {
        const now = new Date().toISOString()
        const saved = { ...board, updatedAt: now, createdAt: board.createdAt || now }
        set((state) => {
          const exists = state.boards.some((item) => item.id === saved.id)
          return {
            boards: exists ? state.boards.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...state.boards],
            activeBoardId: saved.id,
          }
        })
        return saved
      },
      setActiveBoard: (id) => set({ activeBoardId: id }),
      deleteBoard: (id) => set((state) => ({
        boards: state.boards.filter((item) => item.id !== id),
        activeBoardId: state.activeBoardId === id ? null : state.activeBoardId,
      })),
      duplicateBoard: (id) => {
        const board = get().boards.find((item) => item.id === id)
        if (!board) return null
        const now = new Date().toISOString()
        const copy: Board = {
          ...board,
          id: `board_${Date.now()}`,
          name: `${board.name} copy`,
          createdAt: now,
          updatedAt: now,
          status: 'saved',
          editHistory: [...board.editHistory, 'Duplicated board outline'],
        }
        get().saveBoard(copy)
        return copy
      },
      getActiveBoard: () => {
        const state = get()
        return state.boards.find((board) => board.id === state.activeBoardId) || state.boards[0] || null
      },
    }),
    { name: 'boardforge-ai-boards' },
  ),
)

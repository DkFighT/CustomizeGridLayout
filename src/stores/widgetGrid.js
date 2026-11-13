import { defineStore } from 'pinia'

const STORAGE_KEY = 'widgets-layout'

const DEFAULTS = {
  columns: 5,
  rows: 5,
  gap: 8,
}

function defaultTiles() {
  return [
    { id: 'tile-1', x: 0, y: 0, w: 2, h: 2 },
    { id: 'tile-2', x: 2, y: 0, w: 3, h: 2 },
  ]
}

export const useWidgetGridStore = defineStore('widgetGrid', {
  state: () => ({
    columns: DEFAULTS.columns,
    rows: DEFAULTS.rows,
    gap: DEFAULTS.gap,
    tiles: [],
  }),
  actions: {
    loadFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && Array.isArray(parsed.tiles)) {
          this.columns = parsed.columns ?? DEFAULTS.columns
          this.rows = parsed.rows ?? DEFAULTS.rows
          this.gap = parsed.gap ?? DEFAULTS.gap
          this.tiles = parsed.tiles
          return
        }
      } catch {
        // fall through to defaults below
      }
      this.columns = DEFAULTS.columns
      this.rows = DEFAULTS.rows
      this.gap = DEFAULTS.gap
      this.tiles = defaultTiles()
    },
    saveToStorage() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ columns: this.columns, rows: this.rows, gap: this.gap, tiles: this.tiles }),
        )
      } catch {
        // storage unavailable or quota exceeded — nothing we can do here
      }
    },
    setColumns(value) {
      const columns = Math.max(1, Math.round(value))
      this.tiles = this.tiles
        .filter((tile) => tile.x < columns)
        .map((tile) => (tile.x + tile.w > columns ? { ...tile, w: columns - tile.x } : tile))
      this.columns = columns
      this.saveToStorage()
    },
    setRows(value) {
      const rows = Math.max(1, Math.round(value))
      this.tiles = this.tiles
        .filter((tile) => tile.y < rows)
        .map((tile) => (tile.y + tile.h > rows ? { ...tile, h: rows - tile.y } : tile))
      this.rows = rows
      this.saveToStorage()
    },
    setGap(value) {
      this.gap = Math.max(0, Math.round(value))
      this.saveToStorage()
    },
    addTileAt(rect) {
      const id = `tile-${Date.now()}`
      this.tiles.push({ id, ...rect })
      this.saveToStorage()
      return id
    },
    resizeTile(id, { w, h }) {
      const tile = this.tiles.find((t) => t.id === id)
      if (!tile) return
      tile.w = w
      tile.h = h
      this.saveToStorage()
    },
    moveTile(id, { x, y }) {
      const tile = this.tiles.find((t) => t.id === id)
      if (!tile) return
      tile.x = x
      tile.y = y
      this.saveToStorage()
    },
    removeTile(id) {
      this.tiles = this.tiles.filter((tile) => tile.id !== id)
      this.saveToStorage()
    },
  },
})

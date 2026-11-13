<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWidgetGridStore } from '@/stores/widgetGrid'
import WidgetTile from '@/components/WidgetTile.vue'

const store = useWidgetGridStore()
store.loadFromStorage()

const editMode = ref(false)
const boardEl = ref(null)
const selection = ref(null)
const resizingId = ref(null)
const movingId = ref(null)
const dragOffset = ref({ x: 0, y: 0 })
const dragValid = ref(true)
// measured in JS (not read purely from CSS) so tile boxes can be pixel-positioned
// and their width/height/position transitions can actually animate smoothly —
// CSS grid-column/grid-row are "discrete" properties and don't tween
const containerSize = ref({ width: 0, height: 0 })
let resizeObserver = null

const boardStyle = computed(() => ({
    '--cols': store.columns,
    '--rows': store.rows,
    '--gap': `${store.gap}px`,
}))

function tileStyle(tile) {
    const { width, height } = containerSize.value
    const gap = store.gap
    const cellW = (width - gap * (store.columns - 1)) / store.columns
    const cellH = (height - gap * (store.rows - 1)) / store.rows
    let left = tile.x * (cellW + gap)
    let top = tile.y * (cellH + gap)
    if (movingId.value === tile.id) {
        // follow the pointer continuously (unsnapped) while actively dragging
        left += dragOffset.value.x
        top += dragOffset.value.y
    }
    return {
        left: `${left}px`,
        top: `${top}px`,
        width: `${tile.w * cellW + (tile.w - 1) * gap}px`,
        height: `${tile.h * cellH + (tile.h - 1) * gap}px`,
        zIndex: movingId.value === tile.id ? 5 : undefined,
    }
}

function isCellFree(x, y, excludeId) {
    return !store.tiles.some(
        (tile) =>
            tile.id !== excludeId &&
            x >= tile.x &&
            x < tile.x + tile.w &&
            y >= tile.y &&
            y < tile.y + tile.h,
    )
}

function isRectFree(rect, excludeId) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
            if (!isCellFree(x, y, excludeId)) return false
        }
    }
    return true
}

const emptyCells = computed(() => {
    const cells = []
    // while a tile is being dragged it still occupies its old spot in the store
    // (that only updates on drop) — exclude it so its original cells show as
    // empty placeholders instead of a hole with nothing rendered in it
    const excludeId = movingId.value
    for (let y = 0; y < store.rows; y++) {
        for (let x = 0; x < store.columns; x++) {
            if (isCellFree(x, y, excludeId)) cells.push({ x, y })
        }
    }
    return cells
})

// distance in px between the start of one cell and the start of the next
// (cell size + gap), matching how tileStyle() lays cells out
function cellPitch() {
    const rect = boardEl.value.getBoundingClientRect()
    return {
        x: (rect.width + store.gap) / store.columns,
        y: (rect.height + store.gap) / store.rows,
    }
}

function cellFromPoint(clientX, clientY) {
    const rect = boardEl.value.getBoundingClientRect()
    const col = Math.floor(((clientX - rect.left) / rect.width) * store.columns)
    const row = Math.floor(((clientY - rect.top) / rect.height) * store.rows)
    return {
        x: Math.min(Math.max(col, 0), store.columns - 1),
        y: Math.min(Math.max(row, 0), store.rows - 1),
    }
}

// --- create a tile by dragging over empty cells ---
let creating = null

function onCellPointerDown(event, cell) {
    if (!editMode.value) return
    event.preventDefault()
    event.currentTarget?.setPointerCapture?.(event.pointerId)
    creating = { startX: cell.x, startY: cell.y }
    selection.value = { x: cell.x, y: cell.y, w: 1, h: 1, valid: true }
    window.addEventListener('pointermove', onCreatePointerMove)
    window.addEventListener('pointerup', onCreatePointerUp)
    window.addEventListener('pointercancel', onCreatePointerCancel)
}

function onCreatePointerMove(event) {
    if (!creating) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    const rect = {
        x: Math.min(creating.startX, cell.x),
        y: Math.min(creating.startY, cell.y),
        w: Math.abs(cell.x - creating.startX) + 1,
        h: Math.abs(cell.y - creating.startY) + 1,
    }
    selection.value = { ...rect, valid: isRectFree(rect, null) }
}

function onCreatePointerUp() {
    if (selection.value?.valid) {
        const { x, y, w, h } = selection.value
        store.addTileAt({ x, y, w, h })
    }
    stopCreating()
}

function onCreatePointerCancel() {
    stopCreating()
}

function stopCreating() {
    creating = null
    selection.value = null
    window.removeEventListener('pointermove', onCreatePointerMove)
    window.removeEventListener('pointerup', onCreatePointerUp)
    window.removeEventListener('pointercancel', onCreatePointerCancel)
}

// --- resize an existing tile by dragging its corner handle ---
let resizing = null

function onResizeHandlePointerDown(event, tile) {
    if (!editMode.value) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget?.setPointerCapture?.(event.pointerId)

    let maxExtraW = 0
    while (
        tile.x + tile.w + maxExtraW < store.columns &&
        isRectFree({ x: tile.x + tile.w + maxExtraW, y: tile.y, w: 1, h: tile.h }, tile.id)
    ) {
        maxExtraW++
    }
    let maxExtraH = 0
    while (
        tile.y + tile.h + maxExtraH < store.rows &&
        isRectFree({ x: tile.x, y: tile.y + tile.h + maxExtraH, w: tile.w, h: 1 }, tile.id)
    ) {
        maxExtraH++
    }

    resizing = {
        id: tile.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startW: tile.w,
        startH: tile.h,
        maxW: tile.w + maxExtraW,
        maxH: tile.h + maxExtraH,
    }
    resizingId.value = tile.id

    window.addEventListener('pointermove', onResizePointerMove)
    window.addEventListener('pointerup', onResizePointerUp)
    window.addEventListener('pointercancel', onResizePointerUp)
}

function onResizePointerMove(event) {
    if (!resizing) return
    const pitch = cellPitch()
    const deltaCols = Math.round((event.clientX - resizing.startClientX) / pitch.x)
    const deltaRows = Math.round((event.clientY - resizing.startClientY) / pitch.y)

    const w = Math.min(Math.max(resizing.startW + deltaCols, 1), resizing.maxW)
    const h = Math.min(Math.max(resizing.startH + deltaRows, 1), resizing.maxH)

    store.resizeTile(resizing.id, { w, h })
}

function onResizePointerUp() {
    resizing = null
    resizingId.value = null
    window.removeEventListener('pointermove', onResizePointerMove)
    window.removeEventListener('pointerup', onResizePointerUp)
    window.removeEventListener('pointercancel', onResizePointerUp)
}

// --- move an existing tile by dragging its body ---
let moving = null

function onTilePointerDown(event, tile) {
    if (!editMode.value) return
    event.preventDefault()
    event.currentTarget?.setPointerCapture?.(event.pointerId)
    moving = {
        id: tile.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: tile.x,
        startY: tile.y,
        w: tile.w,
        h: tile.h,
    }
    movingId.value = tile.id
    dragOffset.value = { x: 0, y: 0 }

    window.addEventListener('pointermove', onMovePointerMove)
    window.addEventListener('pointerup', onMovePointerUp)
    window.addEventListener('pointercancel', onMovePointerCancel)
}

function moveTarget() {
    const pitch = cellPitch()
    const deltaCols = Math.round(dragOffset.value.x / pitch.x)
    const deltaRows = Math.round(dragOffset.value.y / pitch.y)
    const x = Math.min(Math.max(moving.startX + deltaCols, 0), store.columns - moving.w)
    const y = Math.min(Math.max(moving.startY + deltaRows, 0), store.rows - moving.h)
    const moved = x !== moving.startX || y !== moving.startY
    const valid = !moved || isRectFree({ x, y, w: moving.w, h: moving.h }, moving.id)
    return { x, y, moved, valid }
}

function onMovePointerMove(event) {
    if (!moving) return
    dragOffset.value = {
        x: event.clientX - moving.startClientX,
        y: event.clientY - moving.startClientY,
    }
    dragValid.value = moveTarget().valid
}

function onMovePointerUp() {
    if (!moving) return
    const target = moveTarget()
    if (target.moved && target.valid) {
        store.moveTile(moving.id, { x: target.x, y: target.y })
    }
    stopMoving()
}

function onMovePointerCancel() {
    // gesture was hijacked/interrupted (e.g. native drag or text selection) — just
    // let the tile snap back to its last committed position, don't apply anything
    stopMoving()
}

function stopMoving() {
    moving = null
    movingId.value = null
    dragOffset.value = { x: 0, y: 0 }
    dragValid.value = true
    window.removeEventListener('pointermove', onMovePointerMove)
    window.removeEventListener('pointerup', onMovePointerUp)
    window.removeEventListener('pointercancel', onMovePointerCancel)
}

function removeTile(id) {
    store.removeTile(id)
}

onMounted(() => {
    resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry) return
        containerSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(boardEl.value)
})

onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    window.removeEventListener('pointermove', onCreatePointerMove)
    window.removeEventListener('pointerup', onCreatePointerUp)
    window.removeEventListener('pointercancel', onCreatePointerCancel)
    window.removeEventListener('pointermove', onResizePointerMove)
    window.removeEventListener('pointerup', onResizePointerUp)
    window.removeEventListener('pointercancel', onResizePointerUp)
    window.removeEventListener('pointermove', onMovePointerMove)
    window.removeEventListener('pointerup', onMovePointerUp)
    window.removeEventListener('pointercancel', onMovePointerCancel)
})
</script>

<template>
    <div>
        <div class="d-flex align-items-center justify-content-between mb-3">
            <div class="form-check form-switch mb-0">
                <input id="edit-mode-switch" v-model="editMode" class="form-check-input" type="checkbox"
                    role="switch" />
                <label class="form-check-label" for="edit-mode-switch">Edit mode</label>
            </div>

            <div v-if="editMode" class="d-flex align-items-center gap-4">
                <div class="d-flex align-items-center gap-2">
                    <label class="form-label mb-0 small text-muted" for="columns-input">Columns</label>
                    <input id="columns-input" type="number" class="form-control form-control-sm" style="width: 4.5rem"
                        min="1" :value="store.columns" @change="store.setColumns($event.target.valueAsNumber)" />
                </div>
                <div class="d-flex align-items-center gap-2">
                    <label class="form-label mb-0 small text-muted" for="rows-input">Rows</label>
                    <input id="rows-input" type="number" class="form-control form-control-sm" style="width: 4.5rem"
                        min="1" :value="store.rows" @change="store.setRows($event.target.valueAsNumber)" />
                </div>
                <div class="d-flex align-items-center gap-2">
                    <label class="form-label mb-0 small text-muted" for="gap-input">Gap (px)</label>
                    <input id="gap-input" type="number" class="form-control form-control-sm" style="width: 4.5rem"
                        min="0" :value="store.gap" @change="store.setGap($event.target.valueAsNumber)" />
                </div>
            </div>
        </div>

        <div ref="boardEl" class="board" :style="boardStyle">
            <div v-for="tile in store.tiles" :key="tile.id" class="board-item" :class="{
                'board-item--dragging': movingId === tile.id,
                'board-item--invalid': movingId === tile.id && !dragValid,
                'board-item--resizing': resizingId === tile.id,
            }" :style="tileStyle(tile)" @pointerdown="onTilePointerDown($event, tile)">
                <WidgetTile :id="tile.id" :editable="editMode" @remove="removeTile" />
                <div v-if="editMode" class="resize-handle" @pointerdown="onResizeHandlePointerDown($event, tile)"></div>
            </div>

            <template v-if="editMode">
                <div v-for="cell in emptyCells" :key="`empty-${cell.x}-${cell.y}`" class="board-cell"
                    :style="{ gridColumn: cell.x + 1, gridRow: cell.y + 1 }"
                    @pointerdown="onCellPointerDown($event, cell)">
                    <span class="board-cell__plus">+</span>
                </div>
            </template>

            <div v-if="selection" class="board-selection" :class="{ 'board-selection--invalid': !selection.valid }"
                :style="{
                    gridColumn: `${selection.x + 1} / span ${selection.w}`,
                    gridRow: `${selection.y + 1} / span ${selection.h}`,
                }"></div>
        </div>
    </div>
</template>

<style scoped>
.board {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    grid-template-rows: repeat(var(--rows), minmax(100px, 1fr));
    gap: var(--gap);
}

.board-item {
    position: absolute;
    touch-action: none;
    transition: left 0.22s cubic-bezier(0.22, 1, 0.36, 1), top 0.22s cubic-bezier(0.22, 1, 0.36, 1),
        width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1),
        box-shadow 0.15s ease-in-out;
    border-radius: var(--bs-border-radius);
}

.board-item--dragging {
    /* keep the tile glued to the cursor while actively being dragged around */
    transition: box-shadow 0.15s ease-in-out, outline-color 0.1s ease-in-out;
    box-shadow: 0 0.5rem 1.25rem rgba(0, 0, 0, 0.25);
    outline: 2px solid rgba(var(--bs-success-rgb), 0.6);
    outline-offset: 2px;
}

.board-item--invalid {
    outline-color: rgba(var(--bs-danger-rgb), 0.7);
}

.board-item--resizing {
    box-shadow: 0 0.5rem 1.25rem rgba(0, 0, 0, 0.25);
}

.board-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--bs-border-color);
    border-radius: var(--bs-border-radius);
    color: var(--bs-secondary-color);
    cursor: cell;
    user-select: none;
    touch-action: none;
}

.board-cell__plus {
    font-size: 1.25rem;
    opacity: 0;
    transition: opacity 0.15s ease-in-out;
}

.board-cell:hover {
    background-color: var(--bs-tertiary-bg);
}

.board-cell:hover .board-cell__plus {
    opacity: 1;
}

.board-selection {
    border-radius: var(--bs-border-radius);
    background-color: rgba(var(--bs-primary-rgb), 0.15);
    border: 2px dashed var(--bs-primary);
    pointer-events: none;
}

.board-selection--invalid {
    background-color: rgba(var(--bs-danger-rgb), 0.15);
    border-color: var(--bs-danger);
}

.resize-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 32px;
    height: 32px;
    cursor: nwse-resize;
    touch-action: none;
    opacity: 0;
    transition: opacity 0.15s ease-in-out;
}

.resize-handle::after {
    content: '';
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 20px;
    height: 20px;
    border-radius: 0 var(--bs-border-radius-sm) var(--bs-border-radius-lg) var(--bs-border-radius-sm);
    border-right: 5px solid var(--bs-primary);
    border-bottom: 5px solid var(--bs-primary);
}

.board-item:hover .resize-handle {
    opacity: 1;
}
</style>

<script setup>
defineProps({
    id: {
        type: String,
        required: true,
    },
    editable: {
        type: Boolean,
        default: false,
    },
})

defineEmits(['remove'])
</script>

<template>
    <div class="card h-100 widget-tile" :class="{ 'widget-tile--editable': editable }">
        <div class="card-header d-flex align-items-center justify-content-between">
            <span class="text-truncate">Название виджета</span>
            <button v-if="editable" type="button" class="btn-close" aria-label="Remove widget" @pointerdown.stop
                @click="$emit('remove', id)"></button>
        </div>
        <div class="card-body d-flex align-items-center justify-content-center text-muted">
            тест
        </div>
    </div>
</template>

<style scoped>
.widget-tile {
    overflow: hidden;
    /* prevent the browser's native text-selection/drag from hijacking our
     custom pointer-based drag gesture */
    user-select: none;
    -webkit-user-drag: none;
}

.widget-tile--editable {
    cursor: move;
}
</style>

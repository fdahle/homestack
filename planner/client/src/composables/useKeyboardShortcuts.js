import { onMounted, onBeforeUnmount } from 'vue'

export function useKeyboardShortcuts(handlers) {
  function onKeyDown(e) {
    // Escape always closes the modal — no editing guard
    if (e.key === 'Escape') {
      handlers.closeModal?.()
      return
    }

    // Don't steal shortcuts while the user is typing
    const tag = document.activeElement?.tagName?.toLowerCase()
    const isEditing =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      document.activeElement?.contentEditable === 'true'

    if (e.key === '?' && !isEditing) {
      e.preventDefault()
      handlers.openShortcuts?.()
      return
    }

    if (isEditing) return

    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && !e.shiftKey && e.key === 'n') {
      e.preventDefault()
      handlers.newNote?.()
      return
    }
    if (ctrl && e.shiftKey && e.key === 'N') {
      e.preventDefault()
      handlers.newTask?.()
      return
    }
    if (e.key === '/' || (ctrl && e.key === '/')) {
      e.preventDefault()
      handlers.focusSearch?.()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}

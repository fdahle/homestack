import { onMounted, onBeforeUnmount } from 'vue'

// Open dialogs, topmost last, so Escape only closes the one on top.
const stack = []

function onKeyDown(e) {
  const top = stack.at(-1)
  if (e.key !== 'Escape' || !top || e.defaultPrevented || e.isComposing) return
  // Keeps MapView's own Escape handling (add mode, location panel) from also running.
  e.stopPropagation()
  top.escape()
}

// Backdrop, Escape and focus handling shared by the modals. `close` is called once leaving is
// confirmed; `isDirty` makes every way of closing ask first (with `message`, a string or a
// function returning one); `escape` overrides the Escape key.
export function useDialog(dialogEl, { close, isDirty = () => false, message = 'Discard your unsaved changes?', escape } = {}) {
  const entry = { escape: () => (escape ? escape() : requestClose()) }
  let pressedOnOverlay = false
  let previousFocus = null

  function confirmLeave(text) {
    return !isDirty() || window.confirm(text ?? (typeof message === 'function' ? message() : message))
  }

  function requestClose() {
    if (!confirmLeave()) return false
    close()
    return true
  }

  // A text selection dragged out of the dialog ends with a click on the backdrop: only a press
  // that also started on the backdrop closes.
  function onOverlayMousedown(e) { pressedOnOverlay = e.target === e.currentTarget }
  function onOverlayClick(e) {
    if (pressedOnOverlay && e.target === e.currentTarget) requestClose()
    pressedOnOverlay = false
  }

  // Registered during setup, so a parent dialog is always below the child dialogs it opens.
  stack.push(entry)
  if (stack.length === 1 && typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown)

  onMounted(() => {
    if (typeof document === 'undefined') return
    previousFocus = document.activeElement
    const el = dialogEl?.value
    if (el?.focus && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
  })

  onBeforeUnmount(() => {
    const index = stack.indexOf(entry)
    if (index !== -1) stack.splice(index, 1)
    if (typeof document === 'undefined') return
    if (!stack.length) document.removeEventListener('keydown', onKeyDown)
    if (previousFocus?.isConnected && dialogEl?.value?.contains(document.activeElement)) previousFocus.focus({ preventScroll: true })
  })

  return { requestClose, confirmLeave, onOverlayMousedown, onOverlayClick }
}

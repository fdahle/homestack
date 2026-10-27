import { onMounted, onBeforeUnmount } from 'vue'

// Open dialogs, topmost last, so Escape only closes the one on top.
const stack = []

const FOCUSABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]'

// What Tab can reach inside `container`, queried on every press because v-if sections come and go.
export function tabbables(container) {
  const items = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]')
    && (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0))
  // Tab only stops on the checked radio of a group.
  const checked = new Set(items.filter(el => el.type === 'radio' && el.checked && el.name).map(el => el.name))
  return items.filter(el => el.type !== 'radio' || el.checked || !checked.has(el.name))
}

// Where Tab must send focus to stay in the dialog, or null to leave it to the browser. Only the
// ends wrap; in between the native order (radio groups, scroll containers) is kept.
export function trapTarget(container, items, active, backwards) {
  if (!items.length) return container
  const index = items.indexOf(active) // -1 on the container itself, or outside it
  const atEnd = index === -1 || index === (backwards ? 0 : items.length - 1)
  return atEnd ? (backwards ? items.at(-1) : items[0]) : null
}

function onKeyDown(e) {
  const top = stack.at(-1)
  if (!top || e.defaultPrevented) return
  if (e.key === 'Tab') {
    const el = top.modal && top.el()
    if (!el) return
    const target = trapTarget(el, tabbables(el), document.activeElement, e.shiftKey)
    if (!target) return
    e.preventDefault()
    target.focus({ preventScroll: target === el })
    return
  }
  if (e.key !== 'Escape' || e.isComposing) return
  // Keeps MapView's own Escape handling (add mode, location panel) from also running.
  e.stopPropagation()
  top.escape()
}

// Backdrop, Escape and focus handling shared by the modals. `close` is called once leaving is
// confirmed; `isDirty` makes every way of closing ask first (with `message`, a string or a
// function returning one); `escape` overrides the Escape key. A `modal` dialog keeps Tab inside it
// while it is the topmost; side panels that leave the map usable pass `modal: false`.
export function useDialog(dialogEl, { close, isDirty = () => false, message = 'Discard your unsaved changes?', escape, modal = true } = {}) {
  const entry = { modal, el: () => dialogEl?.value, escape: () => (escape ? escape() : requestClose()) }
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

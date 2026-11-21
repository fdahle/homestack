<script setup>
import { watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from 'tiptap-markdown';
import { t } from '../i18n.js';
import Icon from '../kit/components/Icon.vue';

// The note's text: you write with formatting (lists, checklists, headings, …), it's kept
// as Markdown. Typing Markdown works too ("- [ ] " starts a checklist, "# " a heading).
// Pictures and files pasted in become attachments (emitted as `files`), not part of the text.
const props = defineProps({
  modelValue: { type: String, default: '' },
  editable: { type: Boolean, default: true },
});
const emit = defineEmits(['update:modelValue', 'files']);

let last = props.modelValue;

// Checklists are kept as tight lists (no empty line between the items), like the other lists.
// tiptap-markdown only gives bullet and numbered lists the `tight` attribute it writes them by.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
        renderHTML: (attrs) => ({ 'data-tight': attrs.tight ? 'true' : null }),
      },
    };
  },
});

const editor = useEditor({
  content: props.modelValue,
  editable: props.editable,
  extensions: [
    // Underline has no Markdown; links open with Ctrl/Cmd+click, so they can be edited
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
    TightTaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: () => t('note.body') }),
    // No HTML in notes: what's stored is plain Markdown, and nothing in it can run in the page
    Markdown.configure({ html: false, tightLists: true, linkify: true, breaks: false, transformPastedText: true, transformCopiedText: true }),
  ],
  editorProps: {
    attributes: { class: 'note-text', spellcheck: 'true' },
    handlePaste(view, event) {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return false;
      emit('files', files);
      return true;
    },
    handleClickOn(view, pos, node, nodePos, event) {
      const link = event.target.closest?.('a[href]');
      if (link && (event.ctrlKey || event.metaKey)) {
        window.open(link.href, '_blank', 'noopener');
        return true;
      }
      return false;
    },
  },
  onUpdate({ editor: e }) {
    last = e.storage.markdown.getMarkdown();
    emit('update:modelValue', last);
  },
});

// A change from elsewhere (another device): show it
watch(() => props.modelValue, (value) => {
  if (!editor.value || value === last) return;
  last = value;
  editor.value.commands.setContent(value, { emitUpdate: false });
});
watch(() => props.editable, (value) => editor.value?.setEditable(value));

const run = (fn) => fn(editor.value.chain().focus()).run();
const TOOLS = [
  { name: 'bold', icon: 'bold', active: 'bold', run: (c) => c.toggleBold() },
  { name: 'italic', icon: 'italic', active: 'italic', run: (c) => c.toggleItalic() },
  { name: 'strike', icon: 'strike', active: 'strike', run: (c) => c.toggleStrike() },
  { name: 'heading', icon: 'heading', active: ['heading', { level: 2 }], run: (c) => c.toggleHeading({ level: 2 }) },
  { name: 'checklist', icon: 'checklist', active: 'taskList', run: (c) => c.toggleTaskList() },
  { name: 'bullets', icon: 'list', active: 'bulletList', run: (c) => c.toggleBulletList() },
  { name: 'numbers', icon: 'list-ordered', active: 'orderedList', run: (c) => c.toggleOrderedList() },
  { name: 'quote', icon: 'quote', active: 'blockquote', run: (c) => c.toggleBlockquote() },
  { name: 'code', icon: 'code', active: 'codeBlock', run: (c) => c.toggleCodeBlock() },
];
const isActive = (tool) => editor.value?.isActive(...[tool.active].flat());

// Focus right away (Tiptap's own focus waits a frame, and the first keys would go elsewhere)
function focus(where = 'end') {
  editor.value?.view.dom.focus();
  editor.value?.commands.focus(where);
}
defineExpose({ focus });
</script>

<template>
  <div class="note-editor">
    <div v-if="editable && editor" class="format-bar" role="toolbar" :aria-label="t('note.format')">
      <button
        v-for="tool in TOOLS"
        :key="tool.name"
        type="button"
        class="icon-btn"
        :class="{ active: isActive(tool) }"
        :aria-label="t(`format.${tool.name}`)"
        :aria-pressed="isActive(tool)"
        :title="t(`format.${tool.name}`)"
        @mousedown.prevent
        @click="run(tool.run)"
      >
        <Icon :name="tool.icon" />
      </button>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>

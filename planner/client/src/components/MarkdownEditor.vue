<template>
  <div class="md-editor-wrap">
    <editor-content :editor="editor" class="md-editor" />
  </div>
</template>

<script>
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'

// Extend Image with an explicit tiptap-markdown serializer.
// The default prosemirror-markdown image serializer is designed for inline
// images and never calls closeBlock, so block images get mangled when the
// markdown string is stored. We serialize as an <img> HTML tag (html:true
// lets it pass through markdown-it verbatim) and call closeBlock so the
// block is properly separated from adjacent content.
const ImageWithMarkdown = Image.extend({
  // Images are draggable by default, which lets the user drag an existing image
  // and drop it back into the editor, duplicating it. Disable node dragging.
  draggable: false,

  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          const src = (node.attrs.src || '').replace(/"/g, '&quot;')
          const alt = node.attrs.alt ? ` alt="${node.attrs.alt.replace(/"/g, '&quot;')}"` : ''
          state.write(`<img src="${src}"${alt}>`)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

export default {
  name: 'MarkdownEditor',

  components: { EditorContent },

  props: {
    modelValue: { type: String, default: '' },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      editor:          null,
      _internalUpdate: false,
    }
  },

  mounted() {
    this.editor = new Editor({
      extensions: [
        StarterKit,
        Markdown.configure({ html: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        ImageWithMarkdown,
      ],
      content: this.modelValue,
      editorProps: {
        handleDOMEvents: {
          // Belt-and-braces with the node's draggable:false — also block the
          // browser-native image drag so an image can't be dragged out/re-dropped.
          dragstart: (_view, event) => {
            if (event.target instanceof HTMLImageElement) {
              event.preventDefault()
              return true
            }
            return false
          },
        },
        handlePaste: (view, event) => {
          const items = event.clipboardData?.items
          if (!items) return false
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (file) this._insertImageFile(file)
              return true
            }
          }
          return false
        },
      },
      onUpdate: ({ editor }) => {
        this._internalUpdate = true
        this.$emit('update:modelValue', editor.storage.markdown.getMarkdown())
      },
    })
  },

  beforeUnmount() {
    this.editor.destroy()
  },

  watch: {
    modelValue(value) {
      if (this._internalUpdate) {
        this._internalUpdate = false
        return
      }
      const current = this.editor.storage.markdown.getMarkdown()
      if (value !== current) {
        this.editor.commands.setContent(value, false)
      }
    },
  },

  methods: {
    insertImage(file) {
      this._insertImageFile(file)
    },

    _insertImageFile(file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        this.editor.commands.setImage({ src: e.target.result })
      }
      reader.readAsDataURL(file)
    },
  },
}
</script>

<style>
.md-editor-wrap {
  position: relative;
}

.md-editor .ProseMirror {
  outline: none;
  min-height: 8rem;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--text-2);
  padding: 0.25rem 0;
}

.md-editor .ProseMirror p { margin: 0.3rem 0; }

.md-editor .ProseMirror h1,
.md-editor .ProseMirror h2,
.md-editor .ProseMirror h3 { font-weight: 600; margin: 0.75rem 0 0.2rem; }
.md-editor .ProseMirror h1 { font-size: 1.3rem; }
.md-editor .ProseMirror h2 { font-size: 1.1rem; }
.md-editor .ProseMirror h3 { font-size: 1rem; }

.md-editor .ProseMirror ul,
.md-editor .ProseMirror ol { padding-left: 1.5rem; margin: 0.3rem 0; }
.md-editor .ProseMirror li { margin: 0.15rem 0; }

.md-editor .ProseMirror ul[data-type="taskList"] {
  list-style: none;
  padding-left: 0.25rem;
}
.md-editor .ProseMirror ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}
.md-editor .ProseMirror ul[data-type="taskList"] li > label {
  margin-top: 0.2rem;
  cursor: pointer;
  flex-shrink: 0;
}
.md-editor .ProseMirror ul[data-type="taskList"] li > label input[type="checkbox"] {
  cursor: pointer;
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
}
.md-editor .ProseMirror ul[data-type="taskList"] li > div {
  flex: 1;
}
.md-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div > p {
  text-decoration: line-through;
  color: var(--text-muted);
}
.md-editor .ProseMirror ul[data-type="taskList"] li[data-checked="false"] + li[data-checked="true"] {
  border-top: 1px dashed var(--border-2);
  margin-top: 0.4rem;
  padding-top: 0.4rem;
}

.md-editor .ProseMirror code {
  background: var(--surface-3);
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.875em;
  font-family: 'Menlo', 'Consolas', monospace;
}

.md-editor .ProseMirror pre {
  background: var(--surface-3);
  padding: 0.75rem 1rem;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5rem 0;
}
.md-editor .ProseMirror pre code { background: none; padding: 0; }

.md-editor .ProseMirror blockquote {
  border-left: 3px solid var(--border);
  margin: 0.5rem 0;
  padding-left: 0.75rem;
  color: var(--text-3);
}

.md-editor .ProseMirror strong { font-weight: 600; }
.md-editor .ProseMirror em { font-style: italic; }

.md-editor .ProseMirror a { color: var(--accent); }

.md-editor .ProseMirror hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0.75rem 0;
}

.md-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-muted);
  pointer-events: none;
  float: left;
  height: 0;
}

.md-editor .ProseMirror img {
  max-width: 100%;
  border-radius: 4px;
  display: block;
  margin: 0.5rem 0;
}
</style>

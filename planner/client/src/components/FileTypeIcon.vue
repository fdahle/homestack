<template>
  <svg
    class="file-type-icon"
    viewBox="0 0 48 48"
    :width="size"
    :height="size"
    role="img"
    :aria-label="label"
  >
    <!-- page -->
    <path
      d="M10 3 h19 l9 9 v33 a1.5 1.5 0 0 1 -1.5 1.5 H10 a1.5 1.5 0 0 1 -1.5 -1.5 V4.5 A1.5 1.5 0 0 1 10 3 z"
      fill="#ffffff"
      stroke="#d4d4d4"
      stroke-width="1"
    />
    <!-- folded corner -->
    <path d="M29 3 v9 h9 z" fill="#e4e4e4" />
    <!-- format band -->
    <rect x="3" y="23" width="33" height="13" rx="2" :fill="color" />
    <text
      x="19.5"
      y="32.4"
      text-anchor="middle"
      :font-size="label.length > 3 ? 7.5 : 9"
      font-weight="700"
      fill="#ffffff"
      font-family="-apple-system, system-ui, sans-serif"
    >{{ label }}</text>
  </svg>
</template>

<script>
// Maps a file extension/mime to a "branded-style" format label + accent color.
const MAP = {
  doc:  ['DOC',  '#2b579a'], docx: ['DOCX', '#2b579a'], rtf: ['RTF', '#2b579a'], odt: ['ODT', '#2b579a'],
  xls:  ['XLS',  '#217346'], xlsx: ['XLSX', '#217346'], ods: ['ODS', '#217346'], csv: ['CSV', '#217346'],
  ppt:  ['PPT',  '#c43e1c'], pptx: ['PPTX', '#c43e1c'], odp: ['ODP', '#c43e1c'],
  pdf:  ['PDF',  '#d93025'],
  zip:  ['ZIP',  '#7a4fbf'], rar: ['RAR', '#7a4fbf'], '7z': ['7Z', '#7a4fbf'], tar: ['TAR', '#7a4fbf'], gz: ['GZ', '#7a4fbf'],
  txt:  ['TXT',  '#5f6368'], md: ['MD', '#5f6368'], log: ['LOG', '#5f6368'], json: ['JSON', '#5f6368'],
  mp3:  ['MP3',  '#b5179e'], wav: ['WAV', '#b5179e'], flac: ['FLAC', '#b5179e'], ogg: ['OGG', '#b5179e'], m4a: ['M4A', '#b5179e'],
  mp4:  ['MP4',  '#3f51b5'], mov: ['MOV', '#3f51b5'], avi: ['AVI', '#3f51b5'], mkv: ['MKV', '#3f51b5'], webm: ['WEBM', '#3f51b5'],
}

export default {
  name: 'FileTypeIcon',

  props: {
    name: { type: String, default: '' },
    type: { type: String, default: '' },
    size: { type: [Number, String], default: 44 },
  },

  computed: {
    ext() {
      const m = (this.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
      return m ? m[1] : ''
    },
    label() {
      const hit = MAP[this.ext]
      if (hit) return hit[0]
      if (this.ext) return this.ext.slice(0, 4).toUpperCase()
      return 'FILE'
    },
    color() {
      return MAP[this.ext]?.[1] || '#5f6368'
    },
  },
}
</script>

<style scoped>
.file-type-icon { display: block; }
</style>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '../i18n.js';
import { scannedIsbn } from '../util.js';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import Icon from '../kit/components/Icon.vue';

// The camera reading ISBN barcodes (EAN-13 starting with 978/979). Uses the browser's own
// BarcodeDetector where it has one (Chrome on Android), else a WebAssembly reader that is
// only loaded when the camera starts. Emits 'isbn' with each new ISBN-13, 'close' when closed.
const emit = defineEmits(['isbn', 'close']);
const props = defineProps({ autostart: Boolean });

const video = ref(null);
const cameraOn = ref(false);
const cameraError = ref('');
const notIsbn = ref(false);
let stream = null;
let detector = null;
let timer = null;
let lastCode = '';
let lastCodeAt = 0;

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.includes('ean_13')) return new window.BarcodeDetector({ formats: ['ean_13'] });
    } catch {
      // fall back to the WebAssembly reader
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: ['ean_13'] });
}

async function startCamera() {
  cameraError.value = '';
  try {
    detector ??= await makeDetector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.value.srcObject = stream;
    await video.value.play();
    cameraOn.value = true;
    scanLoop();
  } catch (err) {
    cameraError.value = !window.isSecureContext ? t('scan.needsHttps') : err?.name === 'NotAllowedError' ? t('scan.denied') : t('scan.noCamera');
    stopCamera();
  }
}

function stopCamera() {
  clearTimeout(timer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  cameraOn.value = false;
}

function scanLoop() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!cameraOn.value) return;
    if (video.value?.readyState >= 2) {
      try {
        const code = (await detector.detect(video.value)).map((c) => c.rawValue).find((v) => /^\d{13}$/.test(v));
        // The same code stays in view for a while; only count it again after a pause
        if (code && (code !== lastCode || Date.now() - lastCodeAt > 4000)) {
          lastCode = code;
          lastCodeAt = Date.now();
          const isbn = scannedIsbn(code);
          notIsbn.value = !isbn;
          if (isbn) {
            navigator.vibrate?.(60);
            emit('isbn', isbn);
          }
        }
      } catch {
        // a frame that couldn't be read
      }
    }
    scanLoop();
  }, 180);
}

function close() {
  stopCamera();
  emit('close');
}

onMounted(() => props.autostart && startCamera());
onBeforeUnmount(stopCamera);
</script>

<template>
  <section class="scanner">
    <div class="camera">
      <video ref="video" playsinline muted></video>
      <div v-if="cameraOn" class="aim"></div>
      <div v-if="!cameraOn" class="camera-off">
        <button class="btn primary" @click="startCamera"><Icon name="camera" />{{ t('scan.start') }}</button>
        <p v-if="cameraError" class="error">{{ cameraError }}</p>
      </div>
      <button class="icon-btn camera-close" :aria-label="t('close')" :title="t('close')" @click="close"><Icon name="close" /></button>
    </div>
    <p class="muted small" :class="{ warn: notIsbn }">{{ notIsbn ? t('scan.notIsbn') : t('scan.hint') }}</p>
  </section>
</template>

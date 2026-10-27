<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, setStatus } from '../api.js';
import { t } from '../i18n.js';
import { errorText, formatKeyDate, issueLabel, showToast } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import CoverImage from '../components/CoverImage.vue';

const props = defineProps({ id: String });
const router = useRouter();

const issue = ref(null);
const variants = ref([]);
const others = ref([]);
const detailsError = ref(null);
const loadError = ref('');
const notes = ref('');

async function load() {
  try {
    const data = await api(`/issues/${props.id}`);
    issue.value = data.issue;
    variants.value = data.variants;
    others.value = data.others;
    detailsError.value = data.detailsError;
    notes.value = data.issue.notes || '';
  } catch (err) {
    loadError.value = err.status === 404 ? t('errors.not_found') : errorText(err);
  }
}
onMounted(load);

const credits = computed(() => {
  try {
    return issue.value?.credits ? JSON.parse(issue.value.credits) : null;
  } catch {
    return null;
  }
});

const COLUMN = { owned: 'owned_at', read: 'read_at', wanted: 'wanted_at' };

async function toggle(flag) {
  const value = !issue.value[COLUMN[flag]];
  const before = { ...issue.value };
  issue.value[COLUMN[flag]] = value ? new Date().toISOString() : null;
  if (flag === 'owned' && value) issue.value.wanted_at = null;
  try {
    await setStatus([issue.value.id], { [flag]: value });
  } catch (err) {
    issue.value = before;
    showToast(errorText(err));
  }
}

async function setRating(n) {
  const rating = issue.value.rating === n ? 0 : n;
  issue.value = await api(`/issues/${props.id}/mine`, { method: 'PATCH', body: { rating } });
}

async function saveNotes() {
  if ((issue.value.notes || '') === notes.value) return;
  issue.value = await api(`/issues/${props.id}/mine`, { method: 'PATCH', body: { notes: notes.value } });
  showToast(t('saved'));
}

const fileInput = ref(null);
async function uploadCover(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const blob = await shrinkImage(file);
    issue.value = await api(`/issues/${props.id}/cover`, { method: 'PUT', raw: blob });
    showToast(t('issue.coverSaved'));
  } catch (err) {
    showToast(errorText(err));
  }
  event.target.value = '';
}

// Phone photos are large; scale to 900px height before uploading
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, 900 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85));
}

async function refresh() {
  try {
    issue.value = { ...issue.value, ...(await api(`/issues/${props.id}/refresh`, { method: 'POST' })) };
    detailsError.value = null;
    showToast(t('issue.refreshed'));
  } catch (err) {
    showToast(errorText(err));
  }
}

const editDialog = ref(null);
const editForm = ref({});
function openEdit() {
  const i = issue.value;
  editForm.value = { number: i.number, title: i.title, variant: i.variant, isbn: i.isbn || '', key_date: i.key_date || '', price: i.price || '' };
  editDialog.value.showModal();
}
async function submitEdit() {
  try {
    issue.value = await api(`/issues/${props.id}`, { method: 'PATCH', body: editForm.value });
    editDialog.value.close();
  } catch (err) {
    showToast(errorText(err));
  }
}

async function deleteIssue() {
  if (!confirm(t('issue.confirmDelete'))) return;
  try {
    await api(`/issues/${props.id}`, { method: 'DELETE' });
    router.replace(`/series/${issue.value.series_id}`);
  } catch (err) {
    showToast(errorText(err));
  }
}
</script>

<template>
  <TopBar :title="issue ? `${issue.series_name} ${issueLabel(issue)}` : ''" :back="issue ? `/series/${issue.series_id}` : '/collection'">
    <button v-if="issue" class="icon-btn" :aria-label="t('issue.edit')" @click="openEdit"><Icon name="edit" /></button>
  </TopBar>

  <main v-if="issue" class="issue-page">
    <div class="issue-top">
      <div class="issue-cover">
        <CoverImage :issue="issue" :series-name="issue.series_name" eager />
        <button class="btn small subtle" @click="fileInput.click()"><Icon name="camera" /> {{ t('issue.photoCover') }}</button>
        <input ref="fileInput" type="file" accept="image/*" capture="environment" hidden @change="uploadCover" />
      </div>

      <div class="issue-info">
        <RouterLink :to="`/series/${issue.series_id}`" class="series-link">{{ issue.series_name }}<template v-if="issue.year_began"> ({{ issue.year_began }})</template></RouterLink>
        <h2>{{ issueLabel(issue) }}<template v-if="issue.title"> · {{ issue.title }}</template></h2>
        <p v-if="issue.variant" class="muted">{{ issue.variant }}</p>

        <div class="status-buttons">
          <button class="status-btn s-owned" :class="{ on: issue.owned_at }" @click="toggle('owned')"><Icon name="check" /> {{ t('status.owned') }}</button>
          <button class="status-btn s-read" :class="{ on: issue.read_at }" @click="toggle('read')"><Icon name="book" /> {{ t('status.read') }}</button>
          <button v-if="!issue.owned_at" class="status-btn s-wanted" :class="{ on: issue.wanted_at }" @click="toggle('wanted')"><Icon name="heart" /> {{ t('status.wanted') }}</button>
        </div>

        <div class="rating" :aria-label="t('issue.rating')">
          <button v-for="n in 5" :key="n" :class="{ on: (issue.rating || 0) >= n }" :aria-label="`${n}`" @click="setRating(n)"><Icon name="star" /></button>
        </div>

        <p v-for="o in others" :key="o.display_name" class="muted small">
          {{ o.owned ? t('issue.otherOwns', { name: o.display_name }) : t('issue.otherRead', { name: o.display_name }) }}
        </p>
      </div>
    </div>

    <dl class="facts">
      <template v-if="issue.key_date"><dt>{{ t('issue.date') }}</dt><dd>{{ formatKeyDate(issue.key_date) }}</dd></template>
      <template v-if="issue.publisher_name"><dt>{{ t('add.publisher') }}</dt><dd>{{ issue.publisher_name }}</dd></template>
      <template v-if="credits?.script?.length"><dt>{{ t('issue.script') }}</dt><dd>{{ credits.script.join(', ') }}</dd></template>
      <template v-if="credits?.art?.length"><dt>{{ t('issue.art') }}</dt><dd>{{ credits.art.join(', ') }}</dd></template>
      <template v-if="issue.page_count"><dt>{{ t('issue.pages') }}</dt><dd>{{ issue.page_count }}</dd></template>
      <template v-if="issue.price"><dt>{{ t('issue.price') }}</dt><dd>{{ issue.price }}</dd></template>
      <template v-if="issue.isbn"><dt>ISBN</dt><dd>{{ issue.isbn }}</dd></template>
      <template v-if="issue.barcode"><dt>{{ t('issue.barcode') }}</dt><dd>{{ issue.barcode }}</dd></template>
    </dl>
    <p v-if="detailsError === 'gcd_busy'" class="muted small">{{ t('issue.detailsLater') }}</p>

    <label class="notes">
      <span>{{ t('issue.notes') }}</span>
      <textarea v-model="notes" rows="3" :placeholder="t('issue.notesPlaceholder')" @blur="saveNotes"></textarea>
    </label>

    <template v-if="variants.length">
      <h3 class="section">{{ t('issue.otherPrintings') }}</h3>
      <ul class="plain-list">
        <li v-for="v in variants" :key="v.id">
          <RouterLink :to="`/issue/${v.id}`">{{ issueLabel(v) }} {{ v.variant || t('issue.firstPrinting') }}</RouterLink>
        </li>
      </ul>
    </template>

    <div class="row-buttons spaced">
      <a v-if="issue.gcd_id" class="btn subtle" :href="`https://www.comics.org/issue/${issue.gcd_id}/`" target="_blank" rel="noopener"><Icon name="external" /> GCD</a>
      <button v-if="issue.gcd_id" class="btn subtle" @click="refresh"><Icon name="refresh" /> {{ t('issue.refresh') }}</button>
      <button v-if="!issue.gcd_id" class="btn subtle danger" @click="deleteIssue"><Icon name="trash" /> {{ t('issue.delete') }}</button>
    </div>
  </main>
  <main v-else-if="loadError"><p class="error center">{{ loadError }}</p></main>

  <dialog ref="editDialog" class="dialog">
    <form @submit.prevent="submitEdit">
      <h2>{{ t('issue.edit') }}</h2>
      <div class="two">
        <label><span>{{ t('issue.number') }}</span><input v-model="editForm.number" /></label>
        <label><span>{{ t('issue.variant') }}</span><input v-model="editForm.variant" /></label>
      </div>
      <label><span>{{ t('issue.title') }}</span><input v-model="editForm.title" /></label>
      <label><span>ISBN</span><input v-model="editForm.isbn" inputmode="numeric" /></label>
      <div class="two">
        <label><span>{{ t('issue.date') }}</span><input v-model="editForm.key_date" placeholder="2024-11" /></label>
        <label><span>{{ t('issue.price') }}</span><input v-model="editForm.price" /></label>
      </div>
      <p v-if="issue?.gcd_id" class="muted small">{{ t('issue.editGcdHint') }}</p>
      <div class="row-buttons end">
        <button type="button" class="btn subtle" @click="editDialog.close()">{{ t('cancel') }}</button>
        <button class="btn primary">{{ t('save') }}</button>
      </div>
    </form>
  </dialog>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import { daysBetween, isoDate, relativeDay } from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import Avatar from '../components/Avatar.vue';

const friends = ref(null);
const query = ref('');
const circle = ref(null); // circle name, or 'archived'
const sort = ref(localStorageGet('bande.friendSort') || 'name');
const today = isoDate();

function localStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
watch(sort, (v) => {
  try {
    localStorage.setItem('bande.friendSort', v);
  } catch {
    // only a convenience
  }
});

onMounted(async () => {
  friends.value = await api('/friends');
});

const circles = computed(() => [...new Set((friends.value || []).filter((f) => !f.archived).flatMap((f) => f.circles))].sort((a, b) => a.localeCompare(b)));
const hasArchived = computed(() => (friends.value || []).some((f) => f.archived));

const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Days until the next birthday, for sorting (no birthday sorts last)
function birthdayIn(f) {
  const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(f.birthday || '');
  if (!m) return 9999;
  const y = Number(today.slice(0, 4));
  let next = `${y}-${m[2]}-${m[3]}`;
  if (next < today) next = `${y + 1}-${m[2]}-${m[3]}`;
  return daysBetween(today, next);
}

const shown = computed(() => {
  const q = norm(query.value.trim());
  const list = (friends.value || [])
    .filter((f) => (circle.value === 'archived' ? f.archived : !f.archived))
    .filter((f) => !circle.value || circle.value === 'archived' || f.circles.includes(circle.value))
    .filter((f) => !q || norm(f.name).includes(q) || norm(f.nickname).includes(q) || norm(f.city).includes(q));
  if (sort.value === 'seen') return [...list].sort((a, b) => (a.last_seen || '').localeCompare(b.last_seen || '') * -1);
  if (sort.value === 'birthday') return [...list].sort((a, b) => birthdayIn(a) - birthdayIn(b));
  return list;
});

const overdue = (f) => f.contact_weeks && daysBetween(f.last_contact || f.created_at.slice(0, 10), today) > f.contact_weeks * 7 && !f.next_plan;
</script>

<template>
  <TopBar :title="t('nav.friends')">
    <RouterLink class="icon-btn" to="/friend/new" :aria-label="t('friends.add')"><Icon name="userPlus" /></RouterLink>
  </TopBar>
  <main v-if="friends">
    <div v-if="!friends.length" class="empty">
      <p>{{ t('friends.empty') }}</p>
      <RouterLink class="btn primary" to="/friend/new"><Icon name="userPlus" /> {{ t('friends.add') }}</RouterLink>
    </div>
    <template v-else>
      <div class="toolbar">
        <input v-model="query" type="search" :placeholder="t('friends.search')" />
        <select v-model="sort" :aria-label="t('friends.sort')">
          <option value="name">{{ t('friends.sortName') }}</option>
          <option value="seen">{{ t('friends.sortSeen') }}</option>
          <option value="birthday">{{ t('friends.sortBirthday') }}</option>
        </select>
      </div>
      <div v-if="circles.length || hasArchived" class="chips">
        <button class="chip" :class="{ active: !circle }" @click="circle = null">{{ t('friends.all') }}</button>
        <button v-for="c in circles" :key="c" class="chip" :class="{ active: circle === c }" @click="circle = c">{{ c }}</button>
        <button v-if="hasArchived" class="chip" :class="{ active: circle === 'archived' }" @click="circle = 'archived'"><Icon name="archive" /> {{ t('friends.archived') }}</button>
      </div>

      <ul class="card-list spaced">
        <li v-for="f in shown" :key="f.id">
          <RouterLink :to="`/friend/${f.id}`" class="person-row">
            <Avatar :friend="f" :size="44" />
            <span class="person-body">
              <strong>{{ f.name }} <small v-if="f.nickname" class="muted">{{ f.nickname }}</small></strong>
              <span class="meta">
                <span v-if="f.next_plan" class="ok-text">{{ t('friends.nextPlan', { when: relativeDay(f.next_plan, today) }) }}</span>
                <span v-else-if="f.last_seen">{{ t('friends.lastSeen', { when: relativeDay(f.last_seen, today) }) }}</span>
                <span v-else-if="f.last_contact">{{ t('friends.lastContact', { when: relativeDay(f.last_contact, today) }) }}</span>
                <span v-if="f.circles.length">{{ f.circles.join(', ') }}</span>
              </span>
            </span>
            <span v-if="overdue(f)" class="dot-warn" :title="t('friends.overdue')"></span>
          </RouterLink>
        </li>
      </ul>
      <p v-if="!shown.length" class="muted center hint">{{ t('friends.noMatch') }}</p>
    </template>
  </main>
</template>

<script setup>
import { computed, onMounted, provide, ref, watch } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import {
  daysBetween, duration, errorText, FACT_CATEGORIES, formatBirthday, formatDate, formatPartial, fullAddress, guessCategory, isoDate, mapsLink,
  relativeDay, showToast, whatsappLink,
} from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import Avatar from '../components/Avatar.vue';
import TimelineList from '../components/TimelineList.vue';

const props = defineProps({ id: { type: String, required: true } });
const data = ref(null);
const error = ref('');
const labels = ref([]); // [{ label, category }] used before
const today = isoDate();

// Their events open beside the friends list too (on the phone in place of this page)
provide('eventPath', (eventId) => `/friends/event/${eventId}`);

onMounted(async () => {
  try {
    data.value = await api(`/friends/${props.id}`);
  } catch (err) {
    error.value = errorText(err);
    return;
  }
  labels.value = await api('/fact-labels').catch(() => []);
});

const friend = computed(() => data.value?.friend);
const address = computed(() => fullAddress(friend.value));
// Them on Fernweh's map, when Fernweh is set up (FERNWEH_URL) and there is somewhere to show
const fernwehLink = computed(() => (data.value?.fernwehUrl && address.value ? `${data.value.fernwehUrl}/?bande=${friend.value.id}` : null));
const ideas = computed(() => data.value.events.filter((e) => e.status === 'idea'));
const upcoming = computed(() => data.value.events.filter((e) => e.status === 'planned' && e.date >= today).reverse());
const past = computed(() => data.value.events.filter((e) => e.status !== 'idea' && !(e.status === 'planned' && e.date >= today)));

const birthday = computed(() => {
  const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(friend.value?.birthday || '');
  if (!m) return null;
  const y = Number(today.slice(0, 4));
  let next = `${y}-${m[2]}-${m[3]}`;
  if (next < today) next = `${y + 1}-${m[2]}-${m[3]}`;
  return { next, days: daysBetween(today, next), age: m[1] === '-' ? null : Number(next.slice(0, 4)) - Number(m[1]) };
});

const contactState = computed(() => {
  const f = friend.value;
  if (!f.contact_weeks) return null;
  const since = daysBetween(f.last_contact || f.created_at.slice(0, 10), today);
  return { overdue: since > f.contact_weeks * 7 && !f.next_plan };
});

// --- facts ---

const newFact = ref({ label: '', value: '', category: 'other' });
const groupTouched = ref(false); // picked by hand: stop guessing
const editingFact = ref(null);

watch(() => [newFact.value.label, newFact.value.value], ([label, value]) => {
  if (!groupTouched.value) newFact.value.category = guessCategory(label, value, labels.value);
});

const factGroups = computed(() =>
  FACT_CATEGORIES.map((key) => ({ key, facts: data.value.facts.filter((f) => f.category === key) })).filter((g) => g.facts.length));
// Only "other": no heading needed
const showGroupTitles = computed(() => factGroups.value.length > 1 || factGroups.value[0]?.key !== 'other');
const labelOptions = computed(() =>
  [...new Set([...labels.value.map((l) => l.label), ...t('factGroups.suggestions').split(', ')])]);

async function addFact() {
  if (!newFact.value.value.trim()) return;
  try {
    data.value.facts = await api(`/friends/${props.id}/facts`, { method: 'POST', body: newFact.value });
    const { label, category } = newFact.value;
    if (label.trim() && !labels.value.some((l) => l.label.toLowerCase() === label.trim().toLowerCase())) labels.value.push({ label: label.trim(), category });
    newFact.value = { label: '', value: '', category: 'other' };
    groupTouched.value = false;
  } catch (err) {
    showToast(errorText(err));
  }
}

async function saveFact() {
  const f = editingFact.value;
  try {
    data.value.facts = f.value.trim()
      ? await api(`/facts/${f.id}`, { method: 'PATCH', body: { label: f.label, value: f.value, category: f.category } })
      : await api(`/facts/${f.id}`, { method: 'DELETE' });
    editingFact.value = null;
  } catch (err) {
    showToast(errorText(err));
  }
}

async function deleteFact(fact) {
  data.value.facts = await api(`/facts/${fact.id}`, { method: 'DELETE' });
  editingFact.value = null;
}

// --- gifts ---

const newGift = ref('');
const giftIdeas = computed(() => data.value.gifts.filter((g) => !g.given_on));
const giftsGiven = computed(() => data.value.gifts.filter((g) => g.given_on));

async function addGift() {
  if (!newGift.value.trim()) return;
  try {
    data.value.gifts = await api(`/friends/${props.id}/gifts`, { method: 'POST', body: { title: newGift.value } });
    newGift.value = '';
  } catch (err) {
    showToast(errorText(err));
  }
}

async function markGiven(gift) {
  const occasion = birthday.value && birthday.value.days <= 30 ? t('gifts.birthday') : gift.occasion;
  data.value.gifts = await api(`/gifts/${gift.id}`, { method: 'PATCH', body: { given_on: today, occasion } });
  showToast(t('gifts.markedGiven'));
}

async function deleteGift(gift) {
  data.value.gifts = await api(`/gifts/${gift.id}`, { method: 'DELETE' });
}
</script>

<template>
  <TopBar :title="friend?.name || ''" back="/friends">
    <RouterLink v-if="friend" class="icon-btn" :to="`/friend/${id}/edit`" :aria-label="t('friend.edit')" :title="t('friend.edit')"><Icon name="edit" /></RouterLink>
  </TopBar>
  <main v-if="error"><p class="error">{{ error }}</p></main>
  <main v-else-if="data">
    <section class="profile">
      <Avatar :friend="friend" :size="88" />
      <div class="profile-body">
        <h2>{{ friend.name }}</h2>
        <p v-if="friend.nickname" class="muted">„{{ friend.nickname }}“</p>
        <div v-if="friend.circles.length || friend.archived" class="tags">
          <span v-for="c in friend.circles" :key="c" class="tag">{{ c }}</span>
          <span v-if="friend.archived" class="tag"><Icon name="archive" /> {{ t('friend.archived') }}</span>
        </div>
      </div>
    </section>

    <div class="row-buttons">
      <RouterLink class="btn primary" :to="`/event/new?friend=${id}`"><Icon name="plus" /> {{ t('friend.addEvent') }}</RouterLink>
      <a v-if="whatsappLink(friend.phone)" class="btn" :href="whatsappLink(friend.phone)" target="_blank" rel="noopener"><Icon name="chat" /> WhatsApp</a>
      <a v-if="friend.phone" class="btn" :href="`tel:${friend.phone.replace(/[^\d+]/g, '')}`"><Icon name="phone" /> {{ t('friend.call') }}</a>
    </div>

    <template v-if="birthday || address || friend.phone || friend.email">
      <h2 class="section">{{ t('friend.contact') }}</h2>
      <dl class="facts card">
        <template v-if="birthday">
          <dt><Icon name="cake" /> {{ t('friend.birthday') }}</dt>
          <dd>
            {{ formatBirthday(friend.birthday) }}
            <span class="muted">· {{ birthday.days === 0 ? t('friend.birthdayToday') : relativeDay(birthday.next, today) }}<template v-if="birthday.age">, {{ t('home.turns', { age: birthday.age }) }}</template></span>
          </dd>
        </template>
        <template v-if="address">
          <dt><Icon name="pin" /> {{ friend.address ? t('friend.address') : t('friend.city') }}</dt>
          <dd class="address">
            <span>{{ address }}</span>
            <span class="map-links">
              <a v-if="fernwehLink" class="map-link" :href="fernwehLink" target="_blank" rel="noopener" :title="t('friend.onMapHint')"><Icon name="pin" /> {{ t('friend.onMap') }}</a>
              <a class="map-link" :href="mapsLink(address)" target="_blank" rel="noopener"><Icon name="map" /> {{ t('friend.openMap') }}</a>
            </span>
          </dd>
        </template>
        <template v-if="friend.phone"><dt><Icon name="phone" /> {{ t('friend.phone') }}</dt><dd>{{ friend.phone }}</dd></template>
        <template v-if="friend.email"><dt>@ {{ t('friend.email') }}</dt><dd><a :href="`mailto:${friend.email}`">{{ friend.email }}</a></dd></template>
      </dl>
    </template>

    <h2 class="section">{{ t('friend.together') }}</h2>
    <dl class="facts card">
      <dt><Icon name="users" /> {{ t('friend.lastSeen') }}</dt>
      <dd>
        {{ friend.last_seen ? `${formatDate(friend.last_seen)} · ${relativeDay(friend.last_seen, today)}` : t('friend.never') }}
        <span v-if="friend.seen_this_year" class="muted">· {{ t('friend.seenThisYear', { n: friend.seen_this_year }) }}</span>
      </dd>
      <template v-if="friend.last_contact && friend.last_contact !== friend.last_seen">
        <dt><Icon name="chat" /> {{ t('friend.lastContact') }}</dt><dd>{{ relativeDay(friend.last_contact, today) }}</dd>
      </template>
      <template v-if="friend.contact_weeks">
        <dt><Icon name="bell" /> {{ t('friend.contactEvery') }}</dt>
        <dd>{{ duration(friend.contact_weeks * 7) }} <span v-if="contactState.overdue" class="warn">· {{ t('friend.overdue') }}</span></dd>
      </template>
      <template v-if="friend.met_on || friend.met_story">
        <dt><Icon name="sparkle" /> {{ t('friend.met') }}</dt>
        <dd>{{ formatPartial(friend.met_on) }}<span v-if="friend.met_on && friend.met_story"> · </span>{{ friend.met_story }}</dd>
      </template>
    </dl>

    <p v-if="friend.notes" class="card notes-text">{{ friend.notes }}</p>

    <h2 class="section">{{ t('friend.facts') }}</h2>
    <div class="card">
      <div v-for="g in factGroups" :key="g.key" class="fact-group">
        <h3 v-if="showGroupTitles">{{ t(`factGroups.${g.key}`) }}</h3>
        <ul class="fact-list">
          <li v-for="fact in g.facts" :key="fact.id">
            <form v-if="editingFact?.id === fact.id" class="fact-form" @submit.prevent="saveFact">
              <div class="fact-edit">
                <input v-model="editingFact.label" :placeholder="t('friend.factLabel')" list="fact-labels" />
                <input v-model="editingFact.value" :placeholder="t('friend.factValue')" autofocus />
                <button class="icon-btn" :aria-label="t('save')"><Icon name="check" /></button>
                <button type="button" class="icon-btn danger" :aria-label="t('delete')" @click="deleteFact(fact)"><Icon name="trash" /></button>
              </div>
              <label class="fact-group-select">
                <span>{{ t('friend.factGroup') }}</span>
                <select v-model="editingFact.category"><option v-for="c in FACT_CATEGORIES" :key="c" :value="c">{{ t(`factGroups.${c}`) }}</option></select>
              </label>
            </form>
            <button v-else class="fact" @click="editingFact = { ...fact }">
              <span v-if="fact.label" class="fact-label">{{ fact.label }}</span>
              <span class="fact-value">{{ fact.value }}</span>
            </button>
          </li>
        </ul>
      </div>
      <form class="fact-form" @submit.prevent="addFact">
        <div class="fact-edit">
          <input v-model="newFact.label" :placeholder="t('friend.factLabel')" list="fact-labels" />
          <input v-model="newFact.value" :placeholder="t('friend.factPlaceholder')" />
          <button class="icon-btn" :aria-label="t('add')" :disabled="!newFact.value.trim()"><Icon name="plus" /></button>
        </div>
        <label v-if="newFact.label.trim() || newFact.value.trim()" class="fact-group-select">
          <span>{{ t('friend.factGroup') }}</span>
          <select v-model="newFact.category" @change="groupTouched = true"><option v-for="c in FACT_CATEGORIES" :key="c" :value="c">{{ t(`factGroups.${c}`) }}</option></select>
        </label>
      </form>
      <datalist id="fact-labels"><option v-for="l in labelOptions" :key="l" :value="l" /></datalist>
    </div>

    <template v-if="upcoming.length">
      <h2 class="section">{{ t('friend.upcoming') }}</h2>
      <TimelineList :events="upcoming" :hide-friend="friend.id" />
    </template>

    <h2 class="section">{{ t('friend.ideas') }} <RouterLink :to="`/event/new?friend=${id}&status=idea`" class="section-link">{{ t('add') }}</RouterLink></h2>
    <TimelineList v-if="ideas.length" :events="ideas" :hide-friend="friend.id" />
    <p v-else class="muted small">{{ t('friend.noIdeas') }}</p>

    <h2 class="section">{{ t('friend.gifts') }}</h2>
    <div class="card">
      <ul v-if="data.gifts.length" class="plain-list gift-list">
        <li v-for="g in giftIdeas" :key="g.id">
          <Icon name="gift" />
          <span class="grow">{{ g.title }}</span>
          <button class="btn small" @click="markGiven(g)">{{ t('gifts.given') }}</button>
          <button class="icon-btn" :aria-label="t('delete')" @click="deleteGift(g)"><Icon name="close" /></button>
        </li>
        <li v-for="g in giftsGiven" :key="g.id" class="muted">
          <Icon name="check" />
          <span class="grow">{{ g.title }} <small>· {{ formatDate(g.given_on, { weekday: false }) }}<template v-if="g.occasion"> · {{ g.occasion }}</template></small></span>
          <button class="icon-btn" :aria-label="t('delete')" @click="deleteGift(g)"><Icon name="close" /></button>
        </li>
      </ul>
      <form class="fact-edit" @submit.prevent="addGift">
        <input v-model="newGift" :placeholder="t('gifts.placeholder')" />
        <button class="icon-btn" :aria-label="t('add')" :disabled="!newGift.trim()"><Icon name="plus" /></button>
      </form>
    </div>

    <h2 class="section">{{ t('friend.timeline') }}</h2>
    <TimelineList v-if="past.length" :events="past" group :hide-friend="friend.id" />
    <p v-else class="muted small">{{ t('friend.noEvents') }}</p>
    <div v-if="friend.met_on" class="met-line"><Icon name="sparkle" /> {{ t('friend.metOn', { when: formatPartial(friend.met_on) }) }}</div>
  </main>
</template>

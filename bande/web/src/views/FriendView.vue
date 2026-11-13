<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { t } from '../i18n.js';
import {
  daysBetween, duration, errorText, formatBirthday, formatDate, formatPartial, isoDate, relativeDay, showToast, whatsappLink,
} from '../util.js';
import TopBar from '../components/TopBar.vue';
import Icon from '../components/Icon.vue';
import Avatar from '../components/Avatar.vue';
import TimelineList from '../components/TimelineList.vue';
import ChatBars from '../components/ChatBars.vue';

const props = defineProps({ id: { type: String, required: true } });
const data = ref(null);
const labels = ref([]);
const today = isoDate();

onMounted(async () => {
  data.value = await api(`/friends/${props.id}`);
  labels.value = await api('/fact-labels').catch(() => []);
});

const friend = computed(() => data.value?.friend);
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

const newFact = ref({ label: '', value: '' });
const editingFact = ref(null);

async function addFact() {
  if (!newFact.value.value.trim()) return;
  try {
    data.value.facts = await api(`/friends/${props.id}/facts`, { method: 'POST', body: newFact.value });
    newFact.value = { label: '', value: '' };
  } catch (err) {
    showToast(errorText(err));
  }
}

async function saveFact() {
  const f = editingFact.value;
  try {
    data.value.facts = f.value.trim()
      ? await api(`/facts/${f.id}`, { method: 'PATCH', body: { label: f.label, value: f.value } })
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

const totalMessages = computed(() => data.value.chatMonths.reduce((s, m) => s + m.n, 0));
</script>

<template>
  <TopBar :title="friend?.name || ''" back="/friends">
    <RouterLink v-if="friend" class="icon-btn" :to="`/friend/${id}/edit`" :aria-label="t('friend.edit')"><Icon name="edit" /></RouterLink>
  </TopBar>
  <main v-if="data">
    <section class="profile">
      <Avatar :friend="friend" :size="88" />
      <div class="profile-body">
        <h2>{{ friend.name }}</h2>
        <p v-if="friend.nickname" class="muted">„{{ friend.nickname }}“</p>
        <div v-if="friend.circles.length" class="tags">
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

    <dl class="facts card">
      <template v-if="birthday">
        <dt><Icon name="cake" /> {{ t('friend.birthday') }}</dt>
        <dd>
          {{ formatBirthday(friend.birthday) }}
          <span class="muted">· {{ birthday.days === 0 ? t('friend.birthdayToday') : relativeDay(birthday.next, today) }}<template v-if="birthday.age">, {{ t('home.turns', { age: birthday.age }) }}</template></span>
        </dd>
      </template>
      <template v-if="friend.city"><dt><Icon name="pin" /> {{ t('friend.city') }}</dt><dd>{{ friend.city }}</dd></template>
      <template v-if="friend.phone"><dt><Icon name="phone" /> {{ t('friend.phone') }}</dt><dd>{{ friend.phone }}</dd></template>
      <template v-if="friend.email"><dt>@ {{ t('friend.email') }}</dt><dd><a :href="`mailto:${friend.email}`">{{ friend.email }}</a></dd></template>
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
      <ul v-if="data.facts.length" class="fact-list">
        <li v-for="fact in data.facts" :key="fact.id">
          <form v-if="editingFact?.id === fact.id" class="fact-edit" @submit.prevent="saveFact">
            <input v-model="editingFact.label" :placeholder="t('friend.factLabel')" list="fact-labels" />
            <input v-model="editingFact.value" :placeholder="t('friend.factValue')" autofocus />
            <button class="icon-btn" :aria-label="t('save')"><Icon name="check" /></button>
            <button type="button" class="icon-btn danger" :aria-label="t('delete')" @click="deleteFact(fact)"><Icon name="trash" /></button>
          </form>
          <button v-else class="fact" @click="editingFact = { ...fact }">
            <span v-if="fact.label" class="fact-label">{{ fact.label }}</span>
            <span class="fact-value">{{ fact.value }}</span>
          </button>
        </li>
      </ul>
      <form class="fact-edit" @submit.prevent="addFact">
        <input v-model="newFact.label" :placeholder="t('friend.factLabel')" list="fact-labels" />
        <input v-model="newFact.value" :placeholder="t('friend.factPlaceholder')" />
        <button class="icon-btn" :aria-label="t('add')" :disabled="!newFact.value.trim()"><Icon name="plus" /></button>
      </form>
      <datalist id="fact-labels"><option v-for="l in labels" :key="l" :value="l" /></datalist>
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

    <template v-if="totalMessages">
      <h2 class="section">{{ t('chat.title') }}</h2>
      <div class="card">
        <ChatBars :months="data.chatMonths" />
        <p class="muted small">{{ t('chat.from', { chats: data.chats.map((c) => c.name).join(', ') }) }}</p>
      </div>
    </template>

    <h2 class="section">{{ t('friend.timeline') }}</h2>
    <TimelineList v-if="past.length" :events="past" group :hide-friend="friend.id" />
    <p v-else class="muted small">{{ t('friend.noEvents') }}</p>
    <div v-if="friend.met_on" class="met-line"><Icon name="sparkle" /> {{ t('friend.metOn', { when: formatPartial(friend.met_on) }) }}</div>
  </main>
</template>

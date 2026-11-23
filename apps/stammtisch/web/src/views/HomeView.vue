<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, session } from '../api.js';
import { t } from '../i18n.js';
import { duration, errorText, eventChange, eventChanged, firstName, formatDate, relativeDay, showToast } from '../util.js';
import TopBar from '../kit/components/TopBar.vue';
import Icon from '../kit/components/Icon.vue';
import SplitView from '../kit/components/SplitView.vue';
import Avatar from '../components/Avatar.vue';
import TimelineList from '../components/TimelineList.vue';

// The start page. On a computer its parts sit in columns (plans, people, memories),
// and an event opens beside them; on the phone it is one column in the order below.
const route = useRoute();
const data = ref(null);
const load = async () => {
  data.value = await api('/home');
};
onMounted(load);

// An event changed beside the page (or elsewhere): what's planned and due may have moved
watch(eventChange, load);

// A plan whose day has passed: did it happen?
async function settle(event, status) {
  try {
    await api(`/events/${event.id}`, { method: 'PATCH', body: { status } });
    showToast(status === 'done' ? t('home.markedDone') : t('home.markedCancelled'));
    eventChanged(event.id);
  } catch (err) {
    showToast(errorText(err));
  }
}

const yearsAgo = (date) => Number(data.value.today.slice(0, 4)) - Number(date.slice(0, 4));
const isOpen = (e) => route.path === `/event/${e.id}`;
</script>

<template>
  <SplitView>
    <TopBar :title="t('home.greeting', { name: session.user?.display_name })">
      <RouterLink class="icon-btn phone-only" to="/settings" :aria-label="t('nav.settings')"><Icon name="gear" /></RouterLink>
    </TopBar>
    <main v-if="data" class="wide">
      <div v-if="!data.friendCount" class="empty">
        <img src="/icon.svg" alt="" width="72" height="72" />
        <p>{{ t('home.empty') }}</p>
        <div class="row-buttons">
          <RouterLink class="btn primary" to="/friend/new"><Icon name="userPlus" /> {{ t('home.addFriend') }}</RouterLink>
        </div>
      </div>

      <template v-else>
        <div class="row-buttons">
          <RouterLink class="btn primary" to="/event/new"><Icon name="plus" /> {{ t('home.addEvent') }}</RouterLink>
          <RouterLink class="btn" to="/share"><Icon name="chat" /> {{ t('home.fromWhatsapp') }}</RouterLink>
        </div>
        <p class="muted small pointer-only">{{ t('home.pasteHint') }}</p>

        <!-- Columns on a computer; on the phone the sections keep this order (style="order") -->
        <div class="home-grid">
          <div class="home-col plans">
            <section v-if="data.pastPlans.length" style="order: 1">
              <h2 class="section">{{ t('home.didItHappen') }}</h2>
              <ul class="card-list">
                <li v-for="e in data.pastPlans" :key="e.id" class="settle-row" :class="{ selected: isOpen(e) }">
                  <RouterLink :to="`/event/${e.id}`" class="settle-body">
                    <strong>{{ e.title }}</strong>
                    <span class="meta">{{ formatDate(e.date) }}<template v-if="e.friends.length"> · {{ e.friends.map(firstName).join(', ') }}</template></span>
                  </RouterLink>
                  <div class="row-buttons">
                    <button class="btn small" @click="settle(e, 'done')"><Icon name="check" /> {{ t('home.yes') }}</button>
                    <button class="btn small subtle" @click="settle(e, 'cancelled')">{{ t('home.no') }}</button>
                  </div>
                </li>
              </ul>
            </section>

            <section v-if="data.upcoming.length" style="order: 2">
              <h2 class="section">{{ t('home.upcoming') }}</h2>
              <TimelineList :events="data.upcoming" />
            </section>

            <section v-if="data.ideas.length" style="order: 6">
              <h2 class="section">{{ t('home.ideas') }}</h2>
              <TimelineList :events="data.ideas" />
            </section>
          </div>

          <div class="home-col people">
            <section v-if="data.birthdays.length" style="order: 3">
              <h2 class="section">{{ t('home.birthdays') }}</h2>
              <ul class="card-list">
                <li v-for="b in data.birthdays" :key="b.friend.id">
                  <RouterLink :to="`/friend/${b.friend.id}`" class="person-row">
                    <Avatar :friend="b.friend" />
                    <span class="person-body">
                      <strong>{{ b.friend.name }}</strong>
                      <span class="meta">
                        <span>{{ b.days === 0 ? t('home.birthdayToday') : `${formatDate(b.date)} · ${relativeDay(b.date, data.today)}` }}</span>
                        <span v-if="b.age">{{ t('home.turns', { age: b.age }) }}</span>
                      </span>
                    </span>
                    <Icon :name="b.days === 0 ? 'cake' : 'gift'" class="row-icon" :class="{ hot: b.days === 0 }" />
                  </RouterLink>
                </li>
              </ul>
            </section>

            <section v-if="data.overdue.length" style="order: 4">
              <h2 class="section">{{ t('home.overdue') }}</h2>
              <ul class="card-list">
                <li v-for="o in data.overdue" :key="o.friend.id">
                  <RouterLink :to="`/friend/${o.friend.id}`" class="person-row">
                    <Avatar :friend="o.friend" />
                    <span class="person-body">
                      <strong>{{ o.friend.name }}</strong>
                      <span class="meta">{{ o.days === null ? t('home.neverInTouch') : t('home.notInTouchFor', { span: duration(o.days) }) }}</span>
                    </span>
                  </RouterLink>
                </li>
              </ul>
            </section>
          </div>

          <div class="home-col memories">
            <section v-if="data.onThisDay.length" style="order: 5">
              <h2 class="section">{{ t('home.onThisDay') }}</h2>
              <ul class="card-list">
                <li v-for="e in data.onThisDay" :key="e.id">
                  <RouterLink :to="`/event/${e.id}`" class="memory-row" :class="{ selected: isOpen(e) }">
                    <span class="years">{{ t('home.yearsAgo', { n: yearsAgo(e.date) }) }}</span>
                    <span><strong>{{ e.title }}</strong><span v-if="e.friends.length" class="meta">{{ e.friends.map(firstName).join(', ') }}</span></span>
                  </RouterLink>
                </li>
              </ul>
            </section>

            <section v-if="data.recent.length" style="order: 7">
              <h2 class="section">{{ t('home.recent') }} <RouterLink to="/timeline" class="section-link">{{ t('home.allTimeline') }}</RouterLink></h2>
              <TimelineList :events="data.recent" />
            </section>
          </div>
        </div>

        <p v-if="!data.upcoming.length && !data.recent.length" class="muted hint">{{ t('home.noEventsYet') }}</p>
      </template>
    </main>
  </SplitView>
</template>

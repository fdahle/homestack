// Small progressive enhancements on top of the server-rendered pages.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode etc.: the feature just doesn't remember
    }
  },
};

// --- toast with undo ---

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  el.replaceChildren(document.createTextNode(message));
  if (undo) {
    const btn = document.createElement('button');
    btn.textContent = 'Undo';
    btn.onclick = () => {
      el.hidden = true;
      undo();
    };
    el.append(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

// --- bottom sheet ---

function sheet(title, actions) {
  const dlg = $('#sheet');
  dlg.replaceChildren();
  if (title) {
    const h = document.createElement('p');
    h.className = 'sheet-title';
    h.textContent = title;
    dlg.append(h);
  }
  for (const { label, run, primary } of [...actions, { label: 'Cancel' }]) {
    const btn = document.createElement('button');
    btn.className = `btn wide${primary ? ' primary' : ''}`;
    btn.textContent = label;
    btn.onclick = () => {
      dlg.close();
      run?.();
    };
    dlg.append(btn);
  }
  dlg.showModal();
}

$('#sheet')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop tap
});

// --- article rows ---

function setRowState(row, { read, starred }) {
  if (read !== undefined) {
    row.dataset.read = read ? '1' : '0';
    row.classList.toggle('is-read', read);
  }
  if (starred !== undefined) row.dataset.starred = starred ? '1' : '0';
}

// In the "unread" view, read rows slide away; in "read", unread ones do.
function rowLeavesView(row) {
  const show = row.closest('.list')?.dataset.show;
  const read = row.dataset.read === '1';
  return (show === 'unread' && read) || (show === 'read' && !read);
}

function updateVisibility(row) {
  if (rowLeavesView(row)) {
    row.classList.add('leaving');
    setTimeout(() => row.classList.add('gone'), 250);
  } else {
    row.classList.remove('leaving', 'gone');
  }
}

async function setRead(id, read) {
  const rows = $$(`.art[data-id="${id}"]`);
  rows.forEach((r) => setRowState(r, { read }));
  rows.forEach(updateVisibility);
  try {
    await api(`/api/articles/${id}`, { read });
  } catch (err) {
    rows.forEach((r) => setRowState(r, { read: !read }));
    rows.forEach(updateVisibility);
    toast(err.message);
  }
}

function toggleRead(id, read) {
  setRead(id, read);
  toast(read ? 'Marked as read' : 'Marked as unread', () => setRead(id, !read));
}

document.addEventListener('click', (e) => {
  const check = e.target.closest('.art .check');
  if (check) {
    const row = check.closest('.art');
    toggleRead(row.dataset.id, row.dataset.read !== '1');
    return;
  }

  const more = e.target.closest('.art .more');
  if (more) {
    const row = more.closest('.art');
    const id = row.dataset.id;
    const read = row.dataset.read === '1';
    const starred = row.dataset.starred === '1';
    sheet($('.art-title', row).textContent, [
      { label: read ? 'Mark as unread' : 'Mark as read', run: () => toggleRead(id, !read) },
      {
        label: starred ? 'Remove from read later' : 'Read later ★',
        run: async () => {
          await api(`/api/articles/${id}`, { starred: !starred });
          $$(`.art[data-id="${id}"]`).forEach((r) => setRowState(r, { starred: !starred }));
        },
      },
      {
        label: 'Mark this and all older as read',
        run: async () => {
          const { ids } = await api(`/api/articles/${id}/read-older`, {});
          ids.forEach((i) => $$(`.art[data-id="${i}"]`).forEach((r) => (setRowState(r, { read: true }), updateVisibility(r))));
          toast(`${ids.length} marked as read`, async () => {
            await api('/api/read-many', { ids, read: false });
            location.reload();
          });
        },
      },
      {
        label: 'Hide (not a real post)',
        run: async () => {
          await api(`/api/articles/${id}`, { ignored: true });
          $$(`.art[data-id="${id}"]`).forEach((r) => r.classList.add('leaving', 'gone'));
          toast('Hidden', async () => {
            await api(`/api/articles/${id}`, { ignored: false });
            location.reload();
          });
        },
      },
    ]);
    return;
  }

  // Remember what was opened, to ask "finished?" on return
  const open = e.target.closest('[data-open]');
  if (open) {
    const title = open.dataset.title || open.textContent.trim();
    storage.set('pending', { id: open.dataset.open, title, at: Date.now() });
  }

  const undo = e.target.closest('[data-undo]');
  if (undo) {
    api('/api/read-many', { ids: undo.dataset.undo.split(','), read: false }).then(() => {
      undo.textContent = 'Undone';
      undo.disabled = true;
    });
  }
});

// --- "Finished reading?" when coming back from an article ---

async function askAboutPending() {
  const pending = storage.get('pending');
  if (!pending || document.visibilityState !== 'visible') return;
  if (Date.now() - pending.at < 15_000) return; // came back too fast to have read it
  storage.set('pending', null);
  if (Date.now() - pending.at > 24 * 3600_000) return;
  try {
    const article = await api(`/api/articles/${pending.id}`);
    if (article.read_at) return;
    sheet(`Finished “${article.title}”?`, [
      { label: 'Yes, mark as read', primary: true, run: () => toggleRead(article.id, true) },
      { label: 'Read later ★', run: () => api(`/api/articles/${article.id}`, { starred: true }).then(() => toast('Saved for later')) },
    ]);
  } catch {
    // article gone or offline, nothing to ask
  }
}

document.addEventListener('visibilitychange', askAboutPending);
window.addEventListener('pageshow', askAboutPending);

// --- list filter ---

$('.filter')?.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  $$('.list .art').forEach((row) => {
    row.hidden = q !== '' && !$('.art-title', row).textContent.toLowerCase().includes(q);
  });
});

// --- forms ---

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) {
    e.preventDefault();
    return;
  }

  // Discover: "Later" / "Not interested" just remove the card ("Add" navigates normally)
  const action = e.submitter?.value;
  if (form.dataset.ajaxRemove && action !== 'add') {
    e.preventDefault();
    const card = $(form.dataset.ajaxRemove);
    fetch(form.action, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      card?.classList.add('leaving');
      setTimeout(() => card?.remove(), 250);
      const undoTo = form.closest('.suggs') && location.search.includes('show=later') ? 'later' : 'new';
      toast(action === 'later' ? 'Saved for later' : 'Won’t suggest it again', () =>
        fetch(form.action, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ action: undoTo }),
        }).then(() => location.reload()),
      );
    }).catch((err) => toast(err.message));
    return;
  }

  const busy = e.submitter?.dataset.busy || form.dataset.busy;
  if (busy && e.submitter) {
    // let the form submit first, then show progress
    setTimeout(() => {
      e.submitter.disabled = true;
      e.submitter.textContent = busy;
    });
  }
});

$('#import-file')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const result = await api('/api/import', JSON.parse(await file.text()));
    alert(`Import done. ${result.blogsAdded} blog(s) added; read states merged.`);
    location.href = '/';
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// --- wait for a running scan ---

const poll = $('[data-poll]');
if (poll) {
  const timer = setInterval(async () => {
    try {
      const status = await api(`/api/blogs/${poll.dataset.poll}/status`);
      if (!status.scanning) {
        clearInterval(timer);
        location.reload();
      } else if (status.total) {
        poll.textContent = `Scanning for posts… ${status.total} found so far.`;
      }
    } catch {
      clearInterval(timer);
    }
  }, 3000);
}

if ($('[data-poll-discover]')) {
  const timer = setInterval(async () => {
    try {
      if (!(await api('/api/discover/status')).running) {
        clearInterval(timer);
        location.reload();
      }
    } catch {
      clearInterval(timer);
    }
  }, 3000);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

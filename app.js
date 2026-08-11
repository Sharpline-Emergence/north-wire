const CATEGORY_LABELS = {
  bc: 'B.C.',
  canada: 'Canada',
  entertainment: 'Entertainment',
  markets: 'Markets',
  medical: 'Medicine',
  politics: 'Politics',
  science: 'Science',
  sports: 'Sports',
  technology: 'Technology',
  travel: 'Travel',
  wellness: 'Wellness',
  world: 'World',
};

const state = {
  articles: [],
  category: 'all',
  generatedAt: null,
};

const feedEl = document.getElementById('feed');
const loadingEl = document.getElementById('loadingState');
const emptyEl = document.getElementById('emptyState');
const chipsEl = document.getElementById('categoryChips');
const chipsFadeEl = document.getElementById('chipsFade');
const lastUpdatedEl = document.getElementById('lastUpdated');
const datelineTodayEl = document.getElementById('datelineToday');
const refreshBtn = document.getElementById('refreshBtn');

function timeAgo(isoString) {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMin = Math.max(0, Math.round((now - then) / 60000));
  if (diffMin < 1) return 'JUST NOW';
  if (diffMin < 60) return `${diffMin}M AGO`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}H AGO`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}D AGO`;
}

function formatDatelineToday() {
  const now = new Date();
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  return now.toLocaleDateString('en-CA', opts).toUpperCase().replace(',', '') + ' · CANADA';
}

const SHARE_ICON = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3v9M6.5 6.5 10 3l3.5 3.5M4 11v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function cardHTML(article, featured = false) {
  const catLabel = CATEGORY_LABELS[article.category] || article.category;
  return `
    <article class="card ${featured ? 'card--featured' : ''}">
      <p class="card-dateline">
        <span class="cat-dot" style="background: var(--cat-${article.category}, var(--steel))"></span>
        ${escapeHTML(article.source)} · ${catLabel.toUpperCase()} · ${timeAgo(article.published)}
      </p>
      <div class="card-head-row">
        <h2 class="card-headline">
          <a href="${escapeAttr(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(article.title)}</a>
        </h2>
        <button class="share-btn" type="button" aria-label="Share this article" data-link="${escapeAttr(article.link)}" data-title="${escapeAttr(article.title)}">${SHARE_ICON}</button>
      </div>
      ${article.summary ? `<p class="card-summary">${escapeHTML(article.summary)}</p>` : ''}
    </article>
  `;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function render() {
  const filtered = state.category === 'all'
    ? state.articles
    : state.articles.filter(a => a.category === state.category);

  if (filtered.length === 0) {
    feedEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  let html = '';
  const groupsHTML = [];

  if (state.category === 'all') {
    // Featured top story, then everything else grouped by category
    const [top, ...rest] = filtered;
    html += cardHTML(top, true);

    const byCategory = {};
    rest.forEach(a => {
      byCategory[a.category] = byCategory[a.category] || [];
      byCategory[a.category].push(a);
    });

    Object.keys(CATEGORY_LABELS).forEach(cat => {
      const items = byCategory[cat];
      if (!items || items.length === 0) return;
      groupsHTML.push(`<p class="section-label">${CATEGORY_LABELS[cat]}</p>`);
      items.forEach(a => groupsHTML.push(cardHTML(a)));
    });
  } else {
    filtered.forEach(a => groupsHTML.push(cardHTML(a)));
  }

  feedEl.innerHTML = html + groupsHTML.join('');
}

function setCategory(cat) {
  state.category = cat;
  [...chipsEl.querySelectorAll('.chip')].forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.category === cat);
  });
  render();
}

// Shows a chevron + fade at the right edge of the category chip row
// whenever there are more chips scrolled out of view, and hides it
// once the user has scrolled all the way to the last chip — so the
// "there's more" cue disappears exactly when it's no longer true.
function updateChipsFade() {
  if (!chipsEl || !chipsFadeEl) return;
  const atEnd = chipsEl.scrollLeft + chipsEl.clientWidth >= chipsEl.scrollWidth - 4;
  chipsFadeEl.classList.toggle('is-hidden', atEnd);
}

async function loadData() {
  loadingEl.hidden = false;
  feedEl.prepend(loadingEl);

  let data = null;
  try {
    const res = await fetch(`articles.json?t=${Date.now()}`);
    if (res.ok) data = await res.json();
  } catch (e) { /* fall through to sample data */ }

  if (!data) {
    try {
      const res = await fetch('sample-data.json');
      data = await res.json();
    } catch (e) {
      loadingEl.querySelector('p').textContent = "Couldn't load the feed. Check your connection.";
      return;
    }
  }

  state.articles = data.articles || [];
  state.generatedAt = data.generated_at || null;

  loadingEl.hidden = true;
  updateFooter();
  render();
}

function updateFooter() {
  if (!state.generatedAt) {
    lastUpdatedEl.textContent = 'Showing sample data — run the pipeline to go live';
    return;
  }
  const d = new Date(state.generatedAt);
  const timeStr = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  lastUpdatedEl.textContent = `Updated ${timeStr} · ${state.articles.length} stories`;
  // Also surface the update time up top, next to the date, so it's visible
  // without scrolling to the footer.
  datelineTodayEl.textContent = `${formatDatelineToday()} · UPDATED ${timeStr}`;
}

chipsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  setCategory(chip.dataset.category);
});

chipsEl.addEventListener('scroll', updateChipsFade);
window.addEventListener('resize', updateChipsFade);

// On iOS, links tapped inside an installed home-screen app don't reliably open
// as a separate Safari tab — standalone PWAs have no browser chrome, so a plain
// target="_blank" link can navigate the app itself away from the feed, with no
// way back. Forcing window.open() launches Safari as a distinct app instead,
// leaving this app untouched in the background so switching back returns
// straight to the feed.
feedEl.addEventListener('click', (e) => {
  const link = e.target.closest('.card-headline a');
  if (!link) return;
  e.preventDefault();
  window.open(link.href, '_blank', 'noopener,noreferrer');
});

refreshBtn.addEventListener('click', () => {
  loadData();
});

async function shareArticle(btn) {
  const url = btn.dataset.link;
  const title = btn.dataset.title;

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch (e) { /* user cancelled — no-op */ }
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    const original = btn.innerHTML;
    btn.innerHTML = CHECK_ICON;
    btn.classList.add('is-copied');
    btn.setAttribute('aria-label', 'Link copied');
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove('is-copied');
      btn.setAttribute('aria-label', 'Share this article');
    }, 1500);
  } catch (e) { /* clipboard unavailable — no-op */ }
}

feedEl.addEventListener('click', (e) => {
  const shareBtn = e.target.closest('.share-btn');
  if (!shareBtn) return;
  e.preventDefault();
  shareArticle(shareBtn);
});

datelineTodayEl.textContent = formatDatelineToday();
updateChipsFade();
loadData();

'use strict';

const DATA = 'data/';

const ABBR = {
  MT: 'Masoretic Text',
  'MT-K': 'Masoretic Text – Ketiv',
  'MT-Q': 'Masoretic Text – Qere',
  LXX: 'Septuagint',
  OG: 'Old Greek',
  VUL: 'Vulgate',
  RSV: 'Revised Standard Version (1952)',
  NIV: 'New International Version (1984)',
  NJPS: 'New Jewish Publication Society Version (1985)',
  NJB: 'New Jerusalem Bible (1985)',
  NRSV: 'New Revised Standard Version (1989)',
  REB: 'Revised English Bible (1989)',
  GNT: 'Good News Translation (1992)',
  CEV: 'Contemporary English Version',
  KJV: 'King James Version',
  ESV: 'English Standard Version',
  BHS: 'Biblia Hebraica Stuttgartensia',
  HOTTP: 'Hebrew Old Testament Text Project',
  ABD: 'Anchor Bible Dictionary',
  AYBD: 'Anchor Yale Bible Dictionary',
  ABYD: 'Anchor Yale Bible Dictionary',
  HALOT: 'Hebrew and Aramaic Lexicon of the Old Testament',
  DCH: 'Dictionary of Classical Hebrew',
  NIDB: "New Interpreter's Dictionary of the Bible",
  FAUNA: 'Ted Hope: All Creatures Great and Small',
  BCE: 'Before Common Era',
  TOB: 'Traduction œcuménique de la Bible',
};

const state = {
  index: null,
  byId: new Map(),
  byLemma: new Map(),
  books: null,
  meta: null,
  domains: {},
  entries: new Map(),
  refs: new Map(),
  alphabet: { h: [], g: [] },
};

const app = document.getElementById('app');
let routeSeq = 0;

/* ---------- utilities ---------- */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

function norm(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[\u05be\u05f3\u05f4\u200e\u200f]/g, '');
}

const PLAIN_TOKEN = /\{([A-Z]):([^}]*)\}/g;

function plainText(value) {
  return String(value || '').replace(PLAIN_TOKEN, (match, kind, body) => {
    if (kind === 'L') return body.split('<')[0];
    if (kind === 'A' || kind === 'D') return body;
    return '';
  });
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' \u2014 ' + url);
  return response.json();
}

function corpusLang(corpus) {
  return corpus === 'h' ? 'he' : 'el';
}

function corpusLabel(corpus) {
  return corpus === 'h' ? 'Biblical Hebrew' : 'New Testament Greek';
}

function bibleURL(name, chapter, verse) {
  const reference = name + ' ' + chapter + (verse ? ':' + verse : '');
  return 'https://www.biblegateway.com/passage/?search=' + encodeURIComponent(reference);
}

/* ---------- theme ---------- */

function initTheme() {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const meta = document.querySelector('meta[name="theme-color"]');

  const sync = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(dark));
    button.title = label;
    if (meta) meta.setAttribute('content', dark ? '#1b1916' : '#faf6ee');
  };

  button.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (error) {}
    sync();
  });

  sync();
}

/* ---------- startup and routing ---------- */

function showError(error) {
  app.innerHTML = '<p class="error">Could not load the dictionary data. ' + esc(error.message) + '</p>';
  console.error(error);
}

async function init() {
  try {
    const [books, meta] = await Promise.all([
      fetchJSON(DATA + 'books.json'),
      fetchJSON(DATA + 'meta.json'),
    ]);
    state.books = books;
    state.meta = meta;
    initTheme();
    window.addEventListener('hashchange', () => route().catch(showError));
    document.addEventListener('click', event => {
      const marker = event.target.closest('button.fn');
      if (!marker) return;
      const note = document.getElementById(marker.dataset.note);
      if (!note) return;
      note.setAttribute('tabindex', '-1');
      note.focus();
    });
    await route();
  } catch (error) {
    showError(error);
  }
}

async function route() {
  const seq = ++routeSeq;
  window.scrollTo(0, 0);
  const hash = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart || '');

  if (parts[0] === 'h' || parts[0] === 'g') {
    if (parts[1]) return viewEntry(parts[0], parts[1], seq);
    return viewSearch(params, seq);
  }
  if (parts[0] === 'domains') {
    return viewDomains(parts[1] === 'g' ? 'g' : 'h', parts[2], seq);
  }
  if (parts[0] === 'about') return viewAbout(seq);
  return viewSearch(params, seq);
}

/* ---------- index and search ---------- */

async function ensureIndex() {
  if (state.index) return state.index;
  const rows = await fetchJSON(DATA + 'search.json');
  const alphabets = { h: new Set(), g: new Set() };

  for (const row of rows) {
    row.n = {
      lemma: row[3],
      alt: ' ' + row[4].split(' ').filter(Boolean).map(norm).join(' ') + ' ',
      gloss: norm(row[6]),
      def: norm(row[7]),
    };
    state.byId.set(row[0], row);
    if (row[3] && !state.byLemma.has(row[3])) state.byLemma.set(row[3], row);
    for (const alt of row[4].split(' ')) {
      if (!alt) continue;
      const key = norm(alt);
      if (key && !state.byLemma.has(key)) state.byLemma.set(key, row);
    }
    const first = row[3][0];
    if (first) alphabets[row[1]].add(first);
  }

  state.index = rows;
  state.alphabet.h = [...alphabets.h].sort((a, b) => a.localeCompare(b, 'he'));
  state.alphabet.g = [...alphabets.g].sort((a, b) => a.localeCompare(b, 'el'));
  return rows;
}

function searchRows(query, corpus) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const nq = norm(trimmed);
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  const maybeStrong = /^[hag]?\d{2,4}$/i.test(trimmed.replace(/\s/g, ''));
  const scored = [];

  for (const row of state.index) {
    if (corpus !== 'all' && row[1] !== corpus) continue;
    let score = 0;

    if (maybeStrong && digits) {
      for (const code of row[5].split(' ')) {
        const codeDigits = code.replace(/\D/g, '').replace(/^0+/, '');
        if (codeDigits === digits || codeDigits.startsWith(digits)) {
          score = 95;
          break;
        }
      }
    }

    if (!score) {
      if (row.n.lemma === nq) score = 100;
      else if (row.n.lemma.startsWith(nq)) score = 80;
      else if (row.n.alt.includes(' ' + nq + ' ')) score = 70;
      else if (row.n.gloss.includes(nq)) score = 50;
      else if (row.n.def.includes(nq)) score = 25;
    }

    if (score) scored.push([score, row]);
  }

  scored.sort((a, b) => b[0] - a[0]);
  return scored.map(pair => pair[1]);
}

function renderResult(row) {
  const gloss = row[6] ? row[6].split(' \u00b7 ').slice(0, 6).join(' \u00b7 ') : '';
  const strong = row[5].split(' ').filter(Boolean).slice(0, 2).join(' \u00b7 ');
  return '<a class="result" href="#/' + row[1] + '/' + row[0] + '">' +
    '<span class="result-lemma" lang="' + corpusLang(row[1]) + '">' + esc(row[2]) + '</span>' +
    '<span class="result-gloss">' + esc(gloss) + '</span>' +
    '<span class="result-meta">' + esc(strong) + '</span>' +
    '</a>';
}

function chip(value, label, current) {
  const active = value === current;
  return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-c="' + value +
    '" aria-pressed="' + active + '">' + label + '</button>';
}

function browsePanel() {
  const groups = ['h', 'g'].map(corpus => {
    const letters = state.alphabet[corpus].map(letter =>
      '<a class="letter" lang="' + corpusLang(corpus) + '" href="#/search?q=' +
      encodeURIComponent(letter) + '&c=' + corpus + '">' + esc(letter) + '</a>').join('');
    const info = state.meta.corpora[corpus];
    return '<div class="alphabet"><h2>' + corpusLabel(corpus) + '</h2>' +
      '<div class="letters">' + letters + '</div>' +
      '<p class="muted">' + info.entries.toLocaleString() + ' entries \u00b7 ' +
      '<a href="#/domains/' + corpus + '">browse semantic domains</a></p></div>';
  }).join('');

  return '<div class="browse">' + groups +
    '<p class="hint muted">Search accepts pointed Hebrew, accented Greek, English glosses, and Strong\u2019s numbers (H1119, A0004, G0101).</p></div>';
}

async function viewSearch(params, seq) {
  document.title = 'UBS Biblical Dictionary';
  app.innerHTML = '<p class="muted">Loading\u2026</p>';
  await ensureIndex();
  if (seq !== routeSeq) return;

  const query = params.get('q') || '';
  const corpus = ['h', 'g'].includes(params.get('c')) ? params.get('c') : 'all';

  app.innerHTML = '<section class="search">' +
    '<form class="search-form" role="search" id="search-form">' +
    '<label class="sr-only" for="q">Search the dictionary</label>' +
    '<input id="q" name="q" type="search" autocomplete="off" spellcheck="false" ' +
    'placeholder="Lemma, gloss, or Strong\u2019s number \u2014 e.g. H1119" value="' + esc(query) + '">' +
    '</form>' +
    '<div class="chips" id="corpus-chips" role="group" aria-label="Dictionary">' +
    chip('all', 'Both', corpus) + chip('h', 'Hebrew', corpus) + chip('g', 'Greek', corpus) +
    '</div>' +
    '<p class="muted" id="count" aria-live="polite"></p>' +
    '<div id="results"></div>' +
    '</section>';

  const input = document.getElementById('q');
  const results = document.getElementById('results');
  const count = document.getElementById('count');

  const update = () => {
    if (!input.value.trim()) {
      count.textContent = '';
      results.innerHTML = browsePanel();
      return;
    }
    const rows = searchRows(input.value, corpus);
    const shown = rows.slice(0, 100);
    count.textContent = rows.length
      ? 'Showing ' + shown.length + ' of ' + rows.length + ' matches'
      : 'No matches';
    results.innerHTML = shown.length
      ? shown.map(renderResult).join('')
      : '<p class="empty">No matches. Try a shorter form, an English gloss, or a Strong\u2019s number.</p>';
  };

  input.addEventListener('input', () => {
    history.replaceState(null, '', '#/search?q=' + encodeURIComponent(input.value) + '&c=' + corpus);
    update();
  });

  document.getElementById('corpus-chips').addEventListener('click', event => {
    const button = event.target.closest('button[data-c]');
    if (!button) return;
    location.hash = '#/search?q=' + encodeURIComponent(input.value) + '&c=' + button.dataset.c;
  });

  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  update();
}

/* ---------- entry view ---------- */

async function getEntry(corpus, id) {
  const key = corpus + id;
  if (!state.entries.has(key)) {
    const promise = fetchJSON(DATA + corpus + '/entries/' + id + '.json').catch(error => {
      state.entries.delete(key);
      throw error;
    });
    state.entries.set(key, promise);
  }
  return state.entries.get(key);
}

function groupRefs(refs) {
  const books = new Map();
  for (const ref of refs) {
    const book = Number(ref.slice(0, 3));
    const chapter = Number(ref.slice(3, 6));
    const verse = Number(ref.slice(6, 9));
    if (!books.has(book)) books.set(book, new Map());
    const verses = books.get(book);
    const key = chapter + ':' + verse;
    if (!verses.has(key)) verses.set(key, { chapter, verse });
  }
  return books;
}

function renderOccurrences(books) {
  const parts = [];
  const sorted = [...books.entries()].sort((a, b) => a[0] - b[0]);
  for (const [number, verses] of sorted) {
    const meta = state.books[number - 1];
    const name = meta ? meta[1] : 'Book ' + number;
    const links = [...verses.values()]
      .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
      .map(v => '<a href="' + bibleURL(name, v.chapter, v.verse) + '" target="_blank" rel="noopener">' +
        v.chapter + (v.verse ? ':' + v.verse : '') + '</a>')
      .join(' ');
    parts.push('<details><summary>' + esc(name) + ' <span class="count">' + verses.size +
      '</span></summary><div class="verses">' + links + '</div></details>');
  }
  return '<div class="books">' + parts.join('') + '</div>';
}

function renderText(text, corpus, notes) {
  if (!text) return '';
  const token = /\{([A-Z]):([^}]*)\}/g;
  let out = '';
  let last = 0;

  for (const match of text.matchAll(token)) {
    out += esc(text.slice(last, match.index));
    last = match.index + match[0].length;
    const kind = match[1];
    const body = match[2];

    if (kind === 'L') {
      const split = body.lastIndexOf('<');
      if (split < 0) {
        out += esc(body);
        continue;
      }
      const label = body.slice(0, split);
      const target = body.slice(split + 1).replace(/>$/, '');
      const lemma = target.split(':')[1] || '';
      const row = state.byLemma.get(norm(lemma));
      out += row
        ? '<a href="#/' + row[1] + '/' + row[0] + '">' + esc(label) + '</a>'
        : esc(label);
    } else if (kind === 'S') {
      out += refLink(body.slice(0, 9));
    } else if (kind === 'N') {
      const caller = parseInt(body.replace(/\D/g, ''), 10);
      const note = notes ? notes.get(caller) : null;
      out += '<button type="button" class="fn" data-note="note-' + caller +
        '" title="' + esc(note ? plainText(note) : '') + '">[' + caller + ']</button>';
    } else if (kind === 'A') {
      const title = Object.prototype.hasOwnProperty.call(ABBR, body) ? ABBR[body] : null;
      out += title
        ? '<abbr title="' + esc(title) + '">' + esc(body) + '</abbr>'
        : esc(body);
    } else if (kind === 'D') {
      out += '<span class="ln">' + esc(body) + '</span>';
    } else {
      out += esc(match[0]);
    }
  }

  out += esc(text.slice(last));
  return out;
}

function refLink(ref) {
  if (!/^\d{9}$/.test(ref)) return '';
  const book = Number(ref.slice(0, 3));
  const chapter = Number(ref.slice(3, 6));
  const verse = Number(ref.slice(6, 9));
  const meta = state.books[book - 1];
  if (!meta || !chapter) return '';
  return '<a class="xref" target="_blank" rel="noopener" href="' + bibleURL(meta[1], chapter, verse) + '">' +
    meta[0] + ' ' + chapter + (verse ? ':' + verse : '') + '</a>';
}

function domainChip(code, label, corpus) {
  return '<a class="domain" href="#/domains/' + corpus + '/' + encodeURIComponent(code) + '">' +
    esc(label || code) + '</a>';
}

function relationLink(word, corpus) {
  const row = state.byLemma.get(norm(word));
  if (!row) return '<span lang="' + corpusLang(corpus) + '">' + esc(word) + '</span>';
  return '<a lang="' + corpusLang(row[1]) + '" href="#/' + row[1] + '/' + row[0] + '">' + esc(word) + '</a>';
}

function renderMeaning(meaning, number, corpus, notes) {
  const out = ['<article class="meaning">'];
  out.push('<h2><span class="num">' + number + '</span>');
  if (meaning.pos) out.push('<span class="pos">' + esc(meaning.pos) + '</span>');
  if (meaning.code) out.push('<span class="badge ghost" title="Reference code">' + esc(meaning.code) + '</span>');
  out.push('</h2>');

  if (meaning.glosses.length) {
    out.push('<p class="glosses">' + meaning.glosses.map(g =>
      '<span class="gloss-pill">' + esc(g) + '</span>').join(' ') + '</p>');
  }
  if (meaning.def) out.push('<p class="def">' + renderText(meaning.def, corpus, notes) + '</p>');
  if (meaning.defLong) out.push('<p class="def">' + renderText(meaning.defLong, corpus, notes) + '</p>');
  if (meaning.comments) out.push('<p class="comments">' + renderText(meaning.comments, corpus, notes) + '</p>');

  const domains = meaning.domains.map(pair => domainChip(pair[0], pair[1], corpus))
    .concat(meaning.subdomains.map(pair => domainChip(pair[0], pair[1], corpus)));
  if (domains.length) out.push('<p class="domains">' + domains.join(' ') + '</p>');

  const relations = [];
  if (meaning.synonyms.length) {
    relations.push('<span class="label">Synonyms</span> ' +
      meaning.synonyms.map(word => relationLink(word, corpus)).join(', '));
  }
  if (meaning.antonyms.length) {
    relations.push('<span class="label">Antonyms</span> ' +
      meaning.antonyms.map(word => relationLink(word, corpus)).join(', '));
  }
  if (relations.length) out.push('<p class="relations">' + relations.join(' \u00b7 ') + '</p>');

  if (meaning.refs.length) {
    const books = groupRefs(meaning.refs);
    let verses = 0;
    for (const set of books.values()) verses += set.size;
    state.refs.set(meaning.id, books);
    out.push('<details class="occ" data-meaning="' + esc(meaning.id) + '"><summary>Occurrences ' +
      '<span class="count">' + meaning.refs.length + '</span><span class="muted"> in ' + verses +
      (verses === 1 ? ' verse' : ' verses') + '</span></summary><div class="occ-body"></div></details>');
  }

  out.push('</article>');
  return out.join('');
}

function renderNotes(notes, corpus, noteMap) {
  return '<section class="notes"><h2>Notes</h2><ol>' + notes.map(note => {
    const refs = (note.refs || []).map(ref => {
      const book = Number(ref.slice(0, 3));
      const chapter = Number(ref.slice(3, 6));
      const verse = Number(ref.slice(6, 9));
      const meta = state.books[book - 1];
      if (!meta) return '';
      return '<a href="' + bibleURL(meta[1], chapter, verse) + '" target="_blank" rel="noopener">' +
        esc(meta[1]) + ' ' + chapter + (verse ? ':' + verse : '') + '</a>';
    }).filter(Boolean).join(', ');
    return '<li id="note-' + note.caller + '"><span class="caller">[' + note.caller + ']</span>' +
      (refs ? ' <span class="muted">' + refs + '</span>' : '') + ' ' +
      renderText(note.content, corpus, noteMap) + '</li>';
  }).join('') + '</ol></section>';
}

async function viewEntry(corpus, id, seq) {
  app.innerHTML = '<p class="muted">Loading\u2026</p>';
  await ensureIndex();

  let entry;
  try {
    entry = await getEntry(corpus, id);
  } catch (error) {
    if (seq === routeSeq) {
      app.innerHTML = '<p class="error">Entry not found. <a href="#/search?c=' + corpus +
        '">Back to search</a>.</p>';
    }
    return;
  }
  if (seq !== routeSeq) return;

  const lang = corpusLang(corpus);
  state.refs = new Map();
  const noteMap = new Map(entry.notes.map(note => [note.caller, note.content]));
  const pieces = [];

  pieces.push('<p class="crumbs"><a href="#/search?c=' + corpus + '">\u2190 ' +
    corpusLabel(corpus) + '</a></p>');
  pieces.push('<header class="entry-head">');
  pieces.push('<h1 lang="' + lang + '">' + esc(entry.lemma) + '</h1>');
  if (entry.alt.length) {
    pieces.push('<p class="alt">Also ' + entry.alt.map(alt =>
      '<span lang="' + lang + '">' + esc(alt) + '</span>').join(', ') + '</p>');
  }
  pieces.push('<p class="badges">');
  for (const code of entry.strong) pieces.push('<span class="badge" title="Strong\u2019s number">' + esc(code) + '</span>');
  pieces.push('<span class="badge ghost" title="Dictionary entry ID">' + esc(entry.id) + '</span>');
  pieces.push('</p></header>');

  entry.meanings.forEach((meaning, index) => {
    pieces.push(renderMeaning(meaning, index + 1, corpus, noteMap));
  });
  if (entry.notes.length) pieces.push(renderNotes(entry.notes, corpus, noteMap));

  document.title = entry.lemma + ' \u2014 UBS Biblical Dictionary';
  app.innerHTML = pieces.join('');

  app.querySelectorAll('details.occ[data-meaning]').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = '1';
      details.querySelector('.occ-body').innerHTML = renderOccurrences(state.refs.get(details.dataset.meaning));
    });
  });
}

/* ---------- domains ---------- */

async function loadDomains(corpus) {
  if (state.domains[corpus]) return state.domains[corpus];
  const [list, map] = await Promise.all([
    fetchJSON(DATA + corpus + '/domains.json'),
    fetchJSON(DATA + corpus + '/domain-entries.json'),
  ]);
  const byCode = new Map(list.map(node => [node.code, node]));
  const children = new Map();
  for (const node of list) {
    if (node.parent && byCode.has(node.parent)) {
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(node);
    }
  }
  for (const kids of children.values()) kids.sort((a, b) => a.label.localeCompare(b.label));
  state.domains[corpus] = { list, map, byCode, children };
  return state.domains[corpus];
}

function domainIds(corpus, code) {
  const ids = new Set();
  for (const [key, values] of Object.entries(state.domains[corpus].map)) {
    if (key === code || key.startsWith(code)) {
      for (const id of values) ids.add(id);
    }
  }
  return ids;
}

async function viewDomains(corpus, code, seq) {
  document.title = 'Semantic domains \u2014 UBS Biblical Dictionary';
  app.innerHTML = '<p class="muted">Loading\u2026</p>';
  await Promise.all([ensureIndex(), loadDomains(corpus)]);
  if (seq !== routeSeq) return;

  const data = state.domains[corpus];
  const label = corpusLabel(corpus);

  if (!code) {
    const tops = data.list.filter(node => !node.parent || !data.byCode.has(node.parent));
    app.innerHTML = '<h1>' + label + ' semantic domains</h1>' +
      '<p class="muted">Browse the ' + data.list.length + ' domains used by the dictionary. ' +
      'Open a domain to see subdomains and entries.</p>' +
      '<ul class="domain-list">' + tops.map(node =>
        '<li><a href="#/domains/' + corpus + '/' + node.code + '">' + esc(node.label) + '</a>' +
        '<span class="muted"> ' + domainIds(corpus, node.code).size + ' entries</span></li>').join('') +
      '</ul>';
    return;
  }

  const node = data.byCode.get(code);
  if (!node) {
    app.innerHTML = '<p class="error">Unknown domain. <a href="#/domains/' + corpus +
      '">All domains</a>.</p>';
    return;
  }

  const chain = [];
  for (let current = node; current; current = current.parent ? data.byCode.get(current.parent) : null) {
    chain.unshift(current);
  }
  const crumbs = ['<a href="#/domains/' + corpus + '">Domains</a>']
    .concat(chain.map(item => '<span>' + esc(item.label) + '</span>')).join(' / ');

  const kids = data.children.get(code) || [];
  const rows = [...domainIds(corpus, code)].map(id => state.byId.get(id)).filter(Boolean)
    .sort((a, b) => a[2].localeCompare(b[2], corpusLang(corpus)));
  const shown = rows.slice(0, 500);

  const pieces = [];
  pieces.push('<p class="crumbs">' + crumbs + '</p>');
  pieces.push('<h1>' + esc(node.label) + '</h1>');
  if (node.desc) pieces.push('<p class="domain-desc">' + esc(node.desc) + '</p>');
  if (kids.length) {
    pieces.push('<h2>Subdomains</h2><ul class="domain-list">' + kids.map(kid =>
      '<li><a href="#/domains/' + corpus + '/' + kid.code + '">' + esc(kid.label) + '</a>' +
      '<span class="muted"> ' + domainIds(corpus, kid.code).size + ' entries</span></li>').join('') + '</ul>');
  }
  pieces.push('<h2>Entries <span class="count">' + rows.length + '</span></h2>');
  pieces.push(shown.length
    ? '<div class="results">' + shown.map(renderResult).join('') + '</div>'
    : '<p class="muted">No entries in this domain.</p>');
  if (rows.length > shown.length) {
    pieces.push('<p class="muted">Showing the first ' + shown.length + ' entries.</p>');
  }
  app.innerHTML = pieces.join('');
}

/* ---------- about ---------- */

async function viewAbout(seq) {
  if (seq !== routeSeq) return;
  document.title = 'About \u2014 UBS Biblical Dictionary';
  const corpora = Object.entries(state.meta.corpora).map(([key, value]) =>
    '<li><strong>' + esc(value.label) + '</strong> (' + esc(value.version) + ') \u2014 ' +
    value.entries.toLocaleString() + ' entries, ' + value.meanings.toLocaleString() + ' meanings, ' +
    value.refs.toLocaleString() + ' references.<br><code>' + esc(value.source) + '</code></li>').join('');

  app.innerHTML = '<h1>About</h1>' +
    '<p>' + esc(state.meta.attribution) + '</p>' +
    '<p>This site is a static, read-only browser for the ' +
    '<a href="https://github.com/ubsicap/ubs-open-license" rel="noopener" target="_blank">UBS open-license data repository</a>. ' +
    'It contains English definitions only; the source repository also publishes French, Spanish, Portuguese, and Chinese localizations.</p>' +
    '<h2>Sources</h2><ul>' + corpora + '</ul>' +
    '<h2>Licence</h2><p>Dictionary content is licensed under ' +
    '<a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener" target="_blank">CC BY-SA 4.0</a>. ' +
    'Derived data files on this site are shared under the same licence. Occurrence links point to BibleGateway; ' +
    'this site does not host Bible text.</p>' +
    '<p class="muted">Generated ' + esc(state.meta.generated) + '.</p>';
}

init();

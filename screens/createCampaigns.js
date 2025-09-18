// screens/createCampaigns.js
import {
  getAllStudents,
  uniqueFieldsFromStudents,
  applyFilters,
  getStudentId,
  saveCampaign,
  toISODate
} from '../data/campaignsData.js';

export function CreateCampaign(root) {
  root.innerHTML = '';
  const page = document.createElement('div');

  // state
  let name = '';
  let filters = [];
  let step = 'filters'; // 'filters' | 'question' | 'dates'
  let selectedDates = [];
  let field = '';
  let op = '=';
  let value = '';
  let collectResponses = true;
  let questionText = 'Are you attending the event?';
  let options = ['Yes', 'No', 'Maybe'];

  let students = [];
  let fields = [];
  let valuesByField = new Map();

  (async () => {
    try {
      students = await getAllStudents();
      fields = uniqueFieldsFromStudents(students);
      field = fields[0] || '';
      valuesByField = buildValuesByField(students, fields);
      render();
    } catch (e) {
      page.innerHTML = `<div class="center"><div class="muted">Failed to load students.json</div></div>`;
      root.appendChild(page);
    }
  })();

  function render() {
    page.innerHTML = '';

    if (step === 'filters') {
      page.append(
        h1('Create Campaign'),
        label('Campaign name'),
        input({ placeholder: 'Fall Outreach Week 1', value: name, oninput: e => (name = e.target.value) }),
        div('sectionTitle', 'Filters'),
        row(
          select(fields.length ? fields : ['(loading…)'], field, v => {
            field = v;
            // when field changes, refresh suggestions for that field
            if (suggestInpEl) { suggestInpEl.value = ''; value = ''; }
            showSuggest();
            // update match count live
            renderMatchCountOnly();
          }),
          select(['=', '~', '>', '>=', '<', '<='], op, v => {
            op = v;
            showSuggest();
            renderMatchCountOnly();
          })
        ),
        valueWithSuggestions(),
        chips(filters.map((f, i) =>
          chip(`${f.field} ${f.op} ${f.value}`, () => { filters.splice(i, 1); render(); })
        )),
        status(`${applyFilters(students, filters).length} match${applyFilters(students, filters).length === 1 ? '' : 'es'}`),
        btn('Next: Optional call question', 'btn btn-primary', () => {
          if (!name.trim()) return;
          step = 'question';
          render();
        })
      );
    } else if (step === 'question') {
      page.append(
        h1('Create Campaign'),
        div('sectionTitle', 'Optional: Add a call question'),
        p('Collect lightweight call outcomes (e.g., “Yes / No / Maybe”). You can skip this if you don’t need to capture responses.', 'muted'),
        row(
          pillToggle('Collect responses', collectResponses, () => { collectResponses = true; render(); }),
          pillToggle('Skip', !collectResponses, () => { collectResponses = false; render(); })
        ),
        label('Question to ask'),
        input({ value: questionText, disabled: !collectResponses, oninput: e => (questionText = e.target.value) }),
        div('sectionTitle', 'Answer options'),
        chips(options.map(opt => optChip(opt, () => { options = options.filter(o => o !== opt); render(); }, collectResponses))),
        collectResponses
          ? (() => {
              const addRow = row();
              const addInp = input({
                id: 'addOpt',
                placeholder: "Add another option (e.g., 'Left voicemail')",
                onkeydown: e => {
                  if (e.key === 'Enter') { addOption(e.target.value); e.target.value = ''; }
                }
              });
              const addBtn = btn('Add', 'btn', () => { addOption(addInp.value); addInp.value = ''; });
              addRow.append(addInp, addBtn);
              return addRow;
            })()
          : null,
        btn('Next: Select reminder dates', 'btn btn-primary', () => {
          if (collectResponses && !questionText.trim()) return;
          step = 'dates';
          render();
        }),
        btn('Back to filters', 'btn btn-ghost', () => { step = 'filters'; render(); })
      );
    } else {
      page.append(
        h1('Create Campaign'),
        div('sectionTitle', 'Select call reminder dates'),
        miniCalendar(2, selectedDates, iso => {
          const has = selectedDates.includes(iso);
          selectedDates = has ? selectedDates.filter(d => d !== iso) : [...selectedDates, iso];
          render();
        }),
        wrap(selectedDates.sort().map(d => pill(d))),
        btn('Save Campaign', 'btn btn-primary', async () => {
          if (!selectedDates.length) return;
          const matched = applyFilters(students, filters);
          const studentIds = matched.map((s, i) => getStudentId(s, i));
          const reminders = studentIds.map(id => ({ contactId: id, dates: selectedDates.slice().sort() }));

          const now = Date.now();
          const payload = {
            id: String(now),
            name: name.trim() || `Campaign ${new Date().toLocaleDateString()}`,
            createdAt: now,
            filters,
            studentIds,
            reminders
          };
          if (collectResponses) {
            payload.survey = { question: questionText.trim(), options: options.slice(), createdAt: now, updatedAt: now, active: true };
          }
          await saveCampaign(payload);
          location.hash = '#/dashboard';
        }),
        btn('Back', 'btn btn-ghost', () => { step = 'question'; render(); })
      );
    }

    root.appendChild(page);
  }

  function renderMatchCountOnly() {
    // cheap way: update the last .muted status node if present
    const m = page.querySelector('.muted');
    if (!m) return;
    m.textContent = `${applyFilters(students, filters).length} match${applyFilters(students, filters).length === 1 ? '' : 'es'}`;
  }

  function addOption(v) {
    const clean = String(v || '').trim();
    if (!clean) return;
    if (!options.includes(clean)) options.push(clean);
    render();
  }

  /* ----- Suggestions (live, with keyboard) ----- */
  let suggestEl = null;
  let suggestInpEl = null;
  let currentItems = [];       // current suggestion list
  let activeIndex = -1;        // keyboard-highlighted index

  function valueWithSuggestions() {
    const wrapDiv = div('suggest-host');

    // input + add button row
    const inp = input({
      placeholder: 'value',
      value: value,
      oninput: e => {
        value = e.target.value;
        buildAndShowSuggestions();
        renderMatchCountOnly();
      },
      onfocus: () => buildAndShowSuggestions(),
      onblur: () => setTimeout(hideSuggest, 120),
      onkeydown: onSuggestKeyDown
    });
    suggestInpEl = inp;
    inp.style.flex = '1';

    const add = btn('Add', 'btn', () => {
      if (!field || !op || !String(value).trim()) return;
      filters.push({ field, op, value });
      value = '';
      activeIndex = -1;
      hideSuggest();
      render();
    });

    const rowEl = row(inp, add);
    rowEl.style.marginBottom = '8px';
    wrapDiv.append(rowEl);

    // suggestion container
    const sug = div('suggestWrap', suggestCard([]));
    suggestEl = sug;
    wrapDiv.append(sug);

    // initial fill
    buildAndShowSuggestions();

    return wrapDiv;
  }

  function onSuggestKeyDown(e) {
    if (!currentItems || !currentItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentItems.length;
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
      paintActive();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (activeIndex >= 0 && activeIndex < currentItems.length) {
        e.preventDefault();
        value = currentItems[activeIndex];
        hideSuggest();
        // If Enter, auto-add when op is '=' or '~' (common cases); Tab just fills
        if (e.key === 'Enter' && (op === '=' || op === '~')) {
          filters.push({ field, op, value });
          value = '';
          activeIndex = -1;
          render();
        } else {
          if (suggestInpEl) suggestInpEl.value = value;
        }
      }
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  }

  function buildAndShowSuggestions() {
    if (!suggestEl) return;
    const pool = valuesByField.get(field) || [];
    const term = String(value || '').trim().toLowerCase();

    // Filter + rank
    let items = term
      ? pool.filter(v => v.toLowerCase().includes(term))
      : pool.slice();

    // limit + keep stable order
    items = items.slice(0, 50);
    currentItems = items;
    activeIndex = items.length ? 0 : -1;

    suggestEl.innerHTML = '';
    suggestEl.append(suggestCard(items));
    paintActive();
  }

  function showSuggest() {
    // noop here—buildAndShow handles it
    buildAndShowSuggestions();
  }

  function hideSuggest() {
    if (suggestEl) suggestEl.innerHTML = '';
    currentItems = [];
    activeIndex = -1;
  }

  function paintActive() {
    const nodes = suggestEl ? suggestEl.querySelectorAll('.suggestItem') : [];
    nodes.forEach((n, i) => {
      n.classList.toggle('active', i === activeIndex);
    });
    // auto-scroll active into view
    const active = suggestEl && suggestEl.querySelector('.suggestItem.active');
    const scroller = suggestEl && suggestEl.querySelector('.suggestScroll');
    if (active && scroller) {
      const aTop = active.offsetTop;
      const aBottom = aTop + active.offsetHeight;
      const vTop = scroller.scrollTop;
      const vBottom = vTop + scroller.clientHeight;
      if (aTop < vTop) scroller.scrollTop = aTop;
      else if (aBottom > vBottom) scroller.scrollTop = aBottom - scroller.clientHeight;
    }
  }

  function suggestCard(items = []) {
    const card = div('suggestCard');
    const scroller = document.createElement('div');
    scroller.className = 'suggestScroll';
    scroller.style.maxHeight = '240px';
    scroller.style.overflow = 'auto';

    if (!items.length) scroller.append(div('suggestEmpty', 'No suggestions'));

    items.forEach((val, idx) => {
      const it = div('suggestItem', val);
      it.setAttribute('role', 'option');
      it.onclick = () => {
        value = val;
        if (suggestInpEl) suggestInpEl.value = val;
        hideSuggest();
        // auto-add for '=' and '~' for speed; else just fill
        if (op === '=' || op === '~') {
          filters.push({ field, op, value });
          value = '';
          render();
        } else {
          renderMatchCountOnly();
        }
      };
      it.onmouseenter = () => { activeIndex = idx; paintActive(); };
      scroller.append(it);
    });

    card.append(scroller);
    return card;
  }

  /* ----- utils ----- */
  function buildValuesByField(rows, fields) {
    const tmp = new Map(); fields.forEach(f => tmp.set(f, new Set()));
    for (const r of rows) for (const f of fields) if (Object.prototype.hasOwnProperty.call(r, f)) {
      const v = r[f];
      if (v !== undefined && v !== null) {
        const s = String(v).trim();
        if (s) tmp.get(f).add(s);
      }
    }
    const out = new Map();
    for (const f of fields) out.set(f, Array.from(tmp.get(f)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    return out;
  }

  function status(text) { const n = document.createElement('div'); n.className = 'muted'; n.style.margin = '6px 0 2px'; n.textContent = text; return n; }

  function h1(t) { const n = document.createElement('h1'); n.className = 'title'; n.textContent = t; return n; }
  function p(t, cls) { const n = document.createElement('p'); if (cls) n.className = cls; n.textContent = t; return n; }
  function label(t) { const n = document.createElement('div'); n.className = 'label'; n.textContent = t; return n; }
  function input(props = {}) { const n = document.createElement('input'); n.className = 'input'; Object.assign(n, props); return n; }
  function select(opts, val, on) {
    const s = document.createElement('select');
    s.className = 'input';
    for (const o of opts) {
      const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === val) op.selected = true; s.append(op);
    }
    s.onchange = e => on(e.target.value);
    s.style.width = '200px';
    return s;
  }
  function row(...kids) { const d = document.createElement('div'); d.className = 'row'; kids.forEach(k => k && d.append(k)); return d; }
  function div(cls, ...kids) { const d = document.createElement('div'); d.className = cls; kids.forEach(k => k && d.append(k)); return d; }
  function btn(text, cls, on) { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = on; return b; }
  function chips(children) { return div('chips', ...children); }
  function chip(text, onX) { const c = div('chip', text); const x = document.createElement('span'); x.className = 'x'; x.textContent = '×'; if (onX) x.onclick = onX; c.append(x); return c; }
  function wrap(arr) { return div('chips', ...arr); }
  function pill(text) { return chip(text, null); }
  function optChip(label, onX, enabled = true) { const c = chip(label, enabled ? onX : null); if (!enabled) c.style.opacity = .5; return c; }
  function pillToggle(text, active, on) { const b = btn(text, 'btn ' + (active ? 'btn-primary' : ''), on); b.style.borderRadius = '999px'; return b; }

  /* --- calendar --- */
  function miniCalendar(months, selected, onToggle) {
    const today = new Date();
    const block = document.createElement('div');
    for (let m = 0; m < months; m++) {
      const d0 = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const month = d0.getMonth();
      const days = [];
      const padStart = (d0.getDay() + 6) % 7;
      for (let i = 0; i < padStart; i++) days.push(null);
      const iter = new Date(d0);
      while (iter.getMonth() === month) { days.push(new Date(iter)); iter.setDate(iter.getDate() + 1); }

      const header = div('calHeader', ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(t => {
        const s = document.createElement('div'); s.className = 'calHeadCell'; s.textContent = t; return s;
      }));
      const grid = div('calGrid', ...days.map(d => {
        if (!d) { const p = document.createElement('div'); p.className = 'calCell'; p.style.visibility = 'hidden'; return p; }
        const iso = toISODate(d);
        const cell = document.createElement('div');
        cell.className = 'calCell' + (selected.includes(iso) ? ' sel' : '');
        cell.textContent = String(d.getDate());
        cell.onclick = () => onToggle(iso);
        return cell;
      }));
      const blk = div('calBlock', div('calTitle', d0.toLocaleString(undefined, { month: 'long', year: 'numeric' })), header, grid);
      block.append(blk);
    }
    return block;
  }
}

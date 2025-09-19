// screens/Call.js
import { getAllStudents, getStudentId } from '../data/campaignsData.js';
import { recordSingleCall } from '../data/singleCallProgress.js';

export async function Call(root) {
  root.innerHTML = '';
  const page = div('');

  // ---------- state ----------
  let students = [];
  let index = [];         // [{ id, full_name, ref }]
  let selected = null;    // { id, full_name, ref }
  let caller = '';        // 'Karla' | 'Aracely' | 'Darian'
  let notes = '';
  let query = '';

  const toast = makeToast();

  // ---------- boot ----------
  try {
    students = await getAllStudents();
    index = students.map((s, i) => {
      const id = getStudentId(s, i);
      return { id, full_name: deriveFullName(s), ref: s };
    });
  } catch (e) {
    page.append(errorBox(e));
    root.append(page);
    return;
  }

  // ---------- UI ----------
  const header = div('callHeader',
    h1('Call Anyone'),
    ptext('Search students by full name, then log your call.', 'muted')
  );

  // CreateCampaign-style suggest host
  const searchHost = div('suggest-host');
  const searchRow = div('row');
  const searchInput = input({
    placeholder: 'Search by full name…',
    oninput: (e) => { query = e.target.value; showSuggest(); },
    onfocus: () => showSuggest(),
    onblur: () => setTimeout(hideSuggest, 120),
  });
  searchInput.className = 'input';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  searchInput.style.flex = '1';
  searchRow.append(searchInput);

  const suggestWrap = div('suggestWrap');  // container for suggestion card
  searchHost.append(searchRow, suggestWrap);

  // call pane appears once a student is selected
  const callPane = div('callPane');

  // initial paint
  page.append(header, searchHost, callPane);
  root.append(page);
  root.append(toast.node);

  // ---------- suggestion logic (CreateCampaign-like) ----------
  function showSuggest() {
    const items = filterByName(index, query).slice(0, 50);
    suggestWrap.innerHTML = '';
    suggestWrap.append(suggestCard(items));
  }
  function hideSuggest() {
    suggestWrap.innerHTML = '';
  }
  function suggestCard(items = []) {
    const card = div('suggestCard');
    const scroller = div('');
    scroller.style.maxHeight = '240px';
    scroller.style.overflow = 'auto';

    if (!query) {
      scroller.append(div('suggestEmpty', 'Start typing to search by name'));
    } else if (!items.length) {
      scroller.append(div('suggestEmpty', 'No matches'));
    } else {
      for (const m of items) {
        const it = div('suggestItem', highlight(m.full_name, query));
        it.onclick = () => {
          pickStudent(m);
          hideSuggest();
          searchInput.value = m.full_name;
        };
        scroller.append(it);
      }
    }

    card.append(scroller);
    return card;
  }

  function pickStudent(m) {
    selected = m;
    caller = '';
    notes = '';
    renderCallPane();
  }

  // ---------- call pane ----------
  function renderCallPane() {
    callPane.innerHTML = '';
    if (!selected) return;

    const stu = selected.ref || {};
    const phone =
      stu['Mobile Phone*'] ??
      stu['Mobile Number*'] ??
      stu.mobile ??
      stu.phone_number ??
      stu.phone ??
      '';

    // centered + bold full name
    const nameEl = h1(selected.full_name);
    nameEl.style.textAlign = 'center';
    nameEl.style.fontWeight = '800';

    // centered + green phone button
    const phoneEl = phone ? callButton(phone) : disabledBtn('No phone number');
    phoneEl.style.display = 'inline-block';
    phoneEl.style.fontWeight = '800';
    phoneEl.style.color = '#16a34a';
    phoneEl.style.textAlign = 'center';
    const phoneWrap = div('', { textAlign: 'center', marginTop: '6px', marginBottom: '10px' });
    phoneWrap.append(phoneEl);

    // optional: student details like execution page
    const detailsCard = details(stu);

    // caller dropdown
    const whoRow = div('kv');
    whoRow.append(div('k', 'Your name'));
    const whoV = div('v');
    const sel = document.createElement('select');
    sel.className = 'input';
    ['', 'Karla', 'Aracely', 'Darian'].forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt || 'Choose…';
      sel.append(o);
    });
    sel.onchange = () => { caller = sel.value; };
    whoV.append(sel);
    whoRow.append(whoV);

    // notes
    const notesBox = div('notesCard');
    const notesTitle = h2('Notes from this call', 'notesTitle');
    notesTitle.style.marginTop = '6px';
    notesTitle.style.fontWeight = '700';
    const ta = document.createElement('textarea');
    ta.rows = 4;
    ta.placeholder = 'Type any important notes here...';
    ta.style.width = '100%';
    ta.style.padding = '10px';
    ta.style.border = '1px solid #d1d5db';
    ta.style.borderRadius = '8px';
    ta.style.fontFamily = 'inherit';
    ta.style.fontSize = '14px';
    ta.oninput = () => { notes = ta.value; };
    notesBox.append(notesTitle, ta);

    // save
    const saveRow = div('actions',
      button('Save Call', 'btn btn-primary', onSave)
    );

    callPane.append(
      nameEl,
      phoneWrap,
      detailsCard,
      whoRow,
      notesBox,
      saveRow
    );
  }

  async function onSave() {
    if (!selected) return;
    if (!caller) {
      toast.show('Please select your name before saving.');
      return;
    }
    try {
      await recordSingleCall({
        studentId: selected.id,
        full_name: selected.full_name,
        caller,
        notes,
        at: Date.now()
      });
      toast.show('Call saved.');
    } catch (e) {
      toast.show('Save failed: ' + (e?.message || e));
    }
  }

  // ---------- helpers ----------
  function filterByName(arr, q) {
    const t = normalize(q);
    if (!t) return [];
    return arr.filter(x => normalize(x.full_name).includes(t));
  }

  function normalize(s) {
    return String(s || '').toLowerCase().trim();
  }

  function highlight(text, term) {
    const t = normalize(term);
    const s = String(text || '');
    if (!t) return s;
    const i = s.toLowerCase().indexOf(t);
    if (i < 0) return s;
    const before = s.slice(0, i);
    const mid = s.slice(i, i + t.length);
    const after = s.slice(i + t.length);
    const span = document.createElement('span');
    span.innerHTML = `${escapeHtml(before)}<strong>${escapeHtml(mid)}</strong>${escapeHtml(after)}`;
    return span;
  }

  function escapeHtml(x) {
    return String(x).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function deriveFullName(stu) {
    const cands = [
      String(stu?.full_name || '').trim(),
      String(stu?.fullName || '').trim(),
      String(stu?.['Full Name*'] || '').trim(),
      `${(stu?.first_name||'').trim()} ${(stu?.last_name||'').trim()}`.trim(),
      `${(stu?.FirstName||'').trim()} ${(stu?.LastName||'').trim()}`.trim(),
      `${(stu?.['First Name']||'').trim()} ${(stu?.['Last Name']||'').trim()}`.trim(),
      String(stu?.name||'').trim(),
      String(stu?.['Full Name']||'').trim(),
    ].filter(Boolean);
    return cands[0] || 'Unknown';
  }

  function cleanDigits(s) {
    return String(s || '').replace(/[^\d+]/g, '');
  }
  function toTelHref(raw, defaultCountry = '+1') {
    let n = cleanDigits(raw);
    if (!n) return null;
    if (!n.startsWith('+')) {
      if (n.length === 10) n = defaultCountry + n;
      else if (defaultCountry && !n.startsWith(defaultCountry)) n = defaultCountry + n;
    }
    return 'tel:' + n;
  }
  function humanPhone(raw) {
    const d = cleanDigits(raw).replace(/^\+?1/, '');
    if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    return String(raw);
  }
  function callButton(rawPhone) {
    const href = toTelHref(rawPhone);
    const label = humanPhone(rawPhone);
    const a = document.createElement('a');
    a.className = 'callBtn';
    a.href = href || '#';
    a.textContent = href ? `Call ${label}` : 'No phone number';
    a.style.pointerEvents = href ? 'auto' : 'none';
    a.style.opacity = href ? '1' : '.6';
    a.addEventListener('click', (e) => {
      if (!href) return;
      const ok = confirm(`Place a call to ${label} with your device?`);
      if (!ok) { e.preventDefault(); return; }
      e.preventDefault();
      window.location.href = href;
    });
    return a;
  }
  function phoneLinkOrText(val) {
    const href = toTelHref(val);
    if (!href) return document.createTextNode(String(val ?? ''));
    const a = document.createElement('a');
    a.href = href;
    a.textContent = humanPhone(val);
    a.style.color = 'inherit';
    a.style.textDecoration = 'underline';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = href;
    });
    return a;
  }
  function details(stu){
    const card = div('detailsCard');
    const keys = Object.keys(stu || {});
    if (!keys.length) card.append(ptext('No student fields available','muted'));
    for (const k of keys) {
      const vRaw = stu[k];
      const row = div('kv');
      const keyNode = div('k', k);
      const valNode = div('v');

      const looksPhoneKey = /phone|mobile/i.test(k);
      const looksPhoneVal = typeof vRaw === 'string' && cleanDigits(vRaw).length >= 10;

      if (looksPhoneKey || looksPhoneVal) valNode.append(phoneLinkOrText(vRaw));
      else valNode.append(document.createTextNode(String(vRaw)));

      row.append(keyNode, valNode);
      card.append(row);
    }
    return card;
  }

  // DOM utils
  function div(cls, ...args) {
    const n = document.createElement('div');
    if (cls) n.className = cls;
    for (const a of args) {
      if (a == null) continue;
      if (typeof a === 'object' && !(a instanceof Node) && !Array.isArray(a)) {
        Object.assign(n.style, a);
      } else {
        n.append(a instanceof Node ? a : document.createTextNode(String(a)));
      }
    }
    return n;
  }
  function h1(t){ const n=document.createElement('div'); n.className='title'; n.textContent=t; return n; }
  function h2(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function ptext(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function input(props = {}) { const n = document.createElement('input'); Object.assign(n, props); return n; }
  function button(text, cls, on){
    const b=document.createElement('button');
    b.className=cls;
    b.textContent=text;
    b.onclick=on;
    return b;
  }

  // Toast (same style as dashboard’s makeToast)
  function makeToast() {
    const node = div('toast');
    node.style.display = 'none';
    let t = null;
    return {
      node,
      show(msg) {
        node.textContent = msg;
        node.style.display = 'block';
        clearTimeout(t);
        t = setTimeout(() => { node.style.display = 'none'; }, 2400);
      }
    };
  }

  function errorBox(err){
    const pre = document.createElement('pre');
    pre.style.whiteSpace='pre-wrap';
    pre.style.background='#1a1f2b';
    pre.style.border='1px solid #2b3b5f';
    pre.style.padding='12px';
    pre.style.borderRadius='8px';
    pre.textContent = (err && (err.stack || err.message)) || String(err);
    const box = div('', { padding:'16px', color:'#ffb3b3' });
    box.append(h2('⚠️ Call screen error'), pre);
    return box;
  }
}

// screens/Call.js

import { getAllStudents, getStudentId } from '../data/campaignsData.js';
import { recordSingleCall } from '../data/singleCallProgress.js';

export async function Call(root) {
  root.innerHTML = '';
  const wrap = div('');

  // --- load students once ---
  let students = [];
  try {
    students = await getAllStudents();
  } catch (e) {
    wrap.append(errorBox(e));
    root.append(wrap);
    return;
  }

  // Build an index: [{ id, full_name, ref }]
  const index = students.map((s, i) => {
    const id = getStudentId(s, i);
    return { id, full_name: deriveFullName(s), ref: s };
  });

  // State
  let selected = null; // { id, full_name, ref }
  let caller = '';     // Karla | Aracely | Darian
  let notes = '';

  // --- UI: search box with suggestions ---
  const header = div('callHeader',
    h1('Make a Call'),
    ptext('Search for a student by full name. Click a result to open the call details.', 'muted')
  );

  const searchInput = input('searchInput', 'Search by full name...');
  const resultsBox = div('resultsBox'); // suggestion list
  const callPane = div('callPane');     // where we render call UI

  searchInput.addEventListener('input', () => {
    const q = normalize(searchInput.value);
    renderSuggestions(q);
  });
  searchInput.addEventListener('keydown', (e) => {
    // enter to select first visible suggestion
    if (e.key === 'Enter') {
      const first = resultsBox.querySelector('.resultItem');
      if (first) first.click();
    }
  });

  function renderSuggestions(q) {
    resultsBox.innerHTML = '';
    if (!q) return;

    const MAX = 12;
    const matches = index
      .filter(x => normalize(x.full_name).includes(q))
      .slice(0, MAX);

    if (!matches.length) {
      resultsBox.append(div('muted', 'No matches'));
      return;
    }

    for (const m of matches) {
      const row = div('resultItem', m.full_name);
      row.tabIndex = 0;
      row.onclick = () => { onPickStudent(m); };
      row.onkeydown = (e)=>{ if (e.key==='Enter' || e.key===' ') onPickStudent(m); };
      resultsBox.append(row);
    }
  }

  function onPickStudent(m) {
    selected = m;
    caller = ''; // reset
    notes = '';
    renderCallPane();
    // collapse suggestions
    resultsBox.innerHTML = '';
    searchInput.value = m.full_name;
  }

  async function onSave() {
    if (!selected) return;
    if (!caller) {
      alert('Please select your name before saving.');
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
      alert('Call saved.');
      // keep the selected pane visible; user may add more notes if needed
    } catch (e) {
      alert('Save failed: ' + (e?.message || e));
    }
  }

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

    // Name centered + bold
    const nameEl = h1(selected.full_name);
    nameEl.style.textAlign = 'center';
    nameEl.style.fontWeight = '800';

    // Phone centered + green & clickable (if available)
    const phoneEl = phone ? callButton(phone) : disabledBtn('No phone number');
    phoneEl.style.display = 'inline-block';
    phoneEl.style.fontWeight = '800';
    phoneEl.style.color = '#16a34a';
    phoneEl.style.textAlign = 'center';
    const phoneWrap = div('', { textAlign: 'center', marginTop: '6px', marginBottom:'10px' });
    phoneWrap.append(phoneEl);

    // Caller dropdown
    const callerLabel = div('kv', div('k', 'Your name'), div('v'));
    const sel = document.createElement('select');
    sel.className = 'select';
    ['', 'Karla', 'Aracely', 'Darian'].forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt ? opt : 'Choose…';
      sel.append(o);
    });
    sel.onchange = ()=>{ caller = sel.value; };
    callerLabel.lastChild.append(sel);

    // Notes
    const notesBox = div('notesCard');
    const title = h2('Notes from this call', 'notesTitle');
    title.style.marginTop = '6px';
    title.style.fontWeight = '700';

    const ta = document.createElement('textarea');
    ta.rows = 4;
    ta.placeholder = 'Type any important notes here...';
    ta.style.width = '100%';
    ta.style.padding = '10px';
    ta.style.border = '1px solid #d1d5db';
    ta.style.borderRadius = '8px';
    ta.style.fontFamily = 'inherit';
    ta.style.fontSize = '14px';
    ta.addEventListener('input', () => { notes = ta.value; });

    notesBox.append(title, ta);

    const saveRow = div('actions',
      button('Save Call','btn btn-primary', onSave)
    );

    const detailsCard = details(stu); // optional: show all fields like execution screen

    callPane.append(
      nameEl,
      phoneWrap,
      detailsCard,
      callerLabel,
      notesBox,
      saveRow
    );
  }

  // initial structure
  wrap.append(
    header,
    div('', searchInput),
    resultsBox,
    callPane
  );

  root.append(wrap);

  /* ------------ tiny helpers (mostly mirrored from execution) ------------ */
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

  // dom utils
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
  function input(cls, placeholder){
    const n = document.createElement('input');
    n.type = 'text';
    n.className = cls || '';
    n.placeholder = placeholder || '';
    n.autocomplete = 'off';
    n.spellcheck = false;
    return n;
  }
  function h1(t){ const n=document.createElement('div'); n.className='title'; n.textContent=t; return n; }
  function h2(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function ptext(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function button(text, cls, on){
    const b=document.createElement('button');
    b.className=cls;
    b.textContent=text;
    b.onclick=on;
    return b;
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

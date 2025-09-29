// screens/execution.js
import { getAllStudents, applyFilters, getStudentId } from '../data/campaignsData.js';
import {
  loadOrInitProgress,
  recordOutcome,
  getSummary,
  recordSurveyResponse,
  getSurveyResponse,
  recordNote,            // notes support
  getNote                // notes support
} from '../data/campaignProgress.js';

export async function Execute(root, campaign) {
  if (!campaign) { location.hash = '#/dashboard'; return; }

  root.innerHTML = '';
  const wrap = document.createElement('div');

  let students = [];
  let filtered = [];
  let queueIds = [];
  const idToStudent = {};

  let progress = null;
  let mode = 'idle';                // 'idle' | 'running' | 'summary' | 'missed'
  let passStrategy = 'unattempted'; // 'unattempted' | 'missed'
  let currentId = undefined;
  let selectedSurveyAnswer = null;
  let currentNotes = '';            // local cache of notes text

  // simple undo stack of the last user-facing steps
  // Each entry is { type: 'survey'|'nav'|'outcome', campaignId, studentId, prev, next, prevMode, prevStrategy }
  const undoStack = [];

  // ======= BOOT (with error splash) =======
  try {
    students = await getAllStudents();
    filtered = applyFilters(students, campaign.filters || []);
    queueIds = filtered.map((s, i) => getStudentId(s, i));
    filtered.forEach((s, i) => { idToStudent[getStudentId(s, i)] = s; });

    progress = await loadOrInitProgress(campaign.id, queueIds);
  } catch (err) {
    showError(err);
    return;
  }

  function totals() { return (progress && progress.totals) || { total:0, made:0, answered:0, missed:0 }; }
  function pct() { const t=totals(); return t.total ? t.made / t.total : 0; }

  function pickNextId(p, strategy, skipId){
    if (!p) return undefined;
    if (strategy === 'unattempted'){
      for (const id of queueIds){
        if (id === skipId) continue;
        const c = p.contacts[id];
        if (!c || c.attempts === 0) return id;
      }
      return undefined;
    }
    for (const id of queueIds){
      if (id === skipId) continue;
      const c = p.contacts[id];
      if (c?.outcome === 'no_answer') return id;
    }
    return undefined;
  }

  async function advance(strategy, skipId){
    progress = await loadOrInitProgress(campaign.id, queueIds);
    currentId = pickNextId(progress, strategy, skipId);
    selectedSurveyAnswer = null;
    currentNotes = ''; // reset; will be loaded lazily
    if (!currentId) mode = 'summary';
    render();
  }

  async function beginCalls(){ passStrategy='unattempted'; mode='running'; await advance('unattempted'); }
  async function beginMissed(){ passStrategy='missed'; mode='missed'; await advance('missed'); }

  async function onSelectSurvey(ans){
    if (!currentId) return;
    // push undo BEFORE changing it
    const prev = await getSurveyResponse(campaign.id, currentId);
    undoStack.push({ type:'survey', campaignId: campaign.id, studentId: currentId, prev, next: ans });

    selectedSurveyAnswer = ans;
    await recordSurveyResponse(campaign.id, currentId, ans);
    render();
  }

  async function onOutcome(kind){
    if (!currentId) return;

    // Capture a nav-style undo so we can jump back to this contact if needed.
    undoStack.push({
      type: 'outcome',
      campaignId: campaign.id,
      studentId: currentId,
      prevMode: mode,
      prevStrategy: passStrategy
    });

    progress = await recordOutcome(campaign.id, currentId, kind);
    const skip = passStrategy==='missed' ? currentId : undefined;
    await advance(passStrategy, skip);
  }

  // central undo handler
  async function onBack() {
    if (!undoStack.length) return;

    const last = undoStack.pop();

    if (last.type === 'survey') {
      await recordSurveyResponse(last.campaignId, last.studentId, last.prev ?? null);
      currentId = last.studentId;
      selectedSurveyAnswer = last.prev ?? null;
      if (mode!=='running' && mode!=='missed') mode = 'running';
      currentNotes = await getNote(last.campaignId, last.studentId);
      render();
      return;
    }

    if (last.type === 'outcome' || last.type === 'nav') {
      mode = last.prevMode || 'running';
      passStrategy = last.prevStrategy || passStrategy;
      currentId = last.studentId;
      await ensureSurveyAndNotesLoaded();
      render();
      return;
    }
  }

  // ======= Keyboard shortcuts (temporarily disabled for now) =======
  //const keyHandler = (e)=>{
    //if (mode!=='running' && mode!=='missed') return;
    //const k = (e.key || '').toLowerCase();
    //if (k==='arrowleft' || k==='n') onOutcome('no_answer');
    //if (k==='arrowright' || k==='a') onOutcome('answered');
    //if (k==='escape' || k==='backspace') onBack(); // quick undo
  //};
  //window.addEventListener('keydown', keyHandler);

  // ======= Swipe (pointer) with guard so buttons still work =======
  function isNoSwipeTarget(ev){
    const t = ev.target;
    return !!(t && t.closest && t.closest('[data-noswipe="1"]'));
  }
  function attachSwipe(el){
    let startX = null, dx = 0;
    el.onpointerdown = (ev)=>{
      if (isNoSwipeTarget(ev)) return;
      startX = ev.clientX; dx = 0;
      try { el.setPointerCapture && el.setPointerCapture(ev.pointerId); } catch{}
    };
    el.onpointermove = (ev)=>{
      if (startX==null) return;
      dx = ev.clientX - startX;
      el.style.transform = `translateX(${dx}px) rotate(${dx/30}deg)`;
    };
    el.onpointerup = (ev)=> {
      if (startX==null) return;
      if (!isNoSwipeTarget(ev)) {
        if (dx > 80) onOutcome('answered');
        else if (dx < -80) onOutcome('no_answer');
      }
      el.style.transform = '';
      startX=null; dx=0;
    };
  }

  // ======= Lazy-load current contact's survey & notes =======
  async function ensureSurveyAndNotesLoaded() {
    if (!currentId) return;
    selectedSurveyAnswer = await getSurveyResponse(campaign.id, currentId);
    currentNotes = await getNote(campaign.id, currentId);
  }
  async function ensureSurveySelected() {
    if (!currentId) return;
    selectedSurveyAnswer = await getSurveyResponse(campaign.id, currentId);
  }

  function header() {
    const t = totals();
    const pctNum = Math.round(pct()*100);
    // Back button REMOVED from header to keep it next to the outcome buttons as requested.
    return div('',
      div('progressWrap',
        div('progressBar', div('progressFill'), { width: pctNum + '%' }),
        ptext(`${t.made}/${t.total} complete • ${t.answered} answered • ${t.missed} missed`,'progressText')
      )
    );
  }

  function render() {
    try {
      wrap.innerHTML = '';
      wrap.append(header());

      if (mode==='idle') {
        wrap.append(
          center(
            h1(campaign.name || 'Campaign'),
            ptext(`${queueIds.length} contact${queueIds.length===1?'':'s'} in this campaign`, 'muted'),
            button('Begin Calls','btn btn-primary', beginCalls)
          )
        );
      }

      if ((mode==='running' || mode==='missed') && currentId){
        ensureSurveyAndNotesLoaded();
        const stu = idToStudent[currentId] || {};
        const phone = stu['Mobile Phone*'] ?? stu['Mobile Number*'] ?? stu.phone ?? stu.phone_number ?? stu.mobile ?? '';

        const card = div('', { padding: '16px', paddingBottom:'36px' });
        const swipe = div('');
        attachSwipe(swipe);

        // ===== Top: Full name centered & bold =====
        const fullName =
          String(
            stu.full_name ??
            stu.fullName ??
            stu['Full Name*'] ??
            `${stu.first_name ?? ''} ${stu.last_name ?? ''}`
          ).trim() || 'Current contact';

        const nameEl = h1(fullName);
        nameEl.style.textAlign = 'center';
        nameEl.style.fontWeight = '800';

        // ===== Top: Mobile Number* centered & green =====
        const phoneEl = phone ? callButton(phone) : disabledBtn('No phone number');
        phoneEl.style.display = 'inline-block';
        phoneEl.style.fontWeight = '800';
        phoneEl.style.color = '#16a34a';
        phoneEl.style.textAlign = 'center';
        const phoneWrap = div('', { textAlign: 'center', marginTop: '6px', marginBottom:'6px' });
        phoneWrap.append(phoneEl);

        // ===== Buttons (No Answer • Answered • Back) on the same row =====
        const noBtn  = button('No Answer','btn no', ()=>onOutcome('no_answer'));
        const yesBtn = button('Answered','btn yes', ()=>onOutcome('answered'));
        const backBtn = button('← Back','btn backBtn', onBack);
        backBtn.disabled = undoStack.length === 0;
        if (backBtn.disabled) backBtn.style.opacity = '.6';

        swipe.append(
          nameEl,
          phoneWrap,
          ptext('Swipe right = Answered, Swipe left = No answer','hint'),
          details(stu),
          surveyBlock(campaign.survey, selectedSurveyAnswer, onSelectSurvey),
          notesBlock(currentNotes, onChangeNotes),
          actionRow(noBtn, yesBtn, backBtn) // << Back is next to the outcome buttons
        );

        card.append(swipe);
        wrap.append(card);
      }

      if (mode==='summary') {
        summaryBlock(campaign.id, async ()=>{ await beginMissed(); }, ()=>{ location.hash='#/dashboard'; })
          .then(b=>wrap.append(b))
          .catch(err=>wrap.append(errorBox(err)));
      }

      root.innerHTML=''; root.append(wrap);
    } catch (err) {
      showError(err);
    }
  }

  render();

  // ======= teardown on route change (optional) =======
  window.addEventListener('hashchange', () => {
    window.removeEventListener('keydown', keyHandler);
  });

  /* ---------------- Notes UI & Handlers ---------------- */

  // Debounce utility so we don't hammer localStorage
  function debounce(fn, delay=400) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  const debouncedSaveNotes = debounce(async (cid, sid, text) => {
    try { await recordNote(cid, sid, text); } catch{}
  }, 400);

  async function onChangeNotes(text) {
    if (!currentId) return;
    currentNotes = text;
    debouncedSaveNotes(campaign.id, currentId, currentNotes);
  }

  function notesBlock(value, onChange){
    const container = div('notesCard');
    const title = h2('Notes from this call', 'notesTitle');
    title.style.marginTop = '6px';
    title.style.fontWeight = '700';

    const ta = document.createElement('textarea');
    ta.value = value || '';
    ta.rows = 4;
    ta.placeholder = 'Type any important notes here...';
    ta.style.width = '100%';
    ta.style.padding = '10px';
    ta.style.border = '1px solid #d1d5db';
    ta.style.borderRadius = '8px';
    ta.style.fontFamily = 'inherit';
    ta.style.fontSize = '14px';
    ta.setAttribute('data-noswipe','1');
    ta.addEventListener('pointerdown', e => e.stopPropagation());

    ta.addEventListener('input', () => onChange(ta.value));
    ta.addEventListener('blur', () => onChange(ta.value)); // ensure save on blur

    container.append(title, ta);
    return container;
  }

  /* ---- tiny view helpers ---- */
  function details(stu){
    const card = div('detailsCard');
    const keys = Object.keys(stu || {});
    if (!keys.length) card.append(ptext('No student fields available','muted'));
    for (const k of keys) {
      const vRaw = stu[k];
      const row = div('kv');
      const keyNode = div('k', k);
      const valNode = div('v');

      // Heuristic: make phone-like fields clickable
      const looksPhoneKey = /phone|mobile/i.test(k);
      const looksPhoneVal = typeof vRaw === 'string' && cleanDigits(vRaw).length >= 10;

      if (looksPhoneKey || looksPhoneVal) valNode.append(phoneLinkOrText(vRaw));
      else valNode.append(document.createTextNode(String(vRaw)));

      row.append(keyNode, valNode);
      card.append(row);
    }
    return card;
  }

  function surveyBlock(survey, sel, onPick){
    if (!survey || !survey.question || !Array.isArray(survey.options) || !survey.options.length) return div('');
    const options = survey.options.map(opt => {
      const c = chip(opt, 'surveyChip'+(sel===opt?' sel':''), ()=>onPick(opt));
      c.setAttribute('data-noswipe','1');
      return c;
    });
    const box = div('surveyCard',
      h2(survey.question,'surveyTitle'),
      chipRow(options),
      ptext(sel ? `Saved: ${sel}` : 'Tap an option to record a response', sel ? 'surveySaved' : 'surveyHint')
    );
    return box;
  }

  async function summaryBlock(campaignId, onMissed, onFinish){
    const t = await getSummary(campaignId);
    const allDone = t.missed===0 && t.made===t.total && t.total>0;
    const box = center(
      h1('Campaign Summary'),
      cardKV([['Total contacts',t.total],['Calls made',t.made],['Answered',t.answered],['Missed',t.missed]]),
      (!allDone && t.missed>0) ? button('Proceed to Missed Contacts','btn', onMissed) : null,
      button(allDone ? 'Done' : 'Finish for now','btn btn-primary', onFinish)
    );
    return box;
  }

  /* ===== tel: helpers (click-to-call) ===== */
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
    const d = cleanDigits(raw).replace(/^\+?1/, ''); // trim +1 for display
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
    a.setAttribute('data-noswipe','1');
    a.addEventListener('pointerdown', e => e.stopPropagation());
    if (href) {
      a.addEventListener('click', (e) => {
        const ok = confirm(`Place a call to ${label} with your device?`);
        if (!ok) { e.preventDefault(); return; }
        e.preventDefault();
        window.location.href = href; // Safari-friendly
      });
    }
    return a;
  }
  function phoneLinkOrText(val) {
    const href = toTelHref(val);
    if (!href) return document.createTextNode(String(val));
    const a = document.createElement('a');
    a.href = href;
    a.textContent = humanPhone(val);
    a.style.color = 'inherit';
    a.style.textDecoration = 'underline';
    a.setAttribute('data-noswipe','1');
    a.addEventListener('pointerdown', e => e.stopPropagation());
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = href;
    });
    return a;
  }

  /* dom utilities (SAFE VARIADIC VERSION) */
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
  function center(...kids){ const n=div('center'); kids.forEach(k=>k && n.append(k)); return n; }
  function button(text, cls, on){
    const b=document.createElement('button');
    b.className=cls;
    b.textContent=text;
    b.onclick=on;
    b.setAttribute('data-noswipe','1');
    b.addEventListener('pointerdown', e => e.stopPropagation());
    return b;
  }
  function actionRow(...kids){ const r=div('actions'); kids.forEach(k=>k&&r.append(k)); return r; }
  function disabledBtn(text){ const b=document.createElement('button'); b.className='callBtn'; b.textContent=text; b.disabled=true; b.style.opacity=.6; b.setAttribute('data-noswipe','1'); b.addEventListener('pointerdown', e => e.stopPropagation()); return b; }
  function chip(label, cls, on){
    const c=document.createElement('button');
    c.className=cls;
    c.textContent=label;
    c.onclick=on;
    c.setAttribute('data-noswipe','1');
    c.addEventListener('pointerdown', e => e.stopPropagation());
    return c;
  }
  function chipRow(arr){ const r=div('surveyChips'); arr.forEach(x=>r.append(x)); return r; }
  function cardKV(entries){
    const card = div('detailsCard'); card.style.width='90%';
    for (const [k,v] of entries){ const row = div('kv'); row.append(div('k', k), div('v', String(v))); card.append(row); }
    return card;
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
    box.append(h2('⚠️ Execution screen error'), pre);
    return box;
  }
  function showError(err){
    root.innerHTML = '';
    root.append(errorBox(err));
  }
}

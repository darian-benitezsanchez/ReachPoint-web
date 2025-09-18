import { getAllStudents, applyFilters, getStudentId } from '../data/campaignsData.js';
import { loadOrInitProgress, recordOutcome, getSummary, recordSurveyResponse, getSurveyResponse } from '../data/campaignProgress.js';

export async function Execute(root, campaign) {
  if (!campaign) { location.hash = '#/dashboard'; return; }

  root.innerHTML = '';
  const wrap = document.createElement('div');

  const students = await getAllStudents();
  const filtered = applyFilters(students, campaign.filters);
  const queueIds = filtered.map((s,i)=>getStudentId(s,i));
  const idToStudent = {}; filtered.forEach((s,i)=> idToStudent[getStudentId(s,i)] = s);

  let progress = await loadOrInitProgress(campaign.id, queueIds);
  let mode = 'idle';             // 'idle' | 'running' | 'summary' | 'missed'
  let passStrategy = 'unattempted'; // 'unattempted' | 'missed'
  let currentId = undefined;
  let selectedSurveyAnswer = null;

  function totals() { return progress?.totals || { total:0, made:0, answered:0, missed:0 }; }
  function pct() { const t=totals(); return t.total? t.made/t.total : 0; }

  function pickNextId(p, strategy, skipId){
    if (!p) return;
    if (strategy === 'unattempted'){
      for (const id of queueIds){ if(id===skipId) continue; const c=p.contacts[id]; if(!c || c.attempts===0) return id; }
      return;
    }
    for (const id of queueIds){ if(id===skipId) continue; const c=p.contacts[id]; if(c?.outcome==='no_answer') return id; }
    return;
  }
  async function advance(strategy, skipId){
    progress = await loadOrInitProgress(campaign.id, queueIds);
    currentId = pickNextId(progress, strategy, skipId);
    selectedSurveyAnswer = null;
    if (!currentId) mode = 'summary';
    render();
  }
  async function beginCalls(){ passStrategy='unattempted'; mode='running'; await advance('unattempted'); }
  async function beginMissed(){ passStrategy='missed'; mode='missed'; await advance('missed'); }

  async function onSelectSurvey(ans){
    if (!currentId) return;
    selectedSurveyAnswer = ans;
    await recordSurveyResponse(campaign.id, currentId, ans);
    render();
  }
  async function onOutcome(kind){
    if (!currentId) return;
    progress = await recordOutcome(campaign.id, currentId, kind);
    const skip = passStrategy==='missed' ? currentId : undefined;
    await advance(passStrategy, skip);
  }

  // keyboard shortcuts
  window.onkeydown = (e)=>{
    if (mode!=='running' && mode!=='missed') return;
    if (e.key==='ArrowLeft' || e.key.toLowerCase()==='n') onOutcome('no_answer');
    if (e.key==='ArrowRight' || e.key.toLowerCase()==='a') onOutcome('answered');
  };

  // swipe (pointer)
  let startX=null, dx=0;
  function attachSwipe(el){
    el.onpointerdown = (ev)=>{ startX=ev.clientX; dx=0; el.setPointerCapture(ev.pointerId); };
    el.onpointermove = (ev)=>{ if(startX==null) return; dx = ev.clientX - startX; el.style.transform = `translateX(${dx}px) rotate(${dx/30}deg)`; };
    el.onpointerup = ()=> {
      if (dx > 80) onOutcome('answered');
      else if (dx < -80) onOutcome('no_answer');
      el.style.transform = ''; startX=null; dx=0;
    };
  }

  async function ensureSurveySelected() {
    if (!currentId) return;
    selectedSurveyAnswer = await getSurveyResponse(campaign.id, currentId);
  }

  function header() {
    const p = totals();
    return div('',
      div('progressWrap',
        div('progressBar', div('progressFill', '', { width: Math.round(pct()*100)+'%' })),
        ptext(`${p.made}/${p.total} complete • ${p.answered} answered • ${p.missed} missed`,'progressText')
      )
    );
  }

  function render() {
    wrap.innerHTML = '';
    wrap.append(header());

    if (mode==='idle') {
      wrap.append(
        center(
          h1(campaign.name),
          ptext(`${queueIds.length} contact${queueIds.length===1?'':'s'} in this campaign`, 'muted'),
          button('Begin Calls','btn btn-primary', beginCalls)
        )
      );
    }

    if ((mode==='running' || mode==='missed') && currentId){
      ensureSurveySelected();
      const stu = idToStudent[currentId] || {};
      const phone = stu['Mobile Phone*'] ?? stu.phone ?? stu.phone_number ?? stu.mobile ?? '';

      const card = div('', { padding: '16px', paddingBottom:'36px' });
      const swipe = div('', { });
      attachSwipe(swipe);

      swipe.append(
        h1(`${String(stu.first_name ?? '')} ${String(stu.last_name ?? '')}`),
        ptext('Swipe right = Answered, Swipe left = No answer','hint'),
        phone ? anchorBtn(`Call ${phone}`, `tel:${String(phone)}`) : disabledBtn('No phone number'),
        details(stu),
        surveyBlock(campaign.survey, selectedSurveyAnswer, onSelectSurvey),
        actionRow(
          button('No Answer','btn no', ()=>onOutcome('no_answer')),
          button('Answered','btn yes', ()=>onOutcome('answered'))
        )
      );
      card.append(swipe);
      wrap.append(card);
    }

    if (mode==='summary') {
      summaryBlock(campaign.id, async ()=>{ await beginMissed(); }, ()=>{ location.hash='#/dashboard'; }).then(b=>wrap.append(b));
    }

    root.innerHTML=''; root.append(wrap);
  }

  render();

  /* ---- tiny view helpers ---- */
  function details(stu){
    const card = div('detailsCard');
    for (const k of Object.keys(stu)) {
      const row = div('kv'); row.append(div('k',null,k), div('v',null,String(stu[k])));
      card.append(row);
    }
    return card;
  }
  function surveyBlock(survey, sel, onPick){
    if (!survey || !survey.question || !Array.isArray(survey.options) || !survey.options.length) return div('');
    const box = div('surveyCard',
      h2(survey.question,'surveyTitle'),
      chipRow(survey.options.map(opt => chip(opt, 'surveyChip'+(sel===opt?' sel':''), ()=>onPick(opt)))),
      ptext(sel ? `Saved: ${sel}` : 'Tap an option to record a response', sel ? 'surveySaved' : 'surveyHint')
    );
    return box;
  }
  async function summaryBlock(campaignId, onMissed, onFinish){
    const t = await getSummary(campaignId);
    const allDone = t.missed===0 && t.made===t.total;
    const box = center(
      h1('Campaign Summary'),
      cardKV([['Total contacts',t.total],['Calls made',t.made],['Answered',t.answered],['Missed',t.missed]]),
      !allDone ? button('Proceed to Missed Contacts','btn', onMissed) : null,
      button(allDone ? 'Done' : 'Finish for now','btn btn-primary', onFinish)
    );
    return box;
  }

  /* dom utilities */
  function div(cls, styleOrChild, maybeStyle) {
    const n = document.createElement('div');
    if (cls) n.className = cls;
    if (styleOrChild && typeof styleOrChild === 'object' && !(styleOrChild instanceof Node)) Object.assign(n.style, styleOrChild);
    else if (styleOrChild) n.append(styleOrChild);
    if (maybeStyle) Object.assign(n.style, maybeStyle);
    return n;
  }
  function h1(t){ const n=document.createElement('div'); n.className='title'; n.textContent=t; return n; }
  function h2(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function ptext(t,cls){ const n=document.createElement('div'); n.className=cls||''; n.textContent=t; return n; }
  function center(...kids){ const n=div('center'); kids.forEach(k=>k && n.append(k)); return n; }
  function button(text, cls, on){ const b=document.createElement('button'); b.className=cls; b.textContent=text; b.onclick=on; return b; }
  function actionRow(...kids){ const r=div('actions'); kids.forEach(k=>k&&r.append(k)); return r; }
  function anchorBtn(text, href){ const a=document.createElement('a'); a.href=href; a.className='callBtn'; a.textContent=text; return a; }
  function disabledBtn(text){ const b=document.createElement('button'); b.className='callBtn'; b.textContent=text; b.disabled=true; b.style.opacity=.6; return b; }
  function chip(label, cls, on){ const c=document.createElement('button'); c.className=cls; c.textContent=label; c.onclick=on; return c; }
  function chipRow(arr){ const r=div('surveyChips'); arr.forEach(x=>r.append(x)); return r; }
  function cardKV(entries){
    const card = div('detailsCard'); card.style.width='90%';
    for (const [k,v] of entries){ const row = div('kv'); row.append(div('k',null,k), div('v',null,String(v))); card.append(row); }
    return card;
  }
}

// screens/dashboard.js
// Original-style Dashboard with no auth logic.

import {
  listCampaigns,
  deleteCampaign,
  applyFilters,
  getStudentId,
  getAllStudents
} from '../data/campaignsData.js';
import {
  removeProgress,
  exportSurveyCSV,
  exportCallOutcomesCSV
} from '../data/campaignProgress.js';
import { exportCsvSmart } from '../utils/exportReport.js';

export function Dashboard(root) {
  root.innerHTML = '';
  const page = el('div');

  const header = el('div', 'row space',
    el('h1', 'title', 'Your Campaigns'),
    btn('+ New', 'btn btn-ghost', () => location.hash = '#/create'),
  );
  page.appendChild(header);

  const toast = makeToast();

  (async () => {
    const campaigns = await listCampaigns();
    if (!campaigns.length) {
      page.appendChild(
        div('center',
          el('h1','title','No campaigns yet'),
          el('p','muted','Create a campaign to start calling.'),
          btn('Create Campaign','btn btn-primary',()=>location.hash='#/create')
        )
      );
      root.appendChild(page);
      return;
    }

    const students = await getAllStudents();

    const list = el('div','list');
    for (const c of campaigns) {
      const card = el('section','card');
      const head = button('card-head', () => location.hash = `#/execute/${c.id}`,
        div('card-head-text',
          div('card-title', c.name),
          div('card-sub', `Created ${new Date(c.createdAt).toLocaleDateString()} • ${c.studentIds.length} students`),
          div('card-reminders', remindersLabel(c)),
        )
      );

      const actions = div('actions',
        icon('🗑️','icon danger','Delete campaign', async () => {
          actions.replaceWith(confirmRow());
        }),
        div('spacer'),
        icon('📥','icon','Download summary report', async () => {
          try {
            const rows = await buildSummaryCSVRows(c, students);
            const headers = ['Full Name','Outcome','Response','Timestamp','Student ID','Campaign ID','Campaign Name'];
            const csv = csvString(headers, rows);
            await exportCsvSmart(`campaign-${c.id}-summary.csv`, csv);
            toast.show('Saved summary CSV');
          } catch (e) { toast.show('Export failed: ' + (e?.message||e)); }
        }),
        icon('📊','icon','Download call outcomes', async () => {
          try {
            const csv = await exportCallOutcomesCSV(c.id);
            await exportCsvSmart(`campaign-${c.id}-call-outcomes.csv`, csv);
            toast.show('Saved call outcomes CSV');
          } catch (e) { toast.show('Export failed: ' + (e?.message||e)); }
        }),
        c.survey ? icon('📝','icon','Download survey responses', async () => {
          try {
            const csv = await exportSurveyCSV(c.id);
            await exportCsvSmart(`campaign-${c.id}-survey.csv`, csv);
            toast.show('Saved survey CSV');
          } catch (e) { toast.show('Export failed: ' + (e?.message||e)); }
        }) : null
      );

      function confirmRow() {
        return div('actions',
          span('confirm-text','Delete this campaign?'),
          div('spacer'),
          btn('Cancel','btn btn-small', () => actions.replaceWith(actionsOrig)),
          btn('Delete','btn btn-small btn-danger', async () => {
            await deleteCampaign(c.id);
            await removeProgress(c.id);
            Dashboard(root);
          })
        );
      }
      const actionsOrig = actions;

      card.append(head, actions);
      list.appendChild(card);
    }

    page.appendChild(list);
    root.appendChild(page);
    root.appendChild(toast.node);
  })();
}

/* ---------- helpers ---------- */

function remindersLabel(c) {
  if (!c.reminders?.length) return 'Reminders: —';
  const set = new Set();
  for (const r of c.reminders) for (const d of (r.dates||[])) set.add(d);
  const list = Array.from(set).sort();
  return list.length ? `Reminders: ${list.join(', ')}` : 'Reminders: —';
}

async function buildSummaryCSVRows(campaign, allStudents) {
  const filtered = applyFilters(allStudents, campaign.filters);
  const idToStudent = {};
  filtered.forEach((s,i)=>{ idToStudent[getStudentId(s,i)] = s; });

  // Load progress to get outcomes/responses for timestamp; defer to progress store
  const raw = JSON.parse(localStorage.getItem('reachpoint.progress.'+campaign.id) || '{}');
  const contacts = raw.contacts || {};

  const rows = [];
  filtered.forEach((student, idx) => {
    const sid = getStudentId(student, idx);
    const st = idToStudent[sid];
    const fullName = deriveFullName(st);

    const cp = contacts[sid] || {};
    const outcome = cp.outcome || '';
    const response = cp.surveyAnswer || '';
    const tCall = cp.lastCalledAt || 0;
    let tResp = 0;
    if (Array.isArray(cp.surveyLogs)) {
      for (let i = cp.surveyLogs.length-1; i>=0; i--) if (cp.surveyLogs[i]?.answer === response) { tResp = cp.surveyLogs[i].at||0; break; }
    }
    const iso = (tCall || tResp) ? new Date(Math.max(tCall, tResp)).toISOString() : '';

    rows.push({
      'Full Name': fullName,
      'Outcome': outcome,
      'Response': response,
      'Timestamp': iso,
      'Student ID': sid,
      'Campaign ID': campaign.id,
      'Campaign Name': campaign.name,
    });
  });

  return rows;
}

function deriveFullName(stu) {
  const cands = [
    `${(stu?.first_name||'').trim()} ${(stu?.last_name||'').trim()}`.trim(),
    `${(stu?.FirstName||'').trim()} ${(stu?.LastName||'').trim()}`.trim(),
    `${(stu?.['First Name']||'').trim()} ${(stu?.['Last Name']||'').trim()}`.trim(),
    String(stu?.name||'').trim(),
    String(stu?.['Full Name']||'').trim(),
  ].filter(Boolean);
  return cands[0] || '';
}

/* DOM utils */
function el(tag, className, ...children) {
  const n = document.createElement(tag);
  if (typeof className === 'string') n.className = className, children = children;
  else { children = [className, ...children]; }
  for (const c of children) if (c!=null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
function div(cls,...kids){ return el('div',cls,...kids); }
function span(cls,text){ return el('span',cls,text); }
function button(cls, onClick, ...kids){
  const b = el('button',cls,...kids);
  b.onclick = (e) => { e?.preventDefault?.(); onClick?.(e); };
  return b;
}
function btn(label, cls, onClick){ const b = button(cls, onClick, label); return b; }
function icon(glyph, cls, title, onClick){ const b = button(cls, onClick, glyph); if (title) b.title = title; return b; }

function csvString(headers, rows) {
  const esc = (v)=> {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => headers.map(h=>esc(r[h])).join(',')).join('\n');
  return head + '\n' + body;
}

function makeToast() {
  const node = div('toast'); node.style.display='none';
  let t=null;
  return {
    node,
    show(msg){ node.textContent = msg; node.style.display='block'; clearTimeout(t); t = setTimeout(()=>node.style.display='none', 2400); }
  };
}

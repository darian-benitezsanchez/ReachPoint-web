// screens/insights.js
import {
  getAllCampaigns,      // expected: returns [{ id, name, active, ... }, ...]
  getAllStudents        // used to read students and match grad year
} from '../data/campaignsData.js';

import {
  loadOrInitProgress    // used to read outcomes/notes/timestamps per campaign
} from '../data/campaignProgress.js';

// Small helper: create a div
function div(cls, style = {}) {
  const n = document.createElement('div');
  if (cls) n.className = cls;
  Object.assign(n.style, style);
  return n;
}

// Helper: create a labeled block title
function h2(text) {
  const t = document.createElement('div');
  t.textContent = text;
  t.style.fontSize = '18px';
  t.style.fontWeight = '800';
  t.style.margin = '12px 0 8px';
  return t;
}

// Canvas factory
function chartCanvas(id) {
  const cWrap = div('', { width: '100%', maxWidth: '960px', margin: '8px auto' });
  const c = document.createElement('canvas');
  c.id = id;
  c.style.width = '100%';
  c.style.maxHeight = '360px';
  cWrap.appendChild(c);
  return { wrap: cWrap, canvas: c };
}

// Try to read “graduation year” from a student record with several possible keys
function getGradYear(stu) {
  const keys = [
    'High School Graduation Year*',
    'High School Graduation Year',
    'Graduation Year',
    'HS Grad Year',
    'Grad Year'
  ];
  for (const k of keys) {
    if (stu && stu[k] != null && String(stu[k]).trim() !== '') {
      return String(stu[k]).trim();
    }
  }
  return 'Unknown';
}

// Convert a timestamp-ish value to a Date (defensive)
function toDateSafe(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

// Pull a flat activity list from progress.
// We make no assumptions beyond a minimal shape and handle a few common schemas.
// Returns: [{ studentId, outcome, surveyResponse, note, timestamp }]
function extractActivity(progress) {
  const out = [];
  if (!progress || !progress.contacts) return out;

  for (const [sid, c] of Object.entries(progress.contacts)) {
    // Try several places for timestamps/history
    // 1) explicit history array
    if (Array.isArray(c?.history)) {
      for (const h of c.history) {
        out.push({
          studentId: sid,
          outcome: h.outcome ?? c.outcome ?? null,
          surveyResponse: h.surveyResponse ?? c.surveyResponse ?? null,
          note: h.note ?? c.note ?? null,
          timestamp: h.timestamp ?? h.time ?? c.updatedAt ?? c.lastAttemptAt ?? null
        });
      }
      continue;
    }

    // 2) attempts array with timestamps
    if (Array.isArray(c?.attemptsLog)) {
      for (const a of c.attemptsLog) {
        out.push({
          studentId: sid,
          outcome: a.outcome ?? c.outcome ?? null,
          surveyResponse: a.surveyResponse ?? c.surveyResponse ?? null,
          note: a.note ?? c.note ?? null,
          timestamp: a.timestamp ?? a.time ?? c.updatedAt ?? c.lastAttemptAt ?? null
        });
      }
      continue;
    }

    // 3) flat contact entry (best-effort)
    out.push({
      studentId: sid,
      outcome: c.outcome ?? null,
      surveyResponse: c.surveyResponse ?? null,
      note: c.note ?? null,
      timestamp: c.updatedAt ?? c.lastAttemptAt ?? c.firstAttemptAt ?? null
    });
  }

  return out;
}

// Destroy an existing chart instance (if any)
function destroyChart(maybeChart) {
  if (maybeChart && typeof maybeChart.destroy === 'function') {
    try { maybeChart.destroy(); } catch {}
  }
}

export async function Insights(root) {
  // Layout shell
  root.innerHTML = '';
  const page = div('', { padding: '16px' });
  const header = div('', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '980px', margin: '0 auto 8px' });
  const title = document.createElement('div');
  title.textContent = 'Insights';
  title.style.fontWeight = '800';
  title.style.fontSize = '22px';

  const selectWrap = div('', { display: 'flex', gap: '8px', alignItems: 'center' });
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Campaign:';
  selectLabel.style.fontWeight = '600';
  const campaignSelect = document.createElement('select');
  campaignSelect.style.padding = '6px 10px';
  campaignSelect.style.border = '1px solid #d1d5db';
  campaignSelect.style.borderRadius = '8px';
  campaignSelect.style.background = '#fff';

  selectWrap.append(selectLabel, campaignSelect);
  header.append(title, selectWrap);

  const sectionWrap = div('', { maxWidth: '980px', margin: '0 auto' });

  // Section: Descriptive Statistics
  const descSection = div('', { marginTop: '8px' });
  descSection.append(h2('Descriptive Statistics'));

  // Overall responses (bar)
  const overallBlock = div('', { marginTop: '6px' });
  const overallTitle = document.createElement('div');
  overallTitle.textContent = 'Overall Response / Outcome Breakdown';
  overallTitle.style.fontWeight = '700';
  overallTitle.style.margin = '8px 0';
  const overallCanvas = chartCanvas('overallResponsesChart');
  overallBlock.append(overallTitle, overallCanvas.wrap);

  // Responses by Grad Year (pie)
  const gyBlock = div('', { marginTop: '6px' });
  const gyTitle = document.createElement('div');
  gyTitle.textContent = 'Answered Distribution by High School Graduation Year*';
  gyTitle.style.fontWeight = '700';
  gyTitle.style.margin = '8px 0';
  const gyCanvas = chartCanvas('responsesByGradYearChart');
  gyBlock.append(gyTitle, gyCanvas.wrap);

  descSection.append(overallBlock, gyBlock);

  // Section: Call Statistics
  const callSection = div('', { marginTop: '16px' });
  callSection.append(h2('Call Statistics'));

  // Time of day (line)
  const todBlock = div('', { marginTop: '6px' });
  const todTitle = document.createElement('div');
  todTitle.textContent = 'Responses by Hour of Day';
  todTitle.style.fontWeight = '700';
  todTitle.style.margin = '8px 0';
  const todCanvas = chartCanvas('responsesByHourChart');
  todBlock.append(todTitle, todCanvas.wrap);

  // Day of week (line)
  const dowBlock = div('', { marginTop: '6px' });
  const dowTitle = document.createElement('div');
  dowTitle.textContent = 'Responses by Day of Week';
  dowTitle.style.fontWeight = '700';
  dowTitle.style.margin = '8px 0';
  const dowCanvas = chartCanvas('responsesByDOWChart');
  dowBlock.append(dowTitle, dowCanvas.wrap);

  callSection.append(todBlock, dowBlock);

  sectionWrap.append(descSection, callSection);
  page.append(header, sectionWrap);
  root.appendChild(page);

  // === Data and charts state ===
  let students = [];
  let campaigns = [];
  let charts = { overall: null, byGradYear: null, byHour: null, byDOW: null };

  // Load students & campaigns
  try {
    students = await getAllStudents();     // array of student objects
  } catch (e) {
    console.error('Failed to load students:', e);
  }

  try {
    campaigns = await getAllCampaigns();   // array of campaigns
  } catch (e) {
    console.error('Failed to load campaigns:', e);
  }

  const activeCampaigns = (campaigns || []).filter(c => c?.active !== false); // treat undefined as active
  // Populate dropdown
  campaignSelect.innerHTML = '';
  for (const c of activeCampaigns) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || `Campaign ${c.id}`;
    campaignSelect.appendChild(opt);
  }
  if (activeCampaigns.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No active campaigns';
    campaignSelect.appendChild(opt);
    campaignSelect.disabled = true;
  }

  // Quick student lookup by studentId
  const studentById = {};
  // campaign execution uses getStudentId(s, i); student objects likely have an ID field we derive elsewhere.
  // We defensively index by a few common keys.
  for (const s of students || []) {
    const possibleIds = [
      s.id, s.ID, s.Id, s['Student ID'], s.student_id, s.studentId
    ].filter(Boolean);
    const sid = String(possibleIds[0] ?? '').trim();
    if (sid) studentById[sid] = s;
  }

  async function refreshCharts(campaignId) {
    if (!campaignId) return;

    // Read progress for selected campaign
    let progress = null;
    try {
      // loadOrInitProgress(campaignId, queueIds) requires queueIds normally.
      // For insights we just want persisted data; pass an empty array defensively.
      progress = await loadOrInitProgress(campaignId, []);
    } catch (e) {
      console.error('Failed to load progress for insights:', e);
    }

    const activity = extractActivity(progress);

    // Build a normalized table for this campaign
    // Fields: Full Name, Response, Notes, Timestamp, Student ID, Campaign ID, Campaign Name
    const campaignName = (activeCampaigns.find(c => String(c.id) === String(campaignId))?.name) || '';
    const rows = activity.map(a => {
      const stu = studentById[a.studentId] || {};
      const fullName = `${stu.first_name ?? ''} ${stu.last_name ?? ''}`.trim() || (stu.full_name ?? stu.name ?? '') || '';
      return {
        fullName,
        response: a.surveyResponse ?? a.outcome ?? null,
        notes: a.note ?? '',
        timestamp: a.timestamp ?? null,
        studentId: a.studentId,
        campaignId,
        campaignName
      };
    });

    // === 1) Descriptive statistics ===
    // 1a. Overall Response/Outcome breakdown (bar)
    const overallCounts = {};
    for (const r of rows) {
      const key = (r.response ?? 'unknown').toString();
      overallCounts[key] = (overallCounts[key] || 0) + 1;
    }
    const overallLabels = Object.keys(overallCounts);
    const overallData = overallLabels.map(k => overallCounts[k]);

    destroyChart(charts.overall);
    charts.overall = new Chart(document.getElementById('overallResponsesChart').getContext('2d'), {
      type: 'bar',
      data: {
        labels: overallLabels,
        datasets: [{
          label: 'Count',
          data: overallData
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          title: { display: false }
        },
        scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
      }
    });

    // 1b. Answered distribution by Graduation Year (pie)
    // Define "response" for this chart as rows where outcome === 'answered' (or response === 'answered')
    const answeredRows = rows.filter(r => String(r.response).toLowerCase() === 'answered');
    const byGY = {};
    for (const r of answeredRows) {
      const stu = studentById[r.studentId] || {};
      const gy = getGradYear(stu);
      byGY[gy] = (byGY[gy] || 0) + 1;
    }
    const gyLabels = Object.keys(byGY);
    const gyData = gyLabels.map(k => byGY[k]);

    destroyChart(charts.byGradYear);
    charts.byGradYear = new Chart(document.getElementById('responsesByGradYearChart').getContext('2d'), {
      type: 'pie',
      data: {
        labels: gyLabels,
        datasets: [{
          label: 'Answered',
          data: gyData
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });

    // === 2) Call statistics ===
    // Use only answered responses to infer "response"
    const answeredWithTime = answeredRows
      .map(r => ({ ...r, dt: toDateSafe(r.timestamp) }))
      .filter(r => r.dt);

    // 2a. By hour of day
    const hours = new Array(24).fill(0);
    for (const r of answeredWithTime) {
      hours[r.dt.getHours()] += 1;
    }

    destroyChart(charts.byHour);
    charts.byHour = new Chart(document.getElementById('responsesByHourChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: [...Array(24).keys()].map(h => `${h}:00`),
        datasets: [{
          label: 'Answered',
          data: hours,
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
      }
    });

    // 2b. By day of week (0=Sun..6=Sat)
    const dowCounts = new Array(7).fill(0);
    for (const r of answeredWithTime) {
      dowCounts[r.dt.getDay()] += 1;
    }
    const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    destroyChart(charts.byDOW);
    charts.byDOW = new Chart(document.getElementById('responsesByDOWChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: dowLabels,
        datasets: [{
          label: 'Answered',
          data: dowCounts,
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
      }
    });
  }

  // Initial render
  if (activeCampaigns.length > 0) {
    await refreshCharts(activeCampaigns[0].id);
  }

  campaignSelect.addEventListener('change', async () => {
    const val = campaignSelect.value;
    await refreshCharts(val);
  });
}

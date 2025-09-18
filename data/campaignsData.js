// Storage keys
const K = {
  CAMPAIGNS: 'reachpoint.campaigns',
  STUDENTS: 'reachpoint.studentsCache', // optional cache if you inline JSON
};

// Load students: either fetch /data/students.json or inline <script id="students-json">
export async function getAllStudents() {
  // Try inline first
  const inline = document.getElementById('students-json');
  if (inline?.textContent?.trim()) {
    try { return JSON.parse(inline.textContent); } catch {}
  }
  // Fallback to file
  const resp = await fetch('./data/students.json', { cache: 'no-store' });
  const json = await resp.json();
  return Array.isArray(json) ? json : (json?.data ?? []);
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

/** Derive a stable student id from row + position (compatible with your app) */
export function getStudentId(student, idx) {
  const key =
    student.id ?? student.student_id ?? student.uuid ??
    `${student.first_name ?? ''}-${student.last_name ?? ''}-${idx}`;
  return String(key);
}

/** Field list from dataset */
export function uniqueFieldsFromStudents(rows) {
  const set = new Set();
  for (const r of rows) for (const k of Object.keys(r||{})) set.add(k);
  return Array.from(set);
}

/** Apply filters: [{field, op, value}] */
export function applyFilters(rows, filters) {
  if (!filters?.length) return rows.slice();
  const ops = {
    '=': (a,b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase(),
    '~': (a,b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
    '>': (a,b) => Number(a) > Number(b),
    '>=':(a,b) => Number(a) >= Number(b),
    '<': (a,b) => Number(a) < Number(b),
    '<=':(a,b) => Number(a) <= Number(b),
  };
  return rows.filter(r => {
    return filters.every(f => {
      const a = r?.[f.field];
      const fn = ops[f.op] || ops['='];
      return fn(a, f.value);
    });
  });
}

/* ---------------- Campaign CRUD ---------------- */
export function listCampaigns() {
  const arr = JSON.parse(localStorage.getItem(K.CAMPAIGNS) || '[]');
  return arr;
}
export function getCampaignById(id) {
  return listCampaigns().find(c => c.id === id) || null;
}
export async function saveCampaign(campaign) {
  const arr = listCampaigns();
  const i = arr.findIndex(c => c.id === campaign.id);
  if (i >= 0) arr[i] = campaign; else arr.push(campaign);
  localStorage.setItem(K.CAMPAIGNS, JSON.stringify(arr));
  return campaign;
}
export async function deleteCampaign(id) {
  const arr = listCampaigns().filter(c => c.id !== id);
  localStorage.setItem(K.CAMPAIGNS, JSON.stringify(arr));
  return true;
}

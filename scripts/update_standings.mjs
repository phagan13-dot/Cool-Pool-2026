// Fetches NFL standings + playoff results from ESPN's unofficial JSON API and rewrites data/standings.json.
// Needs Node 18+. If anything looks wrong it exits with an error and leaves the existing file untouched.
// Manual fixes: put {"ABBR": {"div": true}} style entries in data/overrides.json.
import { readFileSync, writeFileSync, existsSync } from 'fs';
const SEASON = 2026, BASE = 'https://site.api.espn.com/apis';
const norm = a => ({ WAS: 'WSH', JAC: 'JAX', LA: 'LAR' }[a] || a);
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const stat = (e, n) => e.stats?.find(s => s.name === n);
const valid = new Set(Object.keys(JSON.parse(readFileSync('data/teams.json'))));
const prev = JSON.parse(readFileSync('data/standings.json')).teams || {};

const sd = await get(`${BASE}/v2/sports/football/nfl/standings?season=${SEASON}`);
const teams = {};
for (const conf of sd.children || [])
  for (const e of conf.standings?.entries || []) {
    const a = norm(e.team.abbreviation);
    if (!valid.has(a)) continue;
    const clinch = (stat(e, 'clincher')?.displayValue || '').toLowerCase();
    teams[a] = { w: stat(e, 'wins')?.value ?? 0, l: stat(e, 'losses')?.value ?? 0, gp: stat(e, 'gamesPlayed')?.value ?? 0,
      seed: stat(e, 'playoffSeed')?.value ?? 99, div: ['y', 'z'].includes(clinch), pw: 0, conf: false, sb: false };
  }
if (Object.keys(teams).length !== 32) throw new Error(`Expected 32 teams, got ${Object.keys(teams).length}`);

// Once every team has finished the regular season, seeds 1-4 in each conference are the division winners.
if (Object.values(teams).every(t => t.gp >= 17)) for (const t of Object.values(teams)) t.div = t.seed <= 4;

// Playoffs: ESPN postseason weeks 1=Wild Card, 2=Divisional, 3=Conference, 5=Super Bowl
let playoffsOk = true;
for (const week of [1, 2, 3, 5]) {
  try {
    const sb = await get(`${BASE}/site/v2/sports/football/nfl/scoreboard?seasontype=3&week=${week}&dates=${SEASON + 1}`);
    for (const ev of sb.events || []) {
      if (!ev.status?.type?.completed) continue;
      const win = ev.competitions[0].competitors.find(c => c.winner);
      const t = win && teams[norm(win.team.abbreviation)];
      if (!t) continue;
      t.pw++; if (week === 3) t.conf = true; if (week === 5) t.sb = true;
    }
  } catch (e) { playoffsOk = false; console.warn('Playoff week', week, 'failed:', e.message); }
}
// If a playoff lookup failed, keep the playoff numbers from the last good run instead of zeroing them.
if (!playoffsOk) for (const [a, t] of Object.entries(teams)) if (prev[a]) Object.assign(t, { pw: prev[a].pw || 0, conf: !!prev[a].conf, sb: !!prev[a].sb });

if (existsSync('data/overrides.json')) {
  for (const [a, v] of Object.entries(JSON.parse(readFileSync('data/overrides.json')))) Object.assign(teams[a] || {}, v);
}
for (const t of Object.values(teams)) { delete t.gp; delete t.seed; }
writeFileSync('data/standings.json', JSON.stringify({ updated: new Date().toISOString(), teams }));
console.log('Updated', Object.keys(teams).length, 'teams');

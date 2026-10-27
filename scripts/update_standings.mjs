// Fetches NFL standings + playoff results from ESPN's unofficial JSON API and rewrites data/standings.json.
// Needs Node 18+. If anything looks wrong it exits with an error and leaves the existing file untouched.
// Manual fixes: put {"ABBR": {"div": true}} style entries in data/overrides.json.
import { readFileSync, writeFileSync, existsSync } from 'fs';
const SEASON = 2026, BASE = 'https://site.api.espn.com/apis';
const norm = a => ({ WAS: 'WSH', JAC: 'JAX', LA: 'LAR' }[a] || a);
const get = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const stat = (e, n) => e.stats?.find(s => s.name === n);
const valid = new Set(Object.keys(JSON.parse(readFileSync('data/teams.json'))));
const old = JSON.parse(readFileSync('data/standings.json'));
const prev = old.teams || {};

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

// ---- Projections: expected remaining wins + division-title odds (Monte Carlo simulation) ----
const ab = Object.keys(teams), meta = JSON.parse(readFileSync('data/teams.json'));
const cur = a => { const t = teams[a]; return t.w + (t.div ? 5 : 0) + 3 * t.pw + (t.conf ? 5 : 0) + (t.sb ? 5 : 0); };
const maxgp = Math.max(...ab.map(a => teams[a].gp));
const games = new Map();
await Promise.all(ab.map(async a => { try {
  const s = await get(`${BASE}/site/v2/sports/football/nfl/teams/${a.toLowerCase()}/schedule?season=${SEASON}&seasontype=2`);
  for (const ev of s.events || []) {
    const c = ev.competitions?.[0];
    if (!c || (c.status ?? ev.status)?.type?.completed) continue;
    const h = c.competitors.find(x => x.homeAway === 'home'), v = c.competitors.find(x => x.homeAway === 'away');
    if (h && v) games.set(ev.id, [norm(h.team.abbreviation), norm(v.team.abbreviation)]);
  }
} catch (e) { console.warn('Schedule', a, e.message); } }));
{
  // Win odds per game: each team's record (pulled toward .500 early in the season) plus a small home-field edge.
  const rate = a => { const p = (teams[a].w + 4) / (teams[a].gp + 8); return Math.log(p / (1 - p)); };
  let list = [...games.values()].filter(([h, v]) => teams[h] && teams[v]).map(([h, v]) => [h, v, 1 / (1 + Math.exp(-(rate(h) - rate(v) + 0.25)))]);
  if (!list.length && ab.some(a => teams[a].gp < 17)) {
    // Schedule feed unavailable: simulate each team's remaining games against an average opponent instead.
    console.warn('No remaining schedule found; using average-opponent fallback');
    list = ab.flatMap(a => Array.from({ length: Math.max(0, 17 - teams[a].gp) }, () => [a, null, 1 / (1 + Math.exp(-rate(a)))]));
  }
  const groups = {}; for (const a of ab) (groups[meta[a].conf + meta[a].div] ??= []).push(a);
  let seed = [...JSON.stringify(ab.map(a => [a, teams[a].w, teams[a].l, teams[a].pw, teams[a].div]))].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const N = 2000, ew = {}, dw = {}; ab.forEach(a => { ew[a] = 0; dw[a] = 0; });
  for (let i = 0; i < N; i++) {
    const w = {}; ab.forEach(a => w[a] = teams[a].w);
    for (const [h, v, p] of list) { const x = rnd() < p ? h : v; if (x) w[x]++; }
    ab.forEach(a => ew[a] += w[a] - teams[a].w);
    for (const g of Object.values(groups)) {
      if (g.some(a => teams[a].div)) continue;
      const best = Math.max(...g.map(a => w[a])), c = g.filter(a => w[a] === best);
      dw[c[Math.floor(rnd() * c.length)]]++;
    }
  }
  // proj = projected regular-season points (wins + division bonus); pwins = average simulated final wins; pdiv = division-title odds %
  for (const a of ab) {
    const t = teams[a];
    t.proj = +(cur(a) + ew[a] / N + (t.div ? 0 : 5 * dw[a] / N)).toFixed(1);
    t.pwins = +(t.w + ew[a] / N).toFixed(1);
    t.pdiv = t.div ? 100 : Math.round(100 * dw[a] / N);
  }
}
// Weekly snapshot (keyed by games played) so the page can show movement since last week.
const history = old.history || {};
history[maxgp] = { updated: new Date().toISOString(), pts: Object.fromEntries(ab.map(a => [a, cur(a)])) };
for (const t of Object.values(teams)) delete t.seed;
if (old.maxgp === maxgp && JSON.stringify(old.teams) === JSON.stringify(teams)) { console.log('No change since last update'); process.exit(0); }
writeFileSync('data/standings.json', JSON.stringify({ updated: new Date().toISOString(), maxgp, history, teams }));
console.log('Updated', Object.keys(teams).length, 'teams');

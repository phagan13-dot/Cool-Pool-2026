# Cool Pool 2026–27
Static site: `index.html` reads `data/*.json` and recalculates every entry in the browser.
A GitHub Action (`.github/workflows/update.yml`) refreshes `data/standings.json` every 3 hours.

## Maintenance
- New season: `python scripts/build_entries.py pool.xlsm`, update `SEASON` in `scripts/update_standings.mjs`.
- Manual fixes: add to `data/overrides.json`, e.g. `{"DEN": {"div": true}}`.
- ESPN's endpoints are unofficial; if a run fails, old standings stay and the Actions tab shows the error.

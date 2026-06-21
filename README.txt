AU COMMODITY SUPPLY MONITOR — Windows Edition
Strait of Hormuz Crisis Dashboard | June 2026

=============================================
QUICK START
=============================================

1. Install Node.js (if not already installed):
   https://nodejs.org  →  download the LTS version

2. Double-click  start.bat

3. Dashboard opens automatically at http://localhost:5000

That's it. The app installs its own dependencies on first run.

=============================================
WHAT THIS DASHBOARD SHOWS
=============================================

Real-time Australian commodity supply monitoring tracking the
impact of the 2026 Strait of Hormuz crisis on fuel and
fertilizer supply chains.

TABS:
  Overview      — Crisis banner, key metrics, crisis timeline,
                  sector alert strip (always visible)
  Commodities   — Month-by-month: 2024 baseline → 2025 → 2026
                  crisis → Sep 2026 projection. Sub-tabs for
                  Refinery Supply Chain and Origin Regions.
  Sector Impacts — Real-world impacts for farmers, logistics,
                  households, businesses, critical infrastructure
  Reserves      — National fuel stockpiles vs IEA 90-day standard

DATA SOURCE:
  Live ABS MERCH_IMP API (free, no API key required)
  Auto-syncs daily — no manual updates needed.
  Data currently available through Apr 2026.

COMMODITIES TRACKED:
  Fertilizer: Urea (SITC 562), DAP/MAP (562), Potash/MOP (272)
  Petroleum:  Crude (333), Refined diesel/petrol (334), Jet fuel (335)

=============================================
DATA PERSISTENCE
=============================================

Trade data is stored locally in  data.db  (SQLite).
This file is created automatically on first run.
Do not delete it — it preserves your sync history.

To reset all data: delete data.db and restart.

=============================================
REQUIREMENTS
=============================================

  - Windows 10 or 11
  - Node.js 18+ (https://nodejs.org)
  - Internet connection (for live ABS data sync)
  - ~500 MB disk space (for node_modules)

=============================================
LIVE VERSION (always up to date)
=============================================

  https://au-supply-monitor.pplx.app

The live site pulls fresh ABS data daily and is always
current without any setup required.

=============================================
SOURCES
=============================================

  ABS MERCH_IMP API      https://api.data.abs.gov.au
  Wikipedia — Crisis     https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis
  SBS Fuel Supply        https://www.sbs.com.au/news/article/australia-fuel-shortage-2026/zl0grg7ey
  Budget 2026-27         https://budget.gov.au/content/01-fuel-supply-and-security.htm
  OilPrice.com           https://oilprice.com/Energy/Energy-General/Australias-Fuels-Dependence-Turns-Into-a-Crisis.html
  Rabobank Urea Report   https://www.rabobank.com.au/news/media-releases/2025/supply-fragility-creating-volatility-in-urea-market-rabobank-report
  CommBank Farm Costs    https://www.commbank.com.au/articles/newsroom/2026/05/disruption-drives-up-farm-costs.html
  ABC Fertiliser Deficit https://www.abc.net.au/news/2026-04-15/australian-fertiliser-manufacturing-after-iran-war-deficit/106559278
  CSIS Analysis          https://www.csis.org/analysis/iran-fertilizer-and-food-security-risks-impacts-and-policy-responses

=============================================

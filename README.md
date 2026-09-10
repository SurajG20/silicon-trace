# SiliconTrace

**Semiconductor supply-chain risk explorer — powered by CognoDB.**

Pick any fab in the world, take it offline, and see which finished products die,
how much revenue is at risk, and where to dual-source before it happens.

🔗 **Live demo**: https://wexa-ai-drab.vercel.app

| Dashboard | Impact simulator | BOM explorer |
| --- | --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Impact](docs/screenshots/impact.png) | ![BOM](docs/screenshots/bom.png) |

## Highlights

- **One-click worst-case** — the impact simulator suggests the highest-risk
  facility, so first-time visitors get the most dramatic blast radius instantly.
- **Shareable simulations** — every result links to a deep URL
  (`/impact?facility=…`) with a copy-to-clipboard button; links auto-run on open.
- **CSV exports** — blast-radius results and the single-points-of-failure
  report download as CSV for follow-up analysis.

## Why a graph database?

A bill of materials is a **recursive hierarchy**: products contain modules that
contain sub-modules and components, and every part can be sourced from multiple
suppliers operating facilities across regions. The questions this app exists to
ask are all traversals:

- "What dies if this fab goes offline?" = variable-depth walk up the BOM from
  facility → supplier → part → product. In SQL that's recursive CTEs with
  careful dedup; in Cypher it's one line:
  `(product)-[:HAS_MODULE|CONTAINS*1..]->(part)`
- Shared parts fan out across many products through many BOM routes — Cypher's
  `WITH DISTINCT` handles the dedup naturally.
- "Alternate suppliers whose entire supply base sits outside the impacted
  region" is a neighbourhood-shape query: pattern comprehension + `ALL`
  predicate vs. nested `NOT EXISTS` subqueries in SQL.
- New concepts (e.g. purchased assemblies) need no migration — just new edges.

## Data model

```
Region ◄─LOCATED_IN─ Facility ◄─OPERATES─ Supplier
   ▲                                  ▲
   │                        SUPPLIED_BY│ share_pct, lead_time_days
   └──────────────────────┐            │
              ALT_SOURCE  │      ┌─────┴─────┐
        (qualified ───────┴────► │ Component │ ◄─CONTAINS*1..─ Module
         alternates)             └───────────┘                   ▲
                                          ▲                      │HAS_MODULE
                              Module ─CONTAINS┘                 Product
```

- **Nodes** (515): `Product`, `Module`, `Component`, `Supplier`, `Facility`, `Region`
- **Relationships** (999): `HAS_MODULE`, `CONTAINS` (recursive BOM),
  `SUPPLIED_BY` (share %, lead time, unit cost), `OPERATES`, `LOCATED_IN`,
  `ALT_SOURCE`
- Dataset: 60 suppliers · 141 facilities · 89 shared components · 30 products
  across TW / KR / CN / JP / US / EU. Deterministic and idempotent (`MERGE` +
  uniqueness constraints).

## Setup

1. Create a free instance at [console.cognodb.com/signup](https://console.cognodb.com/signup);
   copy the `bolt+s://…` URI and the generated password (shown once).
2. Run the app:

```bash
npm install
cp .env.example .env    # fill in COGNODB_URI / COGNODB_USER / COGNODB_PASSWORD
npm run seed            # loads schema constraints + full dataset
npm run dev             # http://localhost:3000
```

## Key queries ([src/lib/cypher/queries.ts](src/lib/cypher/queries.ts))

All parameterised via the official Neo4j driver — no string interpolation.

**Blast radius (6 hops):** facility ← supplier ← part ← variable-depth BOM → products,
deduped per product and ranked by revenue at risk:

```cypher
MATCH (f:Facility {id: $facilityId})-[:LOCATED_IN]->(region:Region)
MATCH (f)<-[:OPERATES]-(supplier)<-[sup:SUPPLIED_BY]-(part)
MATCH (product:Product)-[:HAS_MODULE|CONTAINS*1..]->(part)
WITH DISTINCT product, ...
```

**Mitigation finder:** keep only alternate sources whose *entire* supply base
sits outside the impacted region:

```cypher
MATCH (part)-[:ALT_SOURCE]->(alt)-[altSup:SUPPLIED_BY]->(altSupplier)
WITH *, [(altSupplier)-[:OPERATES]->(:Facility)-[:LOCATED_IN]->(ar:Region) | ar.iso] AS altRegions
WHERE ALL(iso IN altRegions WHERE iso <> impacted.iso)
```

**Single points of failure:** components with exactly one supplier, ranked by
revenue exposed across all dependent products (recursive traversal +
aggregation).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Recharts ·
`neo4j-driver` over Bolt → CognoDB. Env config validated with zod; DB access
through managed transactions; errors classified into actionable UI states;
`GET /api/health` reports connectivity.

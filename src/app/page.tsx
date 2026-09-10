import Link from "next/link";
import { ArrowRightIcon, ZapIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { RiskBadge, riskLevel } from "@/components/risk-badge";
import { RegionExposureChart } from "@/components/region-exposure-chart";
import { SpofExportButton } from "@/components/spof-export-button";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getCatalog,
  getGlobalStats,
  getRegionExposure,
  getSinglePointsOfFailure,
} from "@/lib/services";
import { fmtCompactUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, regions, spof, catalog] = await Promise.all([
    getGlobalStats(),
    getRegionExposure(),
    getSinglePointsOfFailure(10),
    getCatalog(),
  ]);

  const topProducts = [...catalog].sort((a, b) => b.annualRevenueUsd - a.annualRevenueUsd).slice(0, 6);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card to-background px-6 py-10 sm:px-10">
        <div className="bg-blueprint absolute inset-0" aria-hidden />
        <div className="relative">
          <PageHeader
            eyebrow="Supply-chain graph intelligence"
            title="When a fab goes dark, what goes dark with it?"
            description="SiliconTrace models the semiconductor supply chain as a graph — products, bills of material, suppliers, fabs and regions. Traverse it to find the blast radius of an outage before it happens."
            actions={
              <Link
                href="/impact"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ZapIcon className="size-4" /> Run impact simulation
              </Link>
            }
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Products tracked" value={stats.products} sub={`${fmtCompactUsd(catalog.reduce((a, p) => a + p.annualRevenueUsd, 0))} annual revenue`} />
        <KpiCard label="Components mapped" value={stats.components} sub="catalog-level part numbers" />
        <KpiCard label="Suppliers" value={stats.suppliers} sub={`${stats.facilities} facilities worldwide`} />
        <KpiCard label="Regions" value={stats.regions} sub="geopolitical risk scored" />
        <KpiCard
          label="Single-sourced parts"
          value={stats.singleSourcedComponents}
          tone={stats.singleSourcedComponents > 0 ? "amber" : "emerald"}
          sub="no qualified second source"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="border-border/60 bg-card/70 lg:col-span-3">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Revenue exposure by region
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {regions.some((r) => (r.revenueExposedUsd ?? 0) > 0) ? (
              <RegionExposureChart data={regions} />
            ) : (
              <EmptyState title="No exposure data" description="Load the seed dataset to populate the risk model." />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Highest-value products
            </CardTitle>
            <Link href="/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
              Catalog <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-2">
            {topProducts.map((p) => (
              <Link
                key={p.sku}
                href={`/products/${p.sku}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {p.brand} · {p.singleSourceParts} single-sourced parts
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular-nums">{fmtCompactUsd(p.annualRevenueUsd)}</p>
                  {p.singleSourceParts > 0 ? (
                    <RiskBadge level={riskLevel(Math.min(100, p.singleSourceParts * 25))} className="mt-0.5 scale-90" />
                  ) : (
                    <RiskBadge level="low" className="mt-0.5 scale-90" />
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Single points of failure
          </h2>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">ranked by revenue exposed</span>
            <SpofExportButton rows={spof} />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/70">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Component</TableHead>
                <TableHead>Sole supplier</TableHead>
                <TableHead className="text-right">Lead time</TableHead>
                <TableHead className="text-right">Products hit</TableHead>
                <TableHead className="text-right">Revenue exposed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spof.map((row) => (
                <TableRow key={row.mpn}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{row.category}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.supplierName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.leadTimeDays}d</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.dependentProducts}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums font-medium">{fmtCompactUsd(row.revenueExposedUsd)}</TableCell>
                </TableRow>
              ))}
              {spof.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState title="No single points of failure detected" className="border-0" />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

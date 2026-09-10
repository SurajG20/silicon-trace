"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FactoryIcon,
  FlameIcon,
  LoaderCircleIcon,
  PackageSearchIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TrendingDownIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { RiskBadge, riskLevel } from "@/components/risk-badge";
import { cn } from "@/lib/utils";
import { fmtCompactInt, fmtCompactUsd } from "@/lib/format";
import { copyText, downloadCsv, toCsv } from "@/lib/csv";
import type { FacilityOption, ImpactSummary } from "@/lib/services/types";

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; summary: ImpactSummary };

const TYPE_LABELS: Record<string, string> = {
  fab: "Wafer fab",
  osat: "Assembly & test",
  assembly: "Final assembly",
  test: "Test site",
};

export function ImpactSimulator({ facilities }: { facilities: FacilityOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the selected facility, so
  // deep links (?facility=…) work without duplicating state.
  const selectedId = searchParams.get("facility");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const autoRanFor = useRef<string | null>(null);

  const selected = useMemo(() => facilities.find((f) => f.id === selectedId) ?? null, [facilities, selectedId]);

  // Highest region risk first, most parts sourced as tie-break — the most
  // dramatic demo for first-time visitors with zero domain knowledge.
  const worstCase = useMemo(
    () =>
      [...facilities].sort(
        (a, b) => b.regionRiskIndex - a.regionRiskIndex || b.partsSourced - a.partsSourced,
      )[0] ?? null,
    [facilities],
  );

  const run = useCallback(
    async (facilityId: string) => {
      setPhase({ kind: "loading" });
      try {
        const res = await fetch(`/api/impact?facility=${encodeURIComponent(facilityId)}`, { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Simulation failed (${res.status})`);
        }
        const summary = (await res.json()) as ImpactSummary;
        setPhase({ kind: "done", summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        setPhase({ kind: "error", message });
        toast.error("Simulation failed", { description: message });
      }
    },
    [],
  );

  // Deep links (?facility=…) auto-run exactly once per facility.
  useEffect(() => {
    const preset = searchParams.get("facility");
    if (!preset || !facilities.some((f) => f.id === preset)) return;
    if (autoRanFor.current === preset) return;
    autoRanFor.current = preset;
    void run(preset);
  }, [searchParams, facilities, run]);

  function select(id: string) {
    setPickerOpen(false);
    setPhase({ kind: "idle" });
    router.replace(`/impact?facility=${encodeURIComponent(id)}`, { scroll: false });
  }

  function runWorstCase() {
    if (!worstCase) return;
    setPickerOpen(false);
    // Replace the URL (so the result stays shareable) and run directly —
    // the ?facility= auto-run guard fires only once per facility.
    router.replace(`/impact?facility=${encodeURIComponent(worstCase.id)}`, { scroll: false });
    void run(worstCase.id);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Control panel */}
      <div className="space-y-4 lg:col-span-4">
        <Card className="border-border/60 bg-card/70">
          <CardContent className="space-y-5 p-5">
            <div>
              <h2 className="text-sm font-semibold">Disruption source</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a facility to take offline. SiliconTrace walks the graph backwards through suppliers and
                bills of material to find every finished product in the blast radius.
              </p>
            </div>

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="h-auto w-full justify-between px-3 py-2.5 text-left"
                >
                  {selected ? (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <FactoryIcon className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{selected.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {selected.city} · {TYPE_LABELS[selected.type] ?? selected.type} · {selected.partsSourced} parts
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <FactoryIcon className="size-4" /> Select a facility…
                    </span>
                  )}
                  <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search facilities, cities, regions…" />
                  <CommandList>
                    <CommandEmpty>No facility matches.</CommandEmpty>
                    {groupByRegion(facilities).map(([regionName, list]) => (
                      <CommandGroup key={regionName} heading={`${regionName} · risk ${list[0].regionRiskIndex}`}>
                        {list.map((f) => (
                          <CommandItem key={f.id} value={`${f.name} ${f.city} ${f.regionName}`} onSelect={() => select(f.id)}>
                            <FactoryIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{f.name}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {f.city} · {f.partsSourced} parts sourced
                              </span>
                            </span>
                            <span className={cn("font-mono text-[11px] tabular-nums", f.regionRiskIndex >= 65 ? "text-risk-critical" : "text-muted-foreground")}>
                              {f.regionRiskIndex}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {selected ? (
              <div className="rounded-lg border border-border/60 bg-secondary/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Region risk</span>
                  <RiskBadge level={riskLevel(selected.regionRiskIndex)} />
                </div>
                <Separator className="my-3" />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Facility ID</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">{selected.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Parts sourced here</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">{selected.partsSourced}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <Button className="w-full gap-2" disabled={!selected || phase.kind === "loading"} onClick={() => selected && void run(selected.id)}>
              {phase.kind === "loading" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ZapIcon className="size-4" />}
              {phase.kind === "loading" ? "Traversing graph…" : "Simulate outage"}
            </Button>

            {worstCase && phase.kind !== "loading" ? (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={runWorstCase}
                title={`${worstCase.name} · ${worstCase.city} (risk ${worstCase.regionRiskIndex})`}
              >
                <FlameIcon className="size-4" />
                Try worst-case facility
              </Button>
            ) : null}

            {phase.kind === "done" ? (
              <Button variant="ghost" size="sm" className="w-full gap-1.5 text-muted-foreground" onClick={() => setPhase({ kind: "idle" })}>
                <RotateCcwIcon className="size-3.5" /> Reset results
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      <div className="lg:col-span-8">
        {phase.kind === "idle" ? (
          <EmptyState
            className="min-h-[420px]"
            title="No simulation yet"
            description="Choose a facility on the left and hit “Simulate outage”. The blast radius is computed live from the CognoDB graph with a multi-hop Cypher traversal."
          />
        ) : null}

        {phase.kind === "loading" ? <ResultsSkeleton /> : null}

        {phase.kind === "error" ? (
          <EmptyState
            className="min-h-[420px]"
            tone="error"
            title="Simulation failed"
            description={phase.message}
            action={
              selected ? (
                <Button size="sm" onClick={() => void run(selected.id)}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {phase.kind === "done" ? <Results summary={phase.summary} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Results({ summary }: { summary: ImpactSummary }) {
  const { facility, impactedProducts, revenueAtRiskUsd, mitigations } = summary;
  const worstExposure = impactedProducts.reduce((m, p) => Math.max(m, p.exposureScore), 0);
  const totalUnits = impactedProducts.reduce((a, p) => a + p.annualUnits, 0);

  async function share() {
    const url = `${window.location.origin}/impact?facility=${encodeURIComponent(facility.id)}`;
    const ok = await copyText(url);
    if (ok) toast.success("Share link copied", { description: `${facility.name} blast radius` });
    else toast.error("Copy failed", { description: url });
  }

  function exportCsv() {
    const csv = toCsv(
      ["sku", "product", "brand", "category", "annual_revenue_usd", "annual_units", "exposure_score", "sole_source_chokepoints"],
      impactedProducts.map((p) => [p.sku, p.name, p.brand, p.category, p.annualRevenueUsd, p.annualUnits, p.exposureScore, p.singleSourceChokepoints]),
    );
    downloadCsv(`silicontrace-impact-${facility.id}.csv`, csv);
    toast.success("Results exported", { description: `${impactedProducts.length} products` });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResultKpi label="SKUs impacted" value={String(impactedProducts.length)} />
        <ResultKpi label="Revenue at risk" value={fmtCompactUsd(revenueAtRiskUsd)} tone="red" />
        <ResultKpi label="Worst exposure" value={`${worstExposure}%`} tone="amber" />
        <ResultKpi label="Mitigations found" value={String(mitigations.length)} tone="emerald" />
      </div>

      <Card className="border-border/60 bg-card/70">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
            <p className="text-sm">
              <span className="font-semibold">{impactedProducts.length}</span> products depend on{" "}
              <span className="font-medium text-primary">{facility.name}</span>
              <span className="text-muted-foreground"> ({fmtCompactInt(totalUnits)} units/yr)</span>
            </p>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={() => void share()}>
                <CopyIcon className="size-3.5" /> Share
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={exportCsv}
                disabled={impactedProducts.length === 0}
              >
                <DownloadIcon className="size-3.5" /> CSV
              </Button>
            </div>
          </div>

          {impactedProducts.length === 0 ? (
            <EmptyState
              title="Blast radius is empty"
              description="No finished products route through this facility in the current dataset."
              className="border-0"
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {impactedProducts.map((p, i) => (
                <li key={p.sku} className="animate-rise" style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}>
                  <Link
                    href={`/products/${p.sku}`}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-secondary/30"
                  >
                    <div className="hidden w-10 shrink-0 sm:block">
                      <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border text-[11px] font-mono tabular-nums"
                        style={{
                          borderColor: p.exposureScore >= 90 ? "#e0555577" : p.exposureScore >= 60 ? "#e8a33d77" : "#57b98a55",
                          color: p.exposureScore >= 90 ? "#e05555" : p.exposureScore >= 60 ? "#e8a33d" : "#57b98a",
                        }}
                      >
                        {p.exposureScore}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <Badge variant="outline" className="shrink-0 rounded px-1.5 py-0 text-[10px] text-muted-foreground">
                          {p.category}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.chokepoints.slice(0, 2).map((cp) => (
                          <span key={cp.part} className="inline-flex max-w-[240px] items-center gap-1 rounded bg-secondary/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            <TrendingDownIcon className="size-3" />
                            <span className="truncate">{cp.part}</span>
                            {cp.singleSource ? <AlertTriangleIcon className="size-3 shrink-0 text-risk-high" /> : null}
                          </span>
                        ))}
                        {p.chokepoints.length > 2 ? (
                          <span className="text-[11px] text-muted-foreground">+{p.chokepoints.length - 2} more</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-medium tabular-nums">{fmtCompactUsd(p.annualRevenueUsd)}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
                        {p.singleSourceChokepoints > 0 ? (
                          <>
                            <AlertTriangleIcon className="size-3 text-risk-critical" /> {p.singleSourceChokepoints} sole-source
                          </>
                        ) : (
                          "multi-sourced"
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {mitigations.length > 0 ? (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
          <CardContent className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheckIcon className="size-4 text-risk-low" /> Qualified alternate sources outside the impacted region
            </h3>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {mitigations.map((m) => (
                <li key={m.mpn} className="rounded-lg border border-border/50 bg-card/60 px-3.5 py-3">
                  <p className="truncate text-sm font-medium">{m.componentName}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.shareAtRisk}% of supply flows through the disrupted region
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.alternatives.map((alt) => (
                      <Badge key={alt.component + alt.supplier} variant="secondary" className="max-w-full gap-1 rounded font-normal">
                        <PackageSearchIcon className="size-3 shrink-0 text-risk-low" />
                        <span className="truncate">{alt.supplier}</span>
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ResultKpi({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "red" | "amber" | "emerald" }) {
  const toneClass = { default: "", red: "text-risk-critical", amber: "text-primary", emerald: "text-risk-low" }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-card/70 px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="h-[64px]" />
        ))}
      </div>
      <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card/70">
        {Array.from({ length: 7 }).map((_, i) => (
          <SkeletonBox key={i} className="h-16 rounded-none border-0 bg-transparent" inner />
        ))}
      </div>
    </div>
  );
}

function SkeletonBox({ className, inner }: { className?: string; inner?: boolean }) {
  return (
    <div className={cn("p-3", className)}>
      {inner ? <div className="h-full animate-pulse rounded-md bg-secondary/60" /> : <div className="h-full w-full animate-pulse rounded-md bg-secondary/60" />}
    </div>
  );
}

function groupByRegion(facilities: FacilityOption[]): [string, FacilityOption[]][] {
  const map = new Map<string, FacilityOption[]>();
  for (const f of facilities) {
    const list = map.get(f.regionName) ?? [];
    list.push(f);
    map.set(f.regionName, list);
  }
  return [...map.entries()];
}

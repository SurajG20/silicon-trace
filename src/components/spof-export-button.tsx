"use client";

import { toast } from "sonner";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, toCsv } from "@/lib/csv";
import { fmtCompactUsd } from "@/lib/format";
import type { SpofRow } from "@/lib/services/types";

export function SpofExportButton({ rows }: { rows: SpofRow[] }) {
  function exportCsv() {
    const csv = toCsv(
      ["component", "mpn", "category", "sole_supplier", "lead_time_days", "dependent_products", "revenue_exposed_usd"],
      rows.map((r) => [r.name, r.mpn, r.category, r.supplierName, r.leadTimeDays, r.dependentProducts, r.revenueExposedUsd]),
    );
    downloadCsv("silicontrace-single-points-of-failure.csv", csv);
    toast.success("SPOF report exported", {
      description: `${rows.length} parts · ${fmtCompactUsd(rows.reduce((a, r) => a + r.revenueExposedUsd, 0))} exposed`,
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-[11px] text-muted-foreground"
      onClick={exportCsv}
      disabled={rows.length === 0}
    >
      <DownloadIcon className="size-3.5" /> Export CSV
    </Button>
  );
}

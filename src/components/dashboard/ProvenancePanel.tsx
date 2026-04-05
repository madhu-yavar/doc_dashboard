import { useState } from "react";
import StatusBadge from "./StatusBadge";

type ProvenanceStatus = "source_backed" | "mixed" | "derived_only" | "insufficient_evidence";

type ProvenanceItem = {
  value: string;
  sourceSection: string;
  sourceExcerpt: string;
  sourcePage: number | null;
  confidence: number;
  provenanceType: "quoted" | "normalized" | "derived";
};

interface ProvenancePanelProps {
  status: ProvenanceStatus;
  items: ProvenanceItem[];
}

const statusMap: Record<ProvenanceStatus, { badge: "normal" | "warning" | "info" | "neutral"; label: string }> = {
  source_backed: { badge: "normal", label: "Source-backed" },
  mixed: { badge: "warning", label: "Mixed" },
  derived_only: { badge: "info", label: "Derived" },
  insufficient_evidence: { badge: "neutral", label: "Evidence limited" },
};

const ProvenancePanel = ({ status, items }: ProvenancePanelProps) => {
  const [open, setOpen] = useState(false);
  const statusConfig = statusMap[status];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={statusConfig.badge} label={statusConfig.label} />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {open ? "Hide source" : "View source"}
        </button>
      </div>

      {open ? (
        <div className="rounded-xl border bg-muted/20 p-4">
          {items.length > 0 ? (
            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`${item.value}-${index}`} className="rounded-lg border bg-background p-3">
                  <p className="text-sm font-medium text-foreground">{item.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.sourceSection || "Source section unavailable"}
                    {item.sourcePage != null ? ` · Page ${item.sourcePage}` : ""}
                    {` · ${item.provenanceType}`}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.sourceExcerpt}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No source-backed evidence is available for this section yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ProvenancePanel;

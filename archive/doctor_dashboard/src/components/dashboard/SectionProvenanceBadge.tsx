type SectionProvenanceStatus = "source_backed" | "mixed" | "derived_only" | "insufficient_evidence";

interface SectionProvenanceBadgeProps {
  status: SectionProvenanceStatus;
  className?: string;
}

const STATUS_STYLES: Record<SectionProvenanceStatus, { label: string; className: string }> = {
  source_backed: {
    label: "Source-backed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  mixed: {
    label: "Mixed",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  derived_only: {
    label: "Derived",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  insufficient_evidence: {
    label: "Limited evidence",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
};

const SectionProvenanceBadge = ({ status, className = "" }: SectionProvenanceBadgeProps) => {
  const config = STATUS_STYLES[status];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${config.className} ${className}`.trim()}
    >
      {config.label}
    </span>
  );
};

export default SectionProvenanceBadge;

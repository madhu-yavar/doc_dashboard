import { cn } from "@/lib/utils";

type StatusType = "normal" | "warning" | "critical" | "info" | "neutral";

interface StatusBadgeProps {
  status: StatusType;
  label: string;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  normal: "status-badge-normal",
  warning: "status-badge-warning",
  critical: "status-badge-critical",
  info: "status-badge-info",
  neutral: "status-badge-neutral",
};

const StatusBadge = ({ status, label, className }: StatusBadgeProps) => {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", statusStyles[status], className)}>
      {label}
    </span>
  );
};

export default StatusBadge;

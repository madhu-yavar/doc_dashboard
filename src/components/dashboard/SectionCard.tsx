import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface SectionCardProps {
  icon: ReactNode;
  title: string;
  colorClass: string;
  children: ReactNode;
  onClick: () => void;
  headerBadge?: ReactNode;
}

const SectionCard = ({ icon, title, colorClass, children, onClick, headerBadge }: SectionCardProps) => {
  return (
    <button
      onClick={onClick}
      className="section-card relative w-full overflow-hidden p-3 text-left group"
    >
      <div className={`absolute inset-x-0 top-0 h-1 ${colorClass}`} />
      <div className="mb-2 flex items-center justify-between pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex h-7.5 w-7.5 items-center justify-center rounded-lg bg-muted/60">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          </div>
        </div>
        <div className="flex items-center gap-1 pl-2">
          {headerBadge}
          <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
      <div className="space-y-1 text-[12px]">{children}</div>
    </button>
  );
};

export default SectionCard;

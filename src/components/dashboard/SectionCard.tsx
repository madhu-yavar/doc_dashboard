import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface SectionCardProps {
  icon: ReactNode;
  title: string;
  colorClass: string;
  children: ReactNode;
  onClick: () => void;
}

const SectionCard = ({ icon, title, colorClass, children, onClick }: SectionCardProps) => {
  return (
    <button
      onClick={onClick}
      className="section-card p-5 text-left w-full group"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass}`}>
            {icon}
          </div>
          <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="space-y-1.5 text-sm">{children}</div>
    </button>
  );
};

export default SectionCard;

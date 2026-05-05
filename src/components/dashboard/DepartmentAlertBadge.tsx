import { Microscope, Activity, Atom, Syringe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DepartmentAlertData {
  sent?: boolean;
  skipped?: boolean;
  skip_reason?: string | null;
  departments?: {
    lab?: { sent?: boolean; itemCount?: number };
    radiology?: { sent?: boolean; itemCount?: number };
    nuclear_medicine?: { sent?: boolean; itemCount?: number };
    procedures?: { sent?: boolean; itemCount?: number };
  };
}

interface DepartmentAlertBadgeProps {
  departmentAlerts?: DepartmentAlertData | null;
  compact?: boolean;
  showDetails?: boolean;
}

const departmentIcons = {
  lab: Microscope,
  radiology: Activity,
  nuclear_medicine: Atom,
  procedures: Syringe,
};

const departmentLabels = {
  lab: 'Lab',
  radiology: 'Radiology',
  nuclear_medicine: 'Nuclear',
  procedures: 'Procedures',
};

const DepartmentAlertBadge = ({ departmentAlerts, compact = false, showDetails = false }: DepartmentAlertBadgeProps) => {
  // No alert data
  if (!departmentAlerts) {
    return null;
  }

  // Alert was skipped
  if (departmentAlerts.skipped) {
    return null; // Don't show anything if skipped (no orders)
  }

  // Alert was sent
  if (departmentAlerts.sent && departmentAlerts.departments) {
    const activeDepartments = Object.entries(departmentAlerts.departments)
      .filter(([_, data]) => data?.sent)
      .map(([dept, data]) => ({ department: dept, ...data }));

    if (activeDepartments.length === 0) {
      return null;
    }

    // Compact mode: single badge with count
    if (compact) {
      return (
        <Badge
          variant="default"
          className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-xs font-normal"
          title={`${activeDepartments.length} department(s) alerted`}
        >
          🏥 {activeDepartments.length}
        </Badge>
      );
    }

    // Details mode: show individual department badges
    if (showDetails) {
      return (
        <TooltipProvider>
          <div className="flex gap-1 flex-wrap">
            {activeDepartments.map(({ department, itemCount }) => {
              const Icon = departmentIcons[department as keyof typeof departmentIcons];
              const label = departmentLabels[department as keyof typeof departmentLabels];
              return (
                <Tooltip key={department}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="default"
                      className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-xs font-normal"
                    >
                      {Icon && <Icon className="w-3 h-3" />}
                      {label} {itemCount ? `(${itemCount})` : ''}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{label} department notified{itemCount ? ` about ${itemCount} order(s)` : ''}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      );
    }

    // Default: summary badge
    const deptNames = activeDepartments
      .map(d => departmentLabels[d.department as keyof typeof departmentLabels])
      .join(', ');

    return (
      <Badge
        variant="default"
        className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-xs font-normal"
        title={`Departments notified: ${deptNames}`}
      >
        🏥 {deptNames}
      </Badge>
    );
  }

  return null;
};

export default DepartmentAlertBadge;

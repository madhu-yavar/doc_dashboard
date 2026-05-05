import { Pill } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PharmacyAlertData {
  sent?: boolean;
  email_sent?: boolean;
  whatsapp_sent?: boolean;
  skipped?: boolean;
  skip_reason?: string | null;
  medications_count?: number;
}

interface PharmacyAlertBadgeProps {
  pharmacyAlert?: PharmacyAlertData | null;
  compact?: boolean;
}

const PharmacyAlertBadge = ({ pharmacyAlert, compact = false }: PharmacyAlertBadgeProps) => {
  // No alert data
  if (!pharmacyAlert) {
    return null;
  }

  // Alert was skipped
  if (pharmacyAlert.skipped) {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-xs font-normal"
        title={`Skipped: ${pharmacyAlert.skip_reason || 'Unknown reason'}`}
      >
        <Pill className="w-3 h-3" />
        {compact ? '' : 'No pharmacy alert'}
      </Badge>
    );
  }

  // Alert was sent successfully
  if (pharmacyAlert.sent) {
    const channels = [];
    if (pharmacyAlert.email_sent) channels.push('Email');
    if (pharmacyAlert.whatsapp_sent) channels.push('WhatsApp');

    return (
      <Badge
        variant="default"
        className="gap-1 bg-green-100 text-green-700 hover:bg-green-200 border-green-200 text-xs font-normal"
        title={`Sent to pharmacy via ${channels.join(' + ')}${pharmacyAlert.medications_count ? ` (${pharmacyAlert.medications_count} meds)` : ''}`}
      >
        <Pill className="w-3 h-3" />
        {compact ? '' : 'Pharmacy alerted'}
      </Badge>
    );
  }

  // Alert exists but wasn't sent (error case)
  return (
    <Badge
      variant="outline"
      className="gap-1 text-xs font-normal text-amber-700 border-amber-200 bg-amber-50"
      title="Pharmacy alert attempted but failed"
    >
      <Pill className="w-3 h-3" />
      {compact ? '' : 'Alert failed'}
    </Badge>
  );
};

export default PharmacyAlertBadge;

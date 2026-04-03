import { patientData } from "@/data/patientData";
import { ArrowLeft, Calendar, Clock, MapPin } from "lucide-react";

interface FollowUpDetailProps {
  onBack: () => void;
}

const FollowUpDetail = ({ onBack }: FollowUpDetailProps) => {
  const followUp = patientData.followUp;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-section-followup/10 flex items-center justify-center text-lg">📅</div>
        <h2 className="text-xl font-bold text-foreground">Follow-Up Appointments</h2>
      </div>

      <div className="grid gap-4">
        {followUp.map((appt, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-foreground">{appt.department}</h3>
                <p className="text-sm text-muted-foreground">{appt.physician}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Calendar className="w-3.5 h-3.5" />{appt.date}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                  <Clock className="w-3 h-3" />{appt.time}
                </div>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">{appt.purpose}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FollowUpDetail;

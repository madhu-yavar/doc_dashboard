import { patientData } from "@/data/patientData";
import { User, Phone, Mail, AlertCircle, Calendar, Building2, Stethoscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const PatientHeader = () => {
  const { patient, admission } = patientData;

  return (
    <div className="bg-card rounded-xl border p-6 shadow-sm">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-20 h-20 rounded-xl bg-primary/10 flex items-center justify-center">
            <User className="w-10 h-10 text-primary" />
          </div>
        </div>

        {/* Patient Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-foreground">{patient.name}</h1>
            <Badge variant="outline" className="font-mono text-xs">MRN: {patient.mrn}</Badge>
            <Badge className="bg-primary text-primary-foreground">{patient.bloodGroup}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5" />
              <span>{patient.age} years, {patient.gender}</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5" />
              <span>{admission.department} · Ward {admission.ward}</span>
            </div>
            <div className="flex items-center gap-2">
              <Stethoscope className="w-3.5 h-3.5" />
              <span>{admission.attendingPhysician.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              <span>{admission.lengthOfStay} days stay</span>
            </div>
          </div>
        </div>

        {/* Quick Info */}
        <div className="flex-shrink-0 flex flex-col gap-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="w-3.5 h-3.5" />
            <span>{patient.contact.phone}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="w-3.5 h-3.5" />
            <span>{patient.contact.email}</span>
          </div>
          <div className="flex items-center gap-2 text-status-critical">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="text-xs">{admission.admissionType}</span>
          </div>
        </div>
      </div>

      {/* Admission Bar */}
      <div className="mt-4 pt-4 border-t flex flex-wrap gap-6 text-xs text-muted-foreground">
        <span><strong className="text-foreground">Admitted:</strong> Mar 15, 2026 08:30</span>
        <span><strong className="text-foreground">Discharged:</strong> Mar 20, 2026 14:00</span>
        <span><strong className="text-foreground">Admission Dx:</strong> {admission.admissionDiagnosis}</span>
        <span><strong className="text-foreground">Report ID:</strong> {patientData.meta.reportId}</span>
      </div>
    </div>
  );
};

export default PatientHeader;

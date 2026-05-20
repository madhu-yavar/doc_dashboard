import type { DashboardPatientData } from "@/data/patientData";
import { User, Calendar, Building2, Mic } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type PatientHeaderProps = {
  data: DashboardPatientData;
  documentType?: 'pdf' | 'voice';
};

const PatientHeader = ({ data, documentType }: PatientHeaderProps) => {
  const { patient, admission } = data;
  const isVoiceDocument = documentType === 'voice';
  const weightValue = patient.weight?.value ?? data.vitals?.latest?.weight?.value ?? 0;
  const weightUnit = patient.weight?.unit || data.vitals?.latest?.weight?.unit || "";
  const weightLabel = weightValue > 0 ? `${weightValue}${weightUnit ? ` ${weightUnit}` : ""}` : "";
  const missingVoiceDemographics = isVoiceDocument && !patient.name && !(patient.age > 0) && !patient.gender;

  const demographicItems = [
    patient.age > 0 ? `${patient.age}y` : "",
    patient.gender || "",
    weightLabel,
    admission.department || "",
  ].filter(Boolean);
  const hasInpatientContext = Boolean(
    admission.admissionType ||
    admission.admissionDate ||
    admission.dischargeDate ||
    admission.ward ||
    admission.lengthOfStay > 0
  );
  const hasAdmissionMeta = Boolean(
    hasInpatientContext
  );
  const locationLabel = [admission.department, admission.ward].filter(Boolean).join(" · ");

  const formatDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.035)]">
      <div className="flex flex-col gap-3 px-5 py-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-slate-50">
              <User className="h-6 w-6 text-primary" />
            </div>

            <div className="min-w-0">
              <div className="mb-0.5 flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[24px] font-semibold leading-none text-slate-900">
                  {patient.name || (isVoiceDocument ? "Patient name not extracted" : "Patient name unavailable")}
                </h1>
                {patient.mrn ? (
                  <Badge variant="outline" className="h-6 rounded-md border-blue-200 bg-blue-50 px-2 font-mono text-[11px] text-blue-700">
                    {patient.mrn}
                  </Badge>
                ) : null}
                {missingVoiceDemographics ? (
                  <Badge variant="outline" className="h-6 rounded-md border-amber-200 bg-amber-50 px-2 text-[11px] text-amber-700">
                    Demographics missing
                  </Badge>
                ) : null}
                {hasAdmissionMeta ? (
                  <Badge className="h-6 rounded-md bg-amber-50 px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-50">
                    {admission.dischargeDate ? "Discharged" : "Active"}
                  </Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-500">
                {demographicItems.length > 0 ? (
                  demographicItems.map((item, index) => (
                    <span key={`${item}-${index}`}>
                      {index > 0 ? <span className="mr-3">•</span> : null}
                      {item}
                    </span>
                  ))
                ) : isVoiceDocument ? (
                  <span className="flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5" />
                    Demographics not extracted from voice dictation
                  </span>
                ) : (
                  <span>No demographic details extracted</span>
                )}
              </div>
            </div>
          </div>

          {hasAdmissionMeta ? (
            <div className="grid grid-cols-3 gap-5 rounded-xl bg-slate-50/80 px-4 py-2.5 xl:w-auto">
              <div className="min-w-[66px]">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Admitted</p>
                <p className="mt-0.5 text-[16px] font-semibold text-slate-800">
                  {admission.admissionDate ? formatDate(admission.admissionDate) : "Not documented"}
                </p>
              </div>
              <div className="min-w-[66px]">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Ward</p>
                <p className="mt-0.5 text-[16px] font-semibold text-slate-800">{admission.ward || "Not documented"}</p>
              </div>
              <div className="min-w-[66px]">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Stay</p>
                <p className="mt-0.5 text-[16px] font-semibold text-slate-800">
                  {admission.lengthOfStay > 0 ? `${admission.lengthOfStay} days` : "Not documented"}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {hasAdmissionMeta ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>{admission.dischargeDate ? `Discharged ${formatDate(admission.dischargeDate)}` : "Discharge not documented"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-slate-400" />
              <span>{locationLabel || "Location not documented"}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default PatientHeader;
export type { PatientHeaderProps };

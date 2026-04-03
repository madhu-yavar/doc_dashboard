import { useState } from "react";
import PatientHeader from "@/components/dashboard/PatientHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import StatusBadge from "@/components/dashboard/StatusBadge";
import VitalsDetail from "@/components/dashboard/VitalsDetail";
import DiagnosisDetail from "@/components/dashboard/DiagnosisDetail";
import MedicationsDetail from "@/components/dashboard/MedicationsDetail";
import LabsDetail from "@/components/dashboard/LabsDetail";
import RadiologyDetail from "@/components/dashboard/RadiologyDetail";
import TreatmentDetail from "@/components/dashboard/TreatmentDetail";
import ClinicalNotesDetail from "@/components/dashboard/ClinicalNotesDetail";
import DischargeDetail from "@/components/dashboard/DischargeDetail";
import FollowUpDetail from "@/components/dashboard/FollowUpDetail";
import { patientData } from "@/data/patientData";
import { Printer, Mail, FileDown, Search } from "lucide-react";

type Section = null | "vitals" | "diagnosis" | "medications" | "labs" | "radiology" | "treatment" | "notes" | "discharge" | "followup";

const Index = () => {
  const [activeSection, setActiveSection] = useState<Section>(null);
  const d = patientData;

  const handleBack = () => setActiveSection(null);

  if (activeSection === "vitals") return <PageWrapper><VitalsDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "diagnosis") return <PageWrapper><DiagnosisDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "medications") return <PageWrapper><MedicationsDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "labs") return <PageWrapper><LabsDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "radiology") return <PageWrapper><RadiologyDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "treatment") return <PageWrapper><TreatmentDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "notes") return <PageWrapper><ClinicalNotesDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "discharge") return <PageWrapper><DischargeDetail onBack={handleBack} /></PageWrapper>;
  if (activeSection === "followup") return <PageWrapper><FollowUpDetail onBack={handleBack} /></PageWrapper>;

  return (
    <PageWrapper>
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-foreground">Patient Discharge Summary</h1>
          <p className="text-xs text-muted-foreground">Interactive Dashboard · Manipal CoE</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground" title="Search">
            <Search className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground" title="Print">
            <Printer className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground" title="Email">
            <Mail className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground" title="Export">
            <FileDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      <PatientHeader />

      {/* Section Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {/* Vitals */}
        <SectionCard
          icon={<span className="text-base">📊</span>}
          title="Vitals"
          colorClass="bg-section-vitals/10"
          onClick={() => setActiveSection("vitals")}
        >
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>BP: <span className="text-foreground font-medium">{d.vitals.latest.bloodPressure.systolic}/{d.vitals.latest.bloodPressure.diastolic} mmHg</span></p>
            <p>Pulse: <span className="text-foreground font-medium">{d.vitals.latest.heartRate.value} bpm</span></p>
            <p>SpO2: <span className="text-foreground font-medium">{d.vitals.latest.spo2.value}%</span></p>
          </div>
          <StatusBadge status="normal" label="Stable ✓" className="mt-2" />
        </SectionCard>

        {/* Diagnosis */}
        <SectionCard
          icon={<span className="text-base">🩺</span>}
          title="Diagnosis"
          colorClass="bg-section-diagnosis/10"
          onClick={() => setActiveSection("diagnosis")}
        >
          <p className="text-sm font-medium text-foreground">Acute Myocardial Infarction</p>
          <p className="text-xs font-mono text-muted-foreground">ICD-10: {d.diagnosis.principal.code}</p>
          <p className="text-xs text-muted-foreground mt-1">+{d.diagnosis.secondary.length} Secondary</p>
        </SectionCard>

        {/* Medications */}
        <SectionCard
          icon={<span className="text-base">💊</span>}
          title="Medications"
          colorClass="bg-section-medications/10"
          onClick={() => setActiveSection("medications")}
        >
          <p className="text-sm text-foreground"><span className="font-medium">{d.medications.active.length}</span> Active</p>
          <div className="flex items-center gap-1 mt-1">
            <StatusBadge status="warning" label={`${d.medications.allergies.length} Allergies ⚠️`} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Reconciliation: Done</p>
        </SectionCard>

        {/* Lab Results */}
        <SectionCard
          icon={<span className="text-base">🔬</span>}
          title="Lab Results"
          colorClass="bg-section-labs/10"
          onClick={() => setActiveSection("labs")}
        >
          <p className="text-sm text-foreground"><span className="font-medium">{d.labs.totalTests}</span> Complete</p>
          <div className="flex flex-wrap gap-1 mt-1">
            <StatusBadge status="warning" label={`${d.labs.abnormalCount} Abnormal`} />
            <StatusBadge status="critical" label={`${d.labs.criticalCount} Critical`} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{d.labs.pendingCount} Pending ⏳</p>
        </SectionCard>

        {/* Radiology */}
        <SectionCard
          icon={<span className="text-base">🫀</span>}
          title="Radiology"
          colorClass="bg-section-radiology/10"
          onClick={() => setActiveSection("radiology")}
        >
          <p className="text-sm text-foreground"><span className="font-medium">{d.radiology.completedStudies}</span> Scans Completed</p>
          <StatusBadge status="warning" label={`${d.radiology.criticalFindings} Critical Finding ⚠️`} className="mt-1" />
          <p className="text-xs text-muted-foreground mt-1">{d.radiology.pendingStudies} Pending ⏳</p>
        </SectionCard>

        {/* Treatment */}
        <SectionCard
          icon={<span className="text-base">🏥</span>}
          title="Treatment"
          colorClass="bg-section-treatment/10"
          onClick={() => setActiveSection("treatment")}
        >
          <p className="text-sm text-foreground">Procedures: <span className="font-medium">{d.treatment.procedures.length}</span></p>
          <p className="text-sm text-foreground">Response: <span className="font-medium">{d.treatment.response} ✓</span></p>
          <p className="text-xs text-muted-foreground mt-1">Complications: {d.treatment.complications}</p>
        </SectionCard>

        {/* Clinical Notes */}
        <SectionCard
          icon={<span className="text-base">📝</span>}
          title="Clinical Notes"
          colorClass="bg-section-notes/10"
          onClick={() => setActiveSection("notes")}
        >
          <p className="text-sm text-foreground"><span className="font-medium">{d.clinicalNotes.totalNotes}</span> Notes</p>
          <p className="text-xs text-muted-foreground mt-1">Last Update: 2 hours ago</p>
        </SectionCard>

        {/* Discharge Plan */}
        <SectionCard
          icon={<span className="text-base">📋</span>}
          title="Discharge Plan"
          colorClass="bg-section-discharge/10"
          onClick={() => setActiveSection("discharge")}
        >
          <p className="text-sm text-foreground">Condition: <span className="font-medium">{d.dischargePlan.condition} ✓</span></p>
          <p className="text-xs text-muted-foreground mt-1">{d.dischargePlan.dietary.length + d.dischargePlan.activityRestrictions.doNot.length} instructions</p>
          <p className="text-xs text-muted-foreground">{d.dischargePlan.redFlags.length} Red Flags</p>
        </SectionCard>

        {/* Follow-Up */}
        <SectionCard
          icon={<span className="text-base">📅</span>}
          title="Follow-Up"
          colorClass="bg-section-followup/10"
          onClick={() => setActiveSection("followup")}
        >
          <p className="text-sm text-foreground">Next: <span className="font-medium">Apr 15, 2026</span></p>
          <p className="text-xs text-muted-foreground">{d.followUp[0].department}</p>
          <p className="text-xs text-muted-foreground mt-1">{d.followUp.length} appointments total</p>
        </SectionCard>
      </div>
    </PageWrapper>
  );
};

const PageWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {children}
    </div>
  </div>
);

export default Index;

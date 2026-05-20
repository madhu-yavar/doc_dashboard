import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PatientHeader from "@/components/dashboard/PatientHeader";
import { patientData } from "@/data/patientData";

describe("PatientHeader", () => {
  it("surfaces missing voice demographics instead of masking them as a generic voice session", () => {
    render(
      <PatientHeader
        documentType="voice"
        data={{
          ...patientData,
          patient: {
            ...patientData.patient,
            name: "",
            age: 0,
            gender: "",
            weight: { value: 0, unit: "" },
          },
          admission: {
            ...patientData.admission,
            department: "",
          },
        }}
      />,
    );

    expect(screen.getByText("Patient name not extracted")).toBeInTheDocument();
    expect(screen.getByText("Demographics missing")).toBeInTheDocument();
    expect(screen.getByText("Demographics not extracted from voice dictation")).toBeInTheDocument();
    expect(screen.queryByText("Voice Dictation Session")).not.toBeInTheDocument();
  });

  it("shows extracted weight in the demographic strip", () => {
    render(<PatientHeader documentType="voice" data={patientData} />);

    expect(screen.getByText("77 kg")).toBeInTheDocument();
  });
});

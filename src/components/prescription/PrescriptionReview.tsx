/**
 * Prescription Review & Edit Component
 * Allows reviewing and editing prescription data before generating PDF
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Download, Edit2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Medication {
  srNo: string | number;
  name: string;
  dose: string;
  morning: boolean;
  noon: boolean;
  night: boolean;
  days: string;
  remarks: string;
}

interface PrescriptionData {
  hospital: {
    name: string;
    tagline: string;
    department: string;
    branch: string;
    address: string;
  };
  patient: {
    name: string;
    ageSex: string;
    hospitalNo: string;
    mobile: string;
    email: string;
  };
  visit: {
    episodeNo: string;
    dateTime: string;
  };
  consultant: {
    name: string;
    regNo: string;
    department: string;
  };
  vitals: {
    height: string;
    bp: string;
    weight: string;
  };
  clinical: {
    allergies: string;
    diet: string;
    vulnerable: boolean;
    knownHealthConditions: string;
  };
  doctorNotes: {
    freeText: string;
  };
  labs: Record<string, boolean | string>;
  radiology: Record<string, boolean | string>;
  prescription: {
    medicines: Medication[];
  };
  nextVisitDate: string;
  _metadata?: {
    sourceDocument: string;
    sourceDocumentId: string;
    generatedAt: string;
    department: string;
  };
}

interface PrescriptionReviewProps {
  documentId: string;
  onComplete?: (result: any) => void;
}

interface GeneratedPrescriptionResult {
  success: boolean;
  documentId: string;
  urls?: {
    html?: string;
    pdf?: string;
  };
  paths?: {
    html?: string;
    pdf?: string;
  };
}

export function PrescriptionReview({ documentId, onComplete }: PrescriptionReviewProps) {
  const [data, setData] = useState<PrescriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [format, setFormat] = useState<"html" | "pdf" | "both">("both");
  const [generatedResult, setGeneratedResult] = useState<GeneratedPrescriptionResult | null>(null);

  // Fetch prescription data
  useEffect(() => {
    fetchPrescriptionData();
  }, [documentId]);

  const fetchPrescriptionData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/prescriptions/data/${documentId}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        toast.error("Failed to load prescription data");
      }
    } catch (error) {
      console.error("Error fetching prescription data:", error);
      toast.error("Error loading prescription data");
    } finally {
      setLoading(false);
    }
  };

  const getFileNameFromUrl = (fileUrl: string) => {
    try {
      const url = new URL(fileUrl, window.location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || "");
    } catch {
      return "";
    }
  };

  const buildDownloadUrl = (fileUrl: string) => {
    const fileName = getFileNameFromUrl(fileUrl);
    return fileName ? `/api/prescriptions/download/${encodeURIComponent(fileName)}` : fileUrl;
  };

  const openGeneratedFile = (fileUrl: string) => {
    window.open(new URL(fileUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer");
  };

  const downloadGeneratedFile = async (fileUrl: string) => {
    const downloadUrl = buildDownloadUrl(fileUrl);
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error("Failed to download generated prescription");
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = getFileNameFromUrl(fileUrl) || "prescription";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
  };

  const buildUpdatePayload = (currentData: PrescriptionData) => ({
    medications: currentData.prescription.medicines,
    labs: currentData.labs,
    radiology: currentData.radiology,
    doctorNotes: currentData.doctorNotes,
    vitals: currentData.vitals,
    nextVisitDate: currentData.nextVisitDate,
  });

  const generatePrescription = async () => {
    if (!data) return;

    try {
      setGenerating(true);

      const response = await fetch("/api/prescriptions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          format,
          updateData: editing ? buildUpdatePayload(data) : null
        })
      });

      const result = await response.json();

      if (result.success) {
        setGeneratedResult(result);
        toast.success("Prescription generated successfully!");

        const primaryFileUrl = result.urls?.pdf || result.urls?.html || "";
        if (primaryFileUrl) {
          try {
            await downloadGeneratedFile(primaryFileUrl);
          } catch (downloadError) {
            console.error("Error downloading generated prescription:", downloadError);
            toast.error("Prescription was generated, but automatic download failed. Use the download buttons below.");
          }
        }

        onComplete?.(result);
      } else {
        toast.error("Failed to generate prescription");
      }
    } catch (error) {
      console.error("Error generating prescription:", error);
      toast.error("Error generating prescription");
    } finally {
      setGenerating(false);
    }
  };

  const updateMedication = (index: number, field: keyof Medication, value: any) => {
    if (!data) return;
    const updated = { ...data };
    updated.prescription.medicines = [...updated.prescription.medicines];
    updated.prescription.medicines[index] = {
      ...updated.prescription.medicines[index],
      [field]: value
    };
    setData(updated);
  };

  const updateLab = (key: string, value: boolean) => {
    if (!data) return;
    const updated = { ...data };
    updated.labs = { ...updated.labs };
    updated.labs[key] = value;
    setData(updated);
  };

  const updateRadiology = (key: string, value: boolean) => {
    if (!data) return;
    const updated = { ...data };
    updated.radiology = { ...updated.radiology };
    updated.radiology[key] = value;
    setData(updated);
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading prescription data...</span>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="w-full">
        <CardContent className="py-12">
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load prescription data. Please ensure the document has been processed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const labCheckboxes = Object.entries(data.labs)
    .filter(([key]) => key !== "other")
    .sort(([a], [b]) => a.localeCompare(b));

  const radiologyCheckboxes = Object.entries(data.radiology)
    .filter(([key]) => key !== "other")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle>Prescription Review</CardTitle>
                <CardDescription>
                  {data._metadata?.sourceDocument || "Document"} • {data.patient.name}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editing && (
                <>
                  <Badge variant="outline" className="px-3 py-1">
                    <Edit2 className="h-3 w-3 mr-1" />
                    Edit Mode
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(false)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={generatePrescription}
                    disabled={generating}
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Save & Generate
                  </Button>
                </>
              )}
              {!editing && (
                <>
                  <div className="flex items-center gap-2 mr-4">
                    <Label htmlFor="format" className="text-sm">Format:</Label>
                    <select
                      id="format"
                      value={format}
                      onChange={(e) => setFormat(e.target.value as any)}
                      className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      <option value="pdf">PDF</option>
                      <option value="html">HTML</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(true)}
                  >
                    <Edit2 className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    onClick={generatePrescription}
                    disabled={generating}
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-1" />
                    )}
                    Generate
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {generatedResult?.urls && (generatedResult.urls.pdf || generatedResult.urls.html) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated Files</CardTitle>
            <CardDescription>Use these actions if the browser blocked the automatic download.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {generatedResult.urls.pdf ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => openGeneratedFile(generatedResult.urls!.pdf!)}
                >
                  Open PDF
                </Button>
                <Button
                  onClick={() => {
                    void downloadGeneratedFile(generatedResult.urls!.pdf!);
                  }}
                >
                  Download PDF
                </Button>
              </>
            ) : null}
            {generatedResult.urls.html ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => openGeneratedFile(generatedResult.urls!.html!)}
                >
                  Open HTML
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void downloadGeneratedFile(generatedResult.urls!.html!);
                  }}
                >
                  Download HTML
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="medications" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="labs">Labs</TabsTrigger>
          <TabsTrigger value="radiology">Radiology</TabsTrigger>
          <TabsTrigger value="notes">Notes & Vitals</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        {/* Medications Tab */}
        <TabsContent value="medications">
          <Card>
            <CardHeader>
              <CardTitle>Medications ({data.prescription.medicines.filter(m => m.name).length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.prescription.medicines.map((med, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-start p-3 border rounded-lg">
                    <div className="col-span-1 text-center text-sm text-muted-foreground">{med.srNo}</div>
                    <div className="col-span-3">
                      {editing ? (
                        <Input
                          value={med.name}
                          onChange={(e) => updateMedication(idx, "name", e.target.value)}
                          placeholder="Medicine name"
                          className="h-9"
                        />
                      ) : (
                        <div className="font-medium">{med.name || "-"}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {editing ? (
                        <Input
                          value={med.dose}
                          onChange={(e) => updateMedication(idx, "dose", e.target.value)}
                          placeholder="Dose"
                          className="h-9"
                        />
                      ) : (
                        <div className="text-sm">{med.dose || "-"}</div>
                      )}
                    </div>
                    <div className="col-span-3 flex gap-2">
                      {editing ? (
                        <>
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={med.morning}
                              onCheckedChange={(checked) => updateMedication(idx, "morning", checked)}
                            />
                            M
                          </label>
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={med.noon}
                              onCheckedChange={(checked) => updateMedication(idx, "noon", checked)}
                            />
                            A
                          </label>
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={med.night}
                              onCheckedChange={(checked) => updateMedication(idx, "night", checked)}
                            />
                            N
                          </label>
                        </>
                      ) : (
                        <div className="flex gap-2 text-xs">
                          {med.morning && <Badge variant="secondary">M</Badge>}
                          {med.noon && <Badge variant="secondary">A</Badge>}
                          {med.night && <Badge variant="secondary">N</Badge>}
                        </div>
                      )}
                    </div>
                    <div className="col-span-1">
                      {editing ? (
                        <Input
                          value={med.days}
                          onChange={(e) => updateMedication(idx, "days", e.target.value)}
                          placeholder="Days"
                          className="h-9"
                        />
                      ) : (
                        <div className="text-sm">{med.days || "-"}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {editing ? (
                        <Input
                          value={med.remarks}
                          onChange={(e) => updateMedication(idx, "remarks", e.target.value)}
                          placeholder="Remarks"
                          className="h-9"
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">{med.remarks || "-"}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Labs Tab */}
        <TabsContent value="labs">
          <Card>
            <CardHeader>
              <CardTitle>Lab Investigations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {labCheckboxes.map(([key, checked]) => (
                  <label key={key} className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                    <Checkbox
                      checked={checked as boolean}
                      disabled={!editing}
                      onCheckedChange={(c) => updateLab(key, !!c)}
                    />
                    <span className="text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </label>
                ))}
              </div>
              {data.labs.other && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <Label className="text-sm text-muted-foreground">Other Tests:</Label>
                  <p className="text-sm mt-1">{data.labs.other as string}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Radiology Tab */}
        <TabsContent value="radiology">
          <Card>
            <CardHeader>
              <CardTitle>Radiology & Imaging</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {radiologyCheckboxes.map(([key, checked]) => (
                  <label key={key} className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-muted/50">
                    <Checkbox
                      checked={checked as boolean}
                      disabled={!editing}
                      onCheckedChange={(c) => updateRadiology(key, !!c)}
                    />
                    <span className="text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').replace('Xray', 'X-Ray').replace('Usg', 'USG').trim()}</span>
                  </label>
                ))}
              </div>
              {data.radiology.other && (
                <div className="mt-4 p-3 bg-muted rounded-lg">
                  <Label className="text-sm text-muted-foreground">Other Studies:</Label>
                  <p className="text-sm mt-1">{data.radiology.other as string}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notes & Vitals Tab */}
        <TabsContent value="notes">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Doctor's Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {editing ? (
                  <Textarea
                    value={data.doctorNotes.freeText}
                    onChange={(e) => {
                      const updated = { ...data };
                      updated.doctorNotes = { freeText: e.target.value };
                      setData(updated);
                    }}
                    rows={6}
                    placeholder="Doctor's notes..."
                  />
                ) : (
                  <p className="text-sm whitespace-pre-line">{data.doctorNotes.freeText}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Vitals & Clinical</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">BP</Label>
                    {editing ? (
                      <Input
                        value={data.vitals.bp}
                        onChange={(e) => {
                          const updated = { ...data };
                          updated.vitals = { ...updated.vitals, bp: e.target.value };
                          setData(updated);
                        }}
                        placeholder="120/80"
                        className="h-9"
                      />
                    ) : (
                      <p className="text-sm font-medium">{data.vitals.bp || "-"}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Weight</Label>
                    {editing ? (
                      <Input
                        value={data.vitals.weight}
                        onChange={(e) => {
                          const updated = { ...data };
                          updated.vitals = { ...updated.vitals, weight: e.target.value };
                          setData(updated);
                        }}
                        placeholder="kg"
                        className="h-9"
                      />
                    ) : (
                      <p className="text-sm font-medium">{data.vitals.weight || "-"}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Height</Label>
                    {editing ? (
                      <Input
                        value={data.vitals.height}
                        onChange={(e) => {
                          const updated = { ...data };
                          updated.vitals = { ...updated.vitals, height: e.target.value };
                          setData(updated);
                        }}
                        placeholder="cm"
                        className="h-9"
                      />
                    ) : (
                      <p className="text-sm font-medium">{data.vitals.height || "-"}</p>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-xs text-muted-foreground">Allergies</Label>
                  <p className="text-sm">{data.clinical.allergies}</p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Known Conditions</Label>
                  <p className="text-sm">{data.clinical.knownHealthConditions || "None"}</p>
                </div>

                {editing && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Next Visit Date</Label>
                    <Input
                      value={data.nextVisitDate}
                      onChange={(e) => {
                        const updated = { ...data };
                        updated.nextVisitDate = e.target.value;
                        setData(updated);
                      }}
                      placeholder="YYYY-MM-DD"
                      className="h-9"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Preview Tab */}
        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <Label className="text-muted-foreground">Hospital</Label>
                  <p className="font-medium">{data.hospital.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Department</Label>
                  <p className="font-medium">{data.hospital.department}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Patient</Label>
                  <p className="font-medium">{data.patient.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Hospital No.</Label>
                  <p className="font-medium">{data.patient.hospitalNo}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Consultant</Label>
                  <p className="font-medium">{data.consultant.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Episode No.</Label>
                  <p className="font-medium">{data.visit.episodeNo}</p>
                </div>
              </div>

              <Separator />

              <div>
                <Label className="text-muted-foreground">Medications Summary</Label>
                <ul className="mt-2 space-y-1">
                  {data.prescription.medicines.filter(m => m.name).map(med => (
                    <li key={med.srNo} className="text-sm">
                      <span className="font-medium">{med.name}</span>
                      <span className="text-muted-foreground"> {med.dose}</span>
                      <span className="text-muted-foreground"> ({med.remarks})</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Separator />

              <div>
                <Label className="text-muted-foreground">Labs Selected</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {labCheckboxes.filter(([_, checked]) => checked).map(([key]) => (
                    <Badge key={key} variant="secondary">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Radiology Selected</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {radiologyCheckboxes.filter(([_, checked]) => checked).map(([key]) => (
                    <Badge key={key} variant="secondary">
                      {key.replace(/([A-Z])/g, ' $1').replace('Xray', 'X-Ray').replace('Usg', 'USG').trim()}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

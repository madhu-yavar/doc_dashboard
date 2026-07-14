import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ClipboardList, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SOAPData {
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
  soap: {
    subjective: string[];
    objective: string[];
    assessment: string[];
    plan: string[];
  };
  _metadata?: {
    sourceDocument: string;
    sourceDocumentId: string;
    generatedAt: string;
    department: string;
    noteType: string;
    sessionType?: string;
  };
}

interface GeneratedSOAPResult {
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

interface SOAPReviewProps {
  documentId: string;
  onComplete?: (result: GeneratedSOAPResult) => void;
}

const ICON_ACTION_BUTTON =
  "h-9 w-9 rounded-full border border-teal-200 bg-teal-50 text-teal-700 shadow-sm hover:border-teal-300 hover:bg-teal-100 hover:text-teal-800";

function SectionCard({ title, items, accentClass }: { title: string; items: string[]; accentClass: string }) {
  return (
    <Card className="overflow-hidden">
      <div className={`px-4 py-3 ${accentClass}`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white">{title}</h3>
      </div>
      <CardContent className="p-4">
        <ul className="space-y-2 text-sm text-slate-700">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 leading-relaxed">
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function SOAPReview({ documentId, onComplete }: SOAPReviewProps) {
  const [data, setData] = useState<SOAPData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [format, setFormat] = useState<"html" | "pdf" | "both">("pdf");
  const [generatedResult, setGeneratedResult] = useState<GeneratedSOAPResult | null>(null);

  useEffect(() => {
    void fetchSOAPData();
  }, [documentId]);

  const fetchSOAPData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/soap/data/${documentId}`);
      const result = await response.json();

      if (response.ok && result.success) {
        setData(result.data);
      } else {
        toast.error(result.error || "Failed to load SOAP note data");
      }
    } catch (error) {
      console.error("Error fetching SOAP data:", error);
      toast.error("Error loading SOAP note data");
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
    return fileName ? `/api/soap/download/${encodeURIComponent(fileName)}` : fileUrl;
  };

  const openGeneratedFile = (fileUrl: string) => {
    window.open(new URL(fileUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer");
  };

  const downloadGeneratedFile = async (fileUrl: string) => {
    const response = await fetch(buildDownloadUrl(fileUrl));
    if (!response.ok) {
      throw new Error("Failed to download generated SOAP note");
    }

    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = getFileNameFromUrl(fileUrl) || "soap-note";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
  };

  const generateSOAP = async () => {
    try {
      setGenerating(true);
      const response = await fetch("/api/soap/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, format }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        setGeneratedResult(result);
        toast.success("SOAP note generated successfully!");

        const primaryFileUrl = result.urls?.pdf || result.urls?.html || "";
        if (primaryFileUrl) {
          try {
            await downloadGeneratedFile(primaryFileUrl);
          } catch (downloadError) {
            console.error("Error downloading generated SOAP note:", downloadError);
            toast.error("SOAP note was generated, but automatic download failed. Use the download buttons below.");
          }
        }

        onComplete?.(result);
        return;
      }

      toast.error(result.error || "Failed to generate SOAP note");
    } catch (error) {
      console.error("Error generating SOAP note:", error);
      toast.error("Error generating SOAP note");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading SOAP note data...</span>
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
              Failed to load SOAP note data. Please ensure the document has been processed.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-slate-200">
        <div className="border-b-2 border-teal-700 bg-white px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              <img src="/manipal-logo.png" alt="Manipal Hospitals" className="h-7 w-auto blur-lg select-none" />
              <div>
                <h1 className="text-xl font-semibold text-teal-800">SOAP Clinical Note</h1>
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="flex items-center gap-3">
                <img src="/yavar-logo.png" alt="Yavar" className="h-7 w-auto" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-50">SOAP</Badge>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50">
                  {data._metadata?.sessionType === "live_conversation" ? "Live Conversation" : "Processed Document"}
                </Badge>
                <div className="ml-0 flex items-center gap-2 lg:ml-4">
                  <label htmlFor="soap-format" className="text-sm text-slate-600">Format</label>
                <select
                  id="soap-format"
                  value={format}
                  onChange={(event) => setFormat(event.target.value as "html" | "pdf" | "both")}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-900"
                >
                  <option value="pdf">PDF</option>
                  <option value="html">HTML</option>
                  <option value="both">Both</option>
                </select>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          void generateSOAP();
                        }}
                        disabled={generating}
                        className={ICON_ACTION_BUTTON}
                        aria-label="Generate SOAP Note"
                        title="Generate SOAP Note"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Generate SOAP Note</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </div>
        <CardContent className="grid gap-3 bg-white p-5 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Patient Name</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{data.patient.name}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Age / Sex</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{data.patient.ageSex || "N/A"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Visit / Episode</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{data.visit.episodeNo || "N/A"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Consultant</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{data.consultant.name || "Doctor"}</div>
          </div>
        </CardContent>
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
                <Button variant="outline" onClick={() => openGeneratedFile(generatedResult.urls!.pdf!)}>
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
                <Button variant="outline" onClick={() => openGeneratedFile(generatedResult.urls!.html!)}>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Subjective" items={data.soap.subjective} accentClass="bg-teal-700" />
        <SectionCard title="Objective" items={data.soap.objective} accentClass="bg-slate-700" />
        <SectionCard title="Assessment" items={data.soap.assessment} accentClass="bg-amber-700" />
        <SectionCard title="Plan" items={data.soap.plan} accentClass="bg-emerald-700" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-slate-100 p-2">
              <FileText className="h-5 w-5 text-slate-700" />
            </div>
            <div>
              <CardTitle className="text-base">Source Summary</CardTitle>
              <CardDescription>
                {data._metadata?.sourceDocument || "Document"} • {data.hospital.branch}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-600">
          <p>Department: {data._metadata?.department || data.consultant.department || "Not specified"}</p>
          <p>Generated at: {data._metadata?.generatedAt ? new Date(data._metadata.generatedAt).toLocaleString() : "Not available"}</p>
          <p>Clinician review and signature are required before clinical use.</p>
        </CardContent>
      </Card>
    </div>
  );
}

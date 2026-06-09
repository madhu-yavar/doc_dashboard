import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SOAPReview } from "@/components/soap/SOAPReview";

export default function SOAP() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  if (!documentId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">Invalid Document ID</h1>
          <p className="mt-2 text-slate-600">Please provide a valid document ID.</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="app-shell">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-teal-600" />
                <h1 className="text-lg font-semibold text-slate-900">SOAP Note Generator</h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="app-shell py-6">
        <SOAPReview documentId={documentId} />
      </main>
    </div>
  );
}

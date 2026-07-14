import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Database, FileSpreadsheet, RefreshCw, Search, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import AppShellHeader from "@/components/auth/AppShellHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_BASE, apiFetch, expectApiJson } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Domain = "any" | "medication" | "lab" | "radiology" | "procedure";

type CatalogMetadata = {
  source_path?: string;
  sheet_name?: string;
  imported_at?: string;
  row_count?: string;
};

type CatalogStatus = {
  available: boolean;
  databasePath: string;
  metadata: CatalogMetadata | null;
};

type ImportJob = {
  id: string;
  status: "importing" | "mapping" | "completed" | "failed";
  phase?: string;
  originalName?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string | null;
};

type DomainSummary = {
  total: number;
  matched: number;
  unmatched: number;
  high: number;
  medium: number;
  low: number;
  coverage: number;
};

type CoverageSummary = DomainSummary & {
  documentsScanned: number;
  byDomain: Record<string, DomainSummary>;
};

type MasterStatusResponse = {
  catalog: CatalogStatus;
  importJob: ImportJob | null;
  coverageSummary: CoverageSummary | null;
  reportGeneratedAt: string | null;
};

type SearchMatch = {
  itemCode: string;
  itemDesc: string;
  bgDesc: string;
  bsgDesc: string;
  category: string;
  score: number;
  confidence: "high" | "medium" | "low" | "unmatched";
};

type SearchResponse = {
  query: string;
  domain: string;
  matches: SearchMatch[];
};

const domainOptions: Array<{ value: Domain; label: string }> = [
  { value: "any", label: "All" },
  { value: "medication", label: "Medication" },
  { value: "lab", label: "Lab" },
  { value: "radiology", label: "Radiology" },
  { value: "procedure", label: "Procedure" },
];

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatPercent(value?: number) {
  return `${Math.round((value || 0) * 100)}%`;
}

function statusBadge(job: ImportJob | null, catalog: CatalogStatus) {
  if (job?.status === "failed") {
    return <Badge className="border-transparent bg-rose-50 text-rose-700">Failed</Badge>;
  }
  if (job?.status === "importing" || job?.status === "mapping") {
    return <Badge className="border-transparent bg-amber-50 text-amber-700">Processing</Badge>;
  }
  if (catalog.available) {
    return <Badge className="border-transparent bg-emerald-50 text-emerald-700">Ready</Badge>;
  }
  return <Badge className="border-transparent bg-slate-100 text-slate-700">Not uploaded</Badge>;
}

export default function ItemServiceMasterAdmin() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<MasterStatusResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isRefreshingCoverage, setIsRefreshingCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("Dolo 650");
  const [domain, setDomain] = useState<Domain>("medication");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const isBusy = status?.importJob?.status === "importing" || status?.importJob?.status === "mapping";
  const domainRows = useMemo(() => {
    const byDomain = status?.coverageSummary?.byDomain || {};
    return ["medication", "lab", "radiology", "procedure"]
      .filter((key) => byDomain[key])
      .map((key) => ({ domain: key, ...byDomain[key] }));
  }, [status?.coverageSummary?.byDomain]);

  const loadStatus = async () => {
    const response = await apiFetch(`${API_BASE}/item-service-master/status`);
    const payload = await expectApiJson<MasterStatusResponse>(response, "Unable to load item master status.");
    setStatus(payload);
    return payload;
  };

  useEffect(() => {
    loadStatus()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!isBusy) return undefined;
    const timer = window.setInterval(() => {
      loadStatus().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [isBusy]);

  const uploadFile = async () => {
    if (!selectedFile) {
      toast.error("Select an .xlsx file first.");
      return;
    }

    const form = new FormData();
    form.append("file", selectedFile);
    setIsUploading(true);
    setError(null);

    try {
      const response = await apiFetch(`${API_BASE}/item-service-master/upload`, {
        method: "POST",
        body: form,
      });
      await expectApiJson<{ job: ImportJob }>(response, "Unable to upload item/service master.");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Upload accepted. Import started.");
      await loadStatus();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const refreshCoverage = async () => {
    setIsRefreshingCoverage(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE}/item-service-master/coverage`);
      await expectApiJson(response, "Unable to refresh mapping coverage.");
      toast.success("Coverage refreshed.");
      await loadStatus();
    } catch (coverageError) {
      const message = coverageError instanceof Error ? coverageError.message : String(coverageError);
      setError(message);
      toast.error(message);
    } finally {
      setIsRefreshingCoverage(false);
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: query.trim(), domain, limit: "8" });
      const response = await apiFetch(`${API_BASE}/item-service-master/search?${params.toString()}`);
      const payload = await expectApiJson<SearchResponse>(response, "Unable to search item/service master.");
      setSearchResult(payload);
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : String(searchError);
      setError(message);
      toast.error(message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppShellHeader />
      <main className="app-shell py-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link to="/dashboard" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to dashboard
            </Link>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-teal-700">
              <Database className="h-4 w-4" strokeWidth={1.8} />
              Admin master data
            </div>
            <h1 className="text-2xl font-semibold text-slate-950">Item/service master</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Upload the active client item/service master and keep the mapping layer ready for extracted medicines, labs, radiology, and procedures.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-fit border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            onClick={() => void loadStatus()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} strokeWidth={1.8} />
            Refresh
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive" className="mb-6 bg-white">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4 text-teal-700" strokeWidth={1.8} />
                Catalog status
              </CardTitle>
              {status ? statusBadge(status.importJob, status.catalog) : null}
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="border-l-2 border-teal-500 pl-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rows</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">
                    {status?.catalog.metadata?.row_count || "-"}
                  </p>
                </div>
                <div className="border-l-2 border-cyan-500 pl-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sheet</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">
                    {status?.catalog.metadata?.sheet_name || "-"}
                  </p>
                </div>
                <div className="border-l-2 border-amber-500 pl-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Imported</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {formatDate(status?.catalog.metadata?.imported_at)}
                  </p>
                </div>
              </div>

              {isBusy ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-800">
                    <Activity className="h-4 w-4" strokeWidth={1.8} />
                    {status?.importJob?.phase || "Processing"}
                  </div>
                  <Progress value={status?.importJob?.status === "mapping" ? 75 : 35} className="h-2 bg-amber-100" />
                </div>
              ) : null}

              {status?.importJob?.status === "failed" ? (
                <Alert variant="destructive" className="bg-white">
                  <AlertTitle>Last import failed</AlertTitle>
                  <AlertDescription>{status.importJob.error || "Import failed."}</AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Upload active master</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Expected columns: ItemCode, ItemDesc, BGCode, BGDesc, BSGCode, BSGDesc, ActiveDateTo, Category.
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                  />
                  <Button
                    variant="outline"
                    className="border-slate-300 bg-white"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isBusy || isUploading}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    Choose file
                  </Button>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-h-5 truncate text-sm text-slate-600">
                    {selectedFile ? selectedFile.name : "No file selected"}
                  </p>
                  <Button
                    className="border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700"
                    onClick={() => void uploadFile()}
                    disabled={!selectedFile || isBusy || isUploading}
                  >
                    <Upload className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    {isUploading ? "Uploading" : "Upload and import"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Quick lookup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runSearch();
                  }}
                  placeholder="Dolo 650"
                />
                <div className="flex gap-2">
                  <Select value={domain} onValueChange={(value) => setDomain(value as Domain)}>
                    <SelectTrigger className="w-[160px] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {domainOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button className="flex-1 border-teal-600 bg-teal-600 text-white hover:border-teal-700 hover:bg-teal-700" onClick={() => void runSearch()} disabled={isSearching}>
                    <Search className="mr-2 h-4 w-4" strokeWidth={1.8} />
                    Search
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {(searchResult?.matches || []).slice(0, 5).map((match) => (
                  <div key={`${match.itemCode}-${match.itemDesc}`} className="rounded-md border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-5 text-slate-950">{match.itemDesc}</p>
                      <Badge className="border-transparent bg-teal-50 text-teal-700">{match.confidence}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {match.itemCode} · {match.bgDesc} · {match.bsgDesc}
                    </p>
                  </div>
                ))}
                {searchResult && searchResult.matches.length === 0 ? (
                  <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No matching catalog item found.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4 border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base">Mapping coverage</CardTitle>
            <Button
              variant="outline"
              className="border-slate-300 bg-white"
              onClick={() => void refreshCoverage()}
              disabled={!status?.catalog.available || isBusy || isRefreshingCoverage}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshingCoverage && "animate-spin")} strokeWidth={1.8} />
              Recalculate
            </Button>
          </CardHeader>
          <CardContent>
            {status?.coverageSummary ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Overall</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{formatPercent(status.coverageSummary.coverage)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Extracted items</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{status.coverageSummary.total}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Matched</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{status.coverageSummary.matched}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Documents</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{status.coverageSummary.documentsScanned}</p>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Matched</TableHead>
                      <TableHead className="text-right">Unmatched</TableHead>
                      <TableHead className="text-right">Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domainRows.map((row) => (
                      <TableRow key={row.domain}>
                        <TableCell className="font-medium capitalize">{row.domain.replace("_", " ")}</TableCell>
                        <TableCell className="text-right">{row.total}</TableCell>
                        <TableCell className="text-right">{row.matched}</TableCell>
                        <TableCell className="text-right">{row.unmatched}</TableCell>
                        <TableCell className="text-right">{formatPercent(row.coverage)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Coverage appears after the first successful upload/import.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

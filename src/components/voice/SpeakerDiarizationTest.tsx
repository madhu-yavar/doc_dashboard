/**
 * Speaker Diarization Test Component
 * Test GPU speaker diarization with audio files
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, AudioLines, User, Clock3, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import { toast } from "sonner";

type SpeakerSegment = {
  id: string;
  speakerId: string;
  speakerLabel: string;
  speakerRole: "doctor" | "patient" | "unknown";
  start: number;
  end: number;
  duration: string;
};

type DiarizationResult = {
  numSpeakers: number;
  speakers: string[];
  segments: SpeakerSegment[];
};

export function SpeakerDiarizationTest() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DiarizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResults(null);
      setError(null);
    }
  };

  const handleTest = async () => {
    if (!selectedFile) {
      toast.error("Please select an audio file first");
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Create form data
      const formData = new FormData();
      formData.append("file", selectedFile);

      // Call GPU diarization service directly
      const response = await fetch("http://206.1.62.28:8009/diarize", {
        method: "POST",
        headers: {
          "X-API-Key": "test123",
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Service returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Process results for display
      const segments: SpeakerSegment[] = (data.segments || []).map((seg: any, index: number) => ({
        id: `seg-${index}`,
        speakerId: seg.speaker,
        speakerLabel: seg.speaker === "SPEAKER_00" ? "Speaker 1" : "Speaker 2",
        speakerRole: seg.speaker === "SPEAKER_00" ? "doctor" : "patient",
        start: seg.start,
        end: seg.end,
        duration: `${(seg.end - seg.start).toFixed(2)}s`,
      }));

      setResults({
        numSpeakers: data.num_speakers,
        speakers: data.speakers,
        segments,
      });

      toast.success(`Diarization complete! ${data.num_speakers} speakers detected`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to process audio";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  const getSpeakerColor = (role: string) => {
    if (role === "doctor") return "bg-teal-500";
    if (role === "patient") return "bg-sky-500";
    return "bg-slate-400";
  };

  const getSpeakerBadgeColor = (role: string) => {
    if (role === "doctor") return "border-teal-200 bg-teal-50 text-teal-700";
    if (role === "patient") return "border-sky-200 bg-sky-50 text-sky-700";
    return "border-slate-200 bg-slate-50 text-slate-700";
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AudioLines className="h-5 w-5 text-blue-600" />
            GPU Speaker Diarization Test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Selection */}
          <div className="space-y-4">
            <div>
              <label htmlFor="audio-file" className="sr-only">Select audio file</label>
              <div className="flex items-center gap-4">
                <input
                  id="audio-file"
                  type="file"
                  accept="audio/*"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-slate-600
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-50 file:text-blue-700
                    hover:file:bg-blue-100
                    cursor-pointer"
                />
              </div>
            </div>

            {selectedFile && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <AudioLines className="h-4 w-4" />
                <span>{selectedFile.name}</span>
                <span className="text-slate-400">({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
              </div>
            )}
          </div>

          {/* Test Button */}
          <Button
            onClick={handleTest}
            disabled={!selectedFile || processing}
            className="w-full"
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Test GPU Diarization
              </>
            )}
          </Button>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-md">
              <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-900">Processing Error</h4>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Results Display */}
          {results && !processing && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center gap-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <div className="flex-1">
                  <h4 className="font-semibold text-green-900">
                    {results.numSpeakers} Speakers Detected
                  </h4>
                  <p className="text-sm text-green-700">
                    {results.segments.length} segments identified
                  </p>
                </div>
              </div>

              {/* Segments List */}
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">Speaker Segments</h3>
                <ScrollArea className="h-96 rounded-md border">
                  <div className="p-4 space-y-2">
                    {results.segments.map((segment) => (
                      <div
                        key={segment.id}
                        className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-md"
                      >
                        <div className={`w-1.5 shrink-0 rounded-full ${getSpeakerColor(segment.speakerRole)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={getSpeakerBadgeColor(segment.speakerRole)}>
                              <User className="h-3 w-3 mr-1" />
                              {segment.speakerLabel}
                            </Badge>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s
                              <span className="text-slate-400">({segment.duration})</span>
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            {segment.speakerId} • Role: {segment.speakerRole}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Speaker Summary */}
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">Speakers</h3>
                <div className="flex flex-wrap gap-2">
                  {results.speakers.map((speaker, index) => (
                    <Badge
                      key={speaker}
                      variant="outline"
                      className={index === 0 ? "border-teal-200 bg-teal-50 text-teal-700" : "border-sky-200 bg-sky-50 text-sky-700"}
                    >
                      {speaker}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
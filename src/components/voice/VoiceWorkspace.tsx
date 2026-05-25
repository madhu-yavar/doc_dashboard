import { Radio, Waves } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import LiveConversationWorkspace from "@/components/voice/LiveConversationWorkspace";
import VoiceDictationWorkspace from "@/components/voice/VoiceDictationWorkspace";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TEAL_TABS_TRIGGER =
  "rounded-lg text-teal-800 data-[state=active]:bg-teal-600 data-[state=active]:text-white data-[state=active]:shadow-none";

type VoiceWorkspaceProps = {
  onDocumentsChanged?: () => Promise<void> | void;
};

export default function VoiceWorkspace({ onDocumentsChanged }: VoiceWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "live" ? "live" : "dictation";

  const handleModeChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "live") {
      next.set("mode", "live");
    } else {
      next.delete("mode");
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <Tabs value={mode} onValueChange={handleModeChange} className="grid gap-6">
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Voice Intake</p>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Conversation and dictation workspace</h2>
            <p className="text-sm text-slate-600">
              Keep the current dictation queue intact while shaping the live conversation UI in parallel.
            </p>
          </div>
          <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-2 rounded-xl border border-teal-200 bg-teal-50/80 p-1">
            <TabsTrigger value="dictation" className={TEAL_TABS_TRIGGER}>
              <Radio className="mr-2 h-4 w-4" />
              Dictation
            </TabsTrigger>
            <TabsTrigger value="live" className={TEAL_TABS_TRIGGER}>
              <Waves className="mr-2 h-4 w-4" />
              Live conversation
            </TabsTrigger>
          </TabsList>
        </CardContent>
      </Card>

      <TabsContent value="dictation" className="mt-0">
        <VoiceDictationWorkspace onDocumentsChanged={onDocumentsChanged} />
      </TabsContent>

      <TabsContent value="live" className="mt-0">
        <LiveConversationWorkspace />
      </TabsContent>
    </Tabs>
  );
}

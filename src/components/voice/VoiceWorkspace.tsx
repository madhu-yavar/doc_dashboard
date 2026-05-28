import { ChevronDown, Radio, Waves } from "lucide-react";

import LiveConversationWorkspace from "@/components/voice/LiveConversationWorkspace";
import VoiceDictationWorkspace from "@/components/voice/VoiceDictationWorkspace";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type VoiceWorkspaceProps = {
  mode: "dictation" | "live";
  onModeChange: (mode: "dictation" | "live") => void;
  onDocumentsChanged?: () => Promise<void> | void;
};

export default function VoiceWorkspace({ mode, onModeChange, onDocumentsChanged }: VoiceWorkspaceProps) {
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              aria-label="Switch voice mode"
            >
              {mode === "live" ? <Waves className="mr-2 h-4 w-4" /> : <Radio className="mr-2 h-4 w-4" />}
              Mode
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Voice mode</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => onModeChange(value as "dictation" | "live")}
            >
              <DropdownMenuRadioItem value="dictation">Dictation</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="live">Live conversation</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {mode === "dictation" ? (
        <VoiceDictationWorkspace onDocumentsChanged={onDocumentsChanged} />
      ) : (
        <LiveConversationWorkspace />
      )}
    </div>
  );
}

import { ChevronDown, ChevronUp, Database } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ItemMasterData {
  itemCode?: string | null;
  itemDesc?: string | null;
  bgCode?: string | null;
  bgDesc?: string | null;
  bsgCode?: string | null;
  bsgDesc?: string | null;
  category?: string | null;
  confidence?: "high" | "medium" | "low" | "unmatched";
  score?: number;
  matched?: boolean;
}

interface ItemMasterInfoProps {
  data?: ItemMasterData | null;
  itemName?: string;
}

const confidenceColors = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-rose-50 text-rose-700 border-rose-200",
  unmatched: "bg-slate-100 text-slate-600 border-slate-200",
};

const confidenceLabels = {
  high: "High Match",
  medium: "Medium Match",
  low: "Low Match",
  unmatched: "No Match",
};

function ItemMasterInfo({ data, itemName }: ItemMasterInfoProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!data) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No item master mapping available
      </div>
    );
  }

  const { itemCode, itemDesc, bgCode, bgDesc, bsgCode, bsgDesc, category, confidence, matched } = data;

  if (!matched) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="w-3 h-3" />
        <span className="italic">No match in item master</span>
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto p-0 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Database className="w-3 h-3 mr-1" />
        Item Master
        {confidence && (
          <Badge className={cn("ml-2 text-xs", confidenceColors[confidence])}>
            {confidenceLabels[confidence]}
          </Badge>
        )}
        {isExpanded ? (
          <ChevronUp className="w-3 h-3 ml-1" />
        ) : (
          <ChevronDown className="w-3 h-3 ml-1" />
        )}
      </Button>

      {isExpanded && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-muted-foreground">Item Code:</div>
          <div className="font-mono text-foreground">{itemCode || "-"}</div>

          <div className="text-muted-foreground">Item Desc:</div>
          <div className="text-foreground">{itemDesc || "-"}</div>

          <div className="text-muted-foreground">BG Code:</div>
          <div className="font-mono text-foreground">{bgCode || "-"}</div>

          <div className="text-muted-foreground">BG Desc:</div>
          <div className="text-foreground">{bgDesc || "-"}</div>

          {bsgCode && (
            <>
              <div className="text-muted-foreground">BSG Code:</div>
              <div className="font-mono text-foreground">{bsgCode}</div>
            </>
          )}

          {bsgDesc && (
            <>
              <div className="text-muted-foreground">BSG Desc:</div>
              <div className="text-foreground">{bsgDesc}</div>
            </>
          )}

          {category && (
            <>
              <div className="text-muted-foreground">Category:</div>
              <div className="text-foreground">{category}</div>
            </>
          )}

          {typeof score === "number" && (
            <>
              <div className="text-muted-foreground">Match Score:</div>
              <div className="text-foreground">{(score * 100).toFixed(1)}%</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ItemMasterInfo;

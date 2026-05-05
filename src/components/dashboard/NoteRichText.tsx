import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface NoteRichTextProps {
  text: string;
  className?: string;
  muted?: boolean;
}

type RichTextBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] };

const unorderedListPattern = /^[-*•]\s+(.*)$/;
const orderedListPattern = /^\d+\.\s+(.*)$/;
const headingPattern = /^#{1,3}\s+(.*)$/;

const parseBlocks = (text: string): RichTextBlock[] => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: RichTextBlock[] = [];
  let paragraphLines: string[] = [];
  let listType: "unordered-list" | "ordered-list" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join("\n").trim(),
    });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    blocks.push({ type: listType, items: [...listItems] });
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(headingPattern);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: headingMatch[1].trim() });
      continue;
    }

    const unorderedMatch = trimmed.match(unorderedListPattern);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== "unordered-list") flushList();
      listType = "unordered-list";
      listItems.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = trimmed.match(orderedListPattern);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== "ordered-list") flushList();
      listType = "ordered-list";
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
};

const renderInline = (text: string): ReactNode[] => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${part}-${index}`}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={`${part}-${index}`} className="italic">{part.slice(1, -1)}</em>;
    }

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
};

const renderParagraphText = (text: string) =>
  text.split("\n").map((line, index) => (
    <Fragment key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {renderInline(line)}
    </Fragment>
  ));

const NoteRichText = ({ text, className, muted = false }: NoteRichTextProps) => {
  const blocks = parseBlocks(text);

  if (blocks.length === 0) return null;

  const textColor = muted ? "text-muted-foreground" : "text-foreground";

  return (
    <div className={cn("space-y-3 text-sm leading-6", textColor, className)}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h4 key={`${block.type}-${index}`} className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {renderInline(block.text)}
            </h4>
          );
        }

        if (block.type === "unordered-list") {
          return (
            <ul key={`${block.type}-${index}`} className="space-y-1 pl-5 marker:text-slate-400 list-disc">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={`${block.type}-${index}`} className="space-y-1 pl-5 marker:text-slate-400 list-decimal">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={`${block.type}-${index}`} className="text-inherit">
            {renderParagraphText(block.text)}
          </p>
        );
      })}
    </div>
  );
};

export default NoteRichText;

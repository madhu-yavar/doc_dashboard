import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transformProcessedDocument, type ProcessedDocument } from "@/lib/processedDocuments";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const documentsPath = path.resolve(__dirname, "../server/storage/documents.json");
const payload = JSON.parse(readFileSync(documentsPath, "utf8")) as {
  documents: ProcessedDocument[];
};

const document = payload.documents.find((item) => item.id === "14759598-63f9-48d0-a030-0663a8fe4002");

if (!document) {
  throw new Error("Voice document not found");
}

const originalConsoleLog = console.log;
console.log = () => {};
const transformed = transformProcessedDocument(document);
console.log = originalConsoleLog;

process.stdout.write(`${JSON.stringify({
  patient: transformed.patient,
  admission: transformed.admission,
  diagnosis: transformed.diagnosis,
  vitals: transformed.vitals,
  labs: transformed.labs,
  radiology: transformed.radiology,
  treatment: transformed.treatment,
  followUp: transformed.followUp,
  notesRailCount: transformed.presentation.notesRail.length,
  summaryCardKeys: Object.keys(transformed.presentation.summaryCards || {}),
}, null, 2)}\n`);

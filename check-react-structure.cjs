const PrescriptionReactExtractorAgent = require("./agents/prescription_react_extractor_agent.cjs");

async function test() {
  const agent = new PrescriptionReactExtractorAgent({
    qwen: {
      qwenUrl: "http://206.1.62.28:8001/v1/chat/completions",
      qwenModel: "cyankiwi/Qwen3-VL-30B-A3B-Instruct-AWQ-4bit",
      timeout: 180000
    }
  });

  const result = await agent.process("./data/Doxper.pdf", {
    pdfName: "Doxper.pdf"
  });

  console.log("=== DATA STRUCTURE ===");
  console.log("Keys in result.data:", Object.keys(result.data));
  console.log("");
  console.log("result.data.medications:", result.data.medications?.length);
  console.log("result.data.dashboard_cards:", result.data.dashboard_cards ? "present" : "missing");
  console.log("result.data.presentation:", result.data.presentation ? "present" : "missing");
}

test().catch(console.error);

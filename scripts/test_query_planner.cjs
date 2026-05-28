const QueryIntentAgent = require("../agents/query_intent_agent.cjs");

async function main() {
  const agent = new QueryIntentAgent({
    gemma: {
      baseUrl: process.env.GEMMA_URL || "http://206.1.62.28:8000/v1/chat/completions",
      model: process.env.GEMMA_MODEL || "google/gemma-4-26B-A4B-it",
      timeout: 120000,
    },
  });

  const queries = [
    { message: "Age of the patient?", sectionContext: "" },
    { message: "What is the composition for: T.CILACAR M?", sectionContext: "medications" },
    { message: "The patient's bp is less than reference, why?", sectionContext: "vitals" },
    { message: "Why is this happening?", sectionContext: "" },
  ];

  const results = [];
  for (const input of queries) {
    const result = await agent.execute(input);
    results.push({
      input,
      output: result.data,
    });
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

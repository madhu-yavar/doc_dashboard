import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const PhiMaskerTool = require("../../tools/image/phi_masker.tool.cjs");

async function createPrescriptionTemplateFixture() {
  const width = 1000;
  const height = 1400;
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <rect x="60" y="18" width="320" height="54" fill="#3db24b"/>
      <rect x="58" y="120" width="884" height="3" fill="#1d4ed8"/>
      <rect x="58" y="340" width="884" height="3" fill="#1d4ed8"/>
      <rect x="58" y="392" width="884" height="3" fill="#1d4ed8"/>

      <rect x="170" y="152" width="200" height="28" fill="#111111"/>
      <rect x="170" y="198" width="150" height="24" fill="#111111"/>
      <rect x="170" y="242" width="150" height="24" fill="#111111"/>
      <rect x="170" y="286" width="420" height="44" fill="#111111"/>

      <rect x="565" y="152" width="130" height="24" fill="#111111"/>
      <rect x="825" y="152" width="120" height="24" fill="#111111"/>
      <rect x="565" y="198" width="130" height="24" fill="#111111"/>
      <rect x="565" y="242" width="215" height="24" fill="#111111"/>
      <rect x="565" y="306" width="215" height="24" fill="#111111"/>

      <rect x="135" y="360" width="110" height="24" fill="#2563eb"/>
      <rect x="290" y="360" width="110" height="24" fill="#2563eb"/>
      <rect x="445" y="360" width="160" height="24" fill="#2563eb"/>
      <rect x="660" y="360" width="150" height="24" fill="#2563eb"/>
    </svg>
  `;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    width,
    height,
    base64: buffer.toString("base64")
  };
}

describe("PhiMaskerTool prescription template masking", () => {
  it("detects template anchors and masks header value boxes without touching vitals row", async () => {
    const tool = new PhiMaskerTool();
    const fixture = await createPrescriptionTemplateFixture();

    const anchors = await tool.detectPrescriptionTemplateAnchors(fixture.base64);
    expect(anchors.success).toBe(true);
    expect(anchors.anchorLines.top_separator.y).toBeGreaterThanOrEqual(118);
    expect(anchors.anchorLines.top_separator.y).toBeLessThanOrEqual(124);
    expect(anchors.anchorLines.header_boundary.y).toBeGreaterThanOrEqual(338);
    expect(anchors.anchorLines.header_boundary.y).toBeLessThanOrEqual(344);

    const result = await tool.execute(fixture.base64, {
      pageNum: 1,
      documentType: "prescription"
    });

    expect(result.success).toBe(true);
    expect(result.masking_strategy).toBe("prescription_template");
    expect(result.template_detected).toBe(true);
    expect(result.masked_fields).toContain("patient_name");
    expect(result.masked_fields).toContain("department");

    const maskedBuffer = Buffer.from(result.maskedImage, "base64");
    const { data, info } = await sharp(maskedBuffer).raw().toBuffer({ resolveWithObject: true });

    const readPixel = (x: number, y: number) => {
      const offset = ((y * info.width) + x) * info.channels;
      return Array.from(data.slice(offset, offset + info.channels));
    };

    const maskedHeaderPixel = readPixel(220, 166);
    const preservedVitalsPixel = readPixel(470, 370);

    expect(maskedHeaderPixel[0]).toBeLessThanOrEqual(25);
    expect(maskedHeaderPixel[1]).toBeLessThanOrEqual(25);
    expect(maskedHeaderPixel[2]).toBeLessThanOrEqual(25);

    expect(preservedVitalsPixel[2]).toBeGreaterThan(150);
    expect(preservedVitalsPixel[0]).toBeLessThan(120);
  });
});

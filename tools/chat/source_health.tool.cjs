class SourceHealthTool {
  constructor(config = {}) {
    this.name = "Source Health";
    this.version = "1.0.0";
    this.config = { timeout: 12000, ...config };
    this.sources = {
      openfda: "https://api.fda.gov/drug/label.json?limit=1",
      dailymed: "https://dailymed.nlm.nih.gov/dailymed/",
      pubmed: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed&retmode=json",
      icd: "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=test&maxList=1",
      clinicaltrials: "https://clinicaltrials.gov/api/v2/studies?query.term=heart&pageSize=1",
    };
  }

  async checkUrl(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "*/*" },
      });
      return {
        status: response.ok ? "up" : "down",
        http_status: response.status,
        latency_ms: Date.now() - startedAt,
        error: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        status: error?.name === "AbortError" ? "timeout" : "down",
        http_status: null,
        latency_ms: Date.now() - startedAt,
        error: error?.message || "Request failed",
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async checkAll() {
    const entries = await Promise.all(
      Object.entries(this.sources).map(async ([key, url]) => {
        const result = await this.checkUrl(url);
        return [
          key,
          {
            source: key,
            url,
            checked_at: new Date().toISOString(),
            ...result,
          },
        ];
      })
    );

    return Object.fromEntries(entries);
  }
}

module.exports = SourceHealthTool;

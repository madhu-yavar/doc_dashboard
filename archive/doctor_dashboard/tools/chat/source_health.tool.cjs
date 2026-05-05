class SourceHealthTool {
  constructor(config = {}) {
    this.name = "Source Health";
    this.version = "1.0.0";
    this.config = { timeout: 12000, ...config };
    this.sources = {
      openfda: "https://api.fda.gov/drug/label.json?limit=1",
      openfda_docs: "https://open.fda.gov/apis/drug/",
      dailymed: "https://dailymed.nlm.nih.gov/dailymed/",
      pubmed: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed&retmode=json",
      icd: "https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms=test&maxList=1",
      clinicaltrials: "https://clinicaltrials.gov/api/v2/studies?query.term=heart&pageSize=1",
      rxnorm: "https://rxnav.nlm.nih.gov/REST/version.json",
      medlineplus: "https://medlineplus.gov/",
      medlineplus_connect: "https://connect.medlineplus.gov/service",
      who_icd: "https://icd.who.int/",
      who_id: "https://id.who.int/",
      cdsco: "https://cdsco.gov.in/opencms/opencms/en/Home/",
      ipc: "https://www.ipc.gov.in/",
      icmr: "https://www.icmr.gov.in/guidelines",
      mohfw_stg: "https://clinicalestablishments.mohfw.gov.in/en/standard-treatment-guidelines",
      ncdc: "https://ncdc.mohfw.gov.in/resource-library-tab1/",
      nvhcp: "https://nvhcp.mohfw.gov.in/Guidelines",
      nmc: "https://www.nmc.org.in/",
      janaushadhi: "https://janaushadhi.gov.in/index.html",
      pharmaceuticals: "https://pharmaceuticals.gov.in/",
      nppa: "https://nppaindia.nic.in/",
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

class SourcePolicyTool {
  constructor(config = {}) {
    this.name = "Source Policy";
    this.version = "1.0.0";
    this.config = config;
    this.allowedDomains = [
      "clinicaltables.nlm.nih.gov",
      "api.fda.gov",
      "dailymed.nlm.nih.gov",
      "eutils.ncbi.nlm.nih.gov",
      "clinicaltrials.gov",
      "pubmed.ncbi.nlm.nih.gov",
    ];
  }

  isAllowed(url = "") {
    try {
      const hostname = new URL(url).hostname;
      return this.allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  filter(results = []) {
    return (Array.isArray(results) ? results : []).filter((item) => this.isAllowed(item.url));
  }
}

module.exports = SourcePolicyTool;

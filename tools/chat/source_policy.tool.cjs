class SourcePolicyTool {
  constructor(config = {}) {
    this.name = "Source Policy";
    this.version = "1.0.0";
    this.config = config;
    this.allowedDomains = [
      "api.fda.gov",
      "open.fda.gov",
      "dailymed.nlm.nih.gov",
      "eutils.ncbi.nlm.nih.gov",
      "pubmed.ncbi.nlm.nih.gov",
      "clinicaltables.nlm.nih.gov",
      "clinicaltrials.gov",
      "rxnav.nlm.nih.gov",
      "medlineplus.gov",
      "connect.medlineplus.gov",
      "icd.who.int",
      "id.who.int",
      "cdsco.gov.in",
      "www.cdsco.gov.in",
      "ipc.gov.in",
      "www.ipc.gov.in",
      "icmr.gov.in",
      "www.icmr.gov.in",
      "mohfw.gov.in",
      "clinicalestablishments.mohfw.gov.in",
      "ncdc.mohfw.gov.in",
      "nvhcp.mohfw.gov.in",
      "nmc.org.in",
      "janaushadhi.gov.in",
      "pharmaceuticals.gov.in",
      "nppaindia.nic.in",
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

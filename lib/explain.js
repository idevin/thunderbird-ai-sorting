const KNOWN = {
  "missing-key": "errorMissingKey",
  network: "networkError",
  "no-json": "errorNoJson",
  "unknown-category": "errorUnknownCategory",
  "no-message": "errorNoMessage",
  "no-compose": "errorNoCompose",
  "summary-empty": "errorSummaryEmpty",
  "no-folder": "errorNoFolder",
  empty: "errorEmpty",
};

export function explain(error) {
  const code = error && error.message ? error.message : String(error || "");
  if (KNOWN[code]) {
    return browser.i18n.getMessage(KNOWN[code]);
  }
  if (code.startsWith("provider:")) {
    return browser.i18n.getMessage("errorProvider", code.slice("provider:".length));
  }
  return code || browser.i18n.getMessage("errorEmpty");
}

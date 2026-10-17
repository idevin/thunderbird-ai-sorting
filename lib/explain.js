import { providerErrorText } from "./providers.js";

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
    const text = providerErrorText(code);
    if (text) {
      return text;
    }
    const status = code.match(/^provider:(\d{3})/);
    return browser.i18n.getMessage("errorProvider", status ? status[1] : "");
  }
  return code || browser.i18n.getMessage("errorEmpty");
}

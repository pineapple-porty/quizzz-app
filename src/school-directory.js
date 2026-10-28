const { domainToASCII } = require("node:url");

const DIRECTORY_ORIGINS = {
  district: "https://nces.ed.gov/ccd/districtsearch/district_list.asp",
  school: "https://nces.ed.gov/ccd/schoolsearch/school_list.asp",
};

function normalizeEmailDomain(domain) {
  if (typeof domain !== "string") return null;
  const normalized = domainToASCII(domain.trim().replace(/\.$/, "").toLowerCase());
  if (!normalized || normalized.length > 253 || !normalized.includes(".")) return null;
  const labels = normalized.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return normalized;
}

function parseEmailDomainAllowlist(serialized) {
  if (serialized && typeof serialized === "object" && !Array.isArray(serialized)) {
    return normalizeEmailDomainAllowlist(serialized);
  }
  if (typeof serialized !== "string" || !serialized.trim()) return {};
  try {
    const parsed = JSON.parse(serialized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? normalizeEmailDomainAllowlist(parsed)
      : {};
  } catch {
    return {};
  }
}

function normalizeEmailDomainAllowlist(value) {
  const allowlist = {};
  for (const [institutionKey, domains] of Object.entries(value)) {
    if (!/^(school:\d{12}|district:\d{7})$/.test(institutionKey) || !Array.isArray(domains)) continue;
    const normalizedDomains = [...new Set(domains.map(normalizeEmailDomain).filter(Boolean))];
    if (normalizedDomains.length) allowlist[institutionKey] = normalizedDomains;
  }
  return allowlist;
}

function isVerifiedInstitutionEmail(email, type, id, allowlist) {
  if (typeof email !== "string") return false;
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return false;
  const domain = normalizeEmailDomain(email.slice(separator + 1));
  if (!domain) return false;
  const verifiedDomains = parseEmailDomainAllowlist(allowlist)[`${type}:${id}`] || [];
  return verifiedDomains.includes(domain);
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseDirectoryResults(html, type, query) {
  const detailPage = type === "district" ? "district_detail\\.asp" : "school_detail\\.asp";
  const idParam = type === "district" ? "ID2" : "ID";
  const expression = new RegExp(
    `<a\\b[^>]*href=["'][^"']*${detailPage}\\?[^"']*?${idParam}=(\\d+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
    "gi",
  );
  const searchTerm = query.trim().toLocaleLowerCase("en-US");
  const results = [];
  let match;
  while ((match = expression.exec(html)) !== null) {
    const name = decodeHtml(match[2]);
    if (!name.toLocaleLowerCase("en-US").includes(searchTerm)) continue;
    const afterLink = html.slice(expression.lastIndex);
    const address = decodeHtml(afterLink.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    results.push({
      id: match[1],
      type,
      name,
      address,
      source: "NCES",
    });
  }
  return results;
}

async function searchOneType(type, query, fetchImpl = fetch) {
  const url = new URL(DIRECTORY_ORIGINS[type]);
  url.searchParams.set("Search", "1");
  url.searchParams.set("InstName", query);
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(7000),
    headers: { "User-Agent": "ZachsQuiz teacher-application lookup" },
  });
  if (!response.ok) throw new Error(`NCES ${type} lookup returned ${response.status}`);
  return parseDirectoryResults(await response.text(), type, query);
}

async function searchSchoolDirectory(query, fetchImpl = fetch) {
  const cleaned = typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";
  if (cleaned.length < 2 || cleaned.length > 100) return [];
  const [districts, schools] = await Promise.all([
    searchOneType("district", cleaned, fetchImpl),
    searchOneType("school", cleaned, fetchImpl),
  ]);
  const unique = new Map();
  for (const item of [...districts, ...schools]) {
    unique.set(`${item.type}:${item.id}`, item);
  }
  return [...unique.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))
    .slice(0, 30);
}

module.exports = {
  isVerifiedInstitutionEmail,
  normalizeEmailDomain,
  parseEmailDomainAllowlist,
  parseDirectoryResults,
  searchSchoolDirectory,
};

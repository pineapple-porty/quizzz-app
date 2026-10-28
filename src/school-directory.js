const DIRECTORY_ORIGINS = {
  district: "https://nces.ed.gov/ccd/districtsearch/district_list.asp",
  school: "https://nces.ed.gov/ccd/schoolsearch/school_list.asp",
};

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

module.exports = { parseDirectoryResults, searchSchoolDirectory };

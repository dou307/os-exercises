/** 极简 hash 路由：#/ 、#/ch/1 、#/practice/1?scope=core&i=0 、#/q/<id> 、#/review 、#/search?q= 、#/source */

export function parseHash(hash) {
  const raw = (hash || window.location.hash || "#/").replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart || "");

  if (segments.length === 0) return { name: "home", params: {} };
  const [head, ...rest] = segments;
  if (head === "ch" && rest[0]) return { name: "chapter", params: { chapterId: decodeURIComponent(rest[0]) } };
  if (head === "practice" && rest[0]) {
    return {
      name: "practice",
      params: {
        chapterId: decodeURIComponent(rest[0]),
        scope: query.get("scope") || "core",
        i: query.get("i") || "0",
        qid: query.get("qid") || "",
      },
    };
  }
  if (head === "q" && rest[0]) return { name: "question", params: {
    id: decodeURIComponent(rest[0]), type: query.get("type") || "", status: query.get("status") || "",
  } };
  if (head === "review") return { name: "review", params: { ch: query.get("ch") || "" } };
  if (head === "favorites") return { name: "favorites", params: { ch: query.get("ch") || "" } };
  if (head === "search") {
    return {
      name: "search",
      params: {
        q: query.get("q") || "",
        ch: query.get("ch") || "",
        type: query.get("type") || "",
        tier: query.get("tier") || "",
      },
    };
  }
  if (head === "source") return { name: "source", params: {} };
  return { name: "notfound", params: {} };
}

export function navigate(hash) {
  if (window.location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
}

/** 拼查询串，空值自动省略，避免地址栏里出现 `&ch=&type=` 这种噪声。 */
export function buildHash(path, params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

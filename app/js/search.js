/** 全库搜索：题干、章节、原题号、知识点。结果直达对应题目。 */

import { getIndex, getTopics, topicTitle } from "./questions.js";

export function searchQuestions(index, topics, rawQuery) {
  const query = rawQuery.trim();
  if (!query) return [];
  const terms = query.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
  const results = [];
  index.questions.forEach((entry) => {
    const topicText = entry.topics.map((id) => `${id} ${topicTitle(topics, id)}`).join(" ");
    const haystack = [
      entry.stem,
      entry.sec || "",
      entry.sub || "",
      entry.label || "",
      entry.id,
      topicText,
    ].join(" ").toLowerCase();
    let score = 0;
    let all = true;
    terms.forEach((term) => {
      if (!haystack.includes(term)) { all = false; return; }
      if (entry.id.toLowerCase() === term) score += 60;
      else if (entry.label && entry.label.toLowerCase().includes(term)) score += 25;
      else if (entry.stem.toLowerCase().includes(term)) score += 12;
      else score += 4;
    });
    if (!all) return;
    if (entry.tier === "core" || entry.tier === "bridge") score += 6;
    results.push({ entry, score });
  });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 60).map((r) => r.entry);
}

export async function renderSearch(main, query) {
  const index = await getIndex();
  const topics = await getTopics();
  main.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("h1");
  title.textContent = query ? `搜索：${query}` : "搜索题目";
  card.appendChild(title);

  if (!query) {
    const hint = document.createElement("p");
    hint.className = "sub";
    hint.textContent = "输入题干关键词、知识点、章节名或题目 ID，例如「中断」「t1-4-2」「c1-s3-0-q019」。";
    card.appendChild(hint);
    main.appendChild(card);
    return;
  }

  const results = searchQuestions(index, topics, query);
  const sub = document.createElement("p");
  sub.className = "sub";
  sub.textContent = `命中 ${results.length} 道（最多显示 60 道）。点击任意结果直达题目。`;
  card.appendChild(sub);

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配的题目。换个关键词，或从左侧章节进入题单。";
    card.appendChild(empty);
    main.appendChild(card);
    return;
  }

  const list = document.createElement("ul");
  list.className = "qlist";
  results.forEach((entry) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.className = "qitem";
    link.href = `#/q/${encodeURIComponent(entry.id)}`;
    const no = document.createElement("span");
    no.className = "no";
    no.textContent = entry.label.replace(/\s/g, "") || "—";
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = entry.stem;
    const meta = document.createElement("span");
    meta.className = "meta";
    const badge = document.createElement("span");
    badge.className = `badge ${entry.tier}`;
    badge.textContent = `第 ${entry.ch} 章`;
    meta.appendChild(badge);
    link.appendChild(no);
    link.appendChild(txt);
    link.appendChild(meta);
    li.appendChild(link);
    list.appendChild(li);
  });
  card.appendChild(list);
  main.appendChild(card);
}

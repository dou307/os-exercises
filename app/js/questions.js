/**
 * 题目数据访问层。
 *
 * 元数据与索引一次加载；章节题目按需加载（`data/questions/<chapter>.json`）。
 * 不把整库 760 道题一次性塞进首屏。
 */

const cache = {
  meta: null,
  index: null,
  topics: null,
  chapters: new Map(),
};

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`加载 ${path} 失败：HTTP ${response.status}`);
  return response.json();
}

export async function getMeta() {
  if (!cache.meta) cache.meta = await fetchJSON("data/meta.json");
  return cache.meta;
}

export async function getIndex() {
  if (!cache.index) cache.index = await fetchJSON("data/index.json");
  return cache.index;
}

export async function getTopics() {
  if (!cache.topics) {
    const doc = await fetchJSON("data/topics.json");
    cache.topics = new Map(doc.topics.map((t) => [t.id, t]));
  }
  return cache.topics;
}

export async function getChapterQuestions(chapterId) {
  if (!cache.chapters.has(chapterId)) {
    const doc = await fetchJSON(`data/questions/${chapterId}.json`);
    cache.chapters.set(chapterId, doc.questions);
  }
  return cache.chapters.get(chapterId);
}

export async function getQuestion(id) {
  const index = await getIndex();
  const entry = index.questions.find((q) => q.id === id);
  if (!entry) return null;
  const list = await getChapterQuestions(entry.ch);
  return list.find((q) => q.id === id) || null;
}

export function topicTitle(topics, id) {
  const topic = topics.get(id);
  return topic ? topic.title : id;
}

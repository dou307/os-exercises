/**
 * 公式渲染：把题干里的 `\( … \)`、`\[ … \]`、`$$ … $$` 交给本地 KaTeX。
 *
 * 只处理文本节点，不碰标签结构，因此不会破坏已清洗的 HTML。
 * KaTeX 缺失时保留原始定界符，页面仍然可读。
 */

const PATTERN = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/;

export function renderMath(root) {
  if (!root || !window.katex) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeValue && node.nodeValue.indexOf("\\(") !== -1
      || node.nodeValue && node.nodeValue.indexOf("\\[") !== -1
      || node.nodeValue && node.nodeValue.indexOf("$$") !== -1) {
      targets.push(node);
    }
  }
  targets.forEach(replaceNode);
}

function replaceNode(node) {
  const text = node.nodeValue;
  if (!PATTERN.test(text)) return;
  const fragment = document.createDocumentFragment();
  let rest = text;
  let guard = 0;
  while (rest && guard < 200) {
    guard += 1;
    const match = PATTERN.exec(rest);
    if (!match) break;
    if (match.index > 0) fragment.appendChild(document.createTextNode(rest.slice(0, match.index)));
    const display = match[2] !== undefined || match[3] !== undefined;
    const tex = match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[3]);
    const span = document.createElement("span");
    try {
      window.katex.render(tex, span, { throwOnError: false, displayMode: display });
    } catch (error) {
      span.textContent = match[0];
    }
    fragment.appendChild(span);
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) fragment.appendChild(document.createTextNode(rest));
  node.parentNode.replaceChild(fragment, node);
}

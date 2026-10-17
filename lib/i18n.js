const TOKEN = /__MSG_([A-Za-z0-9_]+)__/g;

function translate(value) {
  return value.replace(TOKEN, (matched, key) => browser.i18n.getMessage(key) || matched);
}

export function applyI18n(root = document) {
  const scope = root.documentElement || root;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (walker.currentNode.nodeValue.includes("__MSG_")) {
      nodes.push(walker.currentNode);
    }
  }
  for (const node of nodes) {
    node.nodeValue = translate(node.nodeValue);
  }
}

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', '@gorhom', 'bottom-sheet');

const guardedTs = `import {
  type NodeHandle,
  findNodeHandle as _findNodeHandle,
} from 'react-native';

export function findNodeHandle(
  componentOrHandle: Parameters<typeof _findNodeHandle>['0']
) {
  if (componentOrHandle == null) {
    return null;
  }

  let nodeHandle: NodeHandle | null;
  try {
    nodeHandle = _findNodeHandle(componentOrHandle);
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}

  try {
    // @ts-ignore
    nodeHandle = typeof componentOrHandle.getNativeScrollRef === 'function'
      ? componentOrHandle.getNativeScrollRef()
      : null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}

  try {
    // @ts-ignore
    nodeHandle = componentOrHandle._scrollRef ?? null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}

  return componentOrHandle;
}
`;

const guardedEsm = `"use strict";

import { findNodeHandle as _findNodeHandle } from 'react-native';
export function findNodeHandle(componentOrHandle) {
  if (componentOrHandle == null) {
    return null;
  }
  let nodeHandle;
  try {
    nodeHandle = _findNodeHandle(componentOrHandle);
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  try {
    nodeHandle = typeof componentOrHandle.getNativeScrollRef === 'function'
      ? componentOrHandle.getNativeScrollRef()
      : null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  try {
    nodeHandle = componentOrHandle._scrollRef ?? null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  return componentOrHandle;
}
`;

const guardedCjs = `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findNodeHandle = findNodeHandle;
var _reactNative = require("react-native");
function findNodeHandle(componentOrHandle) {
  if (componentOrHandle == null) {
    return null;
  }
  let nodeHandle;
  try {
    nodeHandle = (0, _reactNative.findNodeHandle)(componentOrHandle);
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  try {
    nodeHandle = typeof componentOrHandle.getNativeScrollRef === 'function'
      ? componentOrHandle.getNativeScrollRef()
      : null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  try {
    nodeHandle = componentOrHandle._scrollRef ?? null;
    if (nodeHandle) {
      return nodeHandle;
    }
  } catch {}
  return componentOrHandle;
}
`;

const files = [
  [path.join(root, 'src', 'utilities', 'findNodeHandle.web.ts'), guardedTs],
  [path.join(root, 'lib', 'module', 'utilities', 'findNodeHandle.web.js'), guardedEsm],
  [path.join(root, 'lib', 'commonjs', 'utilities', 'findNodeHandle.web.js'), guardedCjs],
];

let patched = 0;
for (const [file, contents] of files) {
  if (!fs.existsSync(file)) {
    console.warn('[patch-bottom-sheet-web] missing', file);
    continue;
  }
  fs.writeFileSync(file, contents);
  patched += 1;
}
console.log(`[patch-bottom-sheet-web] patched ${patched} findNodeHandle.web files`);

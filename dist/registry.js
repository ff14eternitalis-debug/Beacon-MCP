"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTool = registerTool;
exports.getTools = getTools;
exports.getTool = getTool;
const tools = new Map();
let cachedArray = null;
function registerTool(def) {
    tools.set(def.name, def);
    cachedArray = null;
}
function getTools() {
    if (!cachedArray)
        cachedArray = Array.from(tools.values());
    return cachedArray;
}
function getTool(name) {
    return tools.get(name);
}

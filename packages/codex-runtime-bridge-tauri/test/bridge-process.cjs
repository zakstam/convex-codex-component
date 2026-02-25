#!/usr/bin/env node

const fs = require("node:fs");

const inputPath = process.env.BRIDGE_INPUT_PATH;
const bridgeLines = process.env.BRIDGE_LINES ?? "";

if (inputPath) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    fs.appendFileSync(inputPath, chunk.toString());
  });
}

if (bridgeLines.length > 0) {
  process.stdout.write(bridgeLines);
}

process.on("SIGTERM", () => process.exit(0));
process.stdin.resume();
setInterval(() => {}, 10000);

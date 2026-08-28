#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const [, , inputArgument, outputArgument] = process.argv;
if (!inputArgument || !outputArgument) throw new TypeError("Usage: render-f104-svg.mjs <input.svg> <output.png>");
const input = resolve(inputArgument); const output = resolve(outputArgument);
const svg = await readFile(input, "utf8");
if (!/^<svg\b/u.test(svg)) throw new TypeError("F-104 SVG input must start with an SVG root element.");

const width = 2381; const height = 1684;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:#fff;overflow:hidden}svg{display:block;width:${width}px!important;height:${height}px!important}</style>${svg}`, { waitUntil: "load" });
  const root = page.locator("svg");
  if (await root.count() !== 1) throw new Error("F-104 SVG render must contain exactly one SVG root.");
  await root.screenshot({ path: output, animations: "disabled" });
} finally {
  await browser.close();
}
console.log(`F-104 Chromium SVG render written: ${output}`);

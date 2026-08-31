import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("E2E IndexedDB consumers follow the running product schema", async ({ page }) => {
  const staleVersionOneOpen = /indexedDB\.open\(\s*["']kuubik-draw["']\s*,\s*1\s*\)/u;
  const staleConsumers: string[] = [];
  for (const path of await typescriptFiles(resolve(process.cwd(), "e2e"))) {
    if (staleVersionOneOpen.test(await readFile(path, "utf8"))) staleConsumers.push(path);
  }
  expect(staleConsumers).toEqual([]);

  const consoleErrors = collectErrors(page);
  await page.goto("/d/local");
  const schema = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
      const request = indexedDB.open("kuubik-draw");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => rejectOpen(request.error);
    });
    const readBack = {
      version: database.version,
      stores: Array.from(database.objectStoreNames).sort(),
    };
    database.close();
    return readBack;
  });

  expect(schema.version).toBeGreaterThanOrEqual(3);
  expect(schema.stores).toEqual(expect.arrayContaining([
    "attachments",
    "compactions",
    "documents",
    "operations",
    "recoveryEvents",
    "snapshots",
  ]));
  expect(consoleErrors).toEqual([]);
});

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReportSchema } from "./schema.mjs";

/** @typedef {import("./schema.mjs").SmokeReport} SmokeReport */
/** @typedef {{ runDirectory: string, screenshotsDirectory: string, reportJsonPath: string, reportHtmlPath: string, templatePath: string }} ArtifactPaths */

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPORT_TEMPLATE_PATH = path.resolve(MODULE_DIRECTORY, "assets", "report-template.html");

/** @param {{ orgAlias: string | null, orgUsername: string, depth: number, delayMs: number, areas: import("./cli.mjs").CrawlArea[] }} options @returns {SmokeReport} */
export function createInitialReport({ orgAlias, orgUsername, depth, delayMs, areas }) {
  return {
    run: {
      orgAlias,
      orgUsername,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      config: {
        depth,
        delayMs,
        areas,
      },
      counts: {
        typesVisited: 0,
        coverageGaps: 0,
        errors: 0,
      },
    },
    coverageGaps: [],
    errors: [],
  };
}

/** @param {string} [baseDirectory] @returns {Promise<ArtifactPaths>} */
export async function createArtifactPaths(baseDirectory = path.resolve("docs", "smoke-reports")) {
  const runDirectory = path.join(baseDirectory, createRunTimestamp(new Date()));
  const screenshotsDirectory = path.join(runDirectory, "screenshots");
  await mkdir(screenshotsDirectory, { recursive: true });

  return {
    runDirectory,
    screenshotsDirectory,
    reportJsonPath: path.join(runDirectory, "report.json"),
    reportHtmlPath: path.join(runDirectory, "report.html"),
    templatePath: REPORT_TEMPLATE_PATH,
  };
}

/** @param {{ report: SmokeReport, reportJsonPath: string, reportHtmlPath: string, templatePath: string }} paths */
export async function writeReportArtifacts({
  report,
  reportJsonPath,
  reportHtmlPath,
  templatePath,
}) {
  assertReportSchema(report);
  await writeJsonAtomic(reportJsonPath, report);
  await writeReportHtml({ report, reportHtmlPath, templatePath });
}

/** @param {{ report: SmokeReport, reportHtmlPath: string, templatePath?: string }} options */
export async function writeReportHtml({
  report,
  reportHtmlPath,
  templatePath = REPORT_TEMPLATE_PATH,
}) {
  const template = await readFile(templatePath, "utf8");
  const rendered = renderReportHtml({ templateHtml: template, report });
  await writeTextAtomic(reportHtmlPath, rendered);
}

/** @param {{ templateHtml: string, report: SmokeReport }} options @returns {string} */
export function renderReportHtml({ templateHtml, report }) {
  const replacement = [
    '<script id="report-data" type="application/json">',
    indentJson(report, "\t\t\t"),
    "\t\t</script>",
  ].join("\n");

  const replaced = templateHtml.replace(
    /<script id="report-data" type="application\/json">[\s\S]*?<\/script>/,
    replacement,
  );

  if (replaced === templateHtml) {
    throw new Error(
      'Could not locate <script id="report-data" type="application/json"> in report template.',
    );
  }

  return replaced;
}

/** @param {string} name @returns {string} */
export function sanitizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** @param {{ kind: "coverage-gap" | "component" | string, metadataType?: string, componentName?: string | null, signal?: string | null }} options @returns {string} */
export function buildScreenshotName({ kind, metadataType, componentName, signal }) {
  const typePart = sanitizeName(metadataType || "unknown-type");
  const componentPart = sanitizeName(componentName || "none");
  const signalPart = sanitizeName(signal || "signal");

  if (kind === "coverage-gap") {
    return `zero-${typePart}.png`;
  }

  if (kind === "component") {
    return withWindowsLengthGuard(`component-${typePart}-${componentPart}.png`, componentPart);
  }

  return withWindowsLengthGuard(
    `error-${typePart}-${componentPart}-${signalPart}.png`,
    componentPart,
  );
}

/** @param {import("playwright").Page} page @param {string} absolutePath @returns {Promise<string>} */
export async function saveScreenshot(page, absolutePath) {
  try {
    await page.screenshot({ path: absolutePath, fullPage: true });
  } catch (error) {
    if (!isNameTooLong(error)) {
      throw error;
    }
    const retryPath = rewriteLongPath(absolutePath);
    await page.screenshot({ path: retryPath, fullPage: true });
    return retryPath;
  }
  return absolutePath;
}

/** @param {string} filePath @param {unknown} jsonValue */
async function writeJsonAtomic(filePath, jsonValue) {
  const content = JSON.stringify(jsonValue, null, 2);
  await writeTextAtomic(filePath, content);
}

/** @param {string} filePath @param {string} content */
async function writeTextAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${shortHash(`${Date.now()}-${Math.random()}`)}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await renameWithRetry(tempPath, filePath);
}

/** @param {Date} value @returns {string} */
function createRunTimestamp(value) {
  return value
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/:/g, "-");
}

/** @param {unknown} value @param {string} indentPrefix @returns {string} */
function indentJson(value, indentPrefix) {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line) => `${indentPrefix}${line}`)
    .join("\n");
}

/** @param {string} filename @param {string} componentPart @returns {string} */
function withWindowsLengthGuard(filename, componentPart) {
  if (filename.length <= 220) {
    return filename;
  }
  const hash = shortHash(filename);
  const truncatedComponent = componentPart.slice(0, 80);
  return filename.replace(componentPart, `${truncatedComponent}-${hash}`);
}

/** @param {string} value @returns {string} */
function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

/** @param {unknown} error @returns {boolean} */
function isNameTooLong(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENAMETOOLONG" || error.code === "ERR_INVALID_ARG_VALUE")
  );
}

/** @param {string} filePath @returns {string} */
function rewriteLongPath(filePath) {
  const parsed = path.parse(filePath);
  const hash = shortHash(parsed.name);
  const shorterName = `${parsed.name.slice(0, 80)}-${hash}${parsed.ext}`;
  return path.join(parsed.dir, shorterName);
}

/** @param {string} fromPath @param {string} toPath */
async function renameWithRetry(fromPath, toPath) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error) {
      if (!isRetriableRenameError(error) || attempt === maxAttempts) {
        if (isRetriableRenameError(error)) {
          await unlink(toPath).catch(() => {});
          await rename(fromPath, toPath);
          return;
        }
        throw error;
      }
      await wait(attempt * 25);
    }
  }
}

/** @param {unknown} error @returns {boolean} */
function isRetriableRenameError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EPERM", "EACCES", "EEXIST"].includes(/** @type {string} */ (error.code))
  );
}

/** @param {number} ms @returns {Promise<void>} */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

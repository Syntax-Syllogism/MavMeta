import type { LwcBundleSummary, LwcCompileError, LwcFile } from "../../shared/lwc";

export type Language = "javascript" | "html" | "css" | "xml" | "unknown";

const FILE_TAB_ORDER: Language[] = ["html", "javascript", "css", "xml", "unknown"];

export function sortBundleFiles(files: LwcFile[]): LwcFile[] {
	return [...files].sort((a, b) => {
		const ai = FILE_TAB_ORDER.indexOf(inferLanguageFromPath(a.filePath));
		const bi = FILE_TAB_ORDER.indexOf(inferLanguageFromPath(b.filePath));
		return ai - bi;
	});
}

export function inferLanguageFromPath(path: string): Language {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "js") return "javascript";
	if (ext === "html") return "html";
	if (ext === "css") return "css";
	if (ext === "xml") return "xml";
	return "unknown";
}

export function computeDirtyFiles(loaded: LwcFile[], current: Map<string, string>): string[] {
	return loaded
		.filter((file) => {
			const currentSource = current.get(file.filePath);
			return currentSource !== undefined && currentSource !== file.source;
		})
		.map((file) => file.filePath);
}

export function filterBundles(bundles: LwcBundleSummary[], query: string): LwcBundleSummary[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return bundles;
	return bundles.filter(
		(b) =>
			b.developerName.toLowerCase().includes(normalized) ||
			b.masterLabel.toLowerCase().includes(normalized),
	);
}

export function formatCompileErrors(raw: unknown): LwcCompileError[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((item: unknown) => {
		if (typeof item !== "object" || item === null) return [];
		const r = item as Record<string, unknown>;
		if (typeof r.message !== "string" || !r.message) return [];
		return [
			{
				filePath: typeof r.filePath === "string" ? r.filePath : "",
				line: typeof r.line === "number" ? r.line : undefined,
				column: typeof r.column === "number" ? r.column : undefined,
				message: r.message,
				severity: r.severity === "warning" ? ("warning" as const) : ("error" as const),
			},
		];
	});
}

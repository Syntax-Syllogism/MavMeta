export const UNSUPPORTED_DESTRUCTIVE_METADATA_TYPES = new Set<string>([
	"StandardValueSetTranslation",
	"Translations",
]);

export function getDestructiveCompatibilityIssue(metadataType: string) {
	const normalized = metadataType.trim();
	if (!normalized) {
		return "Missing metadata type.";
	}

	if (UNSUPPORTED_DESTRUCTIVE_METADATA_TYPES.has(normalized)) {
		return `Unsupported destructive metadata type: ${normalized}.`;
	}

	return undefined;
}

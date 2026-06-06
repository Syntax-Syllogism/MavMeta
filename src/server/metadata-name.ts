const METADATA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,79}(\.[A-Za-z][A-Za-z0-9_]{0,79})?$/;

export function validateMetadataName(name: string): boolean {
	return METADATA_NAME_PATTERN.test(name);
}

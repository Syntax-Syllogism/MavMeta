export type ScratchOrgTemplate = "minimal" | "admin-dev" | "package-dev" | "custom";
export type WizardCreationMode = "standard" | "snapshot";

export type WizardSettingsEntry = {
	group: string;                    // camelCased group key, e.g. "lightningExperienceSettings"
	subKeys: Record<string, boolean>; // sub-key -> value; only booleans in V1
};

export type ScratchOrgWizardSettings = {
	creationMode: WizardCreationMode;
	snapshotName?: string;
	template: ScratchOrgTemplate;
	edition: string;
	orgName: string;
	features: string[];
	settings: WizardSettingsEntry[];
};

export const TEMPLATE_LABELS: Record<ScratchOrgTemplate, string> = {
	minimal: "Minimal",
	"admin-dev": "Admin / Dev Sandbox-like",
	"package-dev": "Package Development",
	custom: "Blank / Custom JSON",
};

export const EDITION_OPTIONS = ["Developer", "Enterprise", "Partner Developer", "Partner Enterprise"] as const;

export const FEATURE_SUGGESTIONS = [
	"Communities",
	"ServiceCloud",
	"SalesforceToSalesforce",
	"LiveAgent",
	"Einstein",
	"Chatter",
	"ContactsToMultipleAccounts",
	"NetworksEnabled",
	"Forecasting",
	"PersonAccounts",
	"StateAndCountryPicklist",
	"Translation",
] as const;

export type CuratedSettingSubKey = {
	name: string;          // exact JSON key, e.g. "enableS1DesktopEnabled"
	label?: string;        // optional human label; defaults to name
	defaultValue: boolean; // initial toggle state when group is added
};

export type CuratedSettingGroup = {
	group: string;               // camelCased key, e.g. "lightningExperienceSettings"
	label: string;               // PascalCase human label, e.g. "LightningExperienceSettings"
	subKeys: CuratedSettingSubKey[];
};

export const CURATED_SETTINGS: CuratedSettingGroup[] = [
	{
		group: "lightningExperienceSettings",
		label: "LightningExperienceSettings",
		subKeys: [
			{ name: "enableS1DesktopEnabled", defaultValue: true },
			{ name: "enableLightningPreviewPref", defaultValue: true },
		],
	},
	{
		group: "mobileSettings",
		label: "MobileSettings",
		subKeys: [
			{ name: "enableS1EncryptedStoragePref2", defaultValue: false },
		],
	},
	{
		group: "chatterSettings",
		label: "ChatterSettings",
		subKeys: [
			{ name: "enableChatter", defaultValue: true },
		],
	},
	{
		group: "communitiesSettings",
		label: "CommunitiesSettings",
		subKeys: [
			{ name: "enableNetworksEnabled", defaultValue: false },
		],
	},
	{
		group: "searchSettings",
		label: "SearchSettings",
		subKeys: [
			{ name: "documentContentSearchEnabled", defaultValue: false },
		],
	},
];

const TEMPLATE_BASE_DEFINITIONS: Record<ScratchOrgTemplate, Record<string, unknown>> = {
	minimal: {
		edition: "Developer",
	},
	"admin-dev": {
		edition: "Developer",
		features: ["ServiceCloud", "Communities"],
	},
	"package-dev": {
		edition: "Developer",
		features: ["EnableSetPasswordInApi"],
	},
	custom: {},
};

export function buildScratchOrgDefinition(settings: ScratchOrgWizardSettings): Record<string, unknown> {
	if (settings.creationMode === "snapshot") {
		const snapshotName = settings.snapshotName?.trim();
		return snapshotName ? { snapshot: snapshotName } : {};
	}

	const base = { ...TEMPLATE_BASE_DEFINITIONS[settings.template] };
	const definition: Record<string, unknown> = { ...base };

	if (settings.edition) {
		definition.edition = settings.edition;
	}

	if (settings.orgName.trim()) {
		definition.orgName = settings.orgName.trim();
	}

	const templateFeatures = Array.isArray(base.features) ? (base.features as string[]) : [];
	const allFeatures = Array.from(new Set([...templateFeatures, ...settings.features]));
	if (allFeatures.length > 0) {
		definition.features = allFeatures;
	}

	if (settings.settings.length > 0) {
		const settingsObj: Record<string, Record<string, boolean>> = {};
		for (const entry of settings.settings) {
			if (Object.keys(entry.subKeys).length > 0) {
				settingsObj[entry.group] = { ...entry.subKeys };
			}
		}
		if (Object.keys(settingsObj).length > 0) {
			definition.settings = settingsObj;
		}
	}

	return definition;
}

export type JsonValidationResult =
	| { valid: true; parsed: Record<string, unknown> }
	| { valid: false; error: string };

export function validateDefinitionJson(jsonText: string): JsonValidationResult {
	const trimmed = jsonText.trim();
	if (!trimmed) {
		return { valid: false, error: "Definition JSON cannot be empty." };
	}

	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { valid: false, error: "Definition must be a JSON object." };
		}
		return { valid: true, parsed: parsed as Record<string, unknown> };
	} catch (error) {
		const message = error instanceof SyntaxError ? error.message : "Invalid JSON.";
		return { valid: false, error: message };
	}
}

export type DurationValidationResult = { valid: true } | { valid: false; error: string };

export function validateDurationDays(value: number): DurationValidationResult {
	if (!Number.isInteger(value)) {
		return { valid: false, error: "Duration must be a whole number." };
	}
	if (value < 1) {
		return { valid: false, error: "Duration must be at least 1 day." };
	}
	if (value > 30) {
		return { valid: false, error: "Duration cannot exceed 30 days (Salesforce limit)." };
	}
	return { valid: true };
}

const ALIAS_ADJECTIVES = [
	"dev", "cloud", "force", "lightning", "apex", "flex", "agile", "swift",
	"bright", "bold", "core", "prime", "smart", "keen", "rapid", "crisp",
] as const;

const ALIAS_NOUNS = [
	"force", "hub", "wave", "bolt", "trail", "spark", "edge", "flow",
	"field", "grid", "link", "node", "forge", "vault", "orbit", "pulse",
] as const;

export function generateAlias(seed?: number): string {
	const s = seed ?? Math.random();
	const adjIndex = Math.floor((s * 97) % ALIAS_ADJECTIVES.length);
	const nounIndex = Math.floor((s * 137 + 1) % ALIAS_NOUNS.length);
	return `${ALIAS_ADJECTIVES[adjIndex]}-${ALIAS_NOUNS[nounIndex]}`;
}

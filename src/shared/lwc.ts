export type LwcBundleSummary = {
	id: string;
	developerName: string;
	masterLabel: string;
	namespacePrefix: string | null;
	apiVersion: number;
	lastModifiedDate: string;
	lastModifiedByName: string;
};

export type LwcFile = {
	id: string;
	filePath: string;
	format: string;
	source: string;
	lastModifiedDate: string;
};

export type LwcCompileError = {
	filePath: string;
	line?: number;
	column?: number;
	message: string;
	severity: "error" | "warning";
};

// Request / response types

export type ListLwcBundlesRequest = {
	orgUsername: string;
};

export type ListLwcBundlesResponse = {
	bundles: LwcBundleSummary[];
};

export type GetLwcBundleRequest = {
	orgUsername: string;
	bundleId: string;
};

export type GetLwcBundleResponse = {
	bundle: LwcBundleSummary;
	files: LwcFile[];
};

export type DeployLwcBundleFileInput = {
	path: string;
	source: string;
};

export type DeployLwcBundleRequest = {
	orgUsername: string;
	bundleId: string;
	files: DeployLwcBundleFileInput[];
	expectedLastModifiedDate: string;
	force?: boolean;
};

export type DeployLwcBundleResponse =
	| {
			status: "success";
			durationMs: number;
			newLastModifiedDate: string;
	  }
	| {
			status: "error";
			durationMs: number;
			errors: LwcCompileError[];
	  }
	| {
			status: "conflict";
			currentLastModifiedDate: string;
			changedFiles: string[];
	  };

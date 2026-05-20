import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import JSZip from "jszip";

import { DeployService } from "./deploy-service";

describe("DeployService", () => {
	it("completes a destructive validation job and returns succeeded status", async () => {
		const sleep = vi.fn().mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const checkDeployStatus = vi
			.fn()
			.mockResolvedValueOnce({
				status: "InProgress",
				numberComponentsTotal: 2,
				numberComponentsDeployed: 1,
				numberComponentErrors: 0,
			})
			.mockResolvedValueOnce({
				status: "Succeeded",
				numberComponentsTotal: 2,
				numberComponentsDeployed: 2,
				numberComponentErrors: 0,
			});
		const connection = {
			query: vi.fn().mockResolvedValue({
				records: [{ IsSandbox: true, TrialExpirationDate: null }],
			}),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000001" }),
				checkDeployStatus,
				cancelDeploy: vi.fn().mockResolvedValue(undefined),
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "op-1",
			sleep,
			now: () => 1,
		});

		const started = await service.startDestructiveDeploy({
			target: { username: "user@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
		expect(started).toEqual({ operationId: "op-1" });

		const status = await waitForTerminalStatus(service, "op-1");
		expect(status.status).toBe("succeeded");
		expect(status.percentComplete).toBe(100);
		expect(status.result?.environment).toBe("sandbox");
		expect(status.result?.success).toBe(true);
		expect(checkDeployStatus).toHaveBeenCalled();
		expect(sleep).toHaveBeenCalledWith(3000);
	});

	it("fails operation when Salesforce start payload has no deploy job id", async () => {
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [] }),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ warnings: [] }),
				checkDeployStatus: vi.fn(),
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "op-2",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startDestructiveDeploy({
			target: { username: "user@example.com" },
			mode: "deploy",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});

		const status = await waitForTerminalStatus(service, "op-2");
		expect(status.status).toBe("failed");
		expect(status.result?.message).toContain(
			"Salesforce did not return a deploy job id.",
		);
		expect(connection.metadata.checkDeployStatus).not.toHaveBeenCalled();
	});

	it("skips invalid metadata full names before deploy start", async () => {
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [] }),
			metadata: {
				deploy: vi.fn(),
				checkDeployStatus: vi.fn(),
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "op-invalid-name",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startDestructiveDeploy({
			target: { username: "user@example.com" },
			mode: "deploy",
			components: [{ metadataType: "ApexClass", fullName: "Bad<Name" }],
		});

		const status = await waitForTerminalStatus(service, "op-invalid-name");
		expect(status.status).toBe("failed");
		expect(status.result?.skipped).toEqual([
			{
				metadataType: "ApexClass",
				fullName: "Bad<Name",
				reason: "Invalid metadata full name.",
			},
		]);
		expect(connection.metadata.deploy).not.toHaveBeenCalled();
	});

	it("cancels a running operation and returns canceled state", async () => {
		const cancelDeploy = vi.fn().mockResolvedValue(undefined);
		const checkDeployStatus = vi
			.fn()
			.mockResolvedValue({
				status: "InProgress",
				numberComponentsTotal: 3,
				numberComponentsDeployed: 1,
				numberComponentErrors: 0,
			});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [] }),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000003" }),
				checkDeployStatus,
				cancelDeploy,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "op-3",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startDestructiveDeploy({
			target: { username: "user@example.com" },
			mode: "deploy",
			components: [{ metadataType: "ApexClass", fullName: "DeleteMe" }],
		});
		await service.cancelDestructiveDeploy("op-3");

		const status = await waitForTerminalStatus(service, "op-3");
		expect(status.status).toBe("canceled");
		expect(status.result?.state).toBe("Canceled");
	});

	it("maps SucceededPartial into partial failure result state", async () => {
		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "SucceededPartial",
			numberComponentsTotal: 2,
			numberComponentsDeployed: 1,
			numberComponentErrors: 1,
			details: {
				componentFailures: {
					componentType: "ApexClass",
					fullName: "BrokenClass",
					problem: "Delete failed",
				},
			},
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [] }),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000004" }),
				checkDeployStatus,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "op-4",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startDestructiveDeploy({
			target: { username: "user@example.com" },
			mode: "deploy",
			components: [
				{ metadataType: "ApexClass", fullName: "GoodClass" },
				{ metadataType: "ApexClass", fullName: "BrokenClass" },
			],
		});

		const status = await waitForTerminalStatus(service, "op-4");
		expect(status.status).toBe("failed");
		expect(status.result?.state).toBe("PartiallySucceeded");
		expect(status.result?.failed).toEqual([
			{
				metadataType: "ApexClass",
				fullName: "BrokenClass",
				problem: "Delete failed",
			},
		]);
	});

	it("runs cross-org validate deploy and returns succeeded status", async () => {
		const sourceZip = new JSZip();
		sourceZip.file(
			"classes/MyClass.cls",
			"public class MyClass {}",
		);
		sourceZip.file(
			"classes/MyClass.cls-meta.xml",
			'<?xml version="1.0" encoding="UTF-8"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>58.0</apiVersion><status>Active</status></ApexClass>',
		);
		const sourceZipBase64 = (await sourceZip.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
		})).toString("base64");

		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "Succeeded",
			numberComponentsTotal: 1,
			numberComponentsDeployed: 1,
			numberComponentErrors: 0,
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000005" }),
				checkDeployStatus,
				retrieve: vi.fn().mockReturnValue({
					complete: vi.fn().mockResolvedValue({
						zipFile: sourceZipBase64,
					}),
				}),
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-1",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
		const status = await waitForCrossOrgTerminalStatus(service, "xop-1");
		expect(status.status).toBe("succeeded");
		expect(status.result?.source.username).toBe("source@example.com");
		expect(status.result?.target.username).toBe("target@example.com");
	});

	it("rejects cross-org deploy when source and target are the same", async () => {
		const service = new DeployService({
			connectionFactory: vi.fn(),
		});
		await expect(
			service.startCrossOrgDeploy({
				source: { username: "same@example.com" },
				target: { username: "same@example.com" },
				mode: "validate",
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			}),
		).rejects.toThrow("Source and target orgs must be different.");
	});

	it("builds cross-org deploy zip from retrieved source metadata files", async () => {
		const classZip = new JSZip();
		classZip.file("package.xml", "<Package/>");
		classZip.file("classes/MyClass.cls", "public class MyClass {}");
		classZip.file(
			"classes/MyClass.cls-meta.xml",
			'<?xml version="1.0" encoding="UTF-8"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"></ApexClass>',
		);
		const objectZip = new JSZip();
		objectZip.file("package.xml", "<Package/>");
		objectZip.file(
			"objects/MyObject.object-meta.xml",
			'<?xml version="1.0" encoding="UTF-8"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>',
		);

		const retrieveComplete = vi
			.fn()
			.mockResolvedValueOnce({
				zipFile: (
					await classZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
				).toString("base64"),
			})
			.mockResolvedValueOnce({
				zipFile: (
					await objectZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
				).toString("base64"),
			});
		const retrieve = vi.fn().mockReturnValue({ complete: retrieveComplete });
		const deploy = vi.fn().mockResolvedValue({ id: "0Afxx0000006" });
		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "Succeeded",
			numberComponentsTotal: 2,
			numberComponentsDeployed: 2,
			numberComponentErrors: 0,
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy,
				checkDeployStatus,
				retrieve,
				pollTimeout: undefined as number | undefined,
				pollInterval: undefined as number | undefined,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-2",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [
				{ metadataType: "ApexClass", fullName: "MyClass" },
				{ metadataType: "CustomObject", fullName: "MyObject" },
			],
		});
		await waitForCrossOrgTerminalStatus(service, "xop-2");

		expect(retrieve).toHaveBeenCalledTimes(2);
		expect(deploy).toHaveBeenCalledTimes(1);
		const deployZipArg = deploy.mock.calls[0]?.[0];
		expect(Buffer.isBuffer(deployZipArg)).toBe(true);
		const parsedZip = await JSZip.loadAsync(deployZipArg as Buffer);
		expect(parsedZip.file("classes/MyClass.cls")).toBeDefined();
		expect(parsedZip.file("classes/MyClass.cls-meta.xml")).toBeDefined();
		expect(parsedZip.file("objects/MyObject.object-meta.xml")).toBeDefined();
		const packageXml = await parsedZip.file("package.xml")?.async("string");
		expect(packageXml).toContain("<name>ApexClass</name>");
		expect(packageXml).toContain("<name>CustomObject</name>");
		expect(packageXml).toContain("<members>MyClass</members>");
		expect(packageXml).toContain("<members>MyObject</members>");
	});

	it("normalizes retrieved unpackaged paths before deploy", async () => {
		const sourceZip = new JSZip();
		sourceZip.file("unpackaged/package.xml", "<Package/>");
		sourceZip.file("unpackaged/classes/MyClass.cls", "public class MyClass {}");
		sourceZip.file(
			"unpackaged/classes/MyClass.cls-meta.xml",
			'<?xml version="1.0" encoding="UTF-8"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"></ApexClass>',
		);
		const sourceZipBase64 = (await sourceZip.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
		})).toString("base64");

		const retrieve = vi.fn().mockReturnValue({
			complete: vi.fn().mockResolvedValue({ zipFile: sourceZipBase64 }),
		});
		const deploy = vi.fn().mockResolvedValue({ id: "0Afxx0000010" });
		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "Succeeded",
			numberComponentsTotal: 1,
			numberComponentsDeployed: 1,
			numberComponentErrors: 0,
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy,
				checkDeployStatus,
				retrieve,
				pollTimeout: undefined as number | undefined,
				pollInterval: undefined as number | undefined,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-5",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
		await waitForCrossOrgTerminalStatus(service, "xop-5");

		expect(connection.metadata.pollTimeout).toBe(120000);
		expect(connection.metadata.pollInterval).toBe(2000);

		const deployZipArg = deploy.mock.calls[0]?.[0];
		const parsedZip = await JSZip.loadAsync(deployZipArg as Buffer);
		expect(parsedZip.file("classes/MyClass.cls")).toBeDefined();
		expect(parsedZip.file("classes/MyClass.cls-meta.xml")).toBeDefined();
		expect(parsedZip.file("unpackaged/classes/MyClass.cls")).toBeNull();
	});

	it("fails cross-org deploy when retrieved zip contains path traversal entries", async () => {
		const loadAsyncSpy = vi.spyOn(JSZip, "loadAsync").mockResolvedValueOnce({
			files: {
				"../escape.cls": {
					dir: false,
					async: vi.fn().mockResolvedValue("public class Escape {}"),
				},
			},
		} as any);

		const retrieve = vi.fn().mockReturnValue({
			complete: vi.fn().mockResolvedValue({ zipFile: Buffer.from("zip").toString("base64") }),
		});
		const deploy = vi.fn();
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy,
				checkDeployStatus: vi.fn(),
				retrieve,
				pollTimeout: undefined as number | undefined,
				pollInterval: undefined as number | undefined,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-path-traversal",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});

		const status = await waitForCrossOrgTerminalStatus(service, "xop-path-traversal");
		expect(status.status).toBe("failed");
		expect(deploy).not.toHaveBeenCalled();
		loadAsyncSpy.mockRestore();
	});

	it("keeps richer custom object metadata when field retrieve returns partial object xml", async () => {
		const objectZip = new JSZip();
		objectZip.file("package.xml", "<Package/>");
		objectZip.file(
			"objects/CKR_SupportedObject__mdt.object",
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">',
				"  <label>Supported Object</label>",
				"  <pluralLabel>Supported Objects</pluralLabel>",
				"</CustomObject>",
			].join("\n"),
		);
		const fieldZip = new JSZip();
		fieldZip.file("package.xml", "<Package/>");
		fieldZip.file(
			"objects/CKR_SupportedObject__mdt.object",
			[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">',
				"  <fields>",
				"    <fullName>CKR_ObjectApiName__c</fullName>",
				"    <label>Object API Name</label>",
				"    <type>Text</type>",
				"  </fields>",
				"</CustomObject>",
			].join("\n"),
		);

		const retrieveComplete = vi
			.fn()
			.mockResolvedValueOnce({
				zipFile: (
					await objectZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
				).toString("base64"),
			})
			.mockResolvedValueOnce({
				zipFile: (
					await fieldZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
				).toString("base64"),
			});
		const retrieve = vi.fn().mockReturnValue({ complete: retrieveComplete });
		const deploy = vi.fn().mockResolvedValue({ id: "0Afxx0000011" });
		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "Succeeded",
			numberComponentsTotal: 2,
			numberComponentsDeployed: 2,
			numberComponentErrors: 0,
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy,
				checkDeployStatus,
				retrieve,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-object-merge",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [
				{ metadataType: "CustomObject", fullName: "CKR_SupportedObject__mdt" },
				{
					metadataType: "CustomField",
					fullName: "CKR_SupportedObject__mdt.CKR_ObjectApiName__c",
				},
			],
		});
		await waitForCrossOrgTerminalStatus(service, "xop-object-merge");

		const deployZipArg = deploy.mock.calls[0]?.[0];
		const parsedZip = await JSZip.loadAsync(deployZipArg as Buffer);
		const objectXml = await parsedZip
			.file("objects/CKR_SupportedObject__mdt.object")
			?.async("string");
		expect(objectXml).toContain("<label>Supported Object</label>");
		expect(objectXml).toContain("<pluralLabel>Supported Objects</pluralLabel>");
	});

	it("returns failed cross-org status when source retrieve has no zip content", async () => {
		const retrieve = vi.fn().mockReturnValue({
			complete: vi.fn().mockResolvedValue({ zipFile: undefined }),
		});
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000007" }),
				checkDeployStatus: vi.fn(),
				retrieve,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-3",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "deploy",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});

		const status = await waitForCrossOrgTerminalStatus(service, "xop-3");
		expect(status.status).toBe("failed");
		expect(status.result?.message).toContain("Could not retrieve ApexClass:MyClass from source org");
	});

	it("fails cross-org deploy gracefully when retrieve polling times out", async () => {
		const locator = new EventEmitter() as EventEmitter & {
			complete: () => Promise<{ zipFile?: string }>;
		};
		locator.complete = vi.fn().mockImplementation(async () => {
			const timeoutError = new Error(
				"Polling time out. Retrieve operation is not completed.",
			);
			locator.emit("error", timeoutError);
			throw timeoutError;
		});
		const retrieve = vi.fn().mockReturnValue(locator);
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0011111" }),
				checkDeployStatus: vi.fn(),
				retrieve,
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-timeout",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [{ metadataType: "CustomMetadata", fullName: "Some_Type__mdt" }],
		});

		const status = await waitForCrossOrgTerminalStatus(service, "xop-timeout");
		expect(status.status).toBe("failed");
		expect(status.result?.message).toContain("Source retrieve failed for");
		expect(status.result?.message).toContain("Polling time out");
	});

	it("cancels running cross-org deploy operation", async () => {
		const sourceZip = new JSZip();
		sourceZip.file("classes/MyClass.cls", "public class MyClass {}");
		sourceZip.file(
			"classes/MyClass.cls-meta.xml",
			'<?xml version="1.0" encoding="UTF-8"?><ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"></ApexClass>',
		);
		const sourceZipBase64 = (await sourceZip.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
		})).toString("base64");

		const checkDeployStatus = vi.fn().mockResolvedValue({
			status: "InProgress",
			numberComponentsTotal: 1,
			numberComponentsDeployed: 0,
			numberComponentErrors: 0,
		});
		const cancelDeploy = vi.fn().mockResolvedValue(undefined);
		const connection = {
			query: vi.fn().mockResolvedValue({ records: [{ IsSandbox: true }] }),
			getApiVersion: vi.fn().mockReturnValue("58.0"),
			metadata: {
				deploy: vi.fn().mockResolvedValue({ id: "0Afxx0000008" }),
				checkDeployStatus,
				cancelDeploy,
				retrieve: vi.fn().mockReturnValue({
					complete: vi.fn().mockResolvedValue({ zipFile: sourceZipBase64 }),
				}),
			},
		};
		const service = new DeployService({
			connectionFactory: vi.fn().mockResolvedValue(connection),
			uuidFactory: () => "xop-4",
			sleep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			},
		});

		await service.startCrossOrgDeploy({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "deploy",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
		await service.cancelCrossOrgDeploy("xop-4");
		const status = await waitForCrossOrgTerminalStatus(service, "xop-4");
		expect(status.status).toBe("canceled");
		expect(status.result?.state).toBe("Canceled");
	});
});

async function waitForTerminalStatus(
	service: DeployService,
	operationId: string,
	maxAttempts = 120,
) {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const status = await service.getDestructiveDeployStatus(operationId);
		if (
			status.status === "succeeded" ||
			status.status === "failed" ||
			status.status === "canceled"
		) {
			return status;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	throw new Error(`Operation ${operationId} did not reach terminal state in time.`);
}

async function waitForCrossOrgTerminalStatus(
	service: DeployService,
	operationId: string,
	maxAttempts = 120,
) {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const status = await service.getCrossOrgDeployStatus(operationId);
		if (
			status.status === "succeeded" ||
			status.status === "failed" ||
			status.status === "canceled"
		) {
			return status;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	throw new Error(`Cross-org operation ${operationId} did not reach terminal state in time.`);
}

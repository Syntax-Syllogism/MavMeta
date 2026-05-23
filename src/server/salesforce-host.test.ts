import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import { assertSalesforceHost } from "./salesforce-host";

describe("assertSalesforceHost", () => {
	it("accepts supported salesforce domains over https", () => {
		expect(() => assertSalesforceHost("https://mydomain.my.salesforce.com")).not.toThrow();
		expect(() => assertSalesforceHost("https://acme.force.com")).not.toThrow();
		expect(() => assertSalesforceHost("https://acme.lightning.force.com")).not.toThrow();
		expect(() => assertSalesforceHost("https://acme.salesforce-setup.com")).not.toThrow();
		expect(() => assertSalesforceHost("https://cs42.cloudforce.com")).not.toThrow();
	});

	it("rejects malformed urls", () => {
		expect(() => assertSalesforceHost("not-a-url")).toThrow(ApiError);
	});

	it("rejects non-https urls", () => {
		expect(() => assertSalesforceHost("http://mydomain.my.salesforce.com")).toThrow(/HTTPS/);
	});

	it("rejects non-salesforce domains", () => {
		expect(() => assertSalesforceHost("https://evil.example.com")).toThrow(/not allowed/);
	});
});

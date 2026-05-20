import { describe, expect, it } from "vitest";

import { validateMetadataName } from "./metadata-name";

describe("validateMetadataName", () => {
	it("accepts valid metadata names", () => {
		expect(validateMetadataName("MyClass")).toBe(true);
		expect(validateMetadataName("My_Object_1")).toBe(true);
		expect(validateMetadataName("ObjectApi.FieldApi")).toBe(true);
	});

	it("rejects invalid metadata names", () => {
		expect(validateMetadataName("")).toBe(false);
		expect(validateMetadataName("1StartsWithNumber")).toBe(false);
		expect(validateMetadataName("Bad<Name")).toBe(false);
		expect(validateMetadataName("Bad Name")).toBe(false);
		expect(validateMetadataName("Obj/Field")).toBe(false);
		expect(validateMetadataName("Obj.Field.TooManySegments")).toBe(false);
	});
});

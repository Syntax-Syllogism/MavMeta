import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Toast from "./Toast.svelte";

describe("Toast", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it("renders message when visible", () => {
		render(Toast, { message: "Export ready.", visible: true, ondismiss: vi.fn() });
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText("Export ready.")).toBeTruthy();
	});

	it("does not render when not visible", () => {
		render(Toast, { message: "Not shown", visible: false, ondismiss: vi.fn() });
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("calls ondismiss after durationMs", async () => {
		const ondismiss = vi.fn();
		render(Toast, { message: "Dismiss me", visible: true, durationMs: 2500, ondismiss });
		await vi.advanceTimersByTimeAsync(2500);
		expect(ondismiss).toHaveBeenCalledOnce();
	});

	it("does not call ondismiss before durationMs elapses", async () => {
		const ondismiss = vi.fn();
		render(Toast, { message: "Wait", visible: true, durationMs: 2500, ondismiss });
		await vi.advanceTimersByTimeAsync(2499);
		expect(ondismiss).not.toHaveBeenCalled();
	});
});

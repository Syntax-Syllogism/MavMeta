import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Modal from "./Modal.svelte";

describe("Modal", () => {
	it("closes on Escape and restores focus to trigger", async () => {
		const trigger = document.createElement("button");
		trigger.textContent = "open";
		document.body.appendChild(trigger);
		trigger.focus();

		const onClose = vi.fn();
		render(Modal, {
			props: {
				ariaLabel: "Test Modal",
				onClose,
			},
		});

		const dialog = await screen.findByRole("dialog", { name: "Test Modal" });
		await fireEvent.keyDown(dialog, { key: "Escape" });

		await waitFor(() => {
			expect(onClose).toHaveBeenCalledTimes(1);
		});
		expect(document.activeElement).toBe(trigger);
		trigger.remove();
	});
});

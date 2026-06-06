<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";

	let {
		ariaLabel,
		onClose,
		closeOnBackdrop = true,
		closeOnEscape = true,
		children,
	}: {
		ariaLabel: string;
		onClose: () => void;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		children?: () => unknown;
	} = $props();

	let dialogElement = $state<HTMLDialogElement | undefined>();
	let didNotifyClose = false;
	let previouslyFocusedElement: HTMLElement | undefined;

	onMount(() => {
		previouslyFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		void openDialog();
	});

	onDestroy(() => {
		if (dialogElement?.open) {
			if (typeof dialogElement.close === "function") {
				dialogElement.close();
			} else {
				dialogElement.removeAttribute("open");
			}
		}
	});

	async function openDialog() {
		await tick();
		if (!dialogElement) return;

		try {
			if (typeof dialogElement.showModal === "function") {
				dialogElement.showModal();
			} else {
				dialogElement.setAttribute("open", "");
			}
		} catch {
			dialogElement.setAttribute("open", "");
		}

		// Native showModal focuses the first focusable element, but fallback mode does not.
		const initialFocusTarget = dialogElement.querySelector<HTMLElement>(
			"[data-modal-initial-focus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
		);
		initialFocusTarget?.focus();
	}

	function requestClose() {
		if (!dialogElement || !dialogElement.open) {
			finalizeClose();
			return;
		}
		if (typeof dialogElement.close === "function") {
			dialogElement.close();
			return;
		}
		dialogElement.removeAttribute("open");
		finalizeClose();
	}

	function handleDialogClose() {
		finalizeClose();
	}

	function finalizeClose() {
		if (didNotifyClose) return;
		didNotifyClose = true;
		onClose();
		previouslyFocusedElement?.focus();
	}

	function handleDialogClick(event: MouseEvent) {
		if (!closeOnBackdrop) return;
		if (event.target === dialogElement) {
			requestClose();
		}
	}

	function handleDialogCancel(event: Event) {
		if (!closeOnEscape) {
			event.preventDefault();
			return;
		}
		event.preventDefault();
		requestClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!closeOnEscape) return;
		if (event.key === "Escape") {
			event.preventDefault();
			requestClose();
		}
	}
</script>

<dialog
	bind:this={dialogElement}
	class="mav-modal-dialog"
	aria-label={ariaLabel}
	onclick={handleDialogClick}
	oncancel={handleDialogCancel}
	onclose={handleDialogClose}
	onkeydown={handleKeydown}
>
	<div class="mav-modal-surface">
		{@render children?.()}
	</div>
</dialog>

<style>
	.mav-modal-dialog {
		border: 0;
		padding: var(--space-6);
		background: transparent;
		width: 100%;
		max-width: none;
		max-height: none;
		height: 100%;
	}

	.mav-modal-dialog[open] {
		display: grid;
		place-items: center;
	}

	.mav-modal-dialog::backdrop {
		background: var(--color-overlay);
	}

	.mav-modal-surface {
		width: fit-content;
		max-width: 100%;
		max-height: 100%;
	}
</style>

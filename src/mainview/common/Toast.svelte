<script lang="ts">
	import { fade } from "svelte/transition";

	let {
		message,
		visible,
		variant = "info",
		durationMs = 2500,
		ondismiss,
	}: {
		message: string;
		visible: boolean;
		variant?: "info" | "success" | "error";
		durationMs?: number;
		ondismiss: () => void;
	} = $props();

	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!visible) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			ondismiss();
		}, durationMs);
		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div
		class={`toast toast--${variant}`}
		role="status"
		aria-live="polite"
		transition:fade={{ duration: 200 }}
	>
		{message}
	</div>
{/if}

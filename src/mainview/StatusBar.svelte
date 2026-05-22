<script lang="ts">
	let { isBusy, statusMessage }: { isBusy: boolean; statusMessage: string } = $props();
</script>

<footer class="status-bar" aria-live="polite">
	{#if isBusy}
		<div class="spinner" role="progressbar" aria-label="Action in progress"></div>
	{/if}
	{statusMessage}
</footer>



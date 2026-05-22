<script lang="ts">
	import type { CrossOrgDiffResult } from "../../shared/metadata";
	import { buildCompareDiffLines } from "./cart-view-model";

	let {
		result,
		sourceOrgLabel,
		targetOrgLabel,
		onClose,
	}: {
		result: CrossOrgDiffResult;
		sourceOrgLabel: string;
		targetOrgLabel: string;
		onClose: () => void;
	} = $props();

	const diffLines = $derived(buildCompareDiffLines(result.sourceXml, result.targetXml));

	$effect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	});
</script>

<div
	class="diff-modal-overlay"
	role="dialog"
	aria-modal="true"
	aria-label="XML diff viewer"
>
	<div class="diff-modal">
		<header class="diff-modal-header">
			<div class="diff-modal-title">
				<span class="diff-file-name">{result.fileName ?? result.fullName}</span>
				<span class="diff-component-meta muted">
					{result.metadataType}{result.fileName ? `:${result.fullName}` : ""}
				</span>
			</div>
			<div class="diff-org-labels">
				<span class="diff-org-chip">{sourceOrgLabel}</span>
				<svg class="diff-arrow-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
					<path d="M5 12h14M13 6l6 6-6 6" />
				</svg>
				<span class="diff-org-chip">{targetOrgLabel}</span>
			</div>
			<button
				class="btn btn--ghost btn--icon  diff-modal-close"
				type="button"
				onclick={onClose}
				aria-label="Close diff viewer"
			>
				<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
					<path d="m6 6 12 12M18 6 6 18" />
				</svg>
			</button>
		</header>

		<div class="diff-col-headers">
			<div class="diff-col-header">Source â€” {sourceOrgLabel}</div>
			<div class="diff-col-header">Target â€” {targetOrgLabel}</div>
		</div>

		<div class="diff-body" role="region" aria-label="Diff content">
			<div class="diff-table">
				{#each diffLines as line, rowIndex (`${rowIndex}:${line.sourceLineNum ?? ""}:${line.targetLineNum ?? ""}:${line.kind}`)}
					<div
						class="diff-cell"
						class:diff-cell-remove={line.kind === "remove" || line.kind === "change"}
					>
						<span class="diff-gutter" aria-hidden="true">
							{#if line.sourceLineNum !== undefined}
								<span class="diff-sign">{line.kind === "remove" || line.kind === "change" ? "-" : " "}</span>
								<span class="diff-linenum">{line.sourceLineNum}</span>
							{/if}
						</span>
						<pre class="diff-code">{line.sourceLine ?? ""}</pre>
					</div>
					<div
						class="diff-cell"
						class:diff-cell-add={line.kind === "add" || line.kind === "change"}
					>
						<span class="diff-gutter" aria-hidden="true">
							{#if line.targetLineNum !== undefined}
								<span class="diff-sign">{line.kind === "add" || line.kind === "change" ? "+" : " "}</span>
								<span class="diff-linenum">{line.targetLineNum}</span>
							{/if}
						</span>
						<pre class="diff-code">{line.targetLine ?? ""}</pre>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>




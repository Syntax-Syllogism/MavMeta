<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState } from "@codemirror/state";
  import { sql } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { backendClient } from "../backend/backend-client";
  import type { OrgSummary } from "../../shared/org";
  import type { SoqlApiType, SoqlFieldInfo, SObjectSummary } from "../../shared/soql";
  import { buildSoql, type SoqlBuilderState, type SoqlFilter } from "./soql-builder";
  import { parseCsv, toCsv } from "./soql-csv";
  import { parseSoqlError } from "./soql-error";

  let { activeOrg }: { activeOrg: OrgSummary | undefined } = $props();

  let api = $state<SoqlApiType>("rest");
  let mode = $state<"builder" | "raw">("builder");
  let sobjects = $state<SObjectSummary[]>([]);
  let fields = $state<SoqlFieldInfo[]>([]);
  let rawSoql = $state("");
  let validation = $state<string | undefined>();
  let actionMessage = $state<string | undefined>();
  let previewRows = $state<Record<string, unknown>[]>([]);
  let fullRows = $state<Record<string, unknown>[]>([]);
  let isRunningFull = $state(false);
  let isExporting = $state(false);
  let isUnmounted = false;
  let tooLargeInteractive = $state(false);
  let lastCheckedSoql = $state("");
  let lastOrg = $state(untrack(() => activeOrg?.username));
  let fieldSearch = $state("");
  let sobjectSearch = $state("");
  let showSObjectOptions = $state(false);
  let editorHost: HTMLDivElement | undefined = $state();
  let editorView: EditorView | undefined;
  let editorMode = $state<"builder" | "raw">("builder");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let requestVersion = 0;
  const MAX_INTERACTIVE_ROWS = 10000;
  const TOOLING_DEFAULT_LIMIT = 2000;

  let builder = $state<SoqlBuilderState>({
    sobject: "",
    selectedFields: ["Id"],
    filters: [],
    filterLogic: "AND",
  });

  const effectiveSoql = $derived(mode === "raw" ? rawSoql : buildSoql(builder));
  const isProduction = $derived(activeOrg?.environment === "production");
  const displayedRows = $derived(fullRows.length ? fullRows : previewRows);
  const effectiveColumns = $derived(Array.from(new Set(displayedRows.flatMap((row) => Object.keys(row)))));
  const filteredFields = $derived(
    fields.filter((field) => {
      const search = fieldSearch.trim().toLowerCase();
      if (!search) return true;
      return field.apiName.toLowerCase().includes(search) || field.label.toLowerCase().includes(search);
    }),
  );
  const filterableFields = $derived(fields.filter((field) => field.filterable));
  const sortableFields = $derived(fields.filter((field) => field.sortable));
  const filteredSObjects = $derived(
    sobjects.filter((sobject) => {
      const search = sobjectSearch.trim().toLowerCase();
      if (!search) return true;
      return sobject.apiName.toLowerCase().includes(search) || sobject.label.toLowerCase().includes(search);
    }),
  );
  const editorText = $derived(mode === "raw" ? rawSoql : (effectiveSoql || "Select an object to generate SOQL."));
  const parsedValidation = $derived(
    validation && validation !== "Valid" ? parseSoqlError(validation) : undefined,
  );

  $effect(() => {
    if (!activeOrg) return;
    void loadSObjects();
  });

  $effect(() => {
    if (activeOrg?.username !== lastOrg) {
      lastOrg = activeOrg?.username;
      resetToolState();
    }
  });

  $effect(() => {
    if (!builder.sobject) return;
    const match = sobjects.find((entry) => entry.apiName === builder.sobject);
    if (!match) return;
    const next = formatSObjectOption(match);
    if (sobjectSearch !== next) {
      sobjectSearch = next;
    }
  });

  $effect(() => {
    const soql = effectiveSoql.trim();
    const username = activeOrg?.username;

    clearTimeout(timer);
    if (!username || !soql || (mode === "builder" && !builder.sobject)) {
      return;
    }

    timer = setTimeout(() => {
      void validateAndMaybePreview(username, soql);
    }, 1200);

    return () => {
      clearTimeout(timer);
    };
  });

  $effect(() => {
    const host = editorHost;
    const nextMode = mode;
    const doc = editorText;
    if (!host) return;

    if (!editorView || editorMode !== nextMode) {
      createEditorView(host, doc, nextMode === "raw");
      editorMode = nextMode;
      return;
    }

    const current = editorView.state.doc.toString();
    if (current !== doc) {
      editorView.dispatch({ changes: { from: 0, to: current.length, insert: doc } });
    }
  });

  onDestroy(() => {
    isUnmounted = true;
    clearTimeout(timer);
    editorView?.destroy();
  });

  function resetToolState() {
    rawSoql = "";
    previewRows = [];
    fullRows = [];
    tooLargeInteractive = false;
    validation = undefined;
    actionMessage = undefined;
    lastCheckedSoql = "";
    mode = "builder";
    fields = [];
    sobjects = [];
    fieldSearch = "";
    sobjectSearch = "";
    showSObjectOptions = false;
    builder = {
      sobject: "",
      selectedFields: ["Id"],
      filters: [],
      filterLogic: "AND",
    };
  }

  async function validateAndMaybePreview(username: string, soql: string) {
    if (soql === lastCheckedSoql) {
      return;
    }

    requestVersion += 1;
    const localVersion = requestVersion;

    try {
      const result = await backendClient.soqlValidate({ username, api, soql });
      if (localVersion !== requestVersion) return;
      lastCheckedSoql = soql;
      validation = result.valid ? "Valid" : (result.message ?? "Invalid query");
      if (!result.valid || isProduction) {
        if (!result.valid) previewRows = [];
        return;
      }

      const run = await backendClient.soqlRun({ username, api, soql, previewLimit: 5 });
      if (localVersion !== requestVersion) return;
      previewRows = run.records;
    } catch (error) {
      if (localVersion !== requestVersion) return;
      validation = error instanceof Error ? error.message : "SOQL validation failed.";
      previewRows = [];
    }
  }

  async function loadSObjects() {
    if (!activeOrg) return;
    const response = await backendClient.soqlDescribeGlobal({ username: activeOrg.username, api });
    sobjects = response.sobjects;
    if (builder.sobject) {
      const selected = response.sobjects.find((entry) => entry.apiName === builder.sobject);
      sobjectSearch = selected ? formatSObjectOption(selected) : "";
    }
  }

  async function onApiChange() {
    fields = [];
    fieldSearch = "";
    sobjectSearch = "";
    showSObjectOptions = false;
    previewRows = [];
    fullRows = [];
    tooLargeInteractive = false;
    validation = undefined;
    actionMessage = undefined;
    lastCheckedSoql = "";
    builder = {
      ...builder,
      sobject: "",
      selectedFields: ["Id"],
      filters: [],
      filterLogic: "AND",
      orderBy: undefined,
      limit: undefined,
    };
    await loadSObjects();
  }

  async function pickSObject(apiName: string) {
    if (!activeOrg) return;
    if (!apiName) {
      builder = {
        ...builder,
        sobject: "",
        selectedFields: ["Id"],
        filters: [],
        filterLogic: "AND",
        orderBy: undefined,
        limit: undefined,
      };
      fields = [];
      fieldSearch = "";
      sobjectSearch = "";
      showSObjectOptions = false;
      previewRows = [];
      fullRows = [];
      tooLargeInteractive = false;
      validation = undefined;
      actionMessage = undefined;
      lastCheckedSoql = "";
      return;
    }

    builder = {
      ...builder,
      sobject: apiName,
      selectedFields: ["Id"],
      filters: [],
      filterLogic: "AND",
      orderBy: undefined,
      limit: undefined,
    };
    fieldSearch = "";
    previewRows = [];
    fullRows = [];
    tooLargeInteractive = false;
    validation = undefined;
    actionMessage = undefined;
    lastCheckedSoql = "";
    const response = await backendClient.soqlDescribeObject({ username: activeOrg.username, api, sobject: apiName });
    fields = response.fields;
    const selected = sobjects.find((entry) => entry.apiName === apiName);
    if (selected) {
      sobjectSearch = formatSObjectOption(selected);
    }
    showSObjectOptions = false;
  }

  function formatSObjectOption(sobject: SObjectSummary): string {
    return `${sobject.label} (${sobject.apiName})`;
  }

  function resolveSObjectApiName(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const exactApiName = sobjects.find((entry) => entry.apiName.toLowerCase() === trimmed.toLowerCase());
    if (exactApiName) return exactApiName.apiName;
    const exactFormatted = sobjects.find((entry) => formatSObjectOption(entry).toLowerCase() === trimmed.toLowerCase());
    if (exactFormatted) return exactFormatted.apiName;
    const exactLabel = sobjects.find((entry) => entry.label.toLowerCase() === trimmed.toLowerCase());
    if (exactLabel) return exactLabel.apiName;
    return undefined;
  }

  async function onSObjectInputChange(value: string) {
    sobjectSearch = value;
    const apiName = resolveSObjectApiName(value);
    if (apiName) {
      await pickSObject(apiName);
      return;
    }
    showSObjectOptions = true;
    if (!value.trim() && builder.sobject) {
      await pickSObject("");
    }
  }

  async function selectSObjectOption(sobject: SObjectSummary) {
    await pickSObject(sobject.apiName);
  }

  async function onSObjectInputKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      showSObjectOptions = false;
      return;
    }
    if (event.key !== "Enter") return;
    if (filteredSObjects.length === 0) return;
    event.preventDefault();
    await selectSObjectOption(filteredSObjects[0]);
  }

  function toggleField(apiName: string) {
    if (builder.selectedFields.includes(apiName)) {
      builder.selectedFields = builder.selectedFields.filter((field) => field !== apiName);
      return;
    }
    builder.selectedFields = [...builder.selectedFields, apiName];
  }

  function addFilter() {
    const firstField = filterableFields[0];
    const fieldName = firstField?.apiName ?? "";
    const operator = fieldName ? getOperatorOptions(firstField).find((value) => value !== "= null" && value !== "!= null") ?? "=" : "=";
    const value = "";
    builder.filters = [...builder.filters, { field: fieldName, operator, value, fieldType: firstField?.type }];
  }

  function removeFilter(index: number) {
    builder.filters = builder.filters.filter((_, position) => position !== index);
  }

  function onFilterFieldChange(index: number, fieldName: string) {
    const field = fields.find((entry) => entry.apiName === fieldName);
    const fallback = getOperatorOptions(field).find((value) => value !== "= null") ?? "=";
    const next = [...builder.filters];
    next[index] = { ...next[index], field: fieldName, operator: fallback, value: "", fieldType: field?.type };
    builder.filters = next;
  }

  function onFilterOperatorChange(index: number, operator: string) {
    const next = [...builder.filters];
    const value = isValueLessOperator(operator) ? "" : next[index]?.value;
    next[index] = { ...next[index], operator, value };
    builder.filters = next;
  }

  function onFilterValueChange(index: number, value: string) {
    const next = [...builder.filters];
    next[index] = { ...next[index], value };
    builder.filters = next;
  }

  function onOrderByFieldChange(field: string) {
    if (!field) {
      builder.orderBy = undefined;
      return;
    }
    builder.orderBy = { field, direction: builder.orderBy?.direction ?? "ASC" };
  }

  function onLimitChange(value: string) {
    const parsed = Number.parseInt(value, 10);
    builder.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  function selectAllVisibleFields() {
    const names = filteredFields.map((field) => field.apiName);
    builder.selectedFields = Array.from(new Set([...builder.selectedFields, ...names]));
  }

  function clearSelectedFields() {
    builder.selectedFields = [];
  }

  function switchToRaw() {
    rawSoql = buildSoql(builder);
    mode = "raw";
  }

  function resetToBuilder() {
    mode = "builder";
    rawSoql = "";
  }

  async function runPreview() {
    const soql = effectiveSoql.trim();
    if (!activeOrg || !soql) return;
    try {
      const run = await backendClient.soqlRun({ username: activeOrg.username, api, soql, previewLimit: 5 });
      previewRows = run.records;
      validation = "Valid";
      actionMessage = "Preview updated.";
    } catch (error) {
      validation = error instanceof Error ? error.message : "Preview failed.";
      previewRows = [];
    }
  }

  async function runFullQuery() {
    const soql = effectiveSoql.trim();
    if (!activeOrg || !soql) return;
    isRunningFull = true;
    tooLargeInteractive = false;
    actionMessage = "Running full query...";
    try {
      const toolingLimit = api === "tooling" ? ensureToolingLimit(soql, TOOLING_DEFAULT_LIMIT) : undefined;
      const runSoql = toolingLimit?.soql ?? soql;
      const first = await backendClient.soqlRun({
        username: activeOrg.username,
        api,
        soql: runSoql,
        includeAllPages: false,
      });
      if (first.totalSize > MAX_INTERACTIVE_ROWS) {
        fullRows = [];
        tooLargeInteractive = true;
        actionMessage = api === "tooling"
          ? `Tooling query returned ${first.totalSize} rows. Narrow the query or switch to REST before exporting.`
          : `Query returned ${first.totalSize} rows. Use CSV/JSON export for large result sets.`;
        return;
      }

      if (first.done || !first.nextRecordsUrl) {
        fullRows = first.records;
        tooLargeInteractive = false;
        actionMessage = toolingLimit?.applied
          ? `Loaded ${first.records.length} records (Tooling LIMIT ${TOOLING_DEFAULT_LIMIT} applied).`
          : `Loaded ${first.records.length} records.`;
        return;
      }

      if (api === "tooling") {
        fullRows = first.records;
        tooLargeInteractive = false;
        actionMessage = "Tooling returned a partial batch. This object does not support queryMore(); add/adjust LIMIT to refine results.";
        return;
      }

      const remainder = await backendClient.soqlRun({
        username: activeOrg.username,
        api,
        soql: runSoql,
        includeAllPages: true,
        nextRecordsUrl: first.nextRecordsUrl,
      });
      fullRows = first.records.concat(remainder.records);
      tooLargeInteractive = false;
      actionMessage = `Loaded ${fullRows.length} records.`;
    } catch (error) {
      actionMessage = error instanceof Error ? error.message : "Query run failed.";
      fullRows = [];
      tooLargeInteractive = false;
    } finally {
      isRunningFull = false;
    }
  }

  async function exportData(format: "csv" | "json") {
    const soql = effectiveSoql.trim();
    if (!activeOrg || !soql) return;

    isExporting = true;
    actionMessage = `Preparing ${format.toUpperCase()} export...`;

    try {
      const toolingLimit = api === "tooling" ? ensureToolingLimit(soql, TOOLING_DEFAULT_LIMIT) : undefined;
      const runSoql = toolingLimit?.soql ?? soql;
      const first = await backendClient.soqlRun({
        username: activeOrg.username,
        api,
        soql: runSoql,
        includeAllPages: false,
      });

      const canUseBulk = api === "rest" && !isAggregateQuery(soql);
      if (canUseBulk && first.totalSize > 10000) {
        actionMessage = "Large result detected. Switching to Bulk API export...";
        const started = await backendClient.soqlBulkStart({ username: activeOrg.username, soql });
        const csv = await waitForBulkCsv(activeOrg.username, started.jobId);
        if (format === "csv") {
          triggerDownload(csv, `${toFileStem(activeOrg.username)}.csv`, "text/csv;charset=utf-8");
          actionMessage = "Bulk CSV export ready.";
        } else {
          const records = parseCsv(csv, { parseScalars: true });
          triggerDownload(JSON.stringify(records, null, 2), `${toFileStem(activeOrg.username)}.json`, "application/json;charset=utf-8");
          actionMessage = "Bulk JSON export ready.";
        }
        return;
      }

      if (api === "tooling" && first.totalSize > MAX_INTERACTIVE_ROWS) {
        throw new Error(`Tooling export is capped at ${MAX_INTERACTIVE_ROWS} rows. Narrow the query or switch to REST.`);
      }

      let records = first.records;
      if (api === "tooling" && !first.done) {
        actionMessage = toolingLimit?.applied
          ? `Tooling export is single-batch (${records.length} rows, LIMIT ${TOOLING_DEFAULT_LIMIT} applied).`
          : `Tooling export is single-batch (${records.length} rows). Add LIMIT to control batch size.`;
      } else if (!first.done && first.nextRecordsUrl) {
        const remainder = await backendClient.soqlRun({
          username: activeOrg.username,
          api,
          soql: runSoql,
          includeAllPages: true,
          nextRecordsUrl: first.nextRecordsUrl,
        });
        records = first.records.concat(remainder.records);
      }

      if (format === "csv") {
        triggerDownload(toCsv(records), `${toFileStem(activeOrg.username)}.csv`, "text/csv;charset=utf-8");
      } else {
        triggerDownload(JSON.stringify(records, null, 2), `${toFileStem(activeOrg.username)}.json`, "application/json;charset=utf-8");
      }
      if (!(api === "tooling" && !first.done)) {
        actionMessage = `${format.toUpperCase()} export ready.`;
      }
    } catch (error) {
      actionMessage = error instanceof Error ? error.message : "Export failed.";
    } finally {
      isExporting = false;
    }
  }

  async function waitForBulkCsv(username: string, jobId: string): Promise<string> {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      if (isUnmounted) {
        throw new Error("Bulk export cancelled.");
      }
      const status = await backendClient.soqlBulkStatus({ username, jobId });
      const state = status.state.toLowerCase();
      if (state === "jobcomplete") {
        return backendClient.soqlBulkResult(username, jobId);
      }
      if (state.includes("failed") || state.includes("aborted")) {
        throw new Error(`Bulk export failed (${status.state}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Bulk export timed out after 30 minutes.");
  }

  function toFileStem(username: string): string {
    return `soql-export-${username.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  function isAggregateQuery(soql: string): boolean {
    return /\bgroup\s+by\b/i.test(soql) || /\bcount\s*\(/i.test(soql);
  }

  function ensureToolingLimit(soql: string, limit: number): { soql: string; applied: boolean } {
    if (/\bLIMIT\s+\d+\b/i.test(soql)) {
      return { soql, applied: false };
    }
    const trailingModifierMatch = soql.match(/\s+FOR\s+(VIEW|UPDATE)\s*$/i);
    if (!trailingModifierMatch) {
      return { soql: `${soql} LIMIT ${limit}`, applied: true };
    }
    const trailingModifier = trailingModifierMatch[0];
    const withoutTrailing = soql.slice(0, -trailingModifier.length);
    return { soql: `${withoutTrailing} LIMIT ${limit}${trailingModifier}`, applied: true };
  }

  function getOperatorOptions(field: SoqlFieldInfo | undefined): string[] {
    if (!field) return ["=", "!=", "LIKE", "= null", "!= null"];
    const type = field.type.toLowerCase();
    if (type === "picklist" || type === "multipicklist") return ["=", "!=", "IN", "= null", "!= null"];
    if (type === "string" || type === "textarea" || type === "email" || type === "phone" || type === "url") return ["=", "!=", "LIKE", "= null", "!= null"];
    if (type === "int" || type === "double" || type === "currency" || type === "percent" || type === "date" || type === "datetime" || type === "time") {
      return ["=", "!=", "<", "<=", ">", ">=", "= null", "!= null"];
    }
    return ["=", "!=", "= null", "!= null"];
  }

  function isPicklistFilter(filter: SoqlFilter): boolean {
    const field = fields.find((entry) => entry.apiName === filter.field);
    if (!field) return false;
    return isPicklistField(field) && Array.isArray(field.picklistValues) && field.picklistValues.length > 0 && filter.operator !== "IN";
  }

  function isPicklistInFilter(filter: SoqlFilter): boolean {
    const field = fields.find((entry) => entry.apiName === filter.field);
    if (!field) return false;
    return isPicklistField(field) && Array.isArray(field.picklistValues) && field.picklistValues.length > 0 && filter.operator === "IN";
  }

  function isPicklistField(field: SoqlFieldInfo): boolean {
    const type = field.type.toLowerCase();
    return type === "picklist" || type === "multipicklist";
  }

  function getSelectedInValues(value: string | undefined): string[] {
    if (!value) return [];
    const match = value.match(/^[(](.*)[)]$/);
    if (!match) return [];
    return match[1]
      .split(",")
      .map((entry) => entry.trim().replace(/^'(.*)'$/, "$1").replaceAll("\\'", "'"))
      .filter((entry) => entry.length > 0);
  }

  function onFilterInValuesChange(index: number, selectedValues: string[]) {
    const formatted = selectedValues.length
      ? `(${selectedValues.map((value) => `'${value.replaceAll("'", "\\'")}'`).join(",")})`
      : "";
    onFilterValueChange(index, formatted);
  }

  function isValueLessOperator(operator: string): boolean {
    return operator === "= null" || operator === "!= null";
  }

  function triggerDownload(content: string, fileName: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function createEditorView(container: HTMLDivElement, doc: string, editable: boolean) {
    editorView?.destroy();
    editorView = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          oneDark,
          sql(),
          EditorState.readOnly.of(!editable),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || mode !== "raw") return;
            rawSoql = update.state.doc.toString();
          }),
        ],
      }),
      parent: container,
    });
  }

  async function copyQueryText() {
    const value = editorView?.state.doc.toString() ?? editorText;
    try {
      await navigator.clipboard.writeText(value);
      actionMessage = "Query copied.";
    } catch {
      actionMessage = "Copy failed.";
    }
  }

  function isErrorStatus(value: string): boolean {
    const text = value.toLowerCase();
    return text.includes("fail") || text.includes("invalid") || text.includes("error");
  }

  function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[object]";
      }
    }
    return String(value);
  }
</script>

<div class="panel soql-explorer">
  <div class="soql-toolbar-title">
    <p class="eyebrow">SOQL Explorer</p>
    <h2>SOQL</h2>
  </div>

  {#if !activeOrg}
    <div class="empty-state"><p>Select an active org to query.</p></div>
  {:else}
    <div class="soql-workspace">
      <aside class="soql-rail">
        <div class="soql-scope">
          <div class="soql-scope-api">
            <p class="eyebrow">API</p>
            <div class="soql-segment" role="group" aria-label="Query API">
              <button type="button" aria-pressed={api === "rest"} onclick={() => { api = "rest"; void onApiChange(); }}>REST</button>
              <button type="button" aria-pressed={api === "tooling"} onclick={() => { api = "tooling"; void onApiChange(); }}>Tooling</button>
            </div>
          </div>
          <label class="soql-scope-object">SObject
            <div
              class="soql-autocomplete"
              onfocusout={(event) => {
                const next = event.relatedTarget;
                if (next instanceof Node && event.currentTarget.contains(next)) {
                  return;
                }
                showSObjectOptions = false;
              }}
            >
              <input
                type="text"
                value={sobjectSearch}
                disabled={mode === "raw"}
                placeholder="Type to filter objects"
                autocomplete="off"
                spellcheck={false}
                role="combobox"
                aria-expanded={showSObjectOptions}
                aria-controls="soql-sobject-options"
                onfocus={() => {
                  if (mode === "raw") return;
                  showSObjectOptions = true;
                }}
                oninput={(event) => void onSObjectInputChange(event.currentTarget.value)}
                onkeydown={(event) => void onSObjectInputKeyDown(event)}
              />
              {#if showSObjectOptions && mode !== "raw"}
                <div class="soql-autocomplete-menu" id="soql-sobject-options" role="listbox">
                  {#if filteredSObjects.length === 0}
                    <p class="soql-autocomplete-empty">No matching objects.</p>
                  {:else}
                    {#each filteredSObjects as sobject}
                      <button
                        type="button"
                        class="soql-autocomplete-option"
                        onmousedown={(event) => event.preventDefault()}
                        onclick={() => void selectSObjectOption(sobject)}
                      >
                        {formatSObjectOption(sobject)}
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          </label>
        </div>
        <section class="soql-panel">
          <div class="soql-panel-head">
            <p class="eyebrow">Fields</p>
            <p class="muted soql-field-count">{builder.selectedFields.length} of {fields.length} selected</p>
          </div>
          <div class="soql-field-controls">
            <button type="button" class="btn btn--ghost" disabled={mode === "raw"} onclick={selectAllVisibleFields}>All</button>
            <button type="button" class="btn btn--ghost" disabled={mode === "raw"} onclick={clearSelectedFields}>Clear</button>
          </div>
          <input class="soql-field-search" placeholder="Search fields" bind:value={fieldSearch} disabled={mode === "raw"} />
          <div class="soql-field-list">
            {#each filteredFields as field}
              {@const selected = builder.selectedFields.includes(field.apiName)}
              <button
                type="button"
                class="soql-field"
                aria-pressed={selected}
                disabled={mode === "raw"}
                onclick={() => toggleField(field.apiName)}
              >
                <span class="soql-field__check">{selected ? "✓" : ""}</span>
                <span class="soql-field__main">
                  <span class="soql-field__name">{field.apiName}</span>
                  <span class="soql-field__label">{field.label}</span>
                </span>
                <span class="soql-field__type">{field.type}</span>
              </button>
            {/each}
          </div>
        </section>
        <section class="soql-panel soql-panel--filters">
          <div class="soql-panel-head">
            <p class="eyebrow">Filters</p>
          </div>
          <div class="soql-segment soql-segment--equal" role="group" aria-label="Filter logic">
            <button type="button" aria-pressed={builder.filterLogic === "AND"} disabled={mode === "raw"} onclick={() => { builder.filterLogic = "AND"; }}>AND</button>
            <button type="button" aria-pressed={builder.filterLogic === "OR"} disabled={mode === "raw"} onclick={() => { builder.filterLogic = "OR"; }}>OR</button>
          </div>
          <div class="soql-filters">
            {#each builder.filters as filter, index}
              {@const selectedField = fields.find((field) => field.apiName === filter.field)}
              {@const operators = getOperatorOptions(selectedField)}
              <div class="soql-filter-row">
                <select
                  aria-label={`Filter field ${index + 1}`}
                  disabled={mode === "raw"}
                  value={filter.field}
                  onchange={(event) => onFilterFieldChange(index, event.currentTarget.value)}
                >
                  <option value="">Field</option>
                  {#each filterableFields as field}
                    <option value={field.apiName}>{field.apiName}</option>
                  {/each}
                </select>
                <select
                  aria-label={`Filter operator ${index + 1}`}
                  disabled={mode === "raw"}
                  value={filter.operator}
                  onchange={(event) => onFilterOperatorChange(index, event.currentTarget.value)}
                >
                  {#each operators as operator}
                    <option value={operator}>{operator}</option>
                  {/each}
                </select>
                {#if isValueLessOperator(filter.operator)}
                  <input aria-label={`Filter value ${index + 1}`} disabled value="null" />
                {:else if isPicklistInFilter(filter)}
                  <select
                    aria-label={`Filter value ${index + 1}`}
                    disabled={mode === "raw"}
                    multiple
                    onchange={(event) => onFilterInValuesChange(index, Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
                  >
                    {#each selectedField?.picklistValues ?? [] as picklistValue}
                      <option value={picklistValue} selected={getSelectedInValues(filter.value).includes(picklistValue)}>{picklistValue}</option>
                    {/each}
                  </select>
                {:else if isPicklistFilter(filter)}
                  <select
                    aria-label={`Filter value ${index + 1}`}
                    disabled={mode === "raw"}
                    value={filter.value ?? ""}
                    onchange={(event) => onFilterValueChange(index, event.currentTarget.value)}
                  >
                    <option value="">Value</option>
                    {#each selectedField?.picklistValues ?? [] as picklistValue}
                      <option value={picklistValue}>{picklistValue}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    aria-label={`Filter value ${index + 1}`}
                    disabled={mode === "raw"}
                    value={filter.value ?? ""}
                    oninput={(event) => onFilterValueChange(index, event.currentTarget.value)}
                    placeholder="Value"
                  />
                {/if}
                <button type="button" class="btn btn--ghost" aria-label={`Remove filter ${index + 1}`} disabled={mode === "raw"} onclick={() => removeFilter(index)}>×</button>
              </div>
            {/each}
          </div>
          <button type="button" class="btn btn--ghost" disabled={mode === "raw" || !builder.sobject || filterableFields.length === 0} onclick={addFilter}>+ Add filter</button>
          <div class="soql-order-limit">
            <select
              aria-label="Order by field"
              disabled={mode === "raw"}
              value={builder.orderBy?.field ?? ""}
              onchange={(event) => onOrderByFieldChange(event.currentTarget.value)}
            >
              <option value="">No order</option>
              {#each sortableFields as field}
                <option value={field.apiName}>{field.apiName}</option>
              {/each}
            </select>
            <select
              aria-label="Order direction"
              disabled={mode === "raw" || !builder.orderBy?.field}
              value={builder.orderBy?.direction ?? "ASC"}
              onchange={(event) => {
                if (!builder.orderBy) return;
                builder.orderBy = { ...builder.orderBy, direction: event.currentTarget.value as "ASC" | "DESC" };
              }}
            >
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
            <input
              aria-label="Row limit"
              type="number"
              min="1"
              step="1"
              disabled={mode === "raw"}
              value={builder.limit?.toString() ?? ""}
              oninput={(event) => onLimitChange(event.currentTarget.value)}
              placeholder="Limit"
            />
          </div>
        </section>
      </aside>

      <section class="soql-main">
        <div class="soql-editor">
          <div class="soql-editor__bar">
            <div class="soql-editor__title">
              <p class="eyebrow">Query</p>
              {#if mode === "raw"}
                <span class="soql-mode-badge">RAW</span>
              {/if}
            </div>
            <div class="soql-editor__actions">
              <button class="btn btn--ghost" type="button" onclick={() => void copyQueryText()}>Copy</button>
              {#if mode === "builder"}
                <button class="btn btn--ghost" type="button" onclick={switchToRaw} disabled={!builder.sobject}>Edit as raw SOQL</button>
              {:else}
                <button class="btn btn--ghost" type="button" onclick={resetToBuilder}>Reset to builder</button>
              {/if}
            </div>
          </div>
          <div class="soql-editor-surface" bind:this={editorHost}></div>
        </div>

        {#if validation}
          {#if validation === "Valid"}
            <p class="soql-status soql-status--ok">Valid SOQL</p>
          {:else}
            <div class="soql-error" role="alert">
              {#if parsedValidation?.line || parsedValidation?.column}
                <span class="soql-error__loc">Line {parsedValidation.line ?? "?"}, Column {parsedValidation.column ?? "?"}</span>
              {/if}
              <p class="soql-error__msg">{parsedValidation?.message ?? validation}</p>
            </div>
          {/if}
        {/if}

        {#if actionMessage}
          <p class={`soql-status ${isErrorStatus(actionMessage) ? "soql-status--error" : "soql-status--info"}`} role={isErrorStatus(actionMessage) ? "alert" : undefined}>{actionMessage}</p>
        {/if}

        <div class="soql-actions">
          {#if isProduction}
            <button class="btn btn--ghost" type="button" onclick={runPreview} disabled={!effectiveSoql.trim()}>Run preview</button>
          {/if}
          <button class="btn btn--primary" type="button" onclick={runFullQuery} disabled={!effectiveSoql.trim() || isRunningFull}>
            {isRunningFull ? "Running..." : "Run"}
          </button>
          <div class="spacer"></div>
          <button class="btn btn--ghost" type="button" onclick={() => void exportData("csv")} disabled={!effectiveSoql.trim() || isExporting}>Download CSV</button>
          <button class="btn btn--ghost" type="button" onclick={() => void exportData("json")} disabled={!effectiveSoql.trim() || isExporting}>Download JSON</button>
        </div>

        <div class="soql-results">
          <div class="soql-results__head">
            <p class="eyebrow">Results</p>
            <span class="soql-results__count">{displayedRows.length.toLocaleString()} rows</span>
          </div>
          {#if effectiveColumns.length === 0}
            <div class="empty-state">
              <p>{tooLargeInteractive ? "Result set is too large for interactive rendering. Use export controls." : "Run a query to see results."}</p>
            </div>
          {:else}
            <div class="soql-table-scroll">
              <div class="metadata-table">
                <div class="metadata-row table-heading" style={`grid-template-columns: repeat(${effectiveColumns.length}, minmax(140px, max-content));`}>
                  {#each effectiveColumns as column}<span>{column}</span>{/each}
                </div>
                {#each displayedRows as row}
                  <div class="metadata-row" style={`grid-template-columns: repeat(${effectiveColumns.length}, minmax(140px, max-content));`}>
                    {#each effectiveColumns as column}
                      {@const formatted = formatCellValue(row[column])}
                      <span class={`soql-cell ${formatted === "null" ? "soql-cell--null" : ""}`}>{formatted}</span>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </section>
    </div>
  {/if}
</div>


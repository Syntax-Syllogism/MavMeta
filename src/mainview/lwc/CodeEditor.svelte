<script lang="ts">
  import { onDestroy } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState } from "@codemirror/state";
  import { javascript } from "@codemirror/lang-javascript";
  import { html } from "@codemirror/lang-html";
  import { css } from "@codemirror/lang-css";
  import { xml } from "@codemirror/lang-xml";
  import { oneDark } from "@codemirror/theme-one-dark";
  import type { Language } from "./lwc-view-model";

  type Props = {
    value: string;
    language: Language;
    onChange: (value: string) => void;
  };

  let { value, language, onChange }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let activeLanguage: Language | undefined;

  function getLanguageExtension(lang: Language) {
    switch (lang) {
      case "javascript": return javascript();
      case "html": return html();
      case "css": return css();
      case "xml": return xml();
      default: return [];
    }
  }

  function createView(doc: string, lang: Language) {
    if (!container) return;
    view?.destroy();
    activeLanguage = lang;
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          oneDark,
          getLanguageExtension(lang),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
  }

  $effect(() => {
    // Recreate the editor when language changes or on mount
    const lang = language;
    const doc = value;
    const el = container;
    if (!el) return;
    if (lang !== activeLanguage) {
      createView(doc, lang);
    }
  });

  $effect(() => {
    // Sync value changes without recreating (same language)
    const doc = value;
    if (!view) return;
    if (language !== activeLanguage) return; // let language effect handle it
    const current = view.state.doc.toString();
    if (current !== doc) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: doc } });
    }
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div class="code-editor" bind:this={container}></div>

<style>
  .code-editor {
    height: 100%;
    overflow: auto;
  }

  .code-editor :global(.cm-editor) {
    height: 100%;
    font-size: 13px;
  }

  .code-editor :global(.cm-scroller) {
    font-family: "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
  }
</style>



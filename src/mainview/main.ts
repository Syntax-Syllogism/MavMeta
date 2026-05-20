import "./app.css";
import App from "./App.svelte";
import { mount } from "svelte";
import { installRedactingConsole } from "./logging/redacting-console";

installRedactingConsole();

const app = mount(App, {
	target: document.getElementById("app")!,
});

export default app;

const props = document.querySelector<HTMLScriptElement>("#island-props");
if (props !== null) {
	const value = JSON.parse(props.textContent ?? "{}") as { id?: string };
	document.documentElement.dataset.postId = value.id ?? "";
}

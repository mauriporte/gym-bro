// Evaluate JavaScript inside the Dale debug build on the phone via Chrome DevTools Protocol.
// Prereq: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>
// Usage: node cdp.mjs "<expression>"   (awaits promises, prints the JSON result)
const port = process.env.CDP_PORT || 9333;
const pages = await (await fetch(`http://localhost:${port}/json`)).json();
const page = pages.find(p => p.type === "page");
if (!page) { console.error("no page", pages); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id !== 1) return;
  const r = m.result?.result;
  console.log(m.result?.exceptionDetails ? "ERROR " + JSON.stringify(m.result.exceptionDetails.exception?.description) : JSON.stringify(r?.value ?? r?.description, null, 1));
  ws.close();
});
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: process.argv[2], awaitPromise: true, returnByValue: true } }));

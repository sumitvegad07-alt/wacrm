const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["token", "baseUrl"]).then(({ token, baseUrl }) => {
  if (token) $("token").value = token;
  $("baseUrl").value = baseUrl || "https://app.ozzo.co.in";
});

/** Shows whether the loop is on, and the last thing that went wrong if any. */
async function refresh() {
  const { running = false, lastError = "" } = await chrome.storage.local.get([
    "running",
    "lastError",
  ]);
  $("state").textContent = running ? "Running." : "Not running.";
  // Without this the loop could be retrying a 404 every minute with nothing on
  // screen but the word "Sending."
  $("error").textContent = lastError ? `Last error: ${lastError}` : "";
}

refresh();
// The worker writes these from its own context, so poll rather than hope the
// page is open at the moment something changes.
chrome.storage.local.onChanged.addListener(refresh);

$("save").addEventListener("click", async () => {
  // A trailing slash builds https://host//api/... which 404s on every tick,
  // and the only sign of it was a line in the service worker console.
  const baseUrl = $("baseUrl").value.trim().replace(/\/+$/, "");
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    baseUrl: baseUrl || "https://app.ozzo.co.in",
  });
  $("status").textContent = "Saved.";
});

$("start").addEventListener("click", async () => {
  const reply = await chrome.runtime.sendMessage({ op: "start" });
  $("status").textContent = reply?.error ? `Error: ${reply.error}` : "Sending.";
  refresh();
});

$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ op: "stop" });
  $("status").textContent = "Stopped.";
  refresh();
});

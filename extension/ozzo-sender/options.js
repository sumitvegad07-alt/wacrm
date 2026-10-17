const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["token", "baseUrl"]).then(({ token, baseUrl }) => {
  if (token) $("token").value = token;
  $("baseUrl").value = baseUrl || "https://app.ozzo.co.in";
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    baseUrl: $("baseUrl").value.trim() || "https://app.ozzo.co.in",
  });
  $("status").textContent = "Saved.";
});

$("start").addEventListener("click", async () => {
  const reply = await chrome.runtime.sendMessage({ op: "start" });
  $("status").textContent = reply?.error ? `Error: ${reply.error}` : "Sending.";
});

$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ op: "stop" });
  $("status").textContent = "Stopped.";
});

import { AIOMETADATA_HOSTS, HOSTS } from "../installer";
import type { Source } from "../types";
// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { type Html, html, rawHtml } from "./jsx";
import { InstanceRow, MascotSm, PageHead } from "./shared";

export function setupScript(): string {
  return `<script>
(function() {
  var manifest = document.getElementById("manifestUrl");
  var preferred = document.getElementById("preferredHost");
  var list = document.getElementById("fallbackHosts");
  var instanceInput = document.getElementById("instanceInput");
  function syncPreferred() {
    try { preferred.textContent = new URL(manifest.value).origin; } catch { preferred.textContent = "Paste a manifest URL above to detect it"; }
  }
  function addInstance() {
    var value = instanceInput.value.trim().replace(/\\/$/, "");
    if (!/^https:\\/\\//i.test(value) || Array.from(list.children).some(function(row) { return row.dataset.host === value; })) return;
    var row = document.createElement("div"); row.className = "instance-row"; row.dataset.host = value;
    row.innerHTML = '<span class="instance-row-mark">−</span><span class="instance-row-host"></span><span class="instance-reorder"><button type="button" data-move="up" aria-label="Move instance up">↑</button><button type="button" data-move="down" aria-label="Move instance down">↓</button></span><button type="button" class="instance-remove">Remove</button>';
    row.querySelector(".instance-row-host").textContent = value; list.appendChild(row); instanceInput.value = "";
  }
  function moveInstance(button) {
    var row = button.closest(".instance-row");
    if (button.dataset.move === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (button.dataset.move === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
  }
  manifest.addEventListener("input", syncPreferred);
  document.getElementById("addInstanceBtn").addEventListener("click", addInstance);
  instanceInput.addEventListener("keydown", function(e) { if (e.key === "Enter") { e.preventDefault(); addInstance(); } });
  list.addEventListener("click", function(e) { var move = e.target.closest("[data-move]"); if (move) moveInstance(move); else if (e.target.closest(".instance-remove")) e.target.closest(".instance-row").remove(); });
  document.getElementById("setupForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    var result = document.getElementById("result");
    result.textContent = "Creating...";
    var submit = e.submitter || document.querySelector('#setupForm button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      var hosts = Array.from(list.children).map(function(row) { return row.dataset.host; }).filter(Boolean);
      var response = await fetch("/setup", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ manifestUrl: manifest.value.trim(), password: document.getElementById("password").value, preferredHost: preferred.textContent.trim(), enabledFallbackHosts: hosts })});
      var data = await response.json();
      result.textContent = response.ok ? "Install URL:\\n\\n" + data.installUrl + "\\n\\nEdit URL:\\n\\n" + data.manageUrl : (data.error || "Unable to create install link");
    } catch (err) {
      result.textContent = "Unable to create install link: " + err.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();
</script>`;
}

export function SetupPage({ source, hosts }: { source: Source; hosts?: string[] }): Html {
  const isAiometadata = source === "aiometadata";
  const sourceName = isAiometadata ? "AIOMetadata" : "AIOStreams";
  const hostList = hosts?.length ? hosts : isAiometadata ? AIOMETADATA_HOSTS : HOSTS;
  return (
    <html lang="en">
      <head>
        <PageHead title="Create install link" />
      </head>
      <body>
        <main class="container setup-page">
          <div class="setup-brand">
            <MascotSm />
            <span>Streamkeeper</span>
          </div>
          <div class="setup-hero">
            <div class="setup-eyebrow">
              <span class="setup-eyebrow-dot" /> Resilient addon routing
            </div>
            <h1 class="gradient-text">Build your Streamkeeper link</h1>
            <p class="setup-intro">
              Connect your {sourceName} account once. Streamkeeper keeps a preferred instance ready and fails over to
              the rest when needed.
            </p>
            {isAiometadata ? (
              <div class="setup-warning" role="note">
                <strong>Experimental AIOMetadata support.</strong> Fallback instances may receive your saved
                configuration, including provider settings and API keys. Remove any host you do not trust before
                creating the link.
              </div>
            ) : null}
          </div>
          <form id="setupForm" class="setup-form">
            <section class="glass-card setup-card">
              <div class="setup-card-heading">
                <div class="setup-step">01</div>
                <div>
                  <h2>Your {sourceName} account</h2>
                  <p>Use the manifest URL and password from your existing instance.</p>
                </div>
              </div>
              <div class="form-group">
                <label for="manifestUrl">Manifest URL</label>
                <input
                  id="manifestUrl"
                  type="url"
                  required
                  class="form-input"
                  placeholder={
                    isAiometadata
                      ? "https://instance/stremio/userUUID/manifest.json"
                      : "https://instance/stremio/uuid/password/manifest.json"
                  }
                  autocomplete="url"
                />
                <span class="field-hint">
                  {isAiometadata
                    ? "Paste the generated /stremio/<userUUID>/manifest.json URL, not the instance /configure page. "
                    : null}
                  Your manifest credentials are sealed into the generated link. If you update your configuration later,
                  make a new link — existing links fail over with the configuration they were created with.
                </span>
              </div>
              <div class="form-group">
                <label for="password">{sourceName} password</label>
                <input id="password" type="password" required class="form-input" autocomplete="current-password" />
                <span class="field-hint">Used to verify and restore your configuration on a fallback.</span>
              </div>
            </section>
            <section class="glass-card setup-card instance-card">
              <div class="setup-card-heading">
                <div class="setup-step">02</div>
                <div>
                  <h2>Instance pool</h2>
                  <p>Choose where Streamkeeper should route requests.</p>
                </div>
              </div>
              <div class="preferred-instance">
                <div class="instance-label">
                  <span class="instance-status-dot" />
                  <span>
                    <strong>Preferred instance</strong>
                    <small>Detected from your manifest URL</small>
                  </span>
                </div>
                <div id="preferredHost" class="instance-value" aria-live="polite">
                  Paste a manifest URL above to detect it
                </div>
              </div>
              <div class="fallback-heading">
                <span>Fallback instances</span>
                <span class="instance-count">Enabled for failover</span>
              </div>
              <div id="fallbackHosts" class="instance-list">
                {hostList.map((host) => (
                  <InstanceRow host={host} />
                ))}
              </div>
              <div class="instance-add">
                <input
                  id="instanceInput"
                  type="url"
                  class="form-input"
                  placeholder="https://another-instance.example"
                  aria-label="Add fallback instance"
                />
                <button id="addInstanceBtn" type="button" class="btn btn-secondary">
                  Add instance
                </button>
              </div>
              <span class="field-hint">
                Use ↑ and ↓ to set fallback priority. Remove hosts you do not trust or add your own.
              </span>
            </section>
            <div class="setup-submit">
              <button class="btn btn-primary" type="submit">
                Create encrypted install link <span aria-hidden="true">→</span>
              </button>
              <p class="secure-note">
                <span aria-hidden="true">◆</span> Your configuration is encrypted before it leaves this page.
              </p>
            </div>
            <p id="result" class="setup-result" />
          </form>
          <p class="setup-footer">
            {isAiometadata ? "Need AIOStreams instead?" : "Trying AIOMetadata?"}{" "}
            <a href={isAiometadata ? "/setup" : "/setup?source=aiometadata"}>
              {isAiometadata ? "Open AIOStreams setup" : "Open AIOMetadata beta setup"}
            </a>
          </p>
          <p class="setup-footer">
            Open source (GPLv3) ·{" "}
            <a href="https://github.com/greysilly7/streamkeeper" target="_blank" rel="noopener noreferrer">
              Source code
            </a>{" "}
            ·{" "}
            <a
              href="https://torbox.app/subscription?referral=97a1fa98-0aa9-4db5-8a20-f605ef629a2a"
              target="_blank"
              rel="noopener noreferrer"
            >
              TorBox referral
            </a>
          </p>
          <p class="setup-footer">
            Your configuration — including third-party API keys — is sealed into your install link and used only to
            restore it on fallback hosts; the server does not retain it. Anyone holding the link can use it, so treat it
            as a secret. Addon traffic passes through this hosted proxy. Verify everything yourself in{" "}
            <a href="https://github.com/greysilly7/streamkeeper" target="_blank" rel="noopener noreferrer">
              the source
            </a>
            .
          </p>
        </main>
        {rawHtml(setupScript())}
      </body>
    </html>
  );
}

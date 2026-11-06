import type { StatelessTokenPayload } from "../types";
// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { type Html, html, rawHtml } from "./jsx";
import { InstanceRow, MascotSm, PageHead } from "./shared";

export function ManageScript(): string {
  return `<script>
(function() {
  var manifest = document.getElementById("manifestUrl"), preferred = document.getElementById("preferredHost"), list = document.getElementById("fallbackHosts"), instanceInput = document.getElementById("instanceInput");
  manifest.addEventListener("input", function() { try { preferred.textContent = new URL(manifest.value).origin; } catch {} });
  function addInstance() {
    var value = instanceInput.value.trim().replace(/\\/$/, "");
    if (!/^https:\\/\\//i.test(value) || Array.from(list.children).some(function(row) { return row.dataset.host === value; })) return;
    var row = document.createElement("div"); row.className = "instance-row"; row.dataset.host = value;
    row.innerHTML = '<span class="instance-row-mark">−</span><span class="instance-row-host"></span><span class="instance-reorder"><button type="button" data-move="up" aria-label="Move instance up">↑</button><button type="button" data-move="down" aria-label="Move instance down">↓</button></span><button type="button" class="instance-remove">Remove</button>';
    row.querySelector(".instance-row-host").textContent = value; list.appendChild(row); instanceInput.value = "";
  }
  function moveInstance(button) { var row = button.closest(".instance-row"); if (button.dataset.move === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling); if (button.dataset.move === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row); }
  document.getElementById("addInstanceBtn").addEventListener("click", addInstance);
  instanceInput.addEventListener("keydown", function(e) { if (e.key === "Enter") { e.preventDefault(); addInstance(); } });
  list.addEventListener("click", function(e) { var move = e.target.closest("[data-move]"); if (move) moveInstance(move); else if (e.target.closest(".instance-remove")) e.target.closest(".instance-row").remove(); });
  document.getElementById("manageForm").addEventListener("submit", async function(e) {
    e.preventDefault(); var result = document.getElementById("result"); result.textContent = "Updating...";
    var hosts = Array.from(list.children).map(function(row) { return row.dataset.host; }).filter(Boolean);
    var response = await fetch(location.pathname, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ manifestUrl: manifest.value.trim(), password: document.getElementById("password").value, preferredHost: preferred.textContent.trim(), enabledFallbackHosts: hosts })});
    var data = await response.json(); result.textContent = response.ok ? "Copy this updated URL:\\n\\n" + data.installUrl : (data.error || "Unable to update install link");
  });
})();
</script>`;
}
export function ManagePage({ payload }: { payload: StatelessTokenPayload }): Html {
  const source = payload.s || "aiostreams";
  const sourceName = source === "aiometadata" ? "AIOMetadata" : "AIOStreams";
  const manifestUrl = payload.m || `${payload.h}/stremio/${payload.u}/${payload.e}/manifest.json`;
  const manifestOrigin = new URL(manifestUrl).origin;
  return (
    <html lang="en">
      <head>
        <PageHead title="Edit install link" />
      </head>
      <body>
        <main class="container setup-page">
          <div class="setup-brand">
            <MascotSm />
            <span>Streamkeeper</span>
          </div>
          <div class="setup-hero">
            <div class="setup-eyebrow">
              <span class="setup-eyebrow-dot" /> Link configuration
            </div>
            <h1 class="gradient-text">Tune your Streamkeeper link</h1>
            <p class="setup-intro">
              Reorder your instances or update the source credentials. Changes create a new link; the old link remains
              valid.
            </p>
          </div>
          <form id="manageForm" class="setup-form">
            <section class="glass-card setup-card">
              <div class="setup-card-heading">
                <div class="setup-step">01</div>
                <div>
                  <h2>Your {sourceName} account</h2>
                  <p>Update the source manifest or leave the password blank to keep it.</p>
                </div>
              </div>
              <div class="form-group">
                <label for="manifestUrl">Manifest URL</label>
                <input id="manifestUrl" type="url" required class="form-input" value={manifestUrl} />
                <span class="field-hint">
                  Remake the link whenever your {sourceName} configuration changes — fallbacks restore the configuration
                  captured when the link was made, not your latest one.
                </span>
              </div>
              <div class="form-group">
                <label for="password">New {sourceName} password</label>
                <input
                  id="password"
                  type="password"
                  class="form-input"
                  placeholder="Leave blank to keep current password"
                />
              </div>
            </section>
            <section class="glass-card setup-card instance-card">
              <div class="setup-card-heading">
                <div class="setup-step">02</div>
                <div>
                  <h2>Instance pool</h2>
                  <p>The list order controls failover priority.</p>
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
                  {manifestOrigin}
                </div>
              </div>
              <div class="fallback-heading">
                <span>Fallback instances</span>
                <span class="instance-count">Top to bottom priority</span>
              </div>
              <div id="fallbackHosts" class="instance-list">
                {payload.f.map((host) => (
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
                Use ↑ and ↓ to set fallback priority. The preferred instance is tested first.
              </span>
            </section>
            <div class="setup-submit">
              <button class="btn btn-primary" type="submit">
                Create updated link <span aria-hidden="true">→</span>
              </button>
              <p class="secure-note">
                <span aria-hidden="true">◆</span> The updated configuration is encrypted.
              </p>
            </div>
            <p id="result" class="setup-result" />
          </form>
        </main>
        {rawHtml(ManageScript())}
      </body>
    </html>
  );
}

import { AIOMETADATA_HOSTS, HOSTS } from "../installer";
import type { AccountRecord } from "../types";
// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { Fragment, type Html, html, rawHtml } from "./jsx";

export function NewAccountModal({
  aiostreamsHosts = HOSTS,
  aiometadataHosts = AIOMETADATA_HOSTS,
}: {
  aiostreamsHosts?: string[];
  aiometadataHosts?: string[];
}): Html {
  const pools = JSON.stringify({ aiostreams: aiostreamsHosts, aiometadata: aiometadataHosts }).replace(/</g, "\\u003c");
  return (
    <Fragment>
      <div id="addAccountModal" class="modal" style="display:none;">
        <div class="modal-content">
          <div class="modal-header">
            <h3>New Account</h3>
            <button type="button" class="modal-close" id="modalCloseBtn">
              ×
            </button>
          </div>
          <form id="addAccountForm">
            <div class="form-group">
              <label for="newSource">Source</label>
              <select id="newSource" class="form-input">
                <option value="aiostreams">AIOStreams</option>
                <option value="aiometadata">AIOMetadata</option>
              </select>
            </div>
            <div class="form-group">
              <label for="newNickname">Nickname</label>
              <input
                type="text"
                id="newNickname"
                name="nickname"
                required
                class="form-input"
                placeholder="e.g., My Account, Parents, Friend"
              />
            </div>
            <div class="form-group">
              <label for="newManifestUrl">Manifest URL</label>
              <input
                type="url"
                id="newManifestUrl"
                name="manifestUrl"
                required
                class="form-input"
                placeholder="https://host/stremio/uuid/manifest.json"
              />
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label for="newPassword">Source password</label>
              <input
                type="password"
                id="newPassword"
                name="password"
                required
                class="form-input"
                placeholder="Your source password"
              />
            </div>
            <div class="form-group">
              <span>Preferred Host</span>
              <div id="newPreferredHost" class="instance-value">
                Paste a manifest URL above to detect it
              </div>
            </div>
            <div class="form-group">
              <span>Fallback Hosts</span>
              <div id="newFallbackHosts" class="checkbox-group">
                {aiostreamsHosts.map((host) => (
                  <label class="checkbox-label" key={host}>
                    <input type="checkbox" name="newFallbackHost" value={host} checked /> {host}
                  </label>
                ))}
              </div>
            </div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="modalCancelBtn">
                Cancel
              </button>
              <button type="submit" class="btn btn-primary" id="modalSubmitBtn">
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>
      <script>{rawHtml(`window.__streamkeeperHostPools = ${pools};`)}</script>
    </Fragment>
  );
}
export function newAccountModalScript(): string {
  return `<script>
(function() {
  var modal = document.getElementById("addAccountModal");
  if (!modal) return;
  var form = document.getElementById("addAccountForm");
  var closeBtn = document.getElementById("modalCloseBtn");
  var cancelBtn = document.getElementById("modalCancelBtn");
  var submitBtn = document.getElementById("modalSubmitBtn");
  var toastContainer = document.getElementById("toastContainer");
  var source = document.getElementById("newSource");
  var manifest = document.getElementById("newManifestUrl");
  var preferred = document.getElementById("newPreferredHost");
  var fallback = document.getElementById("newFallbackHosts");
  var pools = window.__streamkeeperHostPools || { aiostreams: [], aiometadata: [] };

  function showToast(message, type) {
    type = type || "info";
    var toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 300ms ease";
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3000);
  }
  function closeModal() { modal.style.display = "none"; }
  function syncPreferred() {
    try { preferred.textContent = new URL(manifest.value).origin; }
    catch { preferred.textContent = "Paste a manifest URL above to detect it"; }
  }
  function renderFallbacks() {
    fallback.innerHTML = "";
    (pools[source.value] || []).forEach(function(host) {
      var label = document.createElement("label");
      label.className = "checkbox-label";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.name = "newFallbackHost";
      input.value = host;
      input.checked = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + host));
      fallback.appendChild(label);
    });
  }
  function openModal() {
    modal.style.display = "flex";
    form.reset();
    source.value = "aiostreams";
    renderFallbacks();
    syncPreferred();
    var firstInput = document.getElementById("newNickname");
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);
  }
  [closeBtn, cancelBtn].forEach(function(el) { if (el) el.addEventListener("click", closeModal); });
  modal.addEventListener("click", function(e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function(e) { if (e.key === "Escape" && modal.style.display === "flex") closeModal(); });
  source.addEventListener("change", renderFallbacks);
  manifest.addEventListener("input", syncPreferred);
  form.addEventListener("submit", function(e) {
    e.preventDefault();
    var nickname = document.getElementById("newNickname").value.trim();
    var manifestUrl = manifest.value.trim();
    var password = document.getElementById("newPassword").value;
    var enabledFallbackHosts = Array.from(fallback.querySelectorAll('input[name="newFallbackHost"]:checked')).map(function(cb) { return cb.value; });
    var preferredHost = preferred.textContent.trim();
    var ok = true;
    [["newNickname", nickname], ["newManifestUrl", manifestUrl], ["newPassword", password]].forEach(function(pair) {
      var el = document.getElementById(pair[0]);
      if (el) el.classList.remove("shake");
      if (!pair[1]) { el.classList.add("shake"); ok = false; }
    });
    if (!ok) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
    fetch("/admin/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (function(){try{return localStorage.getItem("aio_auth_token")}catch(e){return "";}})()
      },
      body: JSON.stringify({ nickname: nickname, manifestUrl: manifestUrl, password: password, preferredHost: preferredHost, enabledFallbackHosts: enabledFallbackHosts })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(result) {
      if (result.ok) {
        closeModal();
        showToast("Stateless install URL created", "success");
        window.prompt("Copy your stateless install URL. The URL contains your encrypted configuration.", result.data.installUrl);
        if (window.__streamkeeperAdmin) window.__streamkeeperAdmin.refreshGrid();
      } else {
        showToast("Error: " + (result.data.error || "Unknown error"), "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
    })
    .catch(function(err) {
      showToast("Request failed: " + err.message, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
    });
  });
  window.__openNewAccountModal = openModal;
})();
</script>`;
}
export function AccountCard({ account, index }: { account: AccountRecord; index: number }): Html {
  const nickname = account.nickname || `Account ${index + 1}`;
  const sourceName = account.source === "aiometadata" ? "AIOMetadata" : "AIOStreams";
  const badge = !account.currentHost ? (
    <span class="health-badge health-badge-unavailable">Unavailable</span>
  ) : !account.preferredHost || account.currentHost === account.preferredHost ? (
    <span class="health-badge health-badge-normal">Preferred Host</span>
  ) : (
    <span class="health-badge health-badge-failover">Failover</span>
  );
  return (
    <div class="account-card">
      <div class="account-header">
        <h3>{nickname}</h3>
        {badge}
      </div>
      <div class="account-body">
        <div class="install-field">
          <label for={`url-${index}`}>{sourceName} Streamkeeper URL</label>
          <div class="url-with-copy">
            <input type="text" readonly value={account.installUrl} class="url-input" id={`url-${index}`} />
            <button type="button" class="copy-btn" data-target={`url-${index}`} title="Copy to clipboard">
              Copy
            </button>
          </div>
        </div>
        <div class="account-actions">
          <button type="button" class="btn btn-secondary manage-btn" data-uuid={account.uuid} title="Manage account">
            Manage
          </button>
        </div>
      </div>
    </div>
  );
}

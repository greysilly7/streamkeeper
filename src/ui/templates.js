import { HOSTS } from '../installer.js';
import { adminScript } from './admin.js';
import { THEME_CSS } from './styles.js';

function mascotSvg() {
  return `<svg viewBox="0 0 48 48" width="1em" height="1em" xmlns="http://www.w3.org/2000/svg">
    <path d="M24 4 L44 11 L44 26 C44 38 34 44 24 46 C14 44 6 38 6 26 L6 11 Z" fill="#ffd166"/>
    <path d="M24 6 L42 13 L42 26 C42 37 33 42 24 44 C15 42 6 37 6 26 L6 13 Z" fill="none" stroke="#e8b844" stroke-width="1.2"/>
    <path d="M16 24 Q20 18 24 24 Q28 30 32 24" stroke="#e8b844" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}
function mascotSmHtml() {
  return `<span class="mascot mascot-sm">${mascotSvg()}</span>`;
}
function pageHeadHtml(title, extraStyles) {
  const extra = extraStyles ? `<style>${extraStyles}</style>` : "";
  return `<meta charset="utf-8">
  <title>${htmlEsc(title)} - Streamkeeper</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M24 4 L44 11 L44 26 C44 38 34 44 24 46 C14 44 6 38 6 26 L6 11 Z' fill='%23ffd166'/%3E%3Cpath d='M16 24 Q20 18 24 24 Q28 30 32 24' stroke='%23e8b844' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E" type="image/svg+xml">
  <style>${THEME_CSS}</style>${extra}`;
}
function htmlEsc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function confirmModalHtml() {
  return `
  <div id="confirmModal" class="modal" style="display: none;">
    <div class="modal-content" style="max-width: 380px;">
      <div class="modal-header">
        <h3 id="confirmModalTitle">Confirm</h3>
        <button type="button" class="modal-close" id="confirmCloseBtn">&times;</button>
      </div>
      <p id="confirmModalMessage" style="color: var(--text-secondary); margin-bottom: var(--space-lg);"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="confirmCancelBtn">Cancel</button>
        <button type="button" class="btn btn-danger" id="confirmOkBtn">Confirm</button>
      </div>
    </div>
  </div>`;
}
function toastContainerHtml() {
  return '<div id="toastContainer" class="toast-container" aria-live="polite"></div>';
}
function newAccountModalHtml() {
  return `<div id="addAccountModal" class="modal" style="display:none;">
    <div class="modal-content">
      <div class="modal-header">
        <h3>New Account</h3>
        <button type="button" class="modal-close" id="modalCloseBtn">&times;</button>
      </div>
      <form id="addAccountForm">
        <div class="form-group">
          <label for="newNickname">Nickname</label>
          <input type="text" id="newNickname" name="nickname" required class="form-input" placeholder="e.g., My Account, Parents, Friend">
        </div>
        <div class="form-group">
          <label for="newManifestUrl">AIOStreams Manifest URL</label>
          <input type="url" id="newManifestUrl" name="manifestUrl" required class="form-input" placeholder="https://host/stremio/uuid/enc/manifest.json">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label for="newPassword">AIOStreams Password</label>
          <input type="password" id="newPassword" name="password" required class="form-input" placeholder="Your AIOStreams password">
        </div>
        <div class="form-group">
          <label for="newPreferredHost">Preferred Host</label>
          <select id="newPreferredHost" class="form-input">${HOSTS.map((host) => `<option value="${htmlEsc(host)}">${htmlEsc(host)}</option>`).join("")}</select>
        </div>
        <div class="form-group">
          <label>Fallback Hosts</label>
          <div class="checkbox-group">${HOSTS.map((host) => `<label class="checkbox-label"><input type="checkbox" name="newFallbackHost" value="${htmlEsc(host)}" checked> ${htmlEsc(host)}</label>`).join("")}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="modalSubmitBtn">Create Account</button>
        </div>
      </form>
    </div>
  </div>`;
}
function newAccountModalScript() {
  return `<script>
(function() {
  var modal = document.getElementById("addAccountModal");
  if (!modal) return;
  var form = document.getElementById("addAccountForm");
  var closeBtn = document.getElementById("modalCloseBtn");
  var cancelBtn = document.getElementById("modalCancelBtn");
  var submitBtn = document.getElementById("modalSubmitBtn");
  var toastContainer = document.getElementById("toastContainer");

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

  function openModal() {
    modal.style.display = "flex";
    form.reset();
    var firstInput = document.getElementById("newNickname");
    if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);
  }

  [closeBtn, cancelBtn].forEach(function(el) {
    if (el) el.addEventListener("click", closeModal);
  });

  modal.addEventListener("click", function(e) {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && modal.style.display === "flex") closeModal();
  });

  form.addEventListener("submit", function(e) {
    e.preventDefault();
    var nickname = document.getElementById("newNickname").value.trim();
    var manifestUrl = document.getElementById("newManifestUrl").value.trim();
    var password = document.getElementById("newPassword").value;
    var enabledFallbackHosts = Array.from(document.querySelectorAll('input[name="newFallbackHost"]:checked')).map(function(cb) { return cb.value; });
    var preferredHost = document.getElementById("newPreferredHost").value;

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
<\/script>`;
}
function accountCardHtml(acc, idx) {
  const nickname = htmlEsc(acc.nickname || `Account ${idx + 1}`);
  return `<div class="account-card">
    <div class="account-header">
      <h3>${nickname}</h3>
      ${!acc.currentHost ? `<span class="health-badge health-badge-unknown">Unknown</span>` : !acc.preferredHost || acc.currentHost === acc.preferredHost ? `<span class="health-badge health-badge-normal">Preferred Host</span>` : `<span class="health-badge health-badge-failover">Failover</span>`}
    </div>
    <div class="account-body">
      <div class="install-field">
        <label>AIOStreams Streamkeeper URL</label>
        <div class="url-with-copy">
          <input type="text" readonly value="${htmlEsc(acc.installUrl)}" class="url-input" id="url-${idx}">
          <button class="copy-btn" data-target="url-${idx}" title="Copy to clipboard">Copy</button>
        </div>
      </div>
      <div class="account-actions">
        <button class="btn btn-secondary manage-btn" data-uuid="${htmlEsc(acc.uuid)}" title="Manage account">Manage</button>
      </div>
    </div>
  </div>`;
}
function statelessSetupPage() {
  const hostItems = HOSTS.map((host) => `<div class="instance-row" data-host="${htmlEsc(host)}"><span class="instance-row-mark">−</span><span class="instance-row-host">${htmlEsc(host)}</span><span class="instance-reorder"><button type="button" data-move="up" aria-label="Move ${htmlEsc(host)} up">↑</button><button type="button" data-move="down" aria-label="Move ${htmlEsc(host)} down">↓</button></span><button type="button" class="instance-remove" aria-label="Remove ${htmlEsc(host)}">Remove</button></div>`).join("");
  return `<!doctype html><html lang="en"><head>${pageHeadHtml("Create install link")}</head><body>
  <main class="container setup-page">
    <div class="setup-brand">${mascotSmHtml()}<span>Streamkeeper</span></div>
    <div class="setup-hero">
      <div class="setup-eyebrow"><span class="setup-eyebrow-dot"></span> Resilient addon routing</div>
      <h1 class="gradient-text">Build your Streamkeeper link</h1>
      <p class="setup-intro">Connect your AIOStreams account once. Streamkeeper keeps a preferred instance ready and fails over to the rest when needed.</p>
    </div>
    <form id="setupForm" class="setup-form">
      <section class="glass-card setup-card">
        <div class="setup-card-heading"><div class="setup-step">01</div><div><h2>Your AIOStreams account</h2><p>Use the manifest URL and password from your existing instance.</p></div></div>
        <div class="form-group"><label for="manifestUrl">Manifest URL</label><input id="manifestUrl" type="url" required class="form-input" placeholder="https://instance/stremio/uuid/password/manifest.json" autocomplete="url"><span class="field-hint">Your manifest credentials are sealed into the generated link.</span></div>
        <div class="form-group"><label for="password">AIOStreams password</label><input id="password" type="password" required class="form-input" autocomplete="current-password"><span class="field-hint">Used to verify and restore your configuration on a fallback.</span></div>
      </section>
      <section class="glass-card setup-card instance-card">
        <div class="setup-card-heading"><div class="setup-step">02</div><div><h2>Instance pool</h2><p>Choose where Streamkeeper should route requests.</p></div></div>
        <div class="preferred-instance">
          <div class="instance-label"><span class="instance-status-dot"></span><span><strong>Preferred instance</strong><small>Detected from your manifest URL</small></span></div>
          <div id="preferredHost" class="instance-value" aria-live="polite">Paste a manifest URL above to detect it</div>
        </div>
        <div class="fallback-heading"><label>Fallback instances</label><span class="instance-count">Enabled for failover</span></div>
        <div id="fallbackHosts" class="instance-list">${hostItems}</div>
        <div class="instance-add"><input id="instanceInput" type="url" class="form-input" placeholder="https://another-instance.example" aria-label="Add fallback instance"><button id="addInstanceBtn" type="button" class="btn btn-secondary">Add instance</button></div>
        <span class="field-hint">Use ↑ and ↓ to set fallback priority. Remove hosts you do not trust or add your own.</span>
      </section>
      <div class="setup-submit"><button class="btn btn-primary" type="submit">Create encrypted install link <span aria-hidden="true">→</span></button><p class="secure-note"><span aria-hidden="true">◆</span> Your configuration is encrypted before it leaves this page.</p></div>
      <p id="result" class="setup-result"></p>
    </form>
    <p class="setup-footer">Need an AIOStreams config? <a href="https://duck-tools.pages.dev/quackstart/" target="_blank" rel="noopener noreferrer">Duck Streams</a> can help.</p>
  </main>
  <script>
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
      var result = document.getElementById("result"); result.textContent = "Creating...";
      var hosts = Array.from(list.children).map(function(row) { return row.dataset.host; }).filter(Boolean);
      var response = await fetch("/setup", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ manifestUrl: manifest.value.trim(), password: document.getElementById("password").value, preferredHost: preferred.textContent.trim(), enabledFallbackHosts: hosts })});
      var data = await response.json();
      result.textContent = response.ok ? "Install URL:\\n\\n" + data.installUrl + "\\n\\nEdit URL:\\n\\n" + data.manageUrl : (data.error || "Unable to create install link");
    });
  })();
  </script></body></html>`;
}
function statelessManagePage(tokenString, payload) {
  const hostItems = payload.f.map((host) => `<div class="instance-row" data-host="${htmlEsc(host)}"><span class="instance-row-mark">−</span><span class="instance-row-host">${htmlEsc(host)}</span><span class="instance-reorder"><button type="button" data-move="up" aria-label="Move ${htmlEsc(host)} up">↑</button><button type="button" data-move="down" aria-label="Move ${htmlEsc(host)} down">↓</button></span><button type="button" class="instance-remove" aria-label="Remove ${htmlEsc(host)}">Remove</button></div>`).join("");
  const manifestUrl = payload.m || `${payload.h}/stremio/${payload.u}/${payload.e}/manifest.json`;
  return `<!doctype html><html lang="en"><head>${pageHeadHtml("Edit install link")}</head><body>
  <main class="container setup-page">
    <div class="setup-brand">${mascotSmHtml()}<span>Streamkeeper</span></div>
    <div class="setup-hero">
      <div class="setup-eyebrow"><span class="setup-eyebrow-dot"></span> Link configuration</div>
      <h1 class="gradient-text">Tune your Streamkeeper link</h1>
      <p class="setup-intro">Reorder your instances or update the source credentials. Changes create a new link; the old link remains valid.</p>
    </div>
    <form id="manageForm" class="setup-form">
      <section class="glass-card setup-card">
        <div class="setup-card-heading"><div class="setup-step">01</div><div><h2>Your AIOStreams account</h2><p>Update the source manifest or leave the password blank to keep it.</p></div></div>
        <div class="form-group"><label for="manifestUrl">Manifest URL</label><input id="manifestUrl" type="url" required class="form-input" value="${htmlEsc(manifestUrl)}"></div>
        <div class="form-group"><label for="password">New AIOStreams password</label><input id="password" type="password" class="form-input" placeholder="Leave blank to keep current password"></div>
      </section>
      <section class="glass-card setup-card instance-card">
        <div class="setup-card-heading"><div class="setup-step">02</div><div><h2>Instance pool</h2><p>The list order controls failover priority.</p></div></div>
        <div class="preferred-instance">
          <div class="instance-label"><span class="instance-status-dot"></span><span><strong>Preferred instance</strong><small>Detected from your manifest URL</small></span></div>
          <div id="preferredHost" class="instance-value" aria-live="polite">${htmlEsc(new URL(manifestUrl).origin)}</div>
        </div>
        <div class="fallback-heading"><label>Fallback instances</label><span class="instance-count">Top to bottom priority</span></div>
        <div id="fallbackHosts" class="instance-list">${hostItems}</div>
        <div class="instance-add"><input id="instanceInput" type="url" class="form-input" placeholder="https://another-instance.example" aria-label="Add fallback instance"><button id="addInstanceBtn" type="button" class="btn btn-secondary">Add instance</button></div>
        <span class="field-hint">Use ↑ and ↓ to set fallback priority. The preferred instance is tested first.</span>
      </section>
      <div class="setup-submit"><button class="btn btn-primary" type="submit">Create updated link <span aria-hidden="true">→</span></button><p class="secure-note"><span aria-hidden="true">◆</span> The updated configuration is encrypted.</p></div>
      <p id="result" class="setup-result"></p>
    </form>
  </main>
  <script>
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
  </script></body></html>`;
}
function landingPage() {
  return `<!doctype html>
<html lang="en">
<head>
  ${pageHeadHtml("Streamkeeper")}
</head>
<body>
  <div class="login-wrapper">
    <div class="glass-card login-card">
      ${mascotSmHtml()}
      <h1 class="gradient-text">Streamkeeper</h1>
      <a href="#" id="whatIsLink" class="info-link">What is Streamkeeper?</a>
      <div id="loginForm">
        <div class="form-group">
          <label for="passwordInput">Password</label>
          <input type="password" id="passwordInput" placeholder="Enter admin password" autocomplete="current-password">
        </div>
        <a href="#" id="passwordHelpLink" class="info-link">Don't have a password?</a>
        <button id="loginBtn" class="btn btn-primary">Login</button>
        <div id="loginError" class="login-error"></div>
      </div>
    </div>
  </div>

  <div id="whatIsModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <h3>What is Streamkeeper?</h3>
          <p style="color:var(--text-secondary);font-size:0.85rem;margin:0;margin-top:2px;">100% AIOStreams Uptime.</p>
        </div>
        <button class="modal-close" data-modal="whatIsModal">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:var(--space-md);margin-bottom:var(--space-lg);">
          <div>
            <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Auto-Failover</h4>
            <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">If your preferred instance goes down, Streamkeeper automatically routes to a healthy backup.</p>
          </div>
          <div>
            <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Multi-Instance</h4>
            <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">Bundle multiple AIOStreams instances behind a single link. Streamkeeper distributes across your hosts.</p>
          </div>
          <div>
            <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Config Cache</h4>
            <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">Your addon config is cached and reinstalled on fallback hosts on the fly. No multi-host configuration needed.</p>
          </div>
        </div>
        <h4 style="margin-bottom:var(--space-sm);font-size:0.95rem;">How it works</h4>
        <ol style="color:var(--text-secondary);font-size:0.85rem;padding-left:1.25rem;">
          <li style="margin-bottom:var(--space-sm);">Create an AIOStreams manifest. I suggest <a href="https://duck-tools.pages.dev/quackstart/" target="_blank" style="color:var(--accent-gold);">Duck Streams</a>.</li>
          <li style="margin-bottom:var(--space-sm);">Log in to Streamkeeper and add your manifest URL.</li>
          <li style="margin-bottom:var(--space-sm);">Copy the generated Streamkeeper install URL.</li>
          <li>Install it into your streaming client (e.g., Stremio).</li>
        </ol>
      </div>
    </div>
  </div>

  <div id="passwordHelpModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Admin Password</h3>
        <button class="modal-close" data-modal="passwordHelpModal">&times;</button>
      </div>
      <div class="modal-body">
        <ol style="color:var(--text-secondary);font-size:0.85rem;padding-left:1.25rem;">
          <li style="margin-bottom:var(--space-sm);">Go to the <strong>Cloudflare Dashboard</strong></li>
          <li style="margin-bottom:var(--space-sm);">Navigate to <strong>Workers &amp; Pages</strong></li>
          <li style="margin-bottom:var(--space-sm);">Select your Streamkeeper worker</li>
          <li style="margin-bottom:var(--space-sm);">Go to <strong>Settings &rarr; Variables</strong></li>
          <li style="margin-bottom:var(--space-sm);">Add <code style="font-family:var(--font-mono);font-size:0.8rem;background:rgba(0,0,0,0.3);padding:0.15rem 0.35rem;border-radius:var(--radius-sm);">ADMIN_PASSWORD</code> as a secret with your chosen password</li>
          <li><strong>Save and Deploy</strong></li>
        </ol>
      </div>
    </div>
  </div>

  <script>
(function() {
const LS_AUTH_TOKEN = "aio_auth_token";
var loginForm = document.getElementById("loginForm");
var passwordInput = document.getElementById("passwordInput");
var loginBtn = document.getElementById("loginBtn");
var loginError = document.getElementById("loginError");

function showError(msg) {
  loginError.textContent = msg;
}

loginBtn.addEventListener("click", doLogin);
passwordInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  var password = passwordInput.value;
  if (!password) { showError("Password is required"); return; }
  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";
  try {
    var res = await fetch("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password }),
    });
    var data = await res.json();
    if (res.ok && data.token) {
      try { localStorage.setItem(LS_AUTH_TOKEN, data.token); } catch(e) {}
      window.location.href = "/dashboard";
    } else {
      showError("Invalid password");
    }
  } catch (e) {
    showError("Login failed: " + e.message);
  }
  loginBtn.disabled = false;
  loginBtn.textContent = "Login";
}

function openModal(id) {
  document.getElementById(id).style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

document.getElementById("whatIsLink").addEventListener("click", function(e) {
  e.preventDefault();
  openModal("whatIsModal");
});

document.getElementById("passwordHelpLink").addEventListener("click", function(e) {
  e.preventDefault();
  openModal("passwordHelpModal");
});

document.querySelectorAll(".modal-close").forEach(function(btn) {
  btn.addEventListener("click", function() {
    closeModal(this.dataset.modal);
  });
});

document.querySelectorAll(".modal").forEach(function(modal) {
  modal.addEventListener("click", function(e) {
    if (e.target === modal) closeModal(modal.id);
  });
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal").forEach(function(m) {
      if (m.style.display === "flex") closeModal(m.id);
    });
  }
});
})();
<\/script>
</body>
</html>`;
}
function dashboardPage(baseUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  ${pageHeadHtml("Dashboard")}
</head>
<body>
  <div class="container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">
      <h1 style="margin-bottom:0;display:flex;align-items:center;gap:var(--space-sm);">${mascotSmHtml()} Streamkeeper</h1>
      <div style="display:flex;gap:var(--space-sm);">
        <button id="newAccountBtn" class="btn btn-primary">+ New Account</button>
        <button id="logoutBtn" class="btn btn-secondary">Logout</button>
      </div>
    </div>

    ${newAccountModalHtml()}

    <h2 class="accounts-title">Accounts</h2>

    <div class="account-cards-grid" id="accountGrid">
    </div>
    ${confirmModalHtml()}
  </div>
  ${toastContainerHtml()}
  ${newAccountModalScript()}
  ${adminScript()}
</body>
</html>`;
}
export { mascotSmHtml, pageHeadHtml, htmlEsc, confirmModalHtml, toastContainerHtml, newAccountModalHtml, newAccountModalScript, accountCardHtml, statelessSetupPage, statelessManagePage, landingPage, dashboardPage };

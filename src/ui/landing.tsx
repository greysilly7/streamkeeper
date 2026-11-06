// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { type Html, html, rawHtml } from "./jsx";
import { MascotSm, PageHead } from "./shared";

export function LandingPage(): Html {
  return (
    <html lang="en">
      <head>
        <PageHead title="Streamkeeper" />
      </head>
      <body>
        <div class="login-wrapper">
          <div class="glass-card login-card">
            <MascotSm />
            <h1 class="gradient-text">Streamkeeper</h1>
            <a href="#whatIsModal" id="whatIsLink" class="info-link">
              What is Streamkeeper?
            </a>
            <div id="loginForm">
              <div class="form-group">
                <label for="passwordInput">Password</label>
                <input
                  type="password"
                  id="passwordInput"
                  placeholder="Enter admin password"
                  autocomplete="current-password"
                />
              </div>
              <a href="#passwordHelpModal" id="passwordHelpLink" class="info-link">
                Don't have a password?
              </a>
              <button type="button" id="loginBtn" class="btn btn-primary">
                Login
              </button>
              <div id="loginError" class="login-error" />
            </div>
            <a href="/setup?source=aiometadata" class="info-link" style="display:block;margin-top:var(--space-md);">
              Create an AIOMetadata failover link <small>(beta)</small>
            </a>
          </div>
        </div>
        <div id="whatIsModal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <div>
                <h3>What is Streamkeeper?</h3>
                <p style="color:var(--text-secondary);font-size:0.85rem;margin:0;margin-top:2px;">
                  100% AIOStreams Uptime.
                </p>
              </div>
              <button type="button" class="modal-close" data-modal="whatIsModal">
                ×
              </button>
            </div>
            <div class="modal-body">
              <div style="display:flex;flex-direction:column;gap:var(--space-md);margin-bottom:var(--space-lg);">
                <div>
                  <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Auto-Failover</h4>
                  <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">
                    If your preferred instance goes down, Streamkeeper automatically routes to a healthy backup.
                  </p>
                </div>
                <div>
                  <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Multi-Instance</h4>
                  <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">
                    Bundle multiple AIOStreams instances behind a single link. Streamkeeper distributes across your
                    hosts.
                  </p>
                </div>
                <div>
                  <h4 style="margin-bottom:var(--space-xs);font-size:0.95rem;">Config Cache</h4>
                  <p style="color:var(--text-secondary);font-size:0.85rem;line-height:1.5;">
                    Your addon config is cached and reinstalled on fallback hosts on the fly. No multi-host
                    configuration needed.
                  </p>
                </div>
              </div>
              <h4 style="margin-bottom:var(--space-sm);font-size:0.95rem;">How it works</h4>
              <ol style="color:var(--text-secondary);font-size:0.85rem;padding-left:1.25rem;">
                <li style="margin-bottom:var(--space-sm);">
                  Create an AIOStreams manifest. I suggest{" "}
                  <a
                    href="https://duck-tools.pages.dev/quackstart/"
                    target="_blank"
                    rel="noopener"
                    style="color:var(--accent-gold);"
                  >
                    Duck Streams
                  </a>
                  .
                </li>
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
              <button type="button" class="modal-close" data-modal="passwordHelpModal">
                ×
              </button>
            </div>
            <div class="modal-body">
              <ol style="color:var(--text-secondary);font-size:0.85rem;padding-left:1.25rem;">
                <li style="margin-bottom:var(--space-sm);">
                  Go to the <strong>Cloudflare Dashboard</strong>
                </li>
                <li style="margin-bottom:var(--space-sm);">
                  Navigate to <strong>Workers &amp; Pages</strong>
                </li>
                <li style="margin-bottom:var(--space-sm);">Select your Streamkeeper worker</li>
                <li style="margin-bottom:var(--space-sm);">
                  Go to <strong>Settings → Variables</strong>
                </li>
                <li style="margin-bottom:var(--space-sm);">
                  Add{" "}
                  <code style="font-family:var(--font-mono);font-size:0.8rem;background:rgba(0,0,0,0.3);padding:0.15rem 0.35rem;border-radius:var(--radius-sm);">
                    ADMIN_PASSWORD
                  </code>{" "}
                  as a secret with your chosen password
                </li>
                <li>
                  <strong>Save and Deploy</strong>
                </li>
              </ol>
            </div>
          </div>
        </div>
        {rawHtml(landingScript())}
      </body>
    </html>
  );
}

export function landingScript(): string {
  return `<script>
(function() {
const LS_AUTH_TOKEN = "aio_auth_token";
var loginForm = document.getElementById("loginForm");
var passwordInput = document.getElementById("passwordInput");
var loginBtn = document.getElementById("loginBtn");
var loginError = document.getElementById("loginError");
function showError(msg) { loginError.textContent = msg; }
loginBtn.addEventListener("click", doLogin);
passwordInput.addEventListener("keydown", function(e) { if (e.key === "Enter") doLogin(); });
async function doLogin() {
  var password = passwordInput.value;
  if (!password) { showError("Password is required"); return; }
  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";
  try {
    var res = await fetch("/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: password }) });
    var data = await res.json();
    if (res.ok && data.token) { try { localStorage.setItem(LS_AUTH_TOKEN, data.token); } catch(e) {} window.location.href = "/dashboard"; }
    else showError("Invalid password");
  } catch (e) { showError("Login failed: " + e.message); }
  loginBtn.disabled = false;
  loginBtn.textContent = "Login";
}
function openModal(id) { document.getElementById(id).style.display = "flex"; }
function closeModal(id) { document.getElementById(id).style.display = "none"; }
document.getElementById("whatIsLink").addEventListener("click", function(e) { e.preventDefault(); openModal("whatIsModal"); });
document.getElementById("passwordHelpLink").addEventListener("click", function(e) { e.preventDefault(); openModal("passwordHelpModal"); });
document.querySelectorAll(".modal-close").forEach(function(btn) { btn.addEventListener("click", function() { closeModal(this.dataset.modal); }); });
document.querySelectorAll(".modal").forEach(function(modal) { modal.addEventListener("click", function(e) { if (e.target === modal) closeModal(modal.id); }); });
document.addEventListener("keydown", function(e) { if (e.key === "Escape") document.querySelectorAll(".modal").forEach(function(m) { if (m.style.display === "flex") closeModal(m.id); }); });
})();
</script>`;
}

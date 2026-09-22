function adminScript() {
  return `<script>
(function() {
const LS_AUTH_TOKEN = "aio_auth_token";

var AdminConsole = (function() {

function AdminConsole() {
  this.token = null;
  this.init();
}

AdminConsole.prototype.init = function() {
  this.captureRefs();
  this.initAuth();
  this.bindEvents();
  this.bindGridDelegation();
};

AdminConsole.prototype.captureRefs = function() {
  this.refs = {
    logoutBtn: document.getElementById("logoutBtn"),
    newAccountBtn: document.getElementById("newAccountBtn"),
    accountGrid: document.getElementById("accountGrid"),

    toastContainer: document.getElementById("toastContainer"),
  };
};

AdminConsole.prototype.getToken = function() {
  if (this.token) return this.token;
  try { return localStorage.getItem(LS_AUTH_TOKEN) || null; }
  catch(e) { return null; }
};

AdminConsole.prototype.setToken = function(token) {
  this.token = token;
  try { localStorage.setItem(LS_AUTH_TOKEN, token); } catch(e) {}
};

AdminConsole.prototype.clearToken = function() {
  this.token = null;
  try { localStorage.removeItem(LS_AUTH_TOKEN); } catch(e) {}
};

AdminConsole.prototype.authHeaders = function(extra) {
  var headers = extra || {};
  headers["Authorization"] = "Bearer " + this.getToken();
  return headers;
};

AdminConsole.prototype.logout = function() {
  var self = this;
  this.clearToken();
  fetch("/admin/logout", { method: "POST" })
    .catch(function() {})
    .then(function() { window.location.href = "/"; });
};

AdminConsole.prototype.initAuth = function() {
  var self = this;
  var token = this.getToken();
  if (!token) { window.location.href = "/"; return; }
  fetch("/admin/accounts", { headers: this.authHeaders() })
    .then(function(res) {
      if (res.ok) { self.setToken(token); self.refreshGrid(); }
      else { self.clearToken(); window.location.href = "/"; }
    })
    .catch(function() { window.location.href = "/"; });
};

AdminConsole.prototype.refreshGrid = async function() {
  try {
    var res = await fetch("/accounts/partial", { headers: this.authHeaders() });
    if (!res.ok) return;
    var html = await res.text();
    if (this.refs.accountGrid) {
      this.refs.accountGrid.innerHTML = html;
      return;
    }
  } catch (e) {
    console.error("Grid refresh failed:", e);
  }
  location.reload();
};

AdminConsole.prototype.showToast = function(message, type) {
  if (!this.refs.toastContainer) return;
  type = type || "info";
  var toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.textContent = message;
  this.refs.toastContainer.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 300ms ease";
    setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, 3000);
};

AdminConsole.prototype.modalShow = function(modal) {
  if (modal) modal.style.display = "flex";
};

AdminConsole.prototype.modalHide = function(modal) {
  if (modal) modal.style.display = "none";
};

AdminConsole.prototype.bindEvents = function() {
  var self = this;

  if (this.refs.logoutBtn) {
    this.refs.logoutBtn.addEventListener("click", function() { self.logout(); });
  }

  if (this.refs.newAccountBtn) {
    this.refs.newAccountBtn.addEventListener("click", function() {
      var openModal = window.__openNewAccountModal;
      if (openModal) openModal();
    });
  }

  document.addEventListener("click", function(e) {
    var copyBtn = e.target.closest(".copy-btn");
    if (!copyBtn) return;
    var targetId = copyBtn.dataset.target;
    var input = document.getElementById(targetId);
    if (!input) return;
    (async function() {
      try {
        await navigator.clipboard.writeText(input.value);
      } catch(e) {
        input.select();
        document.execCommand("copy");
      }
      copyBtn.classList.add("copied");
      copyBtn.textContent = "Copied!";
      setTimeout(function() {
        copyBtn.classList.remove("copied");
        copyBtn.textContent = "Copy";
      }, 1500);
    })();
  });
};

AdminConsole.prototype.bindGridDelegation = function() {
  var self = this;
  if (!this.refs.accountGrid) return;
  this.refs.accountGrid.addEventListener("click", function(e) {
    var manageBtn = e.target.closest(".manage-btn");
    if (manageBtn) {
      var uuid = manageBtn.dataset.uuid;
      window.location.href = "/dashboard/account/" + uuid;
      return;
    }
  });
};

return AdminConsole;
})();

window.__streamkeeperAdmin = new AdminConsole();
})();
<\/script>`;
}


export { adminScript };

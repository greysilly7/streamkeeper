import { AIOMETADATA_HOSTS, HOSTS } from "../installer";
import { adminScript } from "./admin";
import { NewAccountModal, newAccountModalScript } from "./account";
// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { type Html, html, rawHtml } from "./jsx";
import { ConfirmModal, MascotSm, PageHead, ToastContainer } from "./shared";

export function DashboardPage({
  aiostreamsHosts = HOSTS,
  aiometadataHosts = AIOMETADATA_HOSTS,
}: {
  aiostreamsHosts?: string[];
  aiometadataHosts?: string[];
}): Html {
  return (
    <html lang="en">
      <head>
        <PageHead title="Dashboard" />
      </head>
      <body>
        <div class="container">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-md);">
            <h1 style="margin-bottom:0;display:flex;align-items:center;gap:var(--space-sm);">
              <MascotSm /> Streamkeeper
            </h1>
            <div style="display:flex;gap:var(--space-sm);">
              <button type="button" id="newAccountBtn" class="btn btn-primary">
                + New Account
              </button>
              <button type="button" id="logoutBtn" class="btn btn-secondary">
                Logout
              </button>
            </div>
          </div>
          <NewAccountModal aiostreamsHosts={aiostreamsHosts} aiometadataHosts={aiometadataHosts} />
          <h2 class="accounts-title">Accounts</h2>
          <div class="account-cards-grid" id="accountGrid" />
          <ConfirmModal />
        </div>
        <ToastContainer />
        {rawHtml(newAccountModalScript())}
        {rawHtml(adminScript())}
      </body>
    </html>
  );
}

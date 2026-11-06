import { AIOMETADATA_HOSTS, HOSTS } from "../installer";
import type { AccountRecord, JsonData, Source, StatelessTokenPayload } from "../types";
import { AccountCard, NewAccountModal, newAccountModalScript } from "./account";
import { DashboardPage } from "./dashboard";
import { LandingPage } from "./landing";
import { renderHtml, type Html } from "./jsx";
import { ManagePage } from "./manage";
import { SetupPage } from "./setup";
import { ConfirmModal, MascotSm, PageHead, ToastContainer } from "./shared";

function htmlEsc(value: JsonData | undefined): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPage(page: Html): string {
  return `<!doctype html>${renderHtml(page)}`;
}

function mascotSmHtml(): string {
  return renderHtml(MascotSm());
}

function pageHeadHtml(title: string, extraStyles = ""): string {
  return renderHtml(PageHead({ title, extraStyles }));
}

function confirmModalHtml(): string {
  return renderHtml(ConfirmModal());
}

function toastContainerHtml(): string {
  return renderHtml(ToastContainer());
}

function newAccountModalHtml(aiostreamsHosts = HOSTS, aiometadataHosts = AIOMETADATA_HOSTS): string {
  return renderHtml(NewAccountModal({ aiostreamsHosts, aiometadataHosts }));
}

function accountCardHtml(account: AccountRecord, index: number): string {
  return renderHtml(AccountCard({ account, index }));
}

function statelessSetupPage(source: Source = "aiostreams", hosts?: string[]): string {
  return renderPage(SetupPage({ source, ...(hosts === undefined ? {} : { hosts }) }));
}

function statelessManagePage(payload: StatelessTokenPayload): string {
  return renderPage(ManagePage({ payload }));
}

function landingPage(): string {
  return renderPage(LandingPage());
}

function dashboardPage(aiostreamsHosts = HOSTS, aiometadataHosts = AIOMETADATA_HOSTS): string {
  return renderPage(DashboardPage({ aiostreamsHosts, aiometadataHosts }));
}

export {
  accountCardHtml,
  confirmModalHtml,
  dashboardPage,
  htmlEsc,
  landingPage,
  mascotSmHtml,
  newAccountModalHtml,
  newAccountModalScript,
  pageHeadHtml,
  statelessManagePage,
  statelessSetupPage,
  toastContainerHtml,
};

import type { AccountRecord, Source, StatelessTokenPayload } from "../types";
import { AccountCard } from "./account";
import { DashboardPage } from "./dashboard";
import { ManagePage } from "./manage";
import { renderHtml, type Html } from "./jsx";
import { SetupPage } from "./setup";

function renderPage(page: Html): string {
  return `<!doctype html>${renderHtml(page)}`;
}

export function accountCardHtml(account: AccountRecord, index: number): string {
  return renderHtml(AccountCard({ account, index }));
}

export function statelessSetupPage(source: Source = "aiostreams", hosts?: string[]): string {
  return renderPage(SetupPage({ source, ...(hosts === undefined ? {} : { hosts }) }));
}

export function statelessManagePage(payload: StatelessTokenPayload): string {
  return renderPage(ManagePage({ payload }));
}

export function dashboardPage(aiostreamsHosts: string[], aiometadataHosts: string[]): string {
  return renderPage(DashboardPage({ aiostreamsHosts, aiometadataHosts }));
}

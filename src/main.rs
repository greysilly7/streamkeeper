use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Html,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{env, net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};

const DEFAULT_REFRESH_SECS: u64 = 2 * 60 * 60;

#[derive(Clone)]
struct AppState {
    client: Client,
    config: Arc<RwLock<Option<Config>>>,
    cache: Arc<RwLock<CacheEntry>>,
    admin_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Config {
    manifest_url: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    mirrors: Vec<String>,
    #[serde(default = "default_refresh")]
    refresh_seconds: u64,
}

fn default_refresh() -> u64 { DEFAULT_REFRESH_SECS }

#[derive(Clone, Debug, Default, Serialize)]
struct CacheEntry {
    manifest: Option<serde_json::Value>,
    fetched_at: Option<DateTime<Utc>>,
    source: Option<String>,
    last_error: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    cached: bool,
    fetched_at: Option<DateTime<Utc>>,
    source: Option<String>,
    last_error: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse { error: String }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(env::var("RUST_LOG").unwrap_or_else(|_| "aiostreams_keeper=info,tower_http=info".into()))
        .init();

    let state = AppState {
        client: Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(30)).build()?,
        config: Arc::new(RwLock::new(config_from_env()?)),
        cache: Arc::new(RwLock::new(CacheEntry::default())),
        admin_token: env::var("KEEPER_ADMIN_TOKEN").ok(),
    };
    let refresh_state = state.clone();
    tokio::spawn(async move { refresh_loop(refresh_state).await });

    let app = Router::new()
.route("/", get(index))
        .route("/healthz", get(healthz))
        .route("/status", get(status))
        .route("/manifest.json", get(manifest))
        .route("/api/config", post(update_config))
        .with_state(state)
        .layer(TraceLayer::new_for_http());
    let addr: SocketAddr = env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into()).parse()?;
    info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn config_from_env() -> anyhow::Result<Option<Config>> {
    let Some(url) = env::var("AIOSTREAMS_MANIFEST_URL").ok() else { return Ok(None) };
    Ok(Some(Config {
        manifest_url: url,
        password: env::var("AIOSTREAMS_PASSWORD").ok(),
        mirrors: env::var("AIOSTREAMS_MIRRORS").unwrap_or_default().split(',').filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_owned()).collect(),
        refresh_seconds: env::var("REFRESH_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_REFRESH_SECS),
    }))
}

async fn refresh_loop(state: AppState) {
    loop {
        if let Err(err) = refresh(&state).await { warn!(%err, "manifest refresh failed") }
        let seconds = state.config.read().await.as_ref().map(|c| c.refresh_seconds).unwrap_or(DEFAULT_REFRESH_SECS).max(30);
        tokio::time::sleep(Duration::from_secs(seconds)).await;
    }
}

async fn refresh(state: &AppState) -> anyhow::Result<()> {
    let Some(config) = state.config.read().await.clone() else { return Ok(()) };
    let mut sources = vec![config.manifest_url.clone()];
    sources.extend(config.mirrors.iter().cloned());
    let mut failures = Vec::new();
    for source in sources {
        match fetch_manifest(state, &config, &source).await {
            Ok(manifest) => {
                let now = Utc::now();
                *state.cache.write().await = CacheEntry { manifest: Some(manifest.clone()), fetched_at: Some(now), source: Some(source.clone()), last_error: None };
                info!(%source, "manifest refreshed");
                mirror_manifest(state, &config, &manifest).await;
                return Ok(());
            }
            Err(err) => { warn!(%source, %err, "upstream unavailable"); failures.push(format!("{source}: {err}")); }
        }
    }
    state.cache.write().await.last_error = Some(failures.join("; "));
    anyhow::bail!("all upstreams failed")
}

async fn fetch_manifest(state: &AppState, config: &Config, source: &str) -> anyhow::Result<serde_json::Value> {
    let mut request = state.client.get(source).header("accept", "application/json");
    if let Some(password) = &config.password {
        request = request.header("authorization", format!("Bearer {password}")).header("x-aiostreams-password", password);
    }
    let response = request.send().await?.error_for_status()?;
    Ok(response.json().await?)
}

async fn mirror_manifest(state: &AppState, config: &Config, manifest: &serde_json::Value) {
    for mirror in &config.mirrors {
        let mut request = state.client.post(mirror).json(manifest);
        if let Some(password) = &config.password { request = request.header("authorization", format!("Bearer {password}")).header("x-aiostreams-password", password); }
        match request.send().await {
            Ok(response) => {
                if let Err(err) = response.error_for_status() { warn!(%mirror, %err, "mirror update failed"); }
            }
            Err(err) => warn!(%mirror, %err, "mirror update failed"),
        }
    }
}


async fn index() -> Html<&'static str> {
    Html("<!doctype html><html><head><meta charset=\"utf-8\"><title>AIOStreams Keeper</title></head><body><h1>AIOStreams Keeper</h1><p>Resilient manifest cache and mirror service.</p><p><a href=\"/manifest.json\">Cached manifest</a> · <a href=\"/status\">Status</a></p></body></html>")
}
async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    let healthy = state.cache.read().await.manifest.is_some();
    if healthy { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE }
}

async fn status(State(state): State<AppState>) -> Json<StatusResponse> {
    let cache = state.cache.read().await;
    Json(StatusResponse { cached: cache.manifest.is_some(), fetched_at: cache.fetched_at, source: cache.source.clone(), last_error: cache.last_error.clone() })
}

async fn manifest(State(state): State<AppState>) -> impl IntoResponse {
    match state.cache.read().await.manifest.clone() {
        Some(value) => (StatusCode::OK, Json(value)).into_response(),
        None => (StatusCode::SERVICE_UNAVAILABLE, Json(ErrorResponse { error: "manifest is not cached".into() })).into_response(),
    }
}

async fn update_config(State(state): State<AppState>, headers: HeaderMap, Json(config): Json<Config>) -> impl IntoResponse {
    if let Some(expected) = &state.admin_token {
        let authorized = headers.get("authorization").and_then(|v| v.to_str().ok()).map(|v| v.strip_prefix("Bearer ")).flatten() == Some(expected.as_str());
        if !authorized {
            return (StatusCode::UNAUTHORIZED, Json(ErrorResponse { error: "admin authorization required".into() })).into_response();
        }
    }
    if url::Url::parse(&config.manifest_url).is_err() || config.mirrors.iter().any(|u| url::Url::parse(u).is_err()) {
        return (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "manifest_url and mirrors must be valid URLs".into() })).into_response();
    }
    *state.config.write().await = Some(config);
    if let Err(err) = refresh(&state).await { error!(%err, "initial refresh failed after config update"); }
    StatusCode::ACCEPTED.into_response()
}

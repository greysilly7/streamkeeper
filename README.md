# Streamkeeper

Resilient addon routing for [AIOStreams](https://github.com/Viren070/AIOStreams): keep one preferred instance ready and fail over to the rest when it goes down. Stateless install links — your configuration is encrypted into the link itself, no server-side account storage.

Source: <https://github.com/greysilly7/streamkeeper> · License: [GPLv3](LICENSE)

## Deploy

```bash
npm install
npx wrangler kv namespace list       # confirm the AIO_KV id in wrangler.toml exists
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put PASSWORD_ENCRYPTION_KEY
npm run deploy
```

`ADMIN_PASSWORD` gates the dashboard; `PASSWORD_ENCRYPTION_KEY` seals install links and stored passwords. Set the encryption key once — rotating it invalidates every link you've distributed. `HOSTS` (optional) overrides the default instance pool.

## Privacy

Be aware before installing others on this:

- Your AIOStreams configuration — including any third-party API keys (Torrentio, debrid services, etc.) — is encrypted into the install link itself (AES-GCM, keyed by `PASSWORD_ENCRYPTION_KEY`). It is used only to restore your setup on a fallback host when your preferred instance is down.
- The server does not retain plaintext configurations at rest.
- Changing your AIOStreams configuration? Remake your link — fallbacks restore the configuration from when the link was created, not your latest one.
- Anyone who holds an install link can use it and see the addon configuration for that account. Treat links as secrets; revoke them through the operator's dashboard.
- All addon traffic passes through the hosted Cloudflare worker, so the operator can observe volume (paths are logged without credentials).
- This is open source — audit it, or self-host it and change nothing about how it works.

## Support

Using [TorBox](https://torbox.app)? A [referral link](https://torbox.app/subscription?referral=97a1fa98-0aa9-4db5-8a20-f605ef629a2a) on signup helps keep this project going — costs you nothing.
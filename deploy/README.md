# Deploying the hosted instance

The hosted Aegis (`https://aegis.nabhanyubm.tech`, API `https://api.aegis.nabhanyubm.tech`) is one Ubuntu 24.04 host
running the release tag under PM2 behind nginx with a Let's Encrypt certificate. Design and trade-offs: `Decisions.md`
D-081; the trust boundary it lives behind: `Architecture.md §11` and D-080.

Prerequisites: PostgreSQL bootstrapped (`scripts/bootstrap-system.sh`), DNS A records for both hostnames at the host,
the security group open on 80 and 443, Node 24 via nvm.

1. **Checkout.** Copy or clone the release into its own directory (the dev tree keeps its own `.env` and ports):
   `cp -r RazorpayAIBuildathon AegisProd-RazorpayAIBuildathon && cd AegisProd-RazorpayAIBuildathon`. This is the only
   step that copies `.env`; from here on the two trees' `.env` files are independent and `deploy/sync-prod.sh` keeps
   them that way.
2. **`.env`.** `NEXT_PUBLIC_API_URL=https://api.aegis.nabhanyubm.tech`, `WEB_ORIGIN=https://aegis.nabhanyubm.tech`,
   `API_HOST=127.0.0.1`, `TRUST_PROXY=loopback`, a fresh `RAZORPAY_WEBHOOK_SECRET` and `X402_SIM_SECRET`, the model
   keys. `NODE_ENV` stays `development` on purpose: C-D5 keeps the simulator out of production mode and the
   dashboard's *Run demo* needs it — the instance is an evaluator sandbox and its environment pill says so.
3. **Build.** `bash deploy/sync-web-env.sh && pnpm --filter @aegis/web build` (Next.js only reads `apps/web/.env*`).
4. **Processes.** `npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save` — API on 127.0.0.1:4000, web on 127.0.0.1:3000.
5. **nginx + TLS + boot unit (the one sudo step).** `sudo bash deploy/setup-server.sh`.
6. **Verify.** `TestChecklist.md` → "Deploy — hosted instance".

Redeploy: `bash deploy/sync-prod.sh` from the dev checkout (mirror + step 3 in one; `--dry-run` first if you want
to see what `--delete` would remove), then `pnpm install && pnpm --filter @aegis/web build && pm2 restart
ecosystem.config.js` in the production tree. Never mirror `.env` from dev — that script excludes it, along with
`logs/`, `backups/` and the build, because the production tree owns them (D-088, B-029). Rollback: `pm2 stop all`
(nginx answers 502) or check out the previous tag and repeat step 3. Both trees share the one PostgreSQL database, so
only one API may run at a time — port 4000 is the lock.

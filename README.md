# Daniel Burden — portfolio

Cloudflare Worker + static assets + D1 content store + R2 image storage.

## Deploy checklist

1. Create a Cloudflare D1 database named `daniel-burden-content`.
2. Create an R2 bucket named `daniel-burden-media`.
3. Put the D1 database UUID in `wrangler.jsonc` (replace the placeholder).
4. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAIL` in `wrangler.jsonc` or as Worker variables.
5. Install and deploy:
   ```sh
   npm install
   npx wrangler d1 migrations apply daniel-burden-content --remote
   npx wrangler deploy
   ```
6. In Cloudflare Zero Trust → Access → Applications, create a self-hosted application for `/admin*` and `/api/admin/*` on your hostname. Allow only your email address. Copy the Access application AUD tag and team domain into the Worker variables.
7. Add `danielburden.uk` as a custom domain for the Worker in Cloudflare. Cloudflare will show the DNS records it needs.

The public website reads content from `/api/content`. The admin editor is at `/admin`; saves go to D1 and images go to R2. Admin API requests verify Cloudflare Access JWTs and the configured email.

**Security:** never commit Cloudflare account tokens or secrets. Keep this repository private. The Access application must protect both `/admin*` and `/api/admin/*`.

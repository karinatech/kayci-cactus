# Kayci Cactus

Arizona-themed massage booking site for Kayci Sonoran.

- Public site: `public/index.html`
- Admin portal: `/admin.html`
- Local API: `server.js`
- Production API: `lambda/` (API Gateway + DynamoDB)
- **Google Calendar** is the source of truth for hours and appointments. See [GOOGLE_CALENDAR.md](GOOGLE_CALENDAR.md).

## Admin portal

| Tab | What you can do |
|-----|------------------|
| Appointments | Confirm/cancel bookings, open events in Google Calendar |
| Calendar | See Google connection status, Block Time, Mark Day Off |
| Waitlist | Confirm/decline waitlist requests, assign a time |
| Services | Add, edit, reorder (↑↓), hide (👁), delete (🗑) services, upload pictures (📷) |
| Website | Edit all site text (hero, about, booking banner, footer) and accent colors |

Services and website text live in DynamoDB, so changes appear on the public site instantly — no redeploy needed. Images uploaded from the admin portal are stored in the `kayci-cactus-media-*` S3 bucket (created by `deploy/cloudformation.yaml` — run a stack update once for the media bucket to exist).

## Deploying

- **Website** changes: push to `main` — Amplify auto-builds.
- **API** changes: redeploy the Lambda zip with `./scripts/deploy-lambda.sh` (see GOOGLE_CALENDAR.md §6).
- **Infra** (media bucket, new env vars): `aws cloudformation deploy --template-file deploy/cloudformation.yaml --stack-name <your-stack> --capabilities CAPABILITY_IAM`

```bash
cp .env.example .env
npm install
npm run dev
```

Then open http://localhost:3300

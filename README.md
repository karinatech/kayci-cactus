# Kayci Cactus

Arizona-themed massage booking site for Kayci Sonoran.

- Public site: `public/index.html`
- Admin portal: `/admin.html`
- Local API: `server.js`
- Production API: `lambda/` (API Gateway + DynamoDB)
- **Google Calendar** is the source of truth for hours and appointments. See [GOOGLE_CALENDAR.md](GOOGLE_CALENDAR.md).

```bash
cp .env.example .env
npm install
npm run dev
```

Then open http://localhost:3300

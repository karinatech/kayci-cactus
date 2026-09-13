# Google Calendar setup

Kayci Cactus uses Google Calendar as the source of truth for open hours and appointments.

- Clients book on the website.
- The API checks free/busy on your calendar, then creates an event.
- Personal events can block slots if you add those calendars to `GOOGLE_FREEBUSY_CALENDARS`.
- Waitlist and service copy stay in the app (memory locally, DynamoDB in production).

## 1. Create a booking calendar

In Google Calendar:

1. Create a calendar named **Kayci Bookings**.
2. Copy the calendar ID (Calendar settings → Integrate calendar).
3. Put it in `GOOGLE_CALENDAR_ID`.

Keep personal plans on a different calendar. Add `primary` to `GOOGLE_FREEBUSY_CALENDARS` if you also want dentist appointments and family events to hide booking slots.

## 2. Enable the API

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable **Google Calendar API**.
4. Configure the OAuth consent screen (External is fine for a solo studio; add yourself as a test user).

## 3. Choose an auth style

### Option A — OAuth refresh token (recommended)

Works with a normal Gmail account. Events are created as you.

1. Create an OAuth client of type **Desktop app**.
2. Copy the client ID and secret into `.env`.
3. Run:

```bash
cp .env.example .env
npm install
node scripts/google-oauth.js
```

4. Paste `GOOGLE_REFRESH_TOKEN` into `.env`.

Set `GOOGLE_ADD_ATTENDEES=true` if you want the client added as a calendar guest (they get a Google invite). Keep it `false` if you only want your own confirmation emails.

### Option B — Service account

1. Create a service account and download the JSON key.
2. Set `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` (keep the `\n` newlines).
3. Share **Kayci Bookings** with that service account email, permission **Make changes to events**.

Service accounts cannot invite attendees unless you use Workspace domain-wide delegation. Leave `GOOGLE_ADD_ATTENDEES=false`.

## 4. Weekly hours

Default is Mon–Fri 9–6 and Sat 9–4 Phoenix time, Sunday closed. Override with:

```bash
GOOGLE_WORKING_HOURS={"0":null,"1":["09:00","18:00"],"2":["09:00","18:00"],"3":["09:00","18:00"],"4":["09:00","18:00"],"5":["09:00","18:00"],"6":["09:00","16:00"]}
```

Slots are duration-aware. A 75 minute Desert Stone will not be offered if it would run into a busy block or past close. A 15 minute buffer is added after each booking so cleanup time stays free.

## 5. Local run

```bash
npm install
npm run dev
```

Open http://localhost:3300 — Book Appointment. If Google env vars are missing, the old in-memory availability still works so the site does not crash.

Admin → Calendar shows connection status, upcoming events from Google, and a form to block time (PTO, lunch, early close).

## 6. Production / Lambda

Set the same env vars on the Lambda function. Redeploy `lambda.zip` including `googleCalendar.js` and `node_modules` (`google-auth-library`).

Do not commit `.env` or the service-account JSON key.

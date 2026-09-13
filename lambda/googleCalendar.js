'use strict';

const { JWT, OAuth2Client } = require('google-auth-library');

const TIMEZONE = (process.env.GOOGLE_TIMEZONE || 'America/Phoenix').trim() || 'America/Phoenix';
const TZ_OFF_RAW = (process.env.GOOGLE_TZ_OFFSET || '-07:00').trim();
// Normalize to RFC3339 offset "-07:00" even if set as "-0700" or "-7:00".
const _tzm = Tel => { const m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(Tel); return m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3]}` : Tel; };
const TZ_OFFSET = _tzm(TZ_OFF_RAW);
const BUFFER_MIN = Number(process.env.GOOGLE_BUFFER_MINUTES || 15);
const SLOT_STEP_MIN = Number(process.env.GOOGLE_SLOT_STEP_MINUTES || 30);

// Default studio hours in America/Phoenix. Override with GOOGLE_WORKING_HOURS JSON.
// Keys are JS weekday numbers: 0=Sun … 6=Sat. null = closed.
const DEFAULT_HOURS = {
  0: null,
  1: ['09:00', '18:00'],
  2: ['09:00', '18:00'],
  3: ['09:00', '18:00'],
  4: ['09:00', '18:00'],
  5: ['09:00', '18:00'],
  6: ['09:00', '16:00'],
};

function authMode() {
  if (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return 'oauth';
  }
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID) {
    return 'service_account';
  }
  return null;
}

function configured() {
  return Boolean(authMode() && process.env.GOOGLE_CALENDAR_ID);
}

function bookingCalendarId() {
  return (process.env.GOOGLE_CALENDAR_ID || '').trim();
}

function freeBusyCalendarIds() {
  const extra = process.env.GOOGLE_FREEBUSY_CALENDARS || '';
  const ids = [bookingCalendarId(), ...extra.split(',').map((s) => s.trim()).filter(Boolean)];
  return [...new Set(ids.filter(Boolean))];
}

function workingHours() {
  if (process.env.GOOGLE_WORKING_HOURS) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_WORKING_HOURS);
      const normalized = {};
      Object.keys(parsed).forEach((k) => {
        normalized[Number(k)] = parsed[k];
      });
      return normalized;
    } catch (err) {
      console.log('Invalid GOOGLE_WORKING_HOURS:', err.message);
    }
  }
  return DEFAULT_HOURS;
}

function parseDurationMinutes(duration) {
  if (typeof duration === 'number' && Number.isFinite(duration)) return duration;
  const match = String(duration || '60').match(/(\d+)/);
  return match ? Number(match[1]) : 60;
}

function to24h(timeLabel) {
  if (/^\d{2}:\d{2}$/.test(timeLabel)) return timeLabel;
  const match = String(timeLabel || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return '09:00';
  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

function toLabel(hhmm) {
  const [hour, minute] = to24h(hhmm).split(':').map(Number);
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

function dateWeekday(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function phoenixDateTime(dateStr, hhmm) {
  return `${dateStr}T${to24h(hhmm)}:00${TZ_OFFSET}`;
}

function addMinutes(hhmm, mins) {
  const [hour, minute] = to24h(hhmm).split(':').map(Number);
  const total = hour * 60 + minute + mins;
  const nextHour = Math.floor(total / 60);
  const nextMinute = ((total % 60) + 60) % 60;
  return `${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`;
}

function hhmmToMin(hhmm) {
  const [hour, minute] = to24h(hhmm).split(':').map(Number);
  return hour * 60 + minute;
}

let authClient;
function getAuthClient() {
  if (authClient) return authClient;
  const mode = authMode();
  if (mode === 'oauth') {
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    authClient = client;
    return authClient;
  }
  if (mode === 'service_account') {
    authClient = new JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject: process.env.GOOGLE_IMPERSONATE_USER || undefined,
    });
    return authClient;
  }
  throw new Error('Google Calendar is not configured');
}

async function accessToken() {
  const client = getAuthClient();
  const token = await client.getAccessToken();
  return token.token || token;
}

async function gfetch(url, options = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw };
  }
  if (!response.ok) {
    let message = (body && body.error && body.error.message) || raw || response.statusText;
    if (body && body.error && Array.isArray(body.error.errors) && body.error.errors.length) {
      message += ' | ' + body.error.errors.map((e) => `${e.location || e.parameter || e.field || ''}: ${e.reason || e.message}`).join('; ');
    }
    console.error('Google Calendar API error body:', JSON.stringify(body));
    const error = new Error(`Google Calendar API ${response.status}: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function getBusyIntervals(dateStr) {
  const data = await gfetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: phoenixDateTime(dateStr, '00:00'),
      timeMax: phoenixDateTime(dateStr, '23:59'),
      timeZone: TIMEZONE,
      items: freeBusyCalendarIds().map((id) => ({ id })),
    }),
  });

  const busy = [];
  const calendars = data.calendars || {};
  Object.keys(calendars).forEach((id) => {
    if (calendars[id].errors) {
      console.log('freeBusy errors for', id, calendars[id].errors);
      return;
    }
    (calendars[id].busy || []).forEach((block) => {
      busy.push({ start: Date.parse(block.start), end: Date.parse(block.end) });
    });
  });
  return busy;
}

function overlaps(startMs, endMs, busy) {
  return busy.some((block) => startMs < block.end && endMs > block.start);
}

async function getAvailableSlots(dateStr, durationMinutes) {
  const hours = workingHours();
  const window = hours[dateWeekday(dateStr)];
  if (!window) {
    return {
      date: dateStr,
      available: [],
      booked: [],
      openHours: [],
      source: 'google',
      closed: true,
      timezone: TIMEZONE,
    };
  }

  const [workStart, workEnd] = window;
  const duration = durationMinutes || 60;
  const busy = await getBusyIntervals(dateStr);
  const available = [];
  const booked = [];

  let cursor = workStart;
  const lastStartMin = hhmmToMin(workEnd) - duration;
  while (hhmmToMin(cursor) <= lastStartMin) {
    const label = toLabel(cursor);
    const startMs = Date.parse(phoenixDateTime(dateStr, cursor));
    const endWithBuffer = addMinutes(cursor, duration + BUFFER_MIN);
    const endMs = Date.parse(phoenixDateTime(dateStr, endWithBuffer));
    if (overlaps(startMs, endMs, busy)) booked.push(label);
    else available.push(label);
    cursor = addMinutes(cursor, SLOT_STEP_MIN);
  }

  return {
    date: dateStr,
    available,
    booked,
    openHours: [...available, ...booked],
    source: 'google',
    duration,
    bufferMinutes: BUFFER_MIN,
    timezone: TIMEZONE,
  };
}

function slotIsOpen(slots, time) {
  const label = toLabel(to24h(time));
  return slots.available.includes(label) || slots.available.includes(time);
}

function eventToAppointment(event) {
  const start = event.start && (event.start.dateTime || event.start.date);
  const end = event.end && (event.end.dateTime || event.end.date);
  const privateProps = (event.extendedProperties && event.extendedProperties.private) || {};
  const summary = event.summary || '';
  const [serviceName, clientFromTitle] = summary.split('—').map((part) => part && part.trim());
  const firstAttendee = (event.attendees || [])[0] || {};
  const isBlock = privateProps.type === 'block' || /^Blocked/i.test(summary);

  return {
    id: event.id,
    htmlLink: event.htmlLink,
    name: privateProps.clientName || clientFromTitle || summary,
    email: privateProps.clientEmail || firstAttendee.email || '',
    phone: privateProps.phone || '',
    serviceId: privateProps.serviceId || '',
    serviceName: isBlock ? 'Blocked' : (serviceName || summary),
    servicePrice: privateProps.servicePrice ? Number(privateProps.servicePrice) : '',
    serviceDuration: privateProps.serviceDuration || '',
    address: privateProps.address || event.location || '',
    date: start ? start.slice(0, 10) : '',
    time: event.start && event.start.dateTime ? toLabel(start.slice(11, 16)) : 'All day',
    start,
    end,
    notes: event.description || '',
    status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
    createdAt: event.created,
    source: 'google',
    type: isBlock ? 'block' : 'appointment',
  };
}

async function createBooking({ name, email, phone, address, service, date, time, notes }) {
  const duration = parseDurationMinutes(service.duration);
  const slots = await getAvailableSlots(date, duration);
  if (!slotIsOpen(slots, time)) {
    const error = new Error('That time slot is no longer available');
    error.status = 409;
    throw error;
  }

  const addAttendees = process.env.GOOGLE_ADD_ATTENDEES === 'true';
  const event = {
    summary: `${service.name} — ${name}`,
    description: [
      `Service: ${service.name} (${service.duration} — $${service.price})`,
      `Client: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || 'N/A'}`,
      `Address: ${address || 'TBD — call client'}`,
      `Notes: ${notes || 'None'}`,
      'Source: Kayci Cactus website',
    ].join('\n'),
    // Mobile service: the appointment happens at the client's address
    location: address || process.env.STUDIO_ADDRESS || 'Verrado / Buckeye, AZ',
    start: { dateTime: phoenixDateTime(date, time), timeZone: TIMEZONE },
    end: { dateTime: phoenixDateTime(date, addMinutes(time, duration)), timeZone: TIMEZONE },
    guestsCanModify: false,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 120 },
      ],
    },
    extendedProperties: {
      private: {
        source: 'kayci-cactus',
        type: 'appointment',
        serviceId: service.id,
        serviceDuration: service.duration,
        servicePrice: String(service.price),
        phone: phone || '',
        clientName: name,
        clientEmail: email,
      },
    },
    colorId: '6',
  };

  if (addAttendees && email) {
    event.attendees = [{ email, displayName: name }];
  }

  const created = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendarId())}/events${addAttendees ? '?sendUpdates=all' : ''}`,
    { method: 'POST', body: JSON.stringify(event) }
  );
  return eventToAppointment(created);
}

async function listAppointments({ daysBack = 7, daysForward = 60 } = {}) {
  const now = Date.now();
  const timeMin = new Date(now - daysBack * 86400000).toISOString();
  const timeMax = new Date(now + daysForward * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendarId())}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`;
  const data = await gfetch(url);
  return (data.items || [])
    .filter((event) => event.status !== 'cancelled')
    .map(eventToAppointment);
}

async function cancelBooking(eventId) {
  const addAttendees = process.env.GOOGLE_ADD_ATTENDEES === 'true';
  await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendarId())}/events/${encodeURIComponent(eventId)}${addAttendees ? '?sendUpdates=all' : ''}`,
    { method: 'DELETE' }
  );
  return { success: true, id: eventId, status: 'cancelled' };
}

async function blockTime({ date, startTime, endTime, reason }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
  }
  if (!startTime) throw new Error('Missing startTime');
  if (!/^\d{2}:\d{2}$/.test(to24h(String(startTime)))) {
    throw new Error(`Invalid startTime "${startTime}"`);
  }
  const start = phoenixDateTime(date, startTime);
  const end = phoenixDateTime(date, endTime || addMinutes(startTime, 60));
  const eventBody = {
    summary: reason ? `Blocked — ${reason}` : 'Blocked',
    description: 'Blocked from Kayci Cactus admin',
    start: { dateTime: start, timeZone: TIMEZONE },
    end: { dateTime: end, timeZone: TIMEZONE },
    transparency: 'opaque',
    colorId: '8',
    extendedProperties: { private: { source: 'kayci-cactus', type: 'block' } },
  };
  // Debug: log exactly what we send (calendar id + body) to diagnose 400s.
  console.log('blockTime request body:', JSON.stringify(eventBody));
  console.log(`blockTime target calendar: ${JSON.stringify(bookingCalendarId())} tz=${JSON.stringify(TIMEZONE)} offset=${JSON.stringify(TZ_OFFSET)}`);
  const created = await gfetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendarId())}/events`,
    { method: 'POST', body: JSON.stringify(eventBody) }
  );
  return eventToAppointment(created);
}

async function status() {
  return {
    configured: configured(),
    mode: authMode(),
    calendarId: bookingCalendarId() || null,
    freeBusyCalendars: configured() ? freeBusyCalendarIds() : [],
    timezone: TIMEZONE,
    bufferMinutes: BUFFER_MIN,
    slotStepMinutes: SLOT_STEP_MIN,
    workingHours: workingHours(),
    addAttendees: process.env.GOOGLE_ADD_ATTENDEES === 'true',
  };
}

module.exports = {
  configured,
  authMode,
  parseDurationMinutes,
  getAvailableSlots,
  createBooking,
  listAppointments,
  cancelBooking,
  blockTime,
  status,
  workingHours,
  toLabel,
  to24h,
};

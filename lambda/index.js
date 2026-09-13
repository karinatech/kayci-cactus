const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const calendar = require('./googleCalendar');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DDB_TABLE || 'kayci-cactus-data';

const s3Client = new S3Client({});
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET || '';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'saguaro2024';
const SPECIALIST_EMAIL = process.env.SPECIALIST_EMAIL || 'specialist@example.com';
const SPECIALIST_NAME = process.env.SPECIALIST_NAME || 'Kayci Sonoran';

const ALL_TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];

const DEFAULT_SERVICES = [
  { id: 'desert-stone',  name: 'Desert Stone Massage',       duration: '75 min', price: 135, desc: 'Heated Arizona river stones melt tension from deep within.', image: 'https://images.pexels.com/photos/3997989/pexels-photo-3997989.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'sonoran-deep',  name: 'Sonoran Deep Tissue',        duration: '60 min', price: 115, desc: 'Targeted deep-tissue work with locally sourced sage oil.', image: 'https://images.pexels.com/photos/3998037/pexels-photo-3998037.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'sunset-relax',  name: 'Sunset Relaxation',          duration: '50 min', price:  95, desc: 'Gentle, flowing strokes paired with desert botanical aromatherapy.', image: 'https://images.pexels.com/photos/3225531/pexels-photo-3225531.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'monsoon-recovery', name: 'Monsoon Recovery Sports', duration: '60 min', price: 125, desc: 'Athletic recovery massage focusing on overworked muscles.', image: 'https://images.pexels.com/photos/4056723/pexels-photo-4056723.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'palosanto',     name: 'Palo Santo Energy Ritual',   duration: '45 min', price:  85, desc: 'Energy balancing with palo santo and crystal sound therapy.', image: 'https://images.pexels.com/photos/6198027/pexels-photo-6198027.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'cactus-cupping', name: 'Cactus Flower Cupping',     duration: '50 min', price: 110, desc: 'Modern cupping therapy to improve circulation and release fascia.', image: 'https://images.pexels.com/photos/6663584/pexels-photo-6663584.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'migraine-relief', name: 'Migraine Relief Massage',  duration: '45 min', price:  95, desc: 'Targeted head, neck, and shoulder massage to ease tension headaches and migraines.', image: 'https://images.pexels.com/photos/3998013/pexels-photo-3998013.jpeg?auto=compress&cs=tinysrgb&w=600' },
];

// ── Site settings shown on the public homepage; overridable from the admin portal ──
const DEFAULT_SETTINGS = {
  businessName: 'Kayci Sonoran',
  heroTag: 'Verrido · Buckeye, AZ',
  heroTitle: 'Kayci Sonoran|Massage & Therapy',
  heroSubtitle: 'Indulge in the ultimate massage experience. Escape the everyday and treat yourself to therapies designed for total relaxation and renewal.',
  servicesHeading: 'Step into a world of luxury and serenity',
  servicesSub: 'Each treatment blends professional technique with the calming essence of the Sonoran Desert.',
  aboutLabel: 'Experience the Difference!',
  aboutHeading: 'A sanctuary rooted in Arizona tradition',
  aboutText: "Our practice draws from the healing traditions of the Southwest. From the warmth of sun-baked river stones to the calming scent of desert sage, every detail is designed to reconnect you with the natural rhythm of the land.\n\nWhether you're recovering from a hike in the White Tank Mountains or decompressing after a long work week, we tailor every session to your body's needs.",
  ctaHeading: 'Relax Effortlessly!',
  ctaText: 'Book your spa experience today. Your moment of calm is one click away.',
  footerLine: 'Serving Verrado & Buckeye, AZ · Licensed in Arizona',
  accentColor: '#d4846a',
  accentDark: '#b5644a',
};

// ── Services: DynamoDB is the single source of truth after first seed ──
async function putItem(item) {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

async function scanByType(type) {
  const result = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#type = :type',
    ExpressionAttributeNames: { '#type': 'type' },
    ExpressionAttributeValues: { ':type': type },
  }));
  return result.Items || [];
}

function normalizeService(item) {
  return {
    id: item.serviceId || (item.id || '').replace(/^service_/, ''),
    name: item.name, duration: item.duration, price: item.price,
    desc: item.desc, image: item.image,
    sort: item.sort === undefined ? 999 : item.sort,
    hidden: !!item.hidden,
  };
}

// Reads services from DynamoDB. On first run (or when the catalog is a legacy
// partial override set), seeds the full default catalog exactly once so the
// table always holds the complete list — add/edit/delete never duplicate rows.
async function getServices() {
  try {
    const items = await scanByType('service');
    const stored = items.map(normalizeService).filter(s => s.id && s.name);
    const storedIds = new Set(stored.map(s => s.id));
    const missing = DEFAULT_SERVICES.filter(d => !storedIds.has(d.id));

    if (stored.length === 0) {
      // Fresh table — seed everything
      for (let i = 0; i < DEFAULT_SERVICES.length; i++) {
        const d = DEFAULT_SERVICES[i];
        await putItem({ id: `service_${d.id}`, type: 'service', serviceId: d.id, ...d, sort: i, hidden: false, updatedAt: new Date().toISOString() });
      }
      return DEFAULT_SERVICES.map((d, i) => ({ ...d, sort: i, hidden: false }));
    }
    // Re-read not needed; merge in-memory
    const merged = [...stored];
    if (missing.length > 0) {
      // Legacy override-only rows exist — backfill the defaults that were never
      // edited so the table holds the full catalog from now on.
      const seedAll = await getSetting('service_catalog_seeded');
      if (!seedAll) {
        for (const d of missing) {
          const i = DEFAULT_SERVICES.findIndex(x => x.id === d.id);
          await putItem({ id: `service_${d.id}`, type: 'service', serviceId: d.id, ...d, sort: 500 + i, hidden: false, updatedAt: new Date().toISOString() });
          merged.push({ ...d, sort: 500 + i, hidden: false });
        }
        await putItem({ id: 'setting_service_catalog_seeded', type: 'setting', key: 'service_catalog_seeded', value: true, updatedAt: new Date().toISOString() });
      }
    }
    merged.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    return merged;
  } catch (e) {
    console.log('getServices fallback:', e.message);
    return DEFAULT_SERVICES.map((d, i) => ({ ...d, sort: i, hidden: false }));
  }
}

async function getServiceRow(serviceId) {
  return await getItem(`service_${serviceId}`);
}

async function getSetting(key) {
  const item = await getItem(`setting_${key}`);
  return item ? item.value : undefined;
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: process.env.SMTP_USER || 'placeholder@gmail.com', pass: process.env.SMTP_PASS || 'placeholder' },
});

// ── Helper: response ──
function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

// ── Helper: parse event ──
function parseEvent(event) {
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const path = event.path || event.requestContext?.http?.path || '/';
  const pathParts = path.split('/').filter(Boolean);
  let body = {};
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const queryParams = event.queryStringParameters || {};
  return { method, path, pathParts, body, headers, token, queryParams };
}

async function getItem(id) {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: { id } }));
  return result.Item;
}

async function updateItem(id, updates) {
  const exprParts = [];
  const exprValues = {};
  const exprNames = {};
  Object.entries(updates).forEach(([key, value], i) => {
    const placeholder = `:v${i}`;
    const namePlaceholder = `#k${i}`;
    exprParts.push(`${namePlaceholder} = ${placeholder}`);
    exprValues[placeholder] = value;
    exprNames[namePlaceholder] = key;
  });
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression: `SET ${exprParts.join(', ')}`,
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: exprNames,
  }));
}

// ── Email helper ──
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to, subject, html,
    });
  } catch (err) {
    console.log('Email skipped:', err.message);
  }
}

// ── Slug helper for new services ──
function slugify(text) {
  return String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `svc-${Date.now()}`;
}

// ── Route handler ──
async function handleRequest(event) {
  const { method, pathParts, body, token, queryParams } = parseEvent(event);

  // CORS preflight
  if (method === 'OPTIONS') return response(200, {});

  // Route: /api/services  (public — hidden services excluded)
  if (pathParts[0] === 'api' && pathParts[1] === 'services' && method === 'GET') {
    const services = (await getServices()).filter(s => !s.hidden);
    return response(200, services);
  }

  // Route: /api/site-settings (public)
  if (pathParts[0] === 'api' && pathParts[1] === 'site-settings' && method === 'GET') {
    const stored = await getSetting('site_settings') || {};
    return response(200, { ...DEFAULT_SETTINGS, ...stored });
  }

  // Route: /api/slots/:date
  if (pathParts[0] === 'api' && pathParts[1] === 'slots' && pathParts[2] && method === 'GET') {
    const date = pathParts[2];
    if (calendar.configured()) {
      const catalog = await getServices();
      const service = catalog.find(s => s.id === queryParams.serviceId);
      const duration = calendar.parseDurationMinutes(service ? service.duration : 60);
      return response(200, await calendar.getAvailableSlots(date, duration));
    }
    const allItems = await scanByType('appointment');
    const availabilityItems = await scanByType('availability');
    const availRecord = availabilityItems.find(a => a.date === date);
    const openSlots = availRecord ? availRecord.slots : [];
    const bookedTimes = allItems
      .filter(a => a.date === date && a.status !== 'cancelled')
      .map(a => a.time);
    const available = openSlots.filter(s => !bookedTimes.includes(s));
    return response(200, { date, available, booked: bookedTimes, openHours: openSlots, source: 'local' });
  }

  // Route: /api/book (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'book' && method === 'POST') {
    const { name, email, phone, serviceId, date, time, notes } = body;
    if (!name || !email || !serviceId || !date || !time) return response(400, { error: 'Missing required fields' });
    const catalog = (await getServices()).filter(s => !s.hidden);
    const service = catalog.find(s => s.id === serviceId);
    if (!service) return response(400, { error: 'Invalid service' });

    if (calendar.configured()) {
      try {
        const booked = await calendar.createBooking({ name, email, phone, service, date, time, notes });
        await sendEmail(SPECIALIST_EMAIL, `New Appointment — ${name} — ${service.name}`,
          `<h2>New Appointment</h2><p><strong>Client:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>
           <p><strong>Phone:</strong> ${phone || 'N/A'}</p><p><strong>Service:</strong> ${service.name} (${service.duration} — $${service.price})</p>
           <p><strong>Date:</strong> ${date}</p><p><strong>Time:</strong> ${time}</p><p><strong>Notes:</strong> ${notes || 'None'}</p>
           <p>Written to Google Calendar.</p>`);
        await sendEmail(email, `Appointment Confirmed — ${service.name}`,
          `<h2>You're booked, ${name}!</h2><p><strong>Service:</strong> ${service.name}</p>
           <p><strong>Date:</strong> ${date}</p><p><strong>Time:</strong> ${time}</p>`);
        return response(201, { success: true, id: booked.id, appointment: booked, source: 'google' });
      } catch (err) {
        return response(err.status || 500, { error: err.message || 'Could not create calendar event' });
      }
    }

    // Check if slot is in admin-set availability
    const availabilityItems = await scanByType('availability');
    const availRecord = availabilityItems.find(a => a.date === date);
    const openSlots = availRecord ? availRecord.slots : [];
    if (!openSlots.includes(time)) {
      return response(403, { error: 'This time slot is not available. Please join the waitlist.' });
    }

    // Check double-booking
    const allItems = await scanByType('appointment');
    const conflict = allItems.find(a => a.date === date && a.time === time && a.status !== 'cancelled');
    if (conflict) return response(409, { error: 'That time slot is already booked' });

    const id = crypto.randomUUID();
    const appointment = {
      id, type: 'appointment', name, email, phone: phone || '', serviceId,
      serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration,
      date, time, notes: notes || '', status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await putItem(appointment);

    await sendEmail(SPECIALIST_EMAIL, `New Appointment Request — ${name} — ${service.name}`,
      `<h2>New Appointment Request</h2><p><strong>Client:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>
       <p><strong>Phone:</strong> ${phone || 'N/A'}</p><p><strong>Service:</strong> ${service.name} (${service.duration} — $${service.price})</p>
       <p><strong>Date:</strong> ${date}</p><p><strong>Time:</strong> ${time}</p><p><strong>Notes:</strong> ${notes || 'None'}</p>`);

    await sendEmail(email, `Appointment Request Received — ${service.name}`,
      `<h2>Thank you, ${name}!</h2><p>We've received your request for:</p>
       <p><strong>Service:</strong> ${service.name}</p><p><strong>Date:</strong> ${date}</p>
       <p><strong>Time:</strong> ${time}</p><p>We'll confirm your appointment shortly.</p>`);

    return response(201, { success: true, id, appointment });
  }

  // Route: /api/waitlist (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'waitlist' && method === 'POST') {
    const { name, email, phone, serviceId, date, notes } = body;
    if (!name || !email || !date) return response(400, { error: 'Missing required fields' });

    const catalog = await getServices();
    const service = serviceId ? catalog.find(s => s.id === serviceId) : null;
    const id = crypto.randomUUID();
    const entry = {
      id, type: 'waitlist', name, email, phone: phone || '',
      serviceId: serviceId || null,
      serviceName: service ? service.name : 'Any available service',
      date, notes: notes || '', status: 'waiting',
      createdAt: new Date().toISOString(),
    };

    await putItem(entry);

    await sendEmail(SPECIALIST_EMAIL, `Waitlist Request — ${name} — ${date}`,
      `<h2>New Waitlist Request</h2><p><strong>Client:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>
       <p><strong>Phone:</strong> ${phone || 'N/A'}</p><p><strong>Preferred Date:</strong> ${date}</p>
       <p><strong>Service:</strong> ${entry.serviceName}</p><p><strong>Notes:</strong> ${notes || 'None'}</p>`);

    await sendEmail(email, `Waitlist Request Received — ${date}`,
      `<h2>You're on the waitlist, ${name}!</h2><p>We've received your request for ${date}.</p>
       <p>If a slot opens up, we'll contact you to schedule your appointment.</p>`);

    return response(201, { success: true, id, entry });
  }

  // ── Admin routes ──
  function authed() { return token === ADMIN_TOKEN; }

  // Route: /api/admin/login (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'login' && method === 'POST') {
    if (body.password === ADMIN_TOKEN) return response(200, { success: true, token: ADMIN_TOKEN });
    return response(401, { error: 'Invalid password' });
  }

  // Route: /api/admin/appointments (GET)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'appointments' && method === 'GET') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    if (calendar.configured()) {
      const items = await calendar.listAppointments();
      return response(200, items);
    }
    const items = await scanByType('appointment');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return response(200, items);
  }

  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'calendar' && !pathParts[3] && method === 'GET') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    return response(200, await calendar.status());
  }

  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'calendar' && pathParts[3] === 'block' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    if (!calendar.configured()) return response(400, { error: 'Google Calendar is not configured' });
    const { date, startTime, endTime, reason } = body;
    if (!date || !startTime) return response(400, { error: 'date and startTime required' });
    const blocked = await calendar.blockTime({ date, startTime, endTime, reason });
    return response(200, { success: true, appointment: blocked });
  }

  // Route: /api/admin/appointments/:id (PATCH)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'appointments' && pathParts[3] && method === 'PATCH') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { status } = body;
    if (calendar.configured()) {
      if (status === 'cancelled') {
        await calendar.cancelBooking(pathParts[3]);
        return response(200, { success: true, id: pathParts[3], status: 'cancelled' });
      }
      return response(400, { error: 'Google bookings are confirmed when created. Cancel to free the slot.' });
    }
    await updateItem(pathParts[3], { status });

    const appt = await getItem(pathParts[3]);
    if (status === 'confirmed' && appt) {
      await sendEmail(appt.email, `Appointment Confirmed — ${appt.serviceName}`,
        `<h2>Your appointment is confirmed!</h2><p><strong>${appt.serviceName}</strong></p>
         <p><strong>Date:</strong> ${appt.date}</p><p><strong>Time:</strong> ${appt.time}</p>`);
    } else if (status === 'cancelled' && appt) {
      await sendEmail(appt.email, `Appointment Update — ${appt.serviceName}`,
        `<h2>Appointment Update</h2><p>Unfortunately your appointment on ${appt.date} at ${appt.time} has been cancelled.</p>`);
    }
    return response(200, { success: true, appointment: appt });
  }

  // Route: /api/admin/availability (GET)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'availability' && method === 'GET') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const items = await scanByType('availability');
    const result = {};
    items.forEach(a => { result[a.date] = a.slots; });
    return response(200, result);
  }

  // Route: /api/admin/availability (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'availability' && !pathParts[3] && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { date, slots } = body;
    if (!date) return response(400, { error: 'Date required' });
    const id = `avail_${date}`;
    if (!slots || slots.length === 0) {
      // Delete the availability record
      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
      return response(200, { success: true, date, slots: [] });
    }
    await putItem({ id, type: 'availability', date, slots, createdAt: new Date().toISOString() });
    return response(200, { success: true, date, slots });
  }

  // Route: /api/admin/availability/bulk (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'availability' && pathParts[3] === 'bulk' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { startDate, endDate, slots } = body;
    if (!startDate || !endDate || !slots) return response(400, { error: 'startDate, endDate, and slots required' });
    if (!Array.isArray(slots) || slots.length === 0) return response(400, { error: 'At least one time slot required' });
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const id = `avail_${dateStr}`;
      await putItem({ id, type: 'availability', date: dateStr, slots: [...slots], createdAt: new Date().toISOString() });
      dates.push(dateStr);
    }
    return response(200, { success: true, dates, slots });
  }

  // Route: /api/admin/availability/:date (DELETE)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'availability' && pathParts[3] && pathParts[3] !== 'bulk' && method === 'DELETE') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const date = pathParts[3];
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id: `avail_${date}` } }));
    return response(200, { success: true, date });
  }

  // ── Services admin (full CRUD — DynamoDB is the single source of truth) ──

  // Route: /api/admin/services (GET) — includes hidden services for admin
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'services' && !pathParts[3] && method === 'GET') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const services = await getServices();
    return response(200, services);
  }

  // Route: /api/admin/services (POST) — create a brand-new service
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'services' && !pathParts[3] && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { name, desc, price, image, duration } = body;
    if (!name || !desc || price === undefined || !duration) {
      return response(400, { error: 'name, desc, price, and duration are required' });
    }
    let serviceId = slugify(body.id || name);
    // Guarantee uniqueness — never overwrite an existing service
    if (await getServiceRow(serviceId)) {
      serviceId = `${serviceId}-${crypto.randomBytes(3).toString('hex')}`;
    }
    const existing = await getServices();
    const sort = existing.length ? Math.max(...existing.map(s => s.sort)) + 1 : 0;
    const item = {
      id: `service_${serviceId}`, type: 'service', serviceId,
      name, desc, price: Number(price), image: image || '', duration,
      sort, hidden: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await putItem(item);
    return response(201, { success: true, service: { id: serviceId, name, desc, price: Number(price), image, duration, sort, hidden: false } });
  }

  // Route: /api/admin/services/:id (PUT) — update a service's name, desc, price, image, duration, sort, hidden
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'services' && pathParts[3] && method === 'PUT') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const serviceId = pathParts[3];
    const existing = await getServiceRow(serviceId);
    if (!existing) return response(404, { error: 'Service not found' });
    const merged = {
      id: `service_${serviceId}`, type: 'service', serviceId,
      name: body.name !== undefined ? body.name : existing.name,
      desc: body.desc !== undefined ? body.desc : existing.desc,
      price: body.price !== undefined ? Number(body.price) : existing.price,
      image: body.image !== undefined ? body.image : existing.image,
      duration: body.duration !== undefined ? body.duration : existing.duration,
      sort: body.sort !== undefined ? Number(body.sort) : (existing.sort === undefined ? 999 : existing.sort),
      hidden: body.hidden !== undefined ? !!body.hidden : !!existing.hidden,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await putItem(merged);
    return response(200, { success: true, service: normalizeService(merged) });
  }

  // Route: /api/admin/services/:id (DELETE) — permanently remove a service
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'services' && pathParts[3] && method === 'DELETE') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const serviceId = pathParts[3];
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id: `service_${serviceId}` } }));
    return response(200, { success: true, id: serviceId, message: 'Service deleted' });
  }

  // Route: /api/admin/services/restore-defaults (POST) — re-add any deleted default services
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'services' && pathParts[3] === 'restore-defaults' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const existing = await getServices();
    const existingIds = new Set(existing.map(s => s.id));
    let maxSort = existing.length ? Math.max(...existing.map(s => s.sort)) : 0;
    const restored = [];
    for (const d of DEFAULT_SERVICES) {
      if (!existingIds.has(d.id)) {
        maxSort += 1;
        await putItem({ id: `service_${d.id}`, type: 'service', serviceId: d.id, ...d, sort: maxSort, hidden: false, updatedAt: new Date().toISOString() });
        restored.push(d.id);
      }
    }
    return response(200, { success: true, restored });
  }

  // ── Site settings admin ──

  // Route: /api/admin/site-settings (PUT) — merge and save homepage content
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'site-settings' && method === 'PUT') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const current = await getSetting('site_settings') || {};
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const next = { ...current };
    allowed.forEach(k => { if (body[k] !== undefined) next[k] = String(body[k]); });
    await putItem({ id: 'setting_site_settings', type: 'setting', key: 'site_settings', value: next, updatedAt: new Date().toISOString() });
    return response(200, { success: true, settings: { ...DEFAULT_SETTINGS, ...next } });
  }

  // Route: /api/admin/site-settings/reset (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'site-settings' && pathParts[3] === 'reset' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id: 'setting_site_settings' } }));
    return response(200, { success: true, settings: DEFAULT_SETTINGS });
  }

  // ── Image upload (stores to S3 media bucket, returns public URL) ──
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'upload' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    if (!UPLOAD_BUCKET) return response(400, { error: 'Image uploads are not configured yet. Redeploy the CloudFormation stack to add the media bucket.' });
    const { filename, contentType, data } = body;
    if (!data || !contentType) return response(400, { error: 'data and contentType required' });
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(contentType)) return response(400, { error: 'Only PNG, JPG, WebP, GIF, or AVIF images are allowed' });
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > 4 * 1024 * 1024) return response(400, { error: 'Image must be under 4 MB' });
    const ext = (filename && filename.split('.').pop() || contentType.split('/')[1]).toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const key = `uploads/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: UPLOAD_BUCKET, Key: key, Body: buffer,
      ContentType: contentType, CacheControl: 'public, max-age=31536000',
    }));
    const region = process.env.AWS_REGION || 'us-east-1';
    const url = `https://${UPLOAD_BUCKET}.s3.${region}.amazonaws.com/${key}`;
    return response(200, { success: true, url });
  }

  // Route: /api/admin/waitlist (GET)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'waitlist' && method === 'GET') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const items = await scanByType('waitlist');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return response(200, items);
  }

  // Route: /api/admin/waitlist/:id/confirm (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'waitlist' && pathParts[3] && pathParts[4] === 'confirm' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { time } = body;
    const entry = await getItem(pathParts[3]);
    if (!entry) return response(404, { error: 'Waitlist entry not found' });

    const catalog = await getServices();
    const service = entry.serviceId ? catalog.find(s => s.id === entry.serviceId) : catalog[0];
    if (calendar.configured()) {
      if (!time) return response(400, { error: 'Time slot required' });
      const appointment = await calendar.createBooking({
        name: entry.name,
        email: entry.email,
        phone: entry.phone,
        service: service || { id: 'custom', name: entry.serviceName, duration: '60 min', price: 0 },
        date: entry.date,
        time,
        notes: entry.notes,
      });
      await updateItem(entry.id, { status: 'confirmed', appointmentId: appointment.id });
      await sendEmail(entry.email, `Good news! A slot opened up — ${entry.date}`,
        `<h2>Great news, ${entry.name}!</h2><p>A slot has opened up and we'd love to see you.</p>
         <p><strong>Date:</strong> ${entry.date}</p><p><strong>Time:</strong> ${time}</p>
         <p><strong>Service:</strong> ${appointment.serviceName}</p>`);
      return response(200, { success: true, appointment, waitlistEntry: { ...entry, status: 'confirmed', appointmentId: appointment.id }, source: 'google' });
    }
    const apptId = crypto.randomUUID();
    const appointment = {
      id: apptId, type: 'appointment',
      name: entry.name, email: entry.email, phone: entry.phone,
      serviceId: entry.serviceId,
      serviceName: service ? service.name : entry.serviceName,
      servicePrice: service ? service.price : 0,
      serviceDuration: service ? service.duration : 'TBD',
      date: entry.date, time: time || 'TBD',
      notes: entry.notes, status: 'confirmed',
      createdAt: new Date().toISOString(), fromWaitlist: true,
    };
    await putItem(appointment);
    await updateItem(entry.id, { status: 'confirmed', appointmentId: apptId });

    await sendEmail(entry.email, `Good news! A slot opened up — ${entry.date}`,
      `<h2>Great news, ${entry.name}!</h2><p>A slot has opened up and we'd love to see you.</p>
       <p><strong>Date:</strong> ${entry.date}</p><p><strong>Time:</strong> ${time || 'We will contact you'}</p>
       <p><strong>Service:</strong> ${appointment.serviceName}</p><p>Your appointment is confirmed!</p>`);

    await sendEmail(SPECIALIST_EMAIL, `Waitlist Confirmed — ${entry.name} — ${entry.date}`,
      `<h2>Waitlist Entry Confirmed</h2><p><strong>Client:</strong> ${entry.name}</p><p><strong>Date:</strong> ${entry.date}</p>
       <p><strong>Time:</strong> ${time || 'TBD'}</p><p><strong>Service:</strong> ${appointment.serviceName}</p>`);

    return response(200, { success: true, appointment, waitlistEntry: { ...entry, status: 'confirmed', appointmentId: apptId } });
  }

  // Route: /api/admin/waitlist/:id/decline (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'waitlist' && pathParts[3] && pathParts[4] === 'decline' && method === 'POST') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    await updateItem(pathParts[3], { status: 'declined' });
    const entry = await getItem(pathParts[3]);
    if (entry) {
      await sendEmail(entry.email, `Waitlist Update — ${entry.date}`,
        `<h2>Hi ${entry.name},</h2><p>Unfortunately we weren't able to accommodate your waitlist request for ${entry.date}.</p>`);
    }
    return response(200, { success: true, entry });
  }

  return response(404, { error: 'Not found', path: pathParts.join('/') });
}

exports.handler = async (event) => {
  try {
    return await handleRequest(event);
  } catch (err) {
    console.error('Error:', err);
    return response(500, { error: 'Internal server error', message: err.message });
  }
};

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, GetCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DDB_TABLE || 'kayci-cactus-data';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'saguaro2024';
const SPECIALIST_EMAIL = process.env.SPECIALIST_EMAIL || 'specialist@example.com';
const SPECIALIST_NAME = process.env.SPECIALIST_NAME || 'Kayci Sonoran';

const ALL_TIME_SLOTS = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'];

const SERVICES = [
  { id: 'desert-stone',  name: 'Desert Stone Massage',       duration: '75 min', price: 135, desc: 'Heated Arizona river stones melt tension from deep within.' },
  { id: 'sonoran-deep',  name: 'Sonoran Deep Tissue',        duration: '60 min', price: 115, desc: 'Targeted deep-tissue work with locally sourced sage oil.' },
  { id: 'sunset-relax',  name: 'Sunset Relaxation',          duration: '50 min', price:  95, desc: 'Gentle, flowing strokes paired with desert botanical aromatherapy.' },
  { id: 'monsoon-recovery', name: 'Monsoon Recovery Sports', duration: '60 min', price: 125, desc: 'Athletic recovery massage focusing on overworked muscles.' },
  { id: 'palosanto',     name: 'Palo Santo Energy Ritual',   duration: '45 min', price:  85, desc: 'Energy balancing with palo santo and crystal sound therapy.' },
  { id: 'cactus-cupping', name: 'Cactus Flower Cupping',     duration: '50 min', price: 110, desc: 'Modern cupping therapy to improve circulation and release fascia.' },
];

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
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

// ── Helper: parse event ──
function parseEvent(event) {
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const path = event.path || event.requestContext?.http?.path || '/';
  const pathParts = path.split('/').filter(Boolean);
  const body = event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : {};
  const headers = event.headers || {};
  const authHeader = headers.Authorization || headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const queryParams = event.queryStringParameters || {};
  return { method, path, pathParts, body, headers, token, queryParams };
}

// ── DynamoDB helpers ──
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

// ── Route handler ──
async function handleRequest(event) {
  const { method, pathParts, body, token, queryParams } = parseEvent(event);

  // CORS preflight
  if (method === 'OPTIONS') return response(200, {});

  // Route: /api/services
  if (pathParts[0] === 'api' && pathParts[1] === 'services' && method === 'GET') {
    return response(200, SERVICES);
  }

  // Route: /api/slots/:date
  if (pathParts[0] === 'api' && pathParts[1] === 'slots' && pathParts[2] && method === 'GET') {
    const date = pathParts[2];
    const allItems = await scanByType('appointment');
    const availabilityItems = await scanByType('availability');
    const availRecord = availabilityItems.find(a => a.date === date);
    const openSlots = availRecord ? availRecord.slots : [];
    const bookedTimes = allItems
      .filter(a => a.date === date && a.status !== 'cancelled')
      .map(a => a.time);
    const available = openSlots.filter(s => !bookedTimes.includes(s));
    return response(200, { date, available, booked: bookedTimes, openHours: openSlots });
  }

  // Route: /api/book (POST)
  if (pathParts[0] === 'api' && pathParts[1] === 'book' && method === 'POST') {
    const { name, email, phone, serviceId, date, time, notes } = body;
    if (!name || !email || !serviceId || !date || !time) return response(400, { error: 'Missing required fields' });
    const service = SERVICES.find(s => s.id === serviceId);
    if (!service) return response(400, { error: 'Invalid service' });

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

    const service = serviceId ? SERVICES.find(s => s.id === serviceId) : null;
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
    const items = await scanByType('appointment');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return response(200, items);
  }

  // Route: /api/admin/appointments/:id (PATCH)
  if (pathParts[0] === 'api' && pathParts[1] === 'admin' && pathParts[2] === 'appointments' && pathParts[3] && method === 'PATCH') {
    if (!authed()) return response(401, { error: 'Unauthorized' });
    const { status } = body;
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

    const service = entry.serviceId ? SERVICES.find(s => s.id === entry.serviceId) : null;
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
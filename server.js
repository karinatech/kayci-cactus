const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3300;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory data store (prototype; swap for DB later) ──
const appointments = [];
const availability = {}; // { "2026-08-20": ["9:00 AM", "10:00 AM", "2:00 PM"], ... }
const waitlist = []; // [{ id, name, email, phone, serviceId, date, notes, status, createdAt }]
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'saguaro2024';

const ALL_TIME_SLOTS = [
  '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
  '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM'
];

// ── Email transporter ──
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: process.env.SMTP_USER || 'placeholder@gmail.com', pass: process.env.SMTP_PASS || 'placeholder' },
});

const SPECIALIST_EMAIL = process.env.SPECIALIST_EMAIL || 'specialist@example.com';
const SPECIALIST_NAME = process.env.SPECIALIST_NAME || 'Kayci Sonoran';

// ── Services ──
const SERVICES = [
  { id: 'desert-stone',  name: 'Desert Stone Massage',       duration: '75 min', price: 135, desc: 'Heated Arizona river stones melt tension from deep within.', image: 'https://images.pexels.com/photos/3997989/pexels-photo-3997989.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'sonoran-deep',  name: 'Sonoran Deep Tissue',        duration: '60 min', price: 115, desc: 'Targeted deep-tissue work with locally sourced sage oil.', image: 'https://images.pexels.com/photos/3998037/pexels-photo-3998037.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'sunset-relax',  name: 'Sunset Relaxation',          duration: '50 min', price:  95, desc: 'Gentle, flowing strokes paired with desert botanical aromatherapy.', image: 'https://images.pexels.com/photos/3225531/pexels-photo-3225531.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'monsoon-recovery', name: 'Monsoon Recovery Sports', duration: '60 min', price: 125, desc: 'Athletic recovery massage focusing on overworked muscles.', image: 'https://images.pexels.com/photos/4056723/pexels-photo-4056723.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'palosanto',     name: 'Palo Santo Energy Ritual',   duration: '45 min', price:  85, desc: 'Energy balancing with palo santo and crystal sound therapy.', image: 'https://images.pexels.com/photos/6198027/pexels-photo-6198027.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'cactus-cupping', name: 'Cactus Flower Cupping',     duration: '50 min', price: 110, desc: 'Modern cupping therapy to improve circulation and release fascia.', image: 'https://images.pexels.com/photos/6663584/pexels-photo-6663584.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { id: 'migraine-relief', name: 'Migraine Relief Massage',  duration: '45 min', price:  95, desc: 'Targeted head, neck, and shoulder massage to ease tension headaches and migraines.', image: 'https://images.pexels.com/photos/3998013/pexels-photo-3998013.jpeg?auto=compress&cs=tinysrgb&w=600' },
];

// ══════════════════════════════════════════════
//  PUBLIC APIs
// ══════════════════════════════════════════════

// Get services
app.get('/api/services', (req, res) => {
  res.json(SERVICES);
});

// Get available slots for a date — now driven by admin-set availability
app.get('/api/slots/:date', (req, res) => {
  const { date } = req.params;
  const openSlots = availability[date] || [];
  const bookedTimes = appointments
    .filter(a => a.date === date && a.status !== 'cancelled')
    .map(a => a.time);
  const available = openSlots.filter(s => !bookedTimes.includes(s));
  res.json({ date, available, booked: bookedTimes, openHours: openSlots });
});

// Check if waitlist is available for a date (i.e. no open slots or all open slots are booked)
app.get('/api/waitlist-check/:date', (req, res) => {
  const { date } = req.params;
  const openSlots = availability[date] || [];
  const bookedTimes = appointments
    .filter(a => a.date === date && a.status !== 'cancelled')
    .map(a => a.time);
  const available = openSlots.filter(s => !bookedTimes.includes(s));
  res.json({ date, canWaitlist: available.length === 0, openSlots, availableSlots: available });
});

// Create appointment — only allowed for admin-set open slots
app.post('/api/book', async (req, res) => {
  const { name, email, phone, serviceId, date, time, notes } = req.body;

  if (!name || !email || !serviceId || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(400).json({ error: 'Invalid service' });

  // Check if this slot is in admin-set availability
  const openSlots = availability[date] || [];
  if (!openSlots.includes(time)) {
    return res.status(403).json({ error: 'This time slot is not available. Please join the waitlist.' });
  }

  // Check for double-booking
  const conflict = appointments.find(a => a.date === date && a.time === time && a.status !== 'cancelled');
  if (conflict) return res.status(409).json({ error: 'That time slot is already booked' });

  const id = crypto.randomUUID();
  const appointment = {
    id, name, email, phone: phone || '', serviceId,
    serviceName: service.name, servicePrice: service.price, serviceDuration: service.duration,
    date, time, notes: notes || '', status: 'pending',
    createdAt: new Date().toISOString(),
  };

  appointments.push(appointment);

  // Email specialist
  try {
    await transporter.sendMail({
      from: `"Booking System" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: SPECIALIST_EMAIL,
      subject: `New Appointment Request — ${name} — ${service.name}`,
      html: `<h2>New Appointment Request</h2>
        <p><strong>Client:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
        <p><strong>Service:</strong> ${service.name} (${service.duration} — $${service.price})</p>
        <p><strong>Date:</strong> ${date}</p><p><strong>Time:</strong> ${time}</p>
        <p><strong>Notes:</strong> ${notes || 'None'}</p>
        <p><strong>Status:</strong> Pending — log in to admin portal to confirm</p>`,
    });
  } catch (err) { console.log('Email send skipped:', err.message); }

  // Email client
  try {
    await transporter.sendMail({
      from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: email,
      subject: `Appointment Request Received — ${service.name}`,
      html: `<h2>Thank you, ${name}!</h2><p>We've received your request for:</p>
        <p><strong>Service:</strong> ${service.name}</p><p><strong>Date:</strong> ${date}</p>
        <p><strong>Time:</strong> ${time}</p><p>We'll confirm your appointment shortly.</p>`,
    });
  } catch (err) { console.log('Client email skipped:', err.message); }

  res.status(201).json({ success: true, id, appointment });
});

// Join waitlist for a date
app.post('/api/waitlist', async (req, res) => {
  const { name, email, phone, serviceId, date, notes } = req.body;

  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const service = serviceId ? SERVICES.find(s => s.id === serviceId) : null;
  const id = crypto.randomUUID();
  const entry = {
    id, name, email, phone: phone || '',
    serviceId: serviceId || null,
    serviceName: service ? service.name : 'Any available service',
    date,
    notes: notes || '',
    status: 'waiting', // waiting → confirmed → booked | declined
    createdAt: new Date().toISOString(),
  };

  waitlist.push(entry);

  // Email specialist about waitlist request
  try {
    await transporter.sendMail({
      from: `"Booking System" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: SPECIALIST_EMAIL,
      subject: `Waitlist Request — ${name} — ${date}`,
      html: `<h2>New Waitlist Request</h2>
        <p><strong>Client:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
        <p><strong>Preferred Date:</strong> ${date}</p>
        <p><strong>Service:</strong> ${entry.serviceName}</p>
        <p><strong>Notes:</strong> ${notes || 'None'}</p>
        <p>Log in to admin portal to review and confirm if a slot opens up.</p>`,
    });
  } catch (err) { console.log('Waitlist email skipped:', err.message); }

  // Email client
  try {
    await transporter.sendMail({
      from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: email,
      subject: `Waitlist Request Received — ${date}`,
      html: `<h2>You're on the waitlist, ${name}!</h2>
        <p>We've received your request for ${date}.</p>
        <p>If a slot opens up, we'll contact you to schedule your appointment.</p>`,
    });
  } catch (err) { console.log('Waitlist client email skipped:', err.message); }

  res.status(201).json({ success: true, id, entry });
});

// ══════════════════════════════════════════════
//  ADMIN APIs
// ══════════════════════════════════════════════

function authCheck(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_TOKEN) return res.json({ success: true, token: ADMIN_TOKEN });
  return res.status(401).json({ error: 'Invalid password' });
});

// Get all appointments
app.get('/api/admin/appointments', (req, res) => {
  if (!authCheck(req, res)) return;
  res.json(appointments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Update appointment status
app.patch('/api/admin/appointments/:id', (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const { status } = req.body;
  const appt = appointments.find(a => a.id === id);
  if (!appt) return res.status(404).json({ error: 'Not found' });

  appt.status = status;

  if (status === 'confirmed') {
    try { transporter.sendMail({
      from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: appt.email, subject: `Appointment Confirmed — ${appt.serviceName}`,
      html: `<h2>Your appointment is confirmed!</h2><p><strong>${appt.serviceName}</strong></p><p><strong>Date:</strong> ${appt.date}</p><p><strong>Time:</strong> ${appt.time}</p><p>We look forward to seeing you!</p>`,
    }); } catch (e) { console.log('Confirm email skipped:', e.message); }
  } else if (status === 'cancelled') {
    try { transporter.sendMail({
      from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
      to: appt.email, subject: `Appointment Update — ${appt.serviceName}`,
      html: `<h2>Appointment Update</h2><p>Unfortunately your appointment on ${appt.date} at ${appt.time} has been cancelled. Please book a new time if you'd like to reschedule.</p>`,
    }); } catch (e) { console.log('Cancel email skipped:', e.message); }
  }

  res.json({ success: true, appointment: appt });
});

// ── Availability Management ──

// Get all availability data
app.get('/api/admin/availability', (req, res) => {
  if (!authCheck(req, res)) return;
  res.json(availability);
});

// Set availability for a specific date (replaces existing)
app.post('/api/admin/availability', (req, res) => {
  if (!authCheck(req, res)) return;
  const { date, slots } = req.body;
  if (!date) return res.status(400).json({ error: 'Date required' });

  if (!slots || slots.length === 0) {
    delete availability[date];
  } else {
    availability[date] = slots;
  }

  res.json({ success: true, date, slots: availability[date] || [] });
});

// Set availability for a date range (bulk)
app.post('/api/admin/availability/bulk', (req, res) => {
  if (!authCheck(req, res)) return;
  const { startDate, endDate, slots } = req.body;
  if (!startDate || !endDate || !slots) return res.status(400).json({ error: 'startDate, endDate, and slots required' });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    availability[dateStr] = [...slots];
    dates.push(dateStr);
  }

  res.json({ success: true, dates, slots });
});

// Clear availability for a date
app.delete('/api/admin/availability/:date', (req, res) => {
  if (!authCheck(req, res)) return;
  const { date } = req.params;
  delete availability[date];
  res.json({ success: true, date });
});

// ── Waitlist Management ──

// Get all waitlist entries
app.get('/api/admin/waitlist', (req, res) => {
  if (!authCheck(req, res)) return;
  res.json(waitlist.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Confirm a waitlist entry — creates an appointment and notifies client
app.post('/api/admin/waitlist/:id/confirm', async (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const { time } = req.body; // admin specifies the time slot

  const entry = waitlist.find(w => w.id === id);
  if (!entry) return res.status(404).json({ error: 'Waitlist entry not found' });

  // Create an appointment from the waitlist entry
  const apptId = crypto.randomUUID();
  const service = entry.serviceId ? SERVICES.find(s => s.id === entry.serviceId) : null;
  const appointment = {
    id: apptId,
    name: entry.name, email: entry.email, phone: entry.phone,
    serviceId: entry.serviceId,
    serviceName: service ? service.name : entry.serviceName,
    servicePrice: service ? service.price : 0,
    serviceDuration: service ? service.duration : 'TBD',
    date: entry.date, time: time || 'TBD',
    notes: entry.notes, status: 'confirmed',
    createdAt: new Date().toISOString(),
    fromWaitlist: true,
  };

  appointments.push(appointment);
  entry.status = 'confirmed';
  entry.appointmentId = apptId;

  // Email client — slot opened up!
  try { await transporter.sendMail({
    from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
    to: entry.email,
    subject: `Good news! A slot opened up — ${entry.date}`,
    html: `<h2>Great news, ${entry.name}!</h2>
      <p>A slot has opened up and we'd love to see you.</p>
      <p><strong>Date:</strong> ${entry.date}</p><p><strong>Time:</strong> ${time || 'We will contact you to arrange'}</p>
      <p><strong>Service:</strong> ${appointment.serviceName}</p>
      <p>Your appointment is confirmed. We look forward to seeing you!</p>`,
  }); } catch (e) { console.log('Waitlist confirm email skipped:', e.message); }

  // Email specialist
  try { await transporter.sendMail({
    from: `"Booking System" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
    to: SPECIALIST_EMAIL,
    subject: `Waitlist Confirmed — ${entry.name} — ${entry.date}`,
    html: `<h2>Waitlist Entry Confirmed</h2>
      <p><strong>Client:</strong> ${entry.name}</p><p><strong>Date:</strong> ${entry.date}</p>
      <p><strong>Time:</strong> ${time || 'TBD'}</p><p><strong>Service:</strong> ${appointment.serviceName}</p>`,
  }); } catch (e) { console.log('Waitlist specialist email skipped:', e.message); }

  res.json({ success: true, appointment, waitlistEntry: entry });
});

// Decline a waitlist entry
app.post('/api/admin/waitlist/:id/decline', (req, res) => {
  if (!authCheck(req, res)) return;
  const { id } = req.params;
  const entry = waitlist.find(w => w.id === id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  entry.status = 'declined';

  try { transporter.sendMail({
    from: `"${SPECIALIST_NAME}" <${process.env.SMTP_USER || 'noreply@example.com'}>`,
    to: entry.email,
    subject: `Waitlist Update — ${entry.date}`,
    html: `<h2>Hi ${entry.name},</h2><p>Unfortunately we weren't able to accommodate your waitlist request for ${entry.date}. Please feel free to book another date through our website.</p>`,
  }); } catch (e) { console.log('Decline email skipped:', e.message); }

  res.json({ success: true, entry });
});

app.listen(PORT, () => {
  console.log(`🌵 Kayci Sonoran server running → http://localhost:${PORT}`);
  console.log(`📋 Admin portal → http://localhost:${PORT}/admin.html`);
});
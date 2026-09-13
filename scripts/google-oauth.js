#!/usr/bin/env node
/**
 * One-time helper to obtain a Google refresh token for Kayci Cactus.
 *
 * 1. Create an OAuth client (Desktop app) in Google Cloud Console
 * 2. Enable Google Calendar API
 * 3. Put the client id + secret in .env
 * 4. Run: node scripts/google-oauth.js
 * 5. Paste the printed GOOGLE_REFRESH_TOKEN into .env and Lambda env
 */

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.OAUTH_PORT || 4280);
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing code');
      return;
    }
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Google Calendar connected. You can close this tab and return to the terminal.');
    console.log('\nAdd this to .env and to your Lambda environment:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token || ''}`);
    if (!tokens.refresh_token) {
      console.log('\nNo refresh token returned. Revoke access at https://myaccount.google.com/permissions and run this script again with prompt=consent.');
    }
    server.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(String(err.message));
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Open this URL, sign in with the studio Google account, and approve Calendar access:\n');
  console.log(authUrl);
  console.log(`\nWaiting on ${REDIRECT}`);
});

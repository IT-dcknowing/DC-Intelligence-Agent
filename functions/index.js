const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/**
 * Meta WhatsApp Webhook Verification Endpoint (GET)
 * Meta sends GET request with hub.mode, hub.verify_token and hub.challenge
 */
app.get('*', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const allowedTokens = [
    'KeySoc26',
    'dc_intelligence_webhook_secure_token_2026',
    process.env.WHATSAPP_VERIFY_TOKEN,
  ].filter(Boolean);

  console.log(`[META VERIFY] mode=${mode}, token=${token}, challenge=${challenge}`);

  if (mode === 'subscribe' && allowedTokens.includes(token)) {
    console.log('[META VERIFY] Webhook verified successfully 200 OK!');
    return res.status(200).send(challenge);
  }

  console.warn('[META VERIFY] Token mismatch or invalid mode.');
  return res.status(403).send('Forbidden: Invalid verify token');
});

/**
 * Meta WhatsApp Incoming Messages Webhook (POST)
 */
app.post('*', (req, res) => {
  console.log('[META WEBHOOK EVENT]', JSON.stringify(req.body));
  return res.status(200).send('EVENT_RECEIVED');
});

exports.whatsappWebhook = functions.https.onRequest(app);

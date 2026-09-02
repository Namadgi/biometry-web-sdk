import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { BiometrySDK, BiometryApiError } from 'biometry-sdk/sdk';
import dotenv from 'dotenv';

dotenv.config();

const upload = multer();
const app = express();
const port = 3001;

app.use(cors());

const API_KEY = process.env.BIOMETRY_API_KEY;

if (!API_KEY) {
  console.error('BIOMETRY_API_KEY environment variable is required');
  process.exit(1);
}

const sdk = new BiometrySDK(API_KEY);

/**
 * Forwards the gateway's own status and error code to the browser instead of
 * flattening everything into a 500. Anything that is not a BiometryApiError is
 * a bug on this side, so it stays a 500.
 */
const sendError = (res, error, context) => {
  console.error(`Error ${context}:`, error);
  if (error instanceof BiometryApiError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return res.status(500).json({ error: 'Internal server error' });
};

const toFile = (uploaded) =>
  new File([uploaded.buffer], uploaded.originalname, { type: uploaded.mimetype });

app.post('/start-session', async (req, res) => {
  try {
    const response = await sdk.startSession();
    res.json({ sessionId: response.body.data?.session_id });
  } catch (error) {
    sendError(res, error, 'starting session');
  }
});

app.post('/submit-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing video file' });
    }

    // v2 identifies the user by an opaque id you choose, sent in the JSON
    // `request` part. v1 sent a full name in the X-User-Fullname header.
    const { phrase, userId } = req.body;
    const sessionId = req.headers['x-session-id'];

    const response = await sdk.liveness(toFile(req.file), userId, phrase, { sessionId });

    res.json(response.body);
  } catch (error) {
    sendError(res, error, 'processing video');
  }
});

app.post('/submit-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing document file' });
    }

    const { provider } = req.body;
    const sessionId = req.headers['x-session-id'];

    const response = await sdk.checkDocAuth(toFile(req.file), {
      sessionId,
      provider: provider || undefined,
    });

    res.json(response.body);
  } catch (error) {
    sendError(res, error, 'processing ID document');
  }
});

app.listen(port, () => {
  console.log(`Custom backend server running at http://localhost:${port}`);
});

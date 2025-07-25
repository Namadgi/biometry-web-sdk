import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { BiometrySDK } from 'biometry-sdk/sdk';
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

app.post('/submit-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing video file' });
    }

    const { phrase, userFullname } = req.body;

    const sessionId = req.headers['x-session-id'];
    const deviceInfoHeader = req.headers['x-device-info'];

    const deviceInfo = deviceInfoHeader ? JSON.parse(deviceInfoHeader) : undefined;

    const file = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });

    const response = await sdk.processVideo(file, phrase, userFullname, {
      sessionId,
      deviceInfo,
    });

    res.json(response);
  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/submit-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing document file' });
    }

    const { userFullname } = req.body;
    const sessionId = req.headers['x-session-id'];
    const deviceInfoHeader = req.headers['x-device-info'];
    const deviceInfo = deviceInfoHeader ? JSON.parse(deviceInfoHeader) : undefined;

    const file = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });

    // Use the SDK's document check method
    const response = await sdk.checkDocAuth(file, userFullname, {
      sessionId,
      deviceInfo,
    });

    res.json(response);
  } catch (error) {
    console.error('Error processing ID document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Custom backend server running at http://localhost:${port}`);
});

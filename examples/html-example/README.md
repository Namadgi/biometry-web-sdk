# Plain HTML example

A browser page with no build step, talking to a small Express server that holds the API key.

The split matters: `BiometrySDK` takes your API key, so it belongs on a server you control. The
page only uploads files to that server.

## Run it

```bash
cd server
npm install
echo "BIOMETRY_API_KEY=your-key" > .env
npm start          # http://localhost:3001
```

Then serve the client from any static server, for example:

```bash
cd ../client
npx serve .
```

Open the printed URL. The page expects the server on `http://localhost:3001`; change `SERVER` at the
top of `client/index.js` if you moved it.

## What it shows

| Page action | Server route | SDK call |
| --- | --- | --- |
| Start session | `POST /start-session` | `startSession()` |
| Submit video | `POST /submit-video` | `liveness(video, userId, phrase, { sessionId })` |
| Check document | `POST /submit-document` | `checkDocAuth(document, { provider, sessionId })` |

The server forwards the gateway's status and error code from `BiometryApiError` rather than
collapsing every failure into a 500, so the page shows what actually went wrong.

Biometric operations identify the user by an opaque `userId` that you choose — API v2 no longer
takes a full name.

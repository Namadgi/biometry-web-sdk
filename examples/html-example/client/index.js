// The SDK is not loaded here on purpose: it takes the API key, which belongs on
// the server. This page only talks to the example server in ../server, which
// holds the key and calls the SDK.

const SERVER = 'http://localhost:3001';

let sessionId = '';

const show = (id, value) => {
  document.getElementById(id).textContent =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

/** Posts to the example server and surfaces the error body it forwards from the gateway. */
const post = async (path, body) => {
  const response = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: sessionId ? { 'x-session-id': sessionId } : {},
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }
  return payload;
};

document.getElementById('start-session').addEventListener('click', async () => {
  try {
    const { sessionId: id } = await post('/start-session');
    sessionId = id || '';
    show('session-id', sessionId || 'none');
  } catch (error) {
    show('session-id', `error: ${error.message}`);
  }
});

document.getElementById('video-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  show('video-result', 'Processing...');

  try {
    show('video-result', await post('/submit-video', new FormData(event.target)));
  } catch (error) {
    show('video-result', `error: ${error.message}`);
  }
});

document.getElementById('document-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  show('document-result', 'Checking...');

  try {
    show('document-result', await post('/submit-document', new FormData(event.target)));
  } catch (error) {
    show('document-result', `error: ${error.message}`);
  }
});

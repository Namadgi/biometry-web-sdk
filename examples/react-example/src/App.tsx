import React, { useState } from 'react';
import { BiometrySDK, BiometryApiError } from 'biometry-sdk/sdk';

type VerifyOperation = 'liveness' | 'faceVerify' | 'voiceVerify';

/** Renders an error the way the v2 envelope reports it, rather than "[object Object]". */
const describeError = (error: unknown): string => {
  if (error instanceof BiometryApiError) {
    return `${error.message}${error.code ? ` (code: ${error.code})` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
};

const App: React.FC = () => {
  // SDK Initialization state
  const [apiKey, setApiKey] = useState('');
  const [sdk, setSdk] = useState<BiometrySDK | null>(null);
  const [initLoading, setInitLoading] = useState(false);
  const [initResult, setInitResult] = useState<string | null>(null);

  // Identity state. userId is the opaque key v2 uses for every biometric
  // operation; the full name is only for consent, which the consent service
  // still identifies by name.
  const [userId, setUserId] = useState('');
  const [userFullName, setUserFullName] = useState('');

  // Session state
  const [sessionId, setSessionId] = useState('');
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionResult, setSessionResult] = useState<string | null>(null);

  // Consent state
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentResult, setConsentResult] = useState<string | null>(null);

  // Face Enrollment state
  const [isDocument, setIsDocument] = useState(false);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceResult, setFaceResult] = useState<string | null>(null);

  // Verification state
  const [operation, setOperation] = useState<VerifyOperation>('liveness');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [phrase, setPhrase] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<string | null>(null);

  // Document authenticity state
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [provider, setProvider] = useState<'inhouse' | 'idscan'>('inhouse');
  const [docLoading, setDocLoading] = useState(false);
  const [docResult, setDocResult] = useState<string | null>(null);

  const initializeSdk = () => {
    setInitLoading(true);
    try {
      if (apiKey) {
        const newSdk = new BiometrySDK(apiKey);
        setSdk(newSdk);
        setInitResult('SDK initialized successfully!');
      } else {
        setInitResult('Please provide a valid API key.');
      }
    } catch (error) {
      setInitResult(`Error initializing SDK: ${describeError(error)}`);
    } finally {
      setInitLoading(false);
    }
  };

  const handleStartSession = async () => {
    if (!sdk) {
      setSessionResult('SDK is not initialized.');
      return;
    }

    setSessionLoading(true);
    try {
      const response = await sdk.startSession();
      // v2 nests the identifier one level deeper than v1 did.
      const id = response.body.data?.session_id ?? '';
      setSessionId(id);
      setSessionResult(`Session started: ${id}`);
    } catch (error) {
      setSessionResult(`Error starting session: ${describeError(error)}`);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleEndSession = async () => {
    if (!sdk || !sessionId) {
      setSessionResult('SDK is not initialized or there is no open session.');
      return;
    }

    setSessionLoading(true);
    try {
      await sdk.endSession(sessionId);
      setSessionResult(`Session ${sessionId} ended.`);
      setSessionId('');
    } catch (error) {
      setSessionResult(`Error ending session: ${describeError(error)}`);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleConsentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConsentLoading(true);

    if (sdk && userFullName) {
      try {
        // Process BOTH Authorization and Storage consents
        const authResponse = await sdk.giveAuthorizationConsent(true, userFullName);
        const storageResponse = await sdk.giveStorageConsent(true, userFullName);

        setConsentResult(
          `Consent Successful!\nAuthorization: ${JSON.stringify(authResponse)}\nStorage: ${JSON.stringify(storageResponse)}`
        );
      } catch (error) {
        setConsentResult(`Error giving consent: ${describeError(error)}`);
      } finally {
        setConsentLoading(false);
      }
    } else {
      setConsentResult('SDK is not initialized or full name is missing.');
      setConsentLoading(false);
    }
  };

  const handleFaceEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFaceLoading(true);

    if (sdk && faceFile && userId) {
      try {
        const response = await sdk.enrollFace(faceFile, userId, { isDocument });

        setFaceResult(`Face Enrollment Successful: ${JSON.stringify(response.body)}`);
      } catch (error) {
        setFaceResult(`Error in face enrollment: ${describeError(error)}`);
      } finally {
        setFaceLoading(false);
      }
    } else {
      setFaceResult('SDK is not initialized, no file selected, or user ID is missing.');
      setFaceLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVideoLoading(true);

    if (sdk && videoFile && phrase && userId) {
      try {
        // v1's processVideo is split in three: liveness only, liveness plus
        // face recognition, liveness plus voice recognition. Passing the
        // session id lets the backend score them together.
        const props = sessionId ? { sessionId } : undefined;
        const response =
          operation === 'liveness'
            ? await sdk.liveness(videoFile, userId, phrase, props)
            : operation === 'faceVerify'
              ? await sdk.faceVerify(videoFile, userId, phrase, props)
              : await sdk.voiceVerify(videoFile, userId, phrase, props);

        const decision = response.body.decision;
        setVideoResult(
          `${operation} successful${decision ? ` — decision: ${decision.status}` : ''}\n${JSON.stringify(response.body)}`
        );
      } catch (error) {
        setVideoResult(`Error in ${operation}: ${describeError(error)}`);
      } finally {
        setVideoLoading(false);
      }
    } else {
      setVideoResult('SDK is not initialized, no file selected, or required fields are missing.');
      setVideoLoading(false);
    }
  };

  const handleDocAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDocLoading(true);

    if (sdk && documentFile) {
      try {
        const response = await sdk.checkDocAuth(documentFile, {
          provider,
          sessionId: sessionId || undefined,
        });

        setDocResult(`Document check successful: ${JSON.stringify(response.body)}`);
      } catch (error) {
        setDocResult(`Error in document check: ${describeError(error)}`);
      } finally {
        setDocLoading(false);
      }
    } else {
      setDocResult('SDK is not initialized or no document selected.');
      setDocLoading(false);
    }
  };

  const sectionStyle = {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '20px',
  };

  const resultStyle = {
    marginTop: '15px',
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    whiteSpace: 'pre-wrap' as const,
  };

  const inputStyle = { width: '100%', padding: '8px', marginTop: '5px' };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '30px' }}>Biometry SDK Demo (API v2)</h1>

      {/* Step 1: SDK Initialization */}
      <div style={sectionStyle}>
        <h2>Step 1: Initialize SDK</h2>
        <p>Enter your API key to initialize the Biometry SDK.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="apiKey">API Key:</label>
          <input
            type="text"
            id="apiKey"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ flex: 1, padding: '8px' }}
          />
          <button
            onClick={initializeSdk}
            disabled={initLoading}
            style={{ padding: '8px 16px', cursor: initLoading ? 'wait' : 'pointer' }}
          >
            {initLoading ? 'Initializing...' : 'Initialize SDK'}
          </button>
        </div>

        {initResult && <div style={resultStyle}>{initResult}</div>}
      </div>

      {/* Step 2: Identity */}
      <div style={sectionStyle}>
        <h2>Step 2: Identify the user</h2>
        <p>
          Biometric operations take an opaque <code>userId</code> that you choose and control. Consent is separate and
          still identifies the user by full name.
        </p>

        <label style={{ display: 'block', marginBottom: '15px' }}>
          User ID:
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. customer-42"
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'block' }}>
          Full Name (consent only):
          <input
            type="text"
            value={userFullName}
            onChange={(e) => setUserFullName(e.target.value)}
            placeholder="Enter your full name"
            style={inputStyle}
          />
        </label>
      </div>

      {/* Step 3: Session */}
      <div style={sectionStyle}>
        <h2>Step 3: Session (optional)</h2>
        <p>A session groups several checks so the backend can score them together.</p>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleStartSession}
            disabled={!sdk || sessionLoading || !!sessionId}
            style={{ padding: '8px 16px', cursor: !sdk || sessionLoading || sessionId ? 'not-allowed' : 'pointer' }}
          >
            {sessionLoading ? 'Working...' : 'Start Session'}
          </button>
          <button
            onClick={handleEndSession}
            disabled={!sdk || sessionLoading || !sessionId}
            style={{ padding: '8px 16px', cursor: !sdk || sessionLoading || !sessionId ? 'not-allowed' : 'pointer' }}
          >
            End Session
          </button>
        </div>

        {sessionResult && <div style={resultStyle}>{sessionResult}</div>}
      </div>

      {/* Step 4: Give Consent */}
      <div style={sectionStyle}>
        <h2>Step 4: Give Consents</h2>
        <p>Give authorization and storage consent for the full name entered above.</p>

        <form onSubmit={handleConsentSubmit}>
          <button
            type="submit"
            disabled={!sdk || !userFullName || consentLoading}
            style={{
              padding: '8px 16px',
              cursor: !sdk || !userFullName || consentLoading ? 'not-allowed' : 'pointer',
              opacity: !sdk || !userFullName ? 0.6 : 1,
            }}
          >
            {consentLoading ? 'Processing...' : 'Give Consent'}
          </button>
        </form>

        {consentResult && <div style={resultStyle}>{consentResult}</div>}
      </div>

      {/* Step 5: Face Enrollment */}
      <div style={sectionStyle}>
        <h2>Step 5: Enroll Face</h2>
        <p>Upload an image to enroll this user's face.</p>

        <form onSubmit={handleFaceEnrollSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Is Document:
              <input
                type="checkbox"
                checked={isDocument}
                onChange={(e) => setIsDocument(e.target.checked)}
                style={{ marginLeft: '10px' }}
              />
            </label>
            <p style={{ fontSize: '0.8rem', color: '#666' }}>
              Check this if you're uploading an ID document instead of a face photo
            </p>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Upload Face Image:
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFaceFile(e.target.files?.[0] || null)}
                style={inputStyle}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || !userId || faceLoading}
            style={{
              padding: '8px 16px',
              cursor: !sdk || !userId || faceLoading ? 'not-allowed' : 'pointer',
              opacity: !sdk || !userId ? 0.6 : 1,
            }}
          >
            {faceLoading ? 'Enrolling...' : 'Enroll Face'}
          </button>
        </form>

        {faceResult && <div style={resultStyle}>{faceResult}</div>}
      </div>

      {/* Step 6: Verification */}
      <div style={sectionStyle}>
        <h2>Step 6: Verify</h2>
        <p>
          Upload a video of the user speaking the phrase. Phrase should be a set of transcribed digits.{' '}
          <code>liveness</code> checks the capture is live, <code>faceVerify</code> and <code>voiceVerify</code> also
          match it against the enrolled user.
        </p>

        <form onSubmit={handleVerifySubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Operation:
              <select
                value={operation}
                onChange={(e) => setOperation(e.target.value as VerifyOperation)}
                style={inputStyle}
              >
                <option value="liveness">liveness</option>
                <option value="faceVerify">faceVerify</option>
                <option value="voiceVerify">voiceVerify</option>
              </select>
            </label>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Phrase:
              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Enter phrase to speak in video"
                style={inputStyle}
                required
              />
            </label>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Upload Video:
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                style={inputStyle}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || !userId || videoLoading}
            style={{
              padding: '8px 16px',
              cursor: !sdk || !userId || videoLoading ? 'not-allowed' : 'pointer',
              opacity: !sdk || !userId ? 0.6 : 1,
            }}
          >
            {videoLoading ? 'Processing...' : 'Run Verification'}
          </button>
        </form>

        {videoResult && <div style={resultStyle}>{videoResult}</div>}
      </div>

      {/* Step 7: Document authenticity */}
      <div style={sectionStyle}>
        <h2>Step 7: Check a Document</h2>
        <p>Upload an identity document to check its authenticity.</p>

        <form onSubmit={handleDocAuthSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Provider:
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'inhouse' | 'idscan')}
                style={inputStyle}
              >
                <option value="inhouse">inhouse</option>
                <option value="idscan">idscan</option>
              </select>
            </label>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Upload Document:
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                style={inputStyle}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || docLoading}
            style={{
              padding: '8px 16px',
              cursor: !sdk || docLoading ? 'not-allowed' : 'pointer',
              opacity: !sdk ? 0.6 : 1,
            }}
          >
            {docLoading ? 'Checking...' : 'Check Document'}
          </button>
        </form>

        {docResult && <div style={resultStyle}>{docResult}</div>}
      </div>
    </div>
  );
};

export default App;

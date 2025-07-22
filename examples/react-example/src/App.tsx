import React, { useState } from 'react';
import { BiometrySDK } from 'biometry-sdk/sdk';
import { BiometryEnrollment, ProcessVideo } from 'biometry-sdk/react';

const App: React.FC = () => {
  // SDK Initialization state
  const [apiKey, setApiKey] = useState('');
  const [sdk, setSdk] = useState<BiometrySDK | null>(null);
  const [initLoading, setInitLoading] = useState(false);
  const [initResult, setInitResult] = useState<string | null>(null);

  // Consent state
  const [userFullName, setUserFullName] = useState('');
  const [consentLoading, setConsentLoading] = useState(false);
  const [consentResult, setConsentResult] = useState<string | null>(null);

  // Face Enrollment state
  const [isDocument, setIsDocument] = useState(false);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [faceLoading, setFaceLoading] = useState(false);
  const [faceResult, setFaceResult] = useState<string | null>(null);

  // Video Processing state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [phrase, setPhrase] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<string | null>(null);

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
      setInitResult(`Error initializing SDK: ${error}`);
    } finally {
      setInitLoading(false);
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
        setConsentResult(`Error giving consent: ${error}`);
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

    if (sdk && faceFile && userFullName) {
      try {
        const response = await sdk.enrollFace(
          faceFile,
          userFullName,
          isDocument
        );

        setFaceResult(`Face Enrollment Successful: ${JSON.stringify(response)}`);
      } catch (error) {
        setFaceResult(`Error in face enrollment: ${error}`);
      } finally {
        setFaceLoading(false);
      }
    } else {
      setFaceResult('SDK is not initialized, no file selected, or full name is missing.');
      setFaceLoading(false);
    }
  };

  const handleVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVideoLoading(true);

    if (sdk && videoFile && phrase && userFullName) {
      try {
        const response = await sdk.processVideo(
          videoFile,
          phrase,
          userFullName
        );
        setVideoResult(`Video Processing Successful: ${JSON.stringify(response)}`);
      } catch (error) {
        setVideoResult(`Error in video processing: ${error}`);
      } finally {
        setVideoLoading(false);
      }
    } else {
      setVideoResult('SDK is not initialized, no file selected, or required fields are missing.');
      setVideoLoading(false);
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
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '30px' }}>Biometry SDK Demo</h1>

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

      {/* Step 2: Give Consent */}
      <div style={sectionStyle}>
        <h2>Step 2: Give Consents</h2>
        <p>Provide your full name to give authorization and storage consent.</p>

        <form onSubmit={handleConsentSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Full Name:
              <input
                type="text"
                value={userFullName}
                onChange={(e) => setUserFullName(e.target.value)}
                placeholder="Enter your full name"
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || consentLoading}
            style={{
              padding: '8px 16px',
              cursor: (!sdk || consentLoading) ? 'not-allowed' : 'pointer',
              opacity: !sdk ? 0.6 : 1
            }}
          >
            {consentLoading ? 'Processing...' : 'Give Consent'}
          </button>
        </form>

        {consentResult && <div style={resultStyle}>{consentResult}</div>}
      </div>

      {/* Step 3: Face Enrollment */}
      <div style={sectionStyle}>
        <h2>Step 3: Enroll Face</h2>
        <p>Upload an image to enroll your face in the system.</p>

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
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || !userFullName || faceLoading}
            style={{
              padding: '8px 16px',
              cursor: (!sdk || !userFullName || faceLoading) ? 'not-allowed' : 'pointer',
              opacity: (!sdk || !userFullName) ? 0.6 : 1
            }}
          >
            {faceLoading ? 'Enrolling...' : 'Enroll Face'}
          </button>
        </form>

        {faceResult && <div style={resultStyle}>{faceResult}</div>}
      </div>

      {/* Step 4: Process Video */}
      <div style={sectionStyle}>
        <h2>Step 4: Process Video</h2>
        <p>Upload a video and provide a phrase for verification. Phrase should be a set of transcribed digits.</p>

        <form onSubmit={handleVideoSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px' }}>
              Phrase:
              <input
                type="text"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Enter phrase to speak in video"
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
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
                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                required
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!sdk || !userFullName || videoLoading}
            style={{
              padding: '8px 16px',
              cursor: (!sdk || !userFullName || videoLoading) ? 'not-allowed' : 'pointer',
              opacity: (!sdk || !userFullName) ? 0.6 : 1
            }}
          >
            {videoLoading ? 'Processing...' : 'Process Video'}
          </button>
        </form>

        {videoResult && <div style={resultStyle}>{videoResult}</div>}
      </div>
    </div>
  );
};

export default App;

import React, { useState } from 'react';
import { BiometrySDK } from 'biometry-sdk';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [sdk, setSdk] = useState<BiometrySDK | null>(null);

  const [userFullName, setUserFullName] = React.useState('');
  const [isDocument, setIsDocument] = React.useState(false);
  const [onboardFile, setOnboardFile] = React.useState<File | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [phrase, setPhrase] = React.useState('');
  const [result, setResult] = useState<string | null>(null);

  const initializeSdk = () => {
    if (apiKey) {
      setSdk(new BiometrySDK(apiKey));
      sdk?.giveConsent(true, 'John Doe'); 
      setResult('SDK initialized successfully!');
    } else {
      setResult('Please provide a valid API key.');
    }
  };

  const handleOnboardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sdk && onboardFile && userFullName) {
      try {
        const response = await sdk.onboardFace(
          onboardFile,
          userFullName,
          isDocument
        );

        setResult(`Onboarding Successful: ${JSON.stringify(response)}`);
      } catch (error) {
        setResult(`Error in onboarding: ${error}`);
      }
    } else {
      setResult('SDK is not initialized, no file selected, or full name is missing.');
    }
  };

  const handleVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sdk && videoFile && phrase) {
      try {
        const response = await sdk.processVideo(
          videoFile,
          phrase,
          userFullName
        );
        setResult(`Video Processing Successful: ${JSON.stringify(response)}`);
      } catch (error) {
        setResult(`Error in video processing: ${error}`);
      }
    } else {
      setResult('SDK is not initialized or no file selected.');
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>
      <h1>Biometry SDK Demo</h1>

      {/* API Key Field */}
      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="apiKey">API Key:</label>
        <input
          type="text"
          id="apiKey"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ marginLeft: '10px', padding: '5px' }}
        />
        <button onClick={initializeSdk} style={{ marginLeft: '10px', padding: '5px 10px' }}>
          Initialize SDK
        </button>
      </div>

      {/* Onboard Face Form */}
      <form onSubmit={handleOnboardSubmit} style={{ marginBottom: '20px' }}>
        <h2>Onboard Face</h2>

        <div style={{ marginBottom: '10px' }}>
          <label>
            Full Name:
            <input
              type="text"
              value={userFullName}
              onChange={(e) => setUserFullName(e.target.value)}
              placeholder="Enter full name"
              style={{ marginLeft: '10px', padding: '5px' }}
              required
            />
          </label>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>
            Is Document:
            <input
              type="checkbox"
              checked={isDocument}
              onChange={(e) => setIsDocument(e.target.checked)}
              style={{ marginLeft: '10px' }}
            />
          </label>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>
            Upload File:
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setOnboardFile(e.target.files?.[0] || null)}
              style={{ marginLeft: '10px' }}
              required
            />
          </label>
        </div>

        <button type="submit" style={{ padding: '5px 10px' }}>
          Submit
        </button>
      </form>

      {/* Video Processing Form */}
      <form onSubmit={handleVideoSubmit}>
        <h2>Process Video</h2>

        <div style={{ marginBottom: '10px' }}>
          <label>
            Phrase:
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Enter full name"
              style={{ marginLeft: '10px', padding: '5px' }}
              required
            />
          </label>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>
            User Full Name:
            <input
              type="text"
              value={userFullName}
              onChange={(e) => setUserFullName(e.target.value)}
              placeholder="Enter full name"
              style={{ marginLeft: '10px', padding: '5px' }}
              required
            />
          </label>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>
            Upload video:
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              style={{ marginLeft: '10px' }}
              required
            />
          </label>
        </div>

        <button type="submit" style={{ padding: '5px 10px' }}>
          Submit
        </button>
      </form>

      {/* Result Display */}
      {result && (
        <div style={{ marginTop: '20px', padding: '10px', border: '1px solid #ccc' }}>
          <strong>Result:</strong> {result}
        </div>
      )}
    </div>
  );
};

export default App;

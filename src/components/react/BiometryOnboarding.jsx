import React from "react";
import { useRef } from "react";

const { useEffect } = require("react");

const BiometryOnboarding = ({
  apiKey,
  userFullname,
  onSuccess,
  onError,
  onLoading,
  className,
  children,
  ...props
}) => {
  const onboardingRef = useRef(null);

  useEffect(() => {
    const onboardingElement = onboardingRef.current;

    if (onboardingElement) {
      // Set attributes for the custom element
      onboardingElement.setAttribute('api-key', apiKey);
      onboardingElement.setAttribute('user-fullname', userFullname);

      // Event handler for state changes
      const handleStateChange = (event) => {
        switch (event.detail?.state) {
          case 'loading':
            onLoading?.();
            break;
          case 'success':
            onSuccess?.();
            break;
          case 'error':
            onError?.(event.detail?.message || 'An error occurred');
            break;
          default:
            break;
        }
      };

      // Attach the event listener
      onboardingElement.addEventListener('stateChange', handleStateChange);

      // Cleanup the event listener on unmount
      return () => {
        onboardingElement.removeEventListener('stateChange', handleStateChange);
      };
    }
  }, [apiKey, userFullname, onSuccess, onError, onLoading]);

  return (
    <div
      className={`biometry-onboarding-wrapper ${className || ''}`}
      {...props}
    >
      <biometry-onboarding ref={onboardingRef}>
        {/* Default slots with fallback content */}
        <div slot="video" className="default-video">
          <video autoPlay muted playsInline></video>
        </div>
        <div slot="button" className="default-button">
          <button>Start Onboarding</button>
        </div>
        <div slot="canvas" className="default-canvas">
          <canvas width="640" height="480"></canvas>
        </div>
        <div slot="loading" className="default-loading">Loading...</div>
        <div slot="success" className="default-success">Onboarding Successful!</div>
        <div slot="error-no-face" className="default-error">No face detected.</div>
        <div slot="error-multiple-faces" className="default-error">Multiple faces detected.</div>
        <div slot="error-not-centered" className="default-error">Face not centered.</div>
        <div slot="error-other" className="default-error">An unknown error occurred.</div>

        {/* Allow overriding default slots */}
        {children}
      </biometry-onboarding>
    </div>
  );
};

export default BiometryOnboarding;
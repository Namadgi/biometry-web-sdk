import React from "react";
import { useRef } from "react";

const { useEffect } = require("react");

const BiometryEnrollment = ({
  apiKey,
  userFullname,
  onSuccess,
  onError,
  onLoading,
  className,
  children,
  ...props
}) => {
  const enrollmentRef = useRef(null);

  useEffect(() => {
    const enrollmentElement = enrollmentRef.current;

    if (enrollmentElement) {
      // Set attributes for the custom element
      enrollmentElement.setAttribute('api-key', apiKey);
      enrollmentElement.setAttribute('user-fullname', userFullname);

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
      enrollmentElement.addEventListener('stateChange', handleStateChange);

      // Cleanup the event listener on unmount
      return () => {
        enrollmentElement.removeEventListener('stateChange', handleStateChange);
      };
    }
  }, [apiKey, userFullname, onSuccess, onError, onLoading]);

  return (
    <div
      className={`biometry-enrollment-wrapper ${className || ''}`}
      {...props}
    >
      <biometry-enrollment ref={enrollmentRef}>
        {/* Default slots with fallback content */}
        <div slot="video" className="default-video">
          <video autoPlay muted playsInline></video>
        </div>
        <div slot="button" className="default-button">
          <button>Start Enrollment</button>
        </div>
        <div slot="canvas" className="default-canvas">
          <canvas width="640" height="480"></canvas>
        </div>
        <div slot="loading" className="default-loading">Loading...</div>
        <div slot="success" className="default-success">Enrollment Successful!</div>
        <div slot="error-no-face" className="default-error">No face detected.</div>
        <div slot="error-multiple-faces" className="default-error">Multiple faces detected.</div>
        <div slot="error-not-centered" className="default-error">Face not centered.</div>
        <div slot="error-other" className="default-error">An unknown error occurred.</div>

        {/* Allow overriding default slots */}
        {children}
      </biometry-enrollment>
    </div>
  );
};

export default BiometryEnrollment;
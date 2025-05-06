import React, { useEffect, useRef } from "react";

const ProcessVideo = ({
  endpoint,
  userFullname,
  onSuccess,
  onError,
  onLoading,
  className,
  children,
  ...props
}) => {
  const processRef = useRef(null);

  useEffect(() => {
    const element = processRef.current;

    if (element) {
      if (endpoint) element.setAttribute("endpoint", endpoint);
      if (userFullname) element.setAttribute("user-fullname", userFullname);

      const handleStateChange = (event) => {
        switch (event.detail?.state) {
          case "loading":
            onLoading?.();
            break;
          case "success":
            onSuccess?.(event.detail?.data);
            break;
          case "error":
            onError?.(event.detail?.message || "An error occurred");
            break;
          default:
            break;
        }
      };

      element.addEventListener("stateChange", handleStateChange);

      return () => {
        element.removeEventListener("stateChange", handleStateChange);
      };
    }
  }, [endpoint, userFullname, onSuccess, onError, onLoading]);

  return (
    <div className={`process-video-wrapper ${className || ""}`} {...props}>
      <process-video ref={processRef}>{children}</process-video>
    </div>
  );
};

export default ProcessVideo;

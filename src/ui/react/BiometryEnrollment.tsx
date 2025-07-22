import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";

import "../biometry-enrollment";
import { type BiometryEnrollment } from "../biometry-enrollment";

export interface BiometryEnrollmentProps extends React.HTMLAttributes<HTMLElement> {
  endpoint?: string;
  userFullname?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export interface BiometryEnrollmentRef {
  validateAttributes: () => void;
  init: () => void;
  cleanup: () => void;
}

const BiometryEnrollmentWrapper = forwardRef<BiometryEnrollmentRef, BiometryEnrollmentProps>(
  ({ endpoint, userFullname, className, style, children, ...rest }, ref) => {
    const elementRef = useRef<HTMLElement & BiometryEnrollment>(null);

    useImperativeHandle(ref, () => ({
      validateAttributes: () => {
        elementRef.current?.validateAttributes();
      },
      init: () => {
        elementRef.current?.init();
      },
      cleanup: () => {
        elementRef.current?.cleanup();
      },
    }));

    useEffect(() => {
      if (elementRef.current) {
        if (endpoint !== undefined)
          elementRef.current.setAttribute("endpoint", endpoint);
        if (userFullname !== undefined)
          elementRef.current.setAttribute("user-fullname", userFullname);
      }
    }, [endpoint, userFullname]);

    return React.createElement(
      "biometry-enrollment",
      {
        ref: elementRef,
        className,
        style,
        ...rest,
      },
      children
    );
  }
);

BiometryEnrollmentWrapper.displayName = "BiometryEnrollment";

export default BiometryEnrollmentWrapper;

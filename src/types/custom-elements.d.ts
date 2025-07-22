import type React from "react"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "biometry-enrollment": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "process-video": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export { };
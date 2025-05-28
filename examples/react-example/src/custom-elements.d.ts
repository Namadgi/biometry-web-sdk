declare namespace JSX {
  interface IntrinsicElements {
    "process-video": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      onprocessComplete?: (event: CustomEvent) => void;
      onerror?: (event: CustomEvent) => void;
    };
  }
}
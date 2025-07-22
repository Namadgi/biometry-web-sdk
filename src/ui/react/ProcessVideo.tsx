import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";

import '../process-video';
import type { ProcessVideo } from "../process-video";

export interface ProcessVideoProps extends React.HTMLAttributes<HTMLElement> {
  endpoint?: string;
  userFullname?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export interface ProcessVideoRef {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  handleSubmit: () => Promise<void>;

  currentPhrase: string;
  isRecording: boolean;
  videoDuration: number | null;
  currentFile: File | null;
  currentStream: MediaStream | null;

  videoElementRef: HTMLVideoElement;
  fileInputRef: HTMLInputElement;

  recordingTimeLimit: number;
  setRecordingTimeLimit: (value: number) => void;
}

const ProcessVideoWrapper = forwardRef<ProcessVideoRef, ProcessVideoProps>(
  ({ endpoint, userFullname, className, style, children, ...rest }, ref) => {
    const elementRef = useRef<HTMLElement & ProcessVideo>(null);

    useImperativeHandle(ref, () => ({
      startRecording: () => elementRef.current!.startRecording(),
      stopRecording: () => elementRef.current!.stopRecording(),
      handleSubmit: () => elementRef.current!.handleSubmit(),

      get currentPhrase() {
        return elementRef.current!.currentPhrase;
      },
      get isRecording() {
        return elementRef.current!.isRecording;
      },
      get videoDuration() {
        return elementRef.current!.videoDuration;
      },
      get currentFile() {
        return elementRef.current!.currentFile;
      },
      get currentStream() {
        return elementRef.current!.currentStream;
      },
      get videoElementRef() {
        return elementRef.current!.videoElementRef;
      },
      get fileInputRef() {
        return elementRef.current!.fileInputRef;
      },
      get recordingTimeLimit() {
        return elementRef.current!.recordingTimeLimit;
      },
      setRecordingTimeLimit(value: number) {
        elementRef.current!.recordingTimeLimit = value;
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
      "process-video",
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

ProcessVideoWrapper.displayName = "ProcessVideo";

export default ProcessVideoWrapper;

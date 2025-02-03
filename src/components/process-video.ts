import { BiometrySDK } from "../sdk.js";
import ysFixWebmDuration from "fix-webm-duration";

export class ProcessVideoComponent extends HTMLElement {
  private sdk: any;
  private apiKey: string | null = null;

  private phrase: string;
  private previewStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private videoFile: File | null = null;
  private startTime: number = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null;

  private videoElement!: HTMLVideoElement;
  private fileInput!: HTMLInputElement;
  private recordButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private submitButton!: HTMLButtonElement;

  private errorState: string | null = null;
  private timeLimit: number = 30;

  constructor() {
    super();
  
    this.phrase = this.generateDefaultPhrase();
  
    // Attach shadow DOM and initialize UI
    this.attachShadow({ mode: 'open' });
    this.apiKey = this.getAttribute('api-key');
    this.initializeSDK();
    this.initializeUI();
  }
  
  private initializeSDK() {
    if (this.apiKey) {
      this.sdk = new BiometrySDK(this.apiKey);
    } else {
      this.toggleState('error');
      console.error('API key is required to initialize the SDK.');
    }
  }

  connectedCallback() {
    if (this.apiKey) {
      this.initializeSDK();
    } else {
      console.error('API key is required.');
    }
  }

  disconnectedCallback() {
    this.stopRecording();
    if (this.previewStream) {
      this.previewStream.getTracks().forEach(track => track.stop());
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (name === 'api-key' && newValue !== oldValue) {
      this.apiKey = newValue;
      this.initializeSDK();
    }
  }

  private generateDefaultPhrase(): string {
    return Math.random().toString().slice(2, 10); // 8-digit random phrase
  }

  initializeUI() {
    const phraseDisplay = this.phrase
      .split("")
      .map((digit) => `<span class="digit">${digit}</span>`)
      .join(" ");

    this.shadowRoot!.innerHTML = `
    <style>
      :host {
        display: block;
        font-family: Arial, sans-serif;
        --primary-color: #007bff;
        --secondary-color: #6c757d;
        --button-bg: var(--primary-color);
        --button-text-color: #fff;
        --input-border-color: var(--secondary-color);
        --input-focus-border-color: var(--primary-color);
        --spacing: 16px;
        --button-padding: 10px 20px;
        --border-radius: 4px;
      }
      
      .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing);
        padding: var(--spacing);
        max-width: 500px;
        margin: 0 auto;
        text-align: center;
      }

      .video-wrapper {
        position: relative;
        display: inline-block;
      }

      #timer-overlay {
        position: absolute;
        top: 10px;
        left: 10px;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        font-family: Arial, sans-serif;
        font-size: 14px;
      }

      video {
        max-width: 100%;
        border-radius: var(--border-radius);
      }

      input[type="text"], input[type="file"] {
        padding: var(--button-padding);
        border: 1px solid var(--input-border-color);
        border-radius: var(--border-radius);
        width: 100%;
        max-width: 100%;
      }

      input[type="text"]:focus, input[type="file"]:focus {
        outline: none;
        border-color: var(--input-focus-border-color);
      }

      .hidden {
        display: none;
      }

      .phrase-display {
        font-size: 24px;
        font-weight: bold;
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      .digit {
        padding: 4px;
        border: 1px solid #ccc;
        border-radius: 4px;
        text-align: center;
        width: 24px;
      }

    </style>
    <div class="container">
      <slot name="video">
        <div class="video-wrapper">
          <video id="video-preview" muted autoplay></video>
          <div id="timer-overlay" class="hidden">00:00</div>
        </div>
      </slot>
      <slot name="phrase-display">
        <div class="phrase-display">
          ${phraseDisplay}
        </div>
      </slot>
      <slot name="record-button">
        <button id="record-button">Start Recording</button>
      </slot>
      <slot name="stop-button">
        <button id="stop-button" disabled>Stop Recording</button>
      </slot>
      <slot name="file-input">
        <input type="file" accept="video/*" id="file-input" />
      </slot>
      <slot name="submit-button">
        <button id="submit-button">Submit Video</button>
      </slot>
      <slot name="loading">
        <div class="message">Loading...</div>
      </slot>
      <slot name="error">
        <div class="message error">An error occurred</div>
      </slot>
      <slot name="success">
        <div class="message success">Video submitted successfully!</div>
      </slot>
    </div>
    `;
    this.attachSlotListeners();
    this.setupPreview();
    this.toggleState(null);
  }

  private attachSlotListeners(): void {
    const videoSlot = this.shadowRoot!.querySelector('slot[name="video"]') as HTMLSlotElement;
    const recordButtonSlot = this.shadowRoot!.querySelector('slot[name="record-button"]') as HTMLSlotElement;
    const stopButtonSlot = this.shadowRoot!.querySelector('slot[name="stop-button"]') as HTMLSlotElement;
    const fileInputSlot = this.shadowRoot!.querySelector('slot[name="file-input"]') as HTMLSlotElement;
    const submitButtonSlot = this.shadowRoot!.querySelector('slot[name="submit-button"]') as HTMLSlotElement;

    this.videoElement = this.getSlotElement(videoSlot, '#video-preview', HTMLVideoElement);
    this.recordButton = this.getSlotElement(recordButtonSlot, '#record-button', HTMLButtonElement);
    this.stopButton = this.getSlotElement(stopButtonSlot, '#stop-button', HTMLButtonElement);
    this.fileInput = this.getSlotElement(fileInputSlot, '#file-input', HTMLInputElement);
    this.submitButton = this.getSlotElement(submitButtonSlot, '#submit-button', HTMLButtonElement);

    if (this.fileInput) {
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    }
    if (this.recordButton) {
      this.recordButton.addEventListener("click", () => this.startRecording());
    }
    if (this.stopButton) {
      this.stopButton.addEventListener("click", () => this.stopRecording());
    }
    if (this.submitButton) {
      this.submitButton.addEventListener("click", () => this.handleSubmit())
    }
  }

  private getSlotElement<T extends HTMLElement>(
    slot: HTMLSlotElement,
    fallbackSelector: string,
    elementType: { new (): T }
  ): T {
    const assignedElements = slot.assignedElements();
    return (assignedElements.length > 0 ? assignedElements[0] : null) as T || this.shadowRoot!.querySelector(fallbackSelector) as T;
  }

  replaceSlotContent(slotName: string, content: string | HTMLElement) {
    const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLElement;
    if (slot) {
      if (typeof content === 'string') {
        slot.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        slot.innerHTML = '';
        slot.appendChild(content);
      }
    }
  }
  
  removeSlotListener(slotName: string, event: string, callback: EventListener) {
    const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLSlotElement;
    if (slot) {
      const assignedNodes = slot.assignedElements();
      assignedNodes.forEach((node) => {
        node.removeEventListener(event, callback);
      });
    }
  }

  private toggleState(state: 'loading' | 'success' | 'error' | null) {
    const states = ['loading', 'success', 'error'];

    states.forEach((slotName) => {
      const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLElement;
      if (slot) {
        slot.style.display = slotName === state ? 'block' : 'none';
      }
    });
  }

  private convertPhraseToWords(phrase: string): string {
    const digitWords = [
      "zero", "one", "two", "three", "four",
      "five", "six", "seven", "eight", "nine"
    ];
  
    return phrase
      .split("")
      .map((digit) => digitWords[parseInt(digit, 10)])
      .join(" ");
  }

  private async setupPreview() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.previewStream = stream;
  
      this.videoElement.srcObject = stream;
      this.videoElement.controls = false;
      this.videoElement.play();
    } catch (error) {
      this.toggleState('error');
      console.error('Error setting up video preview:', error);
    }
  }

  private async startTimer() {
    const timerOverlay = this.shadowRoot!.querySelector('#timer-overlay') as HTMLElement;
    timerOverlay.textContent = '00:00';
    timerOverlay.classList.remove('hidden');

    let seconds = 0;
    this.timerInterval = setInterval(() => {
      seconds++;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      timerOverlay.textContent = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }, 1000);

    this.recordingTimeout = setTimeout(() => {
      this.stopRecording();
    }, this.timeLimit * 1000);
  }

  private async stopTimer() {
    if (this.recordingTimeout) {
      clearTimeout(this.recordingTimeout);
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    const timerOverlay = this.shadowRoot!.querySelector('#timer-overlay') as HTMLElement;
    timerOverlay.classList.add('hidden');
  }

  public async startRecording() {
    if (!window.MediaRecorder) {
      console.error('MediaRecorder API is not supported in this browser');
      return;
    }
    try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            console.log('Recording already in progress.');
            return;
        }

        if (!this.previewStream) {
            console.log('Initializing preview stream...');
            this.previewStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
            });
        }

        this.videoElement.muted = true;
        this.videoElement.srcObject = this.previewStream;
        this.videoElement.currentTime = 0;

        await this.videoElement.play();

        this.mediaRecorder = new MediaRecorder(this.previewStream);
        this.recordedChunks = [];

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const duration = Date.now() - this.startTime;
            const buggyBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
            
            ysFixWebmDuration(buggyBlob, duration, {logger: false})
              .then((fixedBlob) => {
                this.onStopMediaRecorder(fixedBlob);
            });
        };

        this.mediaRecorder.start();
        this.startTimer();
        this.startTime = Date.now();

        this.recordButton.disabled = true;
        this.stopButton.disabled = false;
        this.videoElement.controls = false;
    } catch (error) {
        console.error('Error starting video recording:', error);
    }
  }

  public stopRecording() {
    try {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
            console.log('No recording in progress.');
            return;
        }

        this.mediaRecorder.stop();

        if (this.previewStream) {
            this.previewStream.getTracks().forEach(track => track.stop());
        }
        this.videoElement.srcObject = null;
        this.videoElement.src = '';
        this.videoElement.controls = false;

        this.recordButton.disabled = false;
        this.stopButton.disabled = true;

        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.previewStream = null;

    } catch (error) {
        console.error('Error stopping video recording:', error);
    }
  }

  private onStopMediaRecorder(blob: Blob) {
    const videoURL = URL.createObjectURL(blob);
    this.videoFile = new File([blob], 'recorded_video.webm', { type: 'video/webm' });

    this.videoElement.src = videoURL;
    this.videoElement.controls = true;
    this.videoElement.play();
    this.videoElement.muted = false;
    this.stopTimer();
  }

  private handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file?.type?.startsWith('video/')) {
      if (file.size > 100 * 1024 * 1024) { // 100MB limit
        this.toggleState('error');
        console.error('File size exceeds limit of 100MB');
        return;
      }
      this.videoFile = file;
      this.videoElement.src = URL.createObjectURL(file);
      this.videoElement.play();
    } else {
      this.toggleState('error');
      console.error('Please select a valid video file.');
    }
  }

  public async handleSubmit() {
    if (!this.videoFile) {
      this.toggleState('error');
      console.error('No video file to submit.');
      return;
    }

    if (!this.apiKey || !this.userFullname) {
      this.toggleState('error');
      console.error('API key and user fullname must be provided.');
      return;
    }

    this.toggleState('loading');

    try {
      const phraseInWords = this.convertPhraseToWords(this.phrase);
      const result = await this.sdk.processVideo(this.videoFile, phraseInWords, this.userFullname);
      console.log('Response from processVideo:', result);
      this.toggleState('success');
    } catch (error) {
      this.toggleState('error');
      console.error('Error submitting video:', error);
    }
  }

  static get observedAttributes() {
    return ['api-key', 'user-fullname'];
  }

  get userFullname(): string | null {
    return this.getAttribute('user-fullname');
  }

  set userFullname(value: string | null) {
    if (value) {
      this.setAttribute('user-fullname', value);
    } else {
      this.removeAttribute('user-fullname');
    }
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }  

  get currentPhrase(): string {
    return this.phrase;
  }

  get videoDuration(): number | null {
    return this.videoElement?.duration || null;
  }

  get currentFile(): File | null {
    return this.videoFile;
  }

  get currentStream(): MediaStream | null {
    return this.previewStream;
  }

  set sdkInstance(newSdk: any) {
    this.sdk = newSdk;
  }

  get videoElementRef(): HTMLVideoElement {
    return this.videoElement;
  }
  
  get fileInputRef(): HTMLInputElement {
    return this.fileInput;
  }

  get recordingTimeLimit(): number {
    return this.timeLimit;
  }

  set recordingTimeLimit(value: number) {
    this.timeLimit = value;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      if (this.recordingTimeout) {
        clearTimeout(this.recordingTimeout);
      }
      this.recordingTimeout = setTimeout(() => this.stopRecording(), this.timeLimit * 1000);
    }
  }
}

customElements.define('process-video', ProcessVideoComponent);

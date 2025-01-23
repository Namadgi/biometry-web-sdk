import { BiometrySDK } from "../sdk.js";

export class ProcessVideoComponent extends HTMLElement {
  private sdk: any;
  private apiKey: string | null = null;

  private phrase: string;
  private previewStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private videoFile: File | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null;

  private videoElement!: HTMLVideoElement;
  private fileInput!: HTMLInputElement;
  private phraseInput!: HTMLInputElement;
  private recordButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;

  private errorState: string | null = null;
  private timeLimit: number = 30;

  constructor(sdk: any, phraseGenerator?: () => string) {
    super();

    this.phrase = phraseGenerator ? phraseGenerator() : this.generateDefaultPhrase();

    // Attach shadow DOM, SDK and UI
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

      button {
        background-color: var(--button-bg);
        color: var(--button-text-color);
        border: none;
        border-radius: var(--border-radius);
        padding: var(--button-padding);
        cursor: pointer;
        transition: background-color 0.3s ease;
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

      .message {
        padding: var(--spacing);
        border-radius: var(--border-radius);
        font-size: 14px;
      }

      .message.success {
        color: #155724;
        background-color: #d4edda;
        border: 1px solid #c3e6cb;
      }

      .message.error {
        color: #721c24;
        background-color: #f8d7da;
        border: 1px solid #f5c6cb;
      }
    </style>
    <div class="container">
      <slot name="video">
        <div class="video-wrapper">
          <video id="video-preview" muted autoplay></video>
          <div id="timer-overlay" class="hidden">00:00</div>
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
      <slot name="phrase-input">
        <input type="text" id="phrase-input" value="${this.phrase}" placeholder="Enter your phrase" />
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
    this.videoElement = this.shadowRoot!.querySelector('#video-preview') as HTMLVideoElement;
    this.fileInput = this.shadowRoot!.querySelector('#file-input') as HTMLInputElement;
    this.phraseInput = this.shadowRoot!.querySelector('#phrase-input') as HTMLInputElement;
    
    const recordButtonSlot = this.shadowRoot!.querySelector('slot[name="record-button"]') as HTMLSlotElement;
    const stopButtonSlot = this.shadowRoot!.querySelector('slot[name="stop-button"]') as HTMLSlotElement;

    this.recordButton = this.getSlotButton(recordButtonSlot, 'record-button');
    this.stopButton = this.getSlotButton(stopButtonSlot, 'stop-button');
  
    this.recordButton.addEventListener('click', () => this.startRecording());
    this.stopButton.addEventListener('click', () => this.stopRecording());

    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.phraseInput.addEventListener('input', (e) => {
      this.phrase = (e.target as HTMLInputElement).value;
    });
    this.shadowRoot!.querySelector('#submit-button')!.addEventListener('click', () => this.handleSubmit());

    this.attachSlotListeners('record-button', 'click', () => this.startRecording());
    this.attachSlotListeners('stop-button', 'click', () => this.stopRecording());
    this.attachSlotListeners('submit-button', 'click', () => this.handleSubmit());
    this.setupPreview();
  }

  private getSlotButton(slot: HTMLSlotElement, buttonId: string): HTMLButtonElement {
    const assignedNodes = slot.assignedElements();
    if (assignedNodes.length > 0) {
        return assignedNodes[0] as HTMLButtonElement;
    } else {
        return this.shadowRoot!.querySelector(`#${buttonId}`) as HTMLButtonElement;
    }
  }

  attachSlotListeners(slotName: string, event: string, callback: EventListener) {
    const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLSlotElement;
  
    if (slot) {
      const updateListeners = () => {
        const assignedNodes = slot.assignedElements();
        if (assignedNodes.length > 0) {
          // Remove listeners from previous elements
          assignedNodes.forEach((node) => {
            node.removeEventListener(event, callback);
            node.addEventListener(event, callback);
          });
        }
      };
  
      slot.addEventListener('slotchange', updateListeners);
      updateListeners();
    }
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
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const videoURL = URL.createObjectURL(blob);
            this.videoFile = new File([blob], 'recorded_video.webm', { type: 'video/webm' });

            this.videoElement.src = videoURL;
            this.videoElement.controls = true;
            this.videoElement.play();
            this.videoElement.muted = false;
            this.stopTimer();
        };

        this.mediaRecorder.start();
        this.startTimer();

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

  private handleFileUpload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file && file.type.startsWith('video/')) {
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
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        'X-User-Fullname': this.userFullname,
      };

      const result = await this.sdk.processVideo(this.videoFile, this.phrase, headers);
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

  set currentPhrase(newPhrase: string) {
    this.phrase = newPhrase;
    this.phraseInput.value = newPhrase;
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

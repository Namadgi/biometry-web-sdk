import { BiometrySDK } from "../sdk.js";

export class ProcessVideoComponent extends HTMLElement {
  private sdk: any;
  private apiKey: string | null = null;

  private phrase: string;
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private videoFile: File | null = null;

  private videoElement!: HTMLVideoElement;
  private fileInput!: HTMLInputElement;
  private phraseInput!: HTMLInputElement;
  private recordButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;

  private errorState: string | null = null;

  constructor(sdk: any, phraseGenerator?: () => string) {
    super();

    this.phrase = phraseGenerator ? phraseGenerator() : this.generateDefaultPhrase();

    // Attach shadow DOM, SDK and UI
    this.attachShadow({ mode: 'open' });

    this.apiKey = this.getAttribute('api-key'); // Fetch the api-key from attributes
    this.initializeSDK();
    this.initializeUI();
  }

  static get observedAttributes() {
    return ['api-key', 'user-fullname'];
  }

  // get apiKey(): string | null {
  //   return this.getAttribute('api-key');
  // }

  // set apiKey(value: string | null) {
  //   if (value) {
  //     this.setAttribute('api-key', value);
  //   } else {
  //     this.removeAttribute('api-key');
  //   }
  // }

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

  private initializeUI() {
    this.shadowRoot!.innerHTML = `
      <div>
        <slot name="video">
          <video id="video-preview" controls muted autoplay></video>
        </slot>
        <slot name="record-button">
          <button id="record-button">Start Recording</button>
        </slot>
        <slot name="stop-button">
          <button id="stop-button" style="display: none;">Stop Recording</button>
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
        <slot name="loading" style="display: none;">Loading...</slot>
        <slot name="error" style="display: none;">An error occurred</slot>
        <slot name="success" style="display: none;">Video submitted successfully!</slot>
      </div>
    `;

    this.videoElement = this.shadowRoot!.querySelector('#video-preview') as HTMLVideoElement;
    this.fileInput = this.shadowRoot!.querySelector('#file-input') as HTMLInputElement;
    this.phraseInput = this.shadowRoot!.querySelector('#phrase-input') as HTMLInputElement;
    this.recordButton = this.shadowRoot!.querySelector('#record-button') as HTMLButtonElement;
    this.stopButton = this.shadowRoot!.querySelector('#stop-button') as HTMLButtonElement;

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
  }

  // private attachSlotListeners(slotName: string, event: string, callback: EventListener) {
  //   const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLSlotElement;
  
  //   if (slot) {
  //     const assignListener = () => {
  //       const assignedNodes = slot.assignedElements();
  //       if (assignedNodes.length > 0) {
  //         assignedNodes.forEach((node) => node.addEventListener(event, callback));
  //       } else {
  //         // Fallback to default content if no external content is slotted
  //         const defaultNode = slot.querySelector(`#${slotName}`);
  //         if (defaultNode) {
  //           defaultNode.addEventListener(event, callback);
  //         }
  //       }
  //     };
  
  //     // Listen for slot changes and reassign listeners
  //     slot.addEventListener('slotchange', assignListener);
  //     assignListener(); // Initial assignment
  //   }
  // }
  private attachSlotListeners(slotName: string, event: string, callback: EventListener) {
    const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLSlotElement;
  
    if (slot) {
      const updateListeners = () => {
        const assignedNodes = slot.assignedElements();
        if (assignedNodes.length > 0) {
          // Remove listeners from previous elements
          assignedNodes.forEach((node) => {
            // Ensure we don't attach the listener multiple times
            node.removeEventListener(event, callback);
            node.addEventListener(event, callback);
          });
        }
      };
  
      // Listen for slot changes and update event listeners dynamically
      slot.addEventListener('slotchange', updateListeners);
      updateListeners(); // Initial assignment
    }
  }

  private toggleState(state: 'loading' | 'success' | 'error' | null) {
    this.errorState = state;
    const states = ['loading', 'success', 'error'];

    states.forEach((slotName) => {
      const slot = this.shadowRoot!.querySelector(`slot[name="${slotName}"]`) as HTMLElement;
      if (slot) {
        slot.style.display = slotName === state ? 'block' : 'none';
      }
    });
  }

  private async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.videoElement.srcObject = stream;

      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      this.recordButton.style.display = 'none';
      this.stopButton.style.display = 'block';
    } catch (error) {
      this.toggleState('error');
      console.error('Error starting video recording:', error);
    }
  }

  private async stopRecording() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        this.videoFile = new File([blob], 'recorded-video.webm', { type: 'video/webm' });
        this.recordedChunks = [];
        this.videoElement.srcObject = null;
        this.videoElement.src = URL.createObjectURL(blob);
        this.videoElement.play();
      };

      // Stop all tracks
      const tracks = (this.videoElement.srcObject as MediaStream)?.getTracks();
      tracks?.forEach((track) => track.stop());
    }

    this.recordButton.style.display = 'block';
    this.stopButton.style.display = 'none';
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

  private async handleSubmit() {
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

  set sdkInstance(newSdk: any) {
    this.sdk = newSdk;
  }
}

// Register the custom element
customElements.define('process-video', ProcessVideoComponent);

export class ProcessVideoComponent extends HTMLElement {
  private sdk: any;
  private phrase: string;
  private recordedChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private videoFile: File | null = null;

  private videoElement!: HTMLVideoElement;
  private fileInput!: HTMLInputElement;
  private phraseInput!: HTMLInputElement;
  private recordButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;

  constructor(sdk: any, phraseGenerator?: () => string) {
    super();

    // Initialize SDK and phrase
    this.sdk = sdk;
    this.phrase = phraseGenerator ? phraseGenerator() : this.generateDefaultPhrase();

    // Attach shadow DOM and UI
    this.attachShadow({ mode: 'open' });
    this.initializeUI();
  }

  private generateDefaultPhrase(): string {
    return Math.random().toString().slice(2, 10); // 8-digit random phrase
  }

  private initializeUI() {
    // UI Structure
    this.shadowRoot!.innerHTML = `
      <div>
        <video id="video-preview" controls muted autoplay></video>
        <button id="record-button">Start Recording</button>
        <button id="stop-button" style="display: none;">Stop Recording</button>
        <input type="file" accept="video/*" id="file-input" />
        <input type="text" id="phrase-input" value="${this.phrase}" placeholder="Enter your phrase" />
        <button id="submit-button">Submit Video</button>
      </div>
    `;

    // Initialize DOM elements
    this.videoElement = this.shadowRoot!.querySelector('#video-preview') as HTMLVideoElement;
    this.fileInput = this.shadowRoot!.querySelector('#file-input') as HTMLInputElement;
    this.phraseInput = this.shadowRoot!.querySelector('#phrase-input') as HTMLInputElement;
    this.recordButton = this.shadowRoot!.querySelector('#record-button') as HTMLButtonElement;
    this.stopButton = this.shadowRoot!.querySelector('#stop-button') as HTMLButtonElement;

    // Attach event listeners
    this.recordButton.addEventListener('click', () => this.startRecording());
    this.stopButton.addEventListener('click', () => this.stopRecording());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.phraseInput.addEventListener('input', (e) => {
      this.phrase = (e.target as HTMLInputElement).value;
    });
    this.shadowRoot!.querySelector('#submit-button')!.addEventListener('click', () => this.handleSubmit());
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
      console.error('Please select a valid video file.');
    }
  }

  private async handleSubmit() {
    if (!this.videoFile) {
      console.error('No video file to submit.');
      return;
    }

    const result = await this.sdk.processVideo(this.videoFile, this.phrase);
    console.log('Response from processVideo:', result);
  }

  /**
   * Getter for video duration.
   * Developers can call this after the video is loaded.
   */
  get videoDuration(): number | null {
    return this.videoElement?.duration || null;
  }
}

// Register the custom element
customElements.define('process-video', ProcessVideoComponent);

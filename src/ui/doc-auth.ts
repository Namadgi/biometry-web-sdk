export class DocAuth extends HTMLElement {
  private readonly shadow: ShadowRoot;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private captureButton: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.captureDocument = this.captureDocument.bind(this);
  }

  static get observedAttributes(): string[] {
    return ["endpoint", "user-fullname"];
  }

  get endpoint(): string | null {
    return this.getAttribute("endpoint");
  }

  set endpoint(value: string | null) {
    if (value !== this.getAttribute("endpoint")) {
      if (value === null) {
        this.removeAttribute("endpoint");
      } else {
        this.setAttribute("endpoint", value);
      }
    }
  }

  get userFullname(): string | null {
    return this.getAttribute("user-fullname");
  }

  set userFullname(value: string | null) {
    if (value !== this.getAttribute("user-fullname")) {
      if (value === null) {
        this.removeAttribute("user-fullname");
      } else {
        this.setAttribute("user-fullname", value);
      }
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === "endpoint" || name === "user-fullname") {
      this.validateAttributes();
    }
  }

  connectedCallback(): void {
    this.validateAttributes();
    this.init();
  }

  disconnectedCallback(): void {
    this.cleanup();
    if (this.captureButton) {
      this.captureButton.removeEventListener("click", this.captureDocument);
    }
  }

  validateAttributes(): void {
    if (!this.endpoint) {
      console.error("Endpoint is required.");
      this.toggleState("error");
      return;
    }
    if (!this.userFullname) {
      console.error("User fullname is required.");
      this.toggleState("error");
      return;
    }
  }

  init(): void {
    this.shadow.innerHTML = `
    <style>
      :host {
        display: block;
        font-family: Arial, sans-serif;
        --primary-color: #007bff;
        --button-bg: var(--primary-color);
        --button-text-color: #fff;
        --border-radius: 8px;
        --scan-area-border: 2px dashed var(--primary-color);
        --scan-area-bg: rgba(0, 123, 255, 0.05);
        --button-padding: 10px 24px;
        --button-radius: 6px;
        --button-hover-bg: #0056b3;
      }
      .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        padding: 24px;
        background: #fff;
        border-radius: var(--border-radius);
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        max-width: 420px;
        margin: 0 auto;
      }
      .scan-area {
        position: relative;
        width: 340px;
        height: 220px;
        background: var(--scan-area-bg);
        border: var(--scan-area-border);
        border-radius: var(--border-radius);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--border-radius);
      }
      canvas {
        display: none;
      }
      .capture-btn {
        background: var(--button-bg);
        color: var(--button-text-color);
        border: none;
        border-radius: var(--button-radius);
        padding: var(--button-padding);
        font-size: 1rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .capture-btn:hover {
        background: var(--button-hover-bg);
      }
      .status {
        min-height: 24px;
        font-size: 0.95rem;
        color: #d32f2f;
        text-align: center;
      }
      .status.success {
        color: #388e3c;
      }
    </style>
    <div class="container">
      <div class="scan-area">
        <video id="video" autoplay playsinline></video>
        <canvas id="canvas"></canvas>
      </div>
      <button class="capture-btn" id="capture-btn">Capture Document</button>
      <div class="status" id="status"></div>
    </div>
    `;
    this.attachElements();
    this.setupCamera();
    this.toggleState("");
  }

  cleanup(): void {
    if (this.videoElement?.srcObject) {
      const tracks = (this.videoElement.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  private attachElements(): void {
    this.videoElement = this.shadow.querySelector("#video") as HTMLVideoElement;
    this.canvasElement = this.shadow.querySelector("#canvas") as HTMLCanvasElement;
    this.captureButton = this.shadow.querySelector("#capture-btn") as HTMLButtonElement;
    if (this.captureButton) {
      this.captureButton.addEventListener("click", this.captureDocument);
    }
  }

  private setupCamera(): void {
    if (!this.videoElement) {
      console.error("Video element is missing.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        this.videoElement!.srcObject = stream;
      })
      .catch((error) => {
        this.toggleState("error");
        this.setStatus("Error accessing camera: " + error, false);
      });
  }

  private async captureDocument(): Promise<void> {
    if (!this.videoElement || !this.canvasElement) {
      this.setStatus("Camera not ready.", false);
      return;
    }
    // Set canvas size to video size for high quality
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    const context = this.canvasElement.getContext("2d");
    context!.drawImage(
      this.videoElement,
      0,
      0,
      this.canvasElement.width,
      this.canvasElement.height
    );
    this.toggleState("loading");
    this.setStatus("Uploading...", false);
    this.canvasElement.toBlob(async (blob) => {
      try {
        if (!blob) {
          this.setStatus("Failed to capture image.", false);
          this.toggleState("error");
          return;
        }
        const file = new File([blob], "id-document.jpg", { type: "image/jpeg" });
        const formData = new FormData();
        formData.append("document", file);
        formData.append("userFullname", this.userFullname || "");
        const response = await fetch(this.endpoint!, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.setStatus("Document uploaded successfully!", true);
        this.toggleState("success");
      } catch (error) {
        this.setStatus("Error uploading document.", false);
        this.toggleState("error");
      }
    }, "image/jpeg", 0.98); // High quality JPEG
  }

  private setStatus(message: string, success: boolean) {
    const statusDiv = this.shadow.querySelector("#status") as HTMLElement;
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = "status" + (success ? " success" : "");
    }
  }

  private toggleState(state: string): void {
    // For extensibility, could add more UI feedback here
    // Currently just updates status color
  }
}

customElements.define("doc-auth", DocAuth); 
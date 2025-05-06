import { BiometryAttributes, BiometryEnrollmentState } from "./types.js";

export class BiometryEnrollment extends HTMLElement {
  private readonly shadow: ShadowRoot;
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private captureButton: HTMLButtonElement | null = null;

  private resultCode?: number;
  private description?: string;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });

    this.toggleState = this.toggleState.bind(this);
    this.capturePhoto = this.capturePhoto.bind(this);
  }

  static get observedAttributes(): string[] {
    return Object.values(BiometryAttributes);
  }

  get endpoint(): string | null {
    return this.getAttribute("endpoint");
  }

  set endpoint(value: string | null) {
    const current = this.getAttribute("endpoint");
    if (value !== null && value !== current) {
      this.setAttribute("endpoint", value);
    } else if (value === null && current !== null) {
      this.removeAttribute("endpoint");
    }
  }

  get userFullname(): string | null {
    return this.getAttribute("user-fullname");
  }

  set userFullname(value: string | null) {
    if (value) {
      this.setAttribute("user-fullname", value);
    } else {
      this.removeAttribute("user-fullname");
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === "endpoint" || name === "user-fullname") {
      if (name === "endpoint") {
        this.endpoint = newValue;
      } else if (name === "user-fullname") {
        this.userFullname = newValue;
      }
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
      this.captureButton.removeEventListener("click", this.capturePhoto);
    }
  }

  validateAttributes(): void {
    if (!this.endpoint) {
      console.error("Endpoint is required.");
      this.toggleState(BiometryEnrollmentState.ErrorOther);
      return;
    }

    if (!this.userFullname) {
      console.error("User fullname is required.");
      this.toggleState(BiometryEnrollmentState.ErrorOther);
      return;
    }
  }

  init(): void {
    this.shadow.innerHTML = `
    <style>
      .wrapper {
        position: relative;
      }
      video {
        transform: scaleX(-1); /* Flip video for preview */
        max-width: 100%;
        border-radius: var(--border-radius, 8px);
      }
      canvas {
        display: none;
      }
    </style>
    <div class="wrapper">
      <slot name="video">
        <video id="video" autoplay playsinline></video>
      </slot>
      <slot name="canvas">
        <canvas id="canvas" style="display: none;"></canvas>
      </slot>
      <slot name="button">
        <button id="button">Capture Photo</button>
      </slot>
      <div class="status">
        <slot name="loading" class="loading"></slot>
        <slot name="success" class="success"></slot>
        <slot name="error-no-face" class="error-no-face"></slot>
        <slot name="error-multiple-faces" class="error-multiple-faces"></slot>
        <slot name="error-not-centered" class="error-not-centered"></slot>
        <slot name="error-other" class="error-other"></slot>
      </div>
    </div>
  `;

    this.attachSlotListeners();
    this.setupCamera();
    this.toggleState("");
  }

  private cleanup(): void {
    if (this.videoElement?.srcObject) {
      const tracks = (this.videoElement.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  private attachSlotListeners(): void {
    const videoSlot = this.shadow.querySelector('slot[name="video"]') as HTMLSlotElement;
    const canvasSlot = this.shadow.querySelector('slot[name="canvas"]') as HTMLSlotElement;
    const buttonSlot = this.shadow.querySelector('slot[name="button"]') as HTMLSlotElement;

    const assignedVideoElements = videoSlot.assignedElements();
    this.videoElement = (assignedVideoElements.length > 0 ? assignedVideoElements[0] : null) as HTMLVideoElement || this.shadow.querySelector("#video") as HTMLVideoElement;

    const assignedCanvasElements = canvasSlot.assignedElements();
    this.canvasElement = (assignedCanvasElements.length > 0 ? assignedCanvasElements[0] : null) as HTMLCanvasElement || this.shadow.querySelector("#canvas") as HTMLCanvasElement;

    const assignedButtonElements = buttonSlot.assignedElements();
    this.captureButton = (assignedButtonElements.length > 0 ? assignedButtonElements[0] : null) as HTMLButtonElement || this.shadow.querySelector("#button") as HTMLButtonElement;

    if (!this.videoElement) {
      console.error("Video element is missing.");
      return;
    }

    if (!this.captureButton) {
      console.error("Capture button is missing.");
      return;
    } else {
      this.captureButton.addEventListener("click", this.capturePhoto);
    }
  }

  private setupCamera(): void {
    if (!this.videoElement) {
      console.error("Video element is missing.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        this.videoElement!.srcObject = stream;
      })
      .catch((error) => {
        console.error("Error accessing camera:", error);
      });
  }

  private async capturePhoto(): Promise<void> {
    try {
      if (!this.videoElement || !this.canvasElement) {
        console.error("Essential elements are not initialized.");
        return;
      }

      const context = this.canvasElement.getContext("2d");
      this.canvasElement.width = this.videoElement.videoWidth;
      this.canvasElement.height = this.videoElement.videoHeight;

      context!.drawImage(
        this.videoElement,
        0,
        0,
        this.canvasElement.width,
        this.canvasElement.height
      );

      this.toggleState("loading");

      this.canvasElement.toBlob(async (blob) => {
        try {
          if (!blob) {
            console.error("Failed to capture photo.");
            this.toggleState(BiometryEnrollmentState.ErrorOther);
            return;
          }

          const file = new File([blob], "onboard-face.jpg", { type: "image/jpeg" });
          const formData = new FormData();
          formData.append('photo', file);
          formData.append('userFullname', this.userFullname || '');

          const response = await fetch(this.endpoint!, {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          this.resultCode = result?.code;
          this.description = result?.description || "Unknown error occurred.";

          switch (this.resultCode) {
            case 0:
              this.toggleState(BiometryEnrollmentState.Success);
              break;
            case 1:
              this.toggleState(BiometryEnrollmentState.ErrorNoFace);
              break;
            case 2:
              this.toggleState(BiometryEnrollmentState.ErrorMultipleFaces);
              break;
            case 3:
              this.toggleState(BiometryEnrollmentState.ErrorNotCentered);
              break;
            default:
              this.toggleState(BiometryEnrollmentState.ErrorOther);
          }

          console.log("Enrollment result:", result);
        } catch (error) {
          console.error("Error in toBlob callback:", error);
          this.toggleState(BiometryEnrollmentState.ErrorOther);
        }
      }, "image/jpeg");
    } catch (error) {
      console.error("Error capturing photo:", error);
      this.toggleState(BiometryEnrollmentState.ErrorOther);
    }
  }

  private toggleState(state: BiometryEnrollmentState | string): void {
    const slots = [
      BiometryEnrollmentState.Loading,
      BiometryEnrollmentState.Success,
      BiometryEnrollmentState.ErrorNoFace,
      BiometryEnrollmentState.ErrorMultipleFaces,
      BiometryEnrollmentState.ErrorNotCentered,
      BiometryEnrollmentState.ErrorOther,
    ];

    slots.forEach((slotName) => {
      const slot = this.shadow.querySelector(`slot[name="${slotName}"]`) as HTMLElement;
      if (slot) {
        slot.style.display = slotName === state ? "block" : "none";
      }
    });
  }
}

customElements.define("biometry-enrollment", BiometryEnrollment);
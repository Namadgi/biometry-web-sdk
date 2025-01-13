class BiometryOnboarding extends HTMLElement {
  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.loading = false;
    this.success = false;
    this.error = null;
  }

  static get observedAttributes() {
    return ['api-key', 'user-fullname'];
  }

  get apiKey() {
    return this.getAttribute('api-key');
  }

  get userFullname() {
    return this.getAttribute('user-fullname');
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'api-key' || name === 'user-fullname') {
      this.validateAttributes();
    }
  }

  connectedCallback() {
    this.validateAttributes();
    this.init();
  }

  disconnectedCallback() {
    this.cleanup();
  }

  validateAttributes() {
    if (!this.apiKey) console.error('API key is required');
    if (!this.userFullname) console.error('User fullname is required');
  }

  init() {
    this.shadow.innerHTML = `
      <div class="wrapper">
        <slot name="video"></slot>
        <slot name="button"></slot>
        <slot name="canvas"></slot>

        <!-- Loading slot -->
        <slot name="loading" class="loading" style="display: none;"></slot>
        <!-- Success slot -->
        <slot name="success" class="success" style="display: none;"></slot>
        <!-- Error slot -->
        <slot name="error" class="error" style="display: none;"></slot>
      </div>
    `;

    this.setupCamera();
    this.setupEventHandlers();
  }

  cleanup() {
    const video = this.querySelector('[slot="video"]');
    if (video?.srcObject) {
      const tracks = video.srcObject.getTracks();
      tracks.forEach((track) => track.stop());
    }
  }

  setupCamera() {
    const video = this.querySelector('[slot="video"]');
    if (!video) {
      console.error('Video element is missing.');
      return;
    }

    video.style.transform = 'scaleX(-1)';
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        video.srcObject = stream;
      })
      .catch((error) => {
        console.error('Error accessing camera:', error);
      });
  }

  setupEventHandlers() {
    const button = this.querySelector('[slot="button"]');
    const video = this.querySelector('[slot="video"]');
    const canvas = this.querySelector('[slot="canvas"]');

    if (button && video && canvas) {
      button.addEventListener('click', () => {
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'onboard-face.jpg', { type: 'image/jpeg' });
            this.onboardFace(file);
          }
        }, 'image/jpeg');
      });
    } else {
      console.error('Required slots (video, button, canvas, image) are not provided.');
    }
  }

  toggleState(state) {
    const slots = ['loading', 'success', 'error'];
    slots.forEach((slotName) => {
      const slot = this.shadowRoot.querySelector(`slot[name="${slotName}"]`);
      if (slot) {
        slot.style.display = slotName === state ? 'block' : 'none';
      }
    });
  }

  onboardFace(image) {
    const endpoint = 'https://dev-console.biometrysolutions.com/api-gateway/onboard/face';
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'X-User-Fullname': this.userFullname,
    };

    const formData = new FormData();
    formData.append('face', image);

    this.toggleState('loading');

    fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    }).then((response) => response.json())
      .then((data) => {
        console.log('Onboarding successful:', data);
        this.toggleState('success');
      })
      .catch((error) => {
        console.error('Error onboarding face:', error);
        this.toggleState('error');
      });
  }
}

customElements.define('biometry-onboarding', BiometryOnboarding);

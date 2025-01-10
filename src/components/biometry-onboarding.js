class BiometryOnboarding extends HTMLElement {
  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });

    if (!this.apiKey) {
      console.error('API key is required');
      return;
    }

    if (!this.userFullname) {
      console.error('User fullname is required');
      return;
    }
  }

  get apiKey() {
    return this.getAttribute('api-key');
  }

  get userFullname() {
    return this.getAttribute('user-fullname');
  }

  static get observedAttributes() {
    return ['api-key', 'user-fullname'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    this.render();
  }

  connectedCallback() {
    this.render();
    this.setupCamera();
    this.handleCapturePhoto();
  }

  setupCamera() {
    const constraints = { video: true };
    const video = this.shadow.querySelector('video');

    if (!video) {
      console.error('Video element not found');
      return;
    }

    video.style.transform = 'scaleX(-1)'; // Flip horizontally
    video.style.webkitTransform = 'scaleX(-1)'; // Add vendor prefix for older browsers
    video.style.msTransform = 'scaleX(-1)'; // Add vendor prefix for IE

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        video.srcObject = stream;
      })
      .catch((err) => {
        console.error('Error accessing camera:', err);
      });
  }

  handleCapturePhoto() {
    const button = this.shadow.querySelector('button');
    const video = this.shadow.querySelector('video');
    const canvas = this.shadow.querySelector('canvas');
    const img = this.shadow.querySelector('img');

    if (!button || !video || !canvas || !img) {
      console.error('Button, video, canvas, or img element not found');
      return;
    }

    button.addEventListener('click', () => {
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const data = canvas.toDataURL('image/jpeg');
      img.src = data;
      img.style.display = 'block';

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'onboard-face.jpg', { type: 'image/jpeg' });
          this.onboardFace(file);
        }
      }, 'image/jpeg');
    });
  }

  onboardFace(image) {
    const endpoint = 'https://dev-console.biometrysolutions.com/api-gateway/onboard/face';
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'X-User-Fullname': `${this.userFullname}`,
    };

    console.log(headers);

    const formData = new FormData();
    formData.append('face', image);

    fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    })
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
      })
      .catch((error) => {
        console.error('Error onboarding face:', error);
      });
  }

  render() {
    this.shadow.innerHTML = `
      <style>
        .wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        video {
          max-width: 100%;
          border: 1px solid black;
        }
        img {
          margin-top: 10px;
          max-width: 100%;
          border: 1px solid black;
        }
        button {
          margin-top: 10px;
          padding: 10px 20px;
          cursor: pointer;
        }
      </style>
      <div>
        <video autoplay playsinline></video>
        <canvas style="display: none;"></canvas>
        <button>Capture Photo</button>
        <img style="display: none;">
      </div> 
    `;
  }
}

customElements.define('biometry-onboarding', BiometryOnboarding);
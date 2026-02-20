const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const FILE_ICONS = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  'application/json': 'JSON',
  'text/csv': 'CSV',
  'text/plain': 'TXT',
};

export class ImageHandler {
  constructor(onImagesChange) {
    this.pendingImages = []; // { filename, objectUrl, isImage, name }
    this.onImagesChange = onImagesChange;

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt,.json';
    this.fileInput.multiple = true;
    this.fileInput.onchange = (e) => this.handleFiles(e.target.files);

    document.getElementById('image-btn').onclick = () => this.fileInput.click();

    // Drag and drop support
    this.setupDragDrop();
  }

  setupDragDrop() {
    const dropZone = document.getElementById('messages');
    const appView = document.getElementById('app-view');
    let dragCounter = 0;

    const showOverlay = () => {
      if (!document.getElementById('drop-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'drop-overlay';
        overlay.innerHTML = '<div class="drop-overlay-content">Drop files here</div>';
        appView.appendChild(overlay);
      }
    };

    const hideOverlay = () => {
      const overlay = document.getElementById('drop-overlay');
      if (overlay) overlay.remove();
    };

    appView.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) showOverlay();
    });

    appView.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) hideOverlay();
    });

    appView.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    appView.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      hideOverlay();
      if (e.dataTransfer.files.length > 0) {
        this.handleFiles(e.dataTransfer.files);
      }
    });
  }

  async handleFiles(files) {
    for (const file of files) {
      try {
        const isImage = IMAGE_TYPES.includes(file.type);

        if (isImage) {
          const resized = await resizeImage(file);
          const result = await uploadFile(resized, 'photo.jpg');
          const objectUrl = URL.createObjectURL(file);
          this.pendingImages.push({ filename: result.filename, objectUrl, isImage: true, name: file.name });
        } else {
          const result = await uploadFile(file, file.name);
          this.pendingImages.push({ filename: result.filename, isImage: false, name: file.name, mimetype: file.type });
        }
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
    this.onImagesChange(this.pendingImages);
  }

  removeImage(index) {
    const img = this.pendingImages[index];
    if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);
    this.pendingImages.splice(index, 1);
    this.onImagesChange(this.pendingImages);
  }

  getFilenames() {
    return this.pendingImages.map((i) => i.filename);
  }

  getAttachments() {
    return this.pendingImages.map((i) => ({
      filename: i.filename,
      isImage: i.isImage,
      name: i.name,
    }));
  }

  clear() {
    this.pendingImages.forEach((i) => {
      if (i.objectUrl) URL.revokeObjectURL(i.objectUrl);
    });
    this.pendingImages = [];
    this.onImagesChange([]);
  }
}

async function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => resolve(blob),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

async function uploadFile(blob, name) {
  const form = new FormData();
  form.append('image', blob, name);
  const res = await fetch('/api/images', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return await res.json();
}

export function renderImagePreview(images, onRemove) {
  const container = document.getElementById('image-preview');
  container.innerHTML = '';
  if (images.length === 0) {
    container.classList.remove('active');
    return;
  }
  container.classList.add('active');

  images.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';

    if (img.isImage && img.objectUrl) {
      thumb.innerHTML = `
        <img src="${img.objectUrl}" alt="preview">
        <button class="remove-img">&times;</button>
      `;
    } else {
      const ext = getFileLabel(img.name, img.mimetype);
      thumb.innerHTML = `
        <div class="file-icon">${ext}</div>
        <button class="remove-img">&times;</button>
      `;
    }

    thumb.querySelector('.remove-img').onclick = () => onRemove(i);
    container.appendChild(thumb);
  });
}

function getFileLabel(name, mimetype) {
  if (mimetype && FILE_ICONS[mimetype]) return FILE_ICONS[mimetype];
  const ext = name?.split('.').pop()?.toUpperCase();
  return ext || 'FILE';
}

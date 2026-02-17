const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

export class ImageHandler {
  constructor(onImagesChange) {
    this.pendingImages = []; // { filename, objectUrl }
    this.onImagesChange = onImagesChange;

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.multiple = true;
    this.fileInput.onchange = (e) => this.handleFiles(e.target.files);

    document.getElementById('image-btn').onclick = () => this.fileInput.click();
  }

  async handleFiles(files) {
    for (const file of files) {
      try {
        const resized = await resizeImage(file);
        const filename = await uploadImage(resized);
        const objectUrl = URL.createObjectURL(file);
        this.pendingImages.push({ filename, objectUrl });
      } catch (err) {
        console.error('Image upload failed:', err);
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

async function uploadImage(blob) {
  const form = new FormData();
  form.append('image', blob, 'photo.jpg');
  const res = await fetch('/api/images', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  const data = await res.json();
  return data.filename;
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
    thumb.innerHTML = `
      <img src="${img.objectUrl}" alt="preview">
      <button class="remove-img">&times;</button>
    `;
    thumb.querySelector('.remove-img').onclick = () => onRemove(i);
    container.appendChild(thumb);
  });
}

// Cloudinary Media Upload Handler
const CLOUDINARY_CLOUD_NAME = 'dp776nphp';
const CLOUDINARY_PRESET = 'vit0x7dr';

export async function uploadToCloudinary(base64Data, resourceType = 'image') {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_PRESET) {
    console.warn('Cloudinary credentials not provided.');
    return null;
  }

  try {
    const formData = new FormData();
    formData.append('file', base64Data);
    formData.append('upload_preset', CLOUDINARY_PRESET);

    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Cloudinary upload failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return null;
  }
}

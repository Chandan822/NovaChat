const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const generateImagePollinations = async (prompt) => {
  const response = await axios.get(
    `https://image.pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`,
    { responseType: 'arraybuffer', timeout: 15000 }
  );
  const base64Image = Buffer.from(response.data, 'binary').toString('base64');
  return `data:image/jpeg;base64,${base64Image}`;
};

const generateImageHuggingFace = async (prompt) => {
  if (!process.env.HF_API_KEY) {
    throw new Error('Hugging Face API key not configured on server.');
  }
  const response = await axios.post(
    'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
    { inputs: prompt },
    {
      headers: {
        Authorization: `Bearer ${process.env.HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 25000,
    }
  );
  const base64Image = Buffer.from(response.data, 'binary').toString('base64');
  return `data:image/jpeg;base64,${base64Image}`;
};

const run = async () => {
  const prompt = 'a lion sitting on a rock in a forest';
  
  console.log('Testing Pollinations...');
  try {
    const img = await generateImagePollinations(prompt);
    console.log('Pollinations Success! Length:', img.length);
  } catch (err) {
    console.error('Pollinations Error:', err.message);
  }

  console.log('Testing Hugging Face...');
  try {
    const img = await generateImageHuggingFace(prompt);
    console.log('Hugging Face Success! Length:', img.length);
  } catch (err) {
    console.error('Hugging Face Error:', err.message);
    if (err.response) {
      console.error('HF Status:', err.response.status);
      console.error('HF Data:', Buffer.from(err.response.data).toString());
    }
  }
};

run();

const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const run = async () => {
  const apiKey = process.env.TAVILY_API_KEY;
  console.log('Using Tavily API Key:', apiKey);
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: apiKey,
      query: 'current weather in London',
      search_depth: 'basic',
      include_answer: true,
      max_results: 3,
    });
    console.log('Success! Results count:', response.data?.results?.length);
    console.log('Answer:', response.data?.answer);
  } catch (err) {
    console.error('Error Status:', err.response?.status);
    console.error('Error Data:', err.response?.data);
    console.error('Error Message:', err.message);
  }
};

run();

const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const Groq = require('groq-sdk');
const axios = require('axios');
const { decrypt } = require('../utils/crypto');

const performTavilySearch = async (query) => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey === 'your_tavily_api_key_here') {
    return 'Search failed: Tavily API key is not configured on the server.';
  }
  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: apiKey,
      query: query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 3,
    });
    
    const results = response.data?.results || [];
    if (results.length === 0) return 'No search results found.';
    
    return results
      .map((r, i) => `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content ? r.content.substring(0, 400) + '...' : 'No description'}`)
      .join('\n\n');
  } catch (error) {
    console.error('Tavily search error:', error?.response?.data || error.message);
    return `Search error: ${error.message}`;
  }
};

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

const CONTEXT_MESSAGE_LIMIT = 10;
const MAX_IMAGE_FILES = 5;
const MAX_TEXT_FILES = 2;
const MAX_TEXT_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const NOVA_SYSTEM_PROMPT = "You are NovaChat, a highly capable, creative, and clever AI assistant. You can help with writing, analysis, learning, coding, calculations, and general conversation. Output responses using clean, well-formatted markdown. If generating code, use markdown code blocks with the correct language tag.";
const DEFAULT_TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'llama-3.2-11b-vision-preview';
const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant'
]);

const getGroqKeys = () => {
  const envKeys = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
    : [];
  if (envKeys.length > 0) return envKeys;
  return process.env.GROQ_API_KEY ? [process.env.GROQ_API_KEY.trim()] : [];
};

const getApiKeyForUser = (userId, keys) => {
  if (!keys || keys.length === 0) return null;
  if (!userId) {
    const randomIndex = Math.floor(Math.random() * keys.length);
    return keys[randomIndex];
  }
  let hash = 0;
  const idStr = String(userId);
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % keys.length;
  return keys[index];
};

// Helper to extract code snippets from markdown text
const extractCodeSnippets = (text) => {
  const codeSnippets = [];
  const regex = /```([\w-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    codeSnippets.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }
  return codeSnippets;
};

const getMessageContentForContext = (message) => {
  let content = message.content;
  const textAttachments = message.attachments?.filter((file) => file.kind === 'text' && file.textContent) || [];

  if (textAttachments.length > 0) {
    const attachmentText = textAttachments
      .map((file) => `--- ${file.fileName} (${file.mimeType}) ---\n${file.textContent}`)
      .join('\n\n');

    content = `${content}\n\nAttached text files:\n${attachmentText}`;
  }

  const imageAttachments = message.attachments?.filter((file) => file.kind === 'image') || [];
  if (imageAttachments.length > 0) {
    const imageList = imageAttachments.map((file) => file.fileName).join(', ');
    content = `${content}\n\nAttached image files: ${imageList}`;
  }

  return content;
};

const toGroqMessages = (messages) => messages
  .filter((m) => m.role === 'user' || m.role === 'assistant')
  .map((m) => ({
    role: m.role,
    content: getMessageContentForContext(m),
  }));

const formatTranscript = (messages) => messages
  .map((m, index) => `${index + 1}. ${m.role.toUpperCase()}: ${m.content}`)
  .join('\n\n');

const fallbackSummary = (messages) => messages
  .map((m) => {
    const compactContent = String(m.content || '').replace(/\s+/g, ' ').trim();
    return `${m.role}: ${compactContent.slice(0, 240)}${compactContent.length > 240 ? '...' : ''}`;
  })
  .join('\n');

const summarizeMessages = async (groq, messages) => {
  if (messages.length === 0) return null;

  try {
    const result = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Summarize the earlier chat context for a general-purpose AI assistant. Keep important user goals, key details, constraints, decisions, and unresolved questions. Be concise and factual.',
        },
        {
          role: 'user',
          content: `Summarize this older conversation in 8 short bullet points or fewer:\n\n${formatTranscript(messages)}`,
        },
      ],
      model: DEFAULT_TEXT_MODEL,
    });

    return result.choices[0]?.message?.content?.trim() || fallbackSummary(messages);
  } catch (error) {
    console.error('Failed to summarize older messages:', error);
    return fallbackSummary(messages);
  }
};

const buildContextMessages = async (groq, allMessages) => {
  const groqMessages = toGroqMessages(allMessages);
  const recentMessages = groqMessages.slice(-CONTEXT_MESSAGE_LIMIT);
  const olderMessages = groqMessages.slice(0, -CONTEXT_MESSAGE_LIMIT);

  if (olderMessages.length === 0) {
    return recentMessages;
  }

  const summary = await summarizeMessages(groq, olderMessages);
  return [
    {
      role: 'system',
      content: `Short summary of earlier messages before the latest ${CONTEXT_MESSAGE_LIMIT} messages:\n${summary}`,
    },
    ...recentMessages,
  ];
};

const processUploads = (files = []) => {
  const imageFiles = files.filter((file) => file.mimetype.startsWith('image/'));
  const textFiles = files.filter((file) => !file.mimetype.startsWith('image/'));

  if (imageFiles.length > MAX_IMAGE_FILES) {
    const error = new Error(`You can upload at most ${MAX_IMAGE_FILES} images per message.`);
    error.statusCode = 400;
    throw error;
  }

  if (textFiles.length > MAX_TEXT_FILES) {
    const error = new Error(`You can upload at most ${MAX_TEXT_FILES} text files per message.`);
    error.statusCode = 400;
    throw error;
  }

  const attachments = [];
  const imageParts = [];

  for (const file of imageFiles) {
    attachments.push({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      kind: 'image',
    });

    imageParts.push({
      type: 'image_url',
      image_url: {
        url: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
      },
    });
  }

  for (const file of textFiles) {
    if (file.size > MAX_TEXT_FILE_SIZE_BYTES) {
      const error = new Error('Each text file must be 1MB or smaller.');
      error.statusCode = 400;
      throw error;
    }

    attachments.push({
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      kind: 'text',
      textContent: file.buffer.toString('utf8'),
    });
  }

  return { attachments, imageParts };
};

const applyCurrentImagesToContext = (contextMessages, imageParts) => {
  if (imageParts.length === 0 || contextMessages.length === 0) {
    return contextMessages;
  }

  const updatedMessages = [...contextMessages];
  const lastIndex = updatedMessages.length - 1;
  const lastMessage = updatedMessages[lastIndex];

  if (lastMessage.role !== 'user') {
    return contextMessages;
  }

  updatedMessages[lastIndex] = {
    ...lastMessage,
    content: [
      { type: 'text', text: lastMessage.content },
      ...imageParts,
    ],
  };

  return updatedMessages;
};

// Start a new chat
exports.createChat = async (req, res) => {
  try {
    const { title } = req.body;
    const newChat = new Chat({
      userId: req.user._id,
      title: title || 'New Chat',
    });
    const savedChat = await newChat.save();
    res.status(201).json(savedChat);
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ message: 'Server error creating chat' });
  }
};

// Get all chats for a user
exports.getUserChats = async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user._id, isActive: true })
      .sort({ updatedAt: -1 });
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ message: 'Server error fetching chats' });
  }
};

// Delete a chat (soft delete)
exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const chat = await Chat.findOne({ _id: chatId, userId: req.user._id });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    chat.isActive = false;
    await chat.save();
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ message: 'Server error deleting chat' });
  }
};

// Get all messages for a chat
exports.getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Ensure chat belongs to user
    const chat = await Chat.findOne({ _id: chatId, userId: req.user._id, isActive: true });
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const messages = await Message.find({ chatId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error fetching messages' });
  }
};

// Send a new message
exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const content = req.body.content?.trim() || '';
    const { attachments, imageParts } = processUploads(req.files || []);
    const messageContent = content || (
      attachments.length > 0
        ? `Uploaded ${attachments.length} file${attachments.length > 1 ? 's' : ''}.`
        : ''
    );

    if (!messageContent) {
      return res.status(400).json({ message: 'Message content or attachments are required' });
    }

    // Validate chat
    const chat = await Chat.findOne({ _id: chatId, userId: req.user._id, isActive: true });
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Handle Image Generation if requested
    const isImageGen = req.body.isImageGen === 'true' || req.body.isImageGen === true;
    if (isImageGen) {
      // Check daily limit (3 images per day)
      const todayStr = new Date().toISOString().split('T')[0];
      const user = await User.findById(req.user._id);

      if (user.lastImageGenDate === todayStr) {
        if (user.imageGenCount >= 3) {
          return res.status(429).json({ message: 'Daily limit of 3 images reached. Try again tomorrow.' });
        }
      } else {
        // Reset count for new day
        user.lastImageGenDate = todayStr;
        user.imageGenCount = 0;
        await user.save();
      }

      const preferredEngine = req.body.imageEngine || 'pollinations';
      let imageUrl = null;
      let usedEngine = preferredEngine;
      const errorLog = [];

      // Try preferred engine first
      try {
        if (preferredEngine === 'huggingface') {
          imageUrl = await generateImageHuggingFace(content);
        } else {
          imageUrl = await generateImagePollinations(content);
        }
      } catch (err) {
        console.error(`Preferred engine (${preferredEngine}) failed:`, err.message);
        errorLog.push(`${preferredEngine}: ${err.message}`);
        
        // Failover to other engine
        const fallbackEngine = preferredEngine === 'huggingface' ? 'pollinations' : 'huggingface';
        console.log(`Attempting fallback to ${fallbackEngine}...`);
        try {
          if (fallbackEngine === 'huggingface') {
            imageUrl = await generateImageHuggingFace(content);
          } else {
            imageUrl = await generateImagePollinations(content);
          }
          usedEngine = fallbackEngine;
        } catch (fallbackErr) {
          console.error(`Fallback engine (${fallbackEngine}) failed:`, fallbackErr.message);
          errorLog.push(`${fallbackEngine}: ${fallbackErr.message}`);
        }
      }

      if (!imageUrl) {
        return res.status(502).json({
          message: 'Failed to generate image from all available services.',
          details: errorLog.join(' | ')
        });
      }

      // Save user message (prompt)
      const userMessage = new Message({
        chatId,
        userId: req.user._id,
        role: 'user',
        content: `Generate image: "${content}"`,
      });
      await userMessage.save();

      // Save assistant message (image markdown)
      const responseText = `![Generated Image: ${content}](${imageUrl})`;
      const assistantMessage = new Message({
        chatId,
        userId: req.user._id,
        role: 'assistant',
        content: responseText,
        metadata: {
          model: `ImageGen (${usedEngine})`,
          processingTime: 0,
        }
      });
      await assistantMessage.save();

      // Update User Gen Stats
      user.imageGenCount += 1;
      await user.save();

      // Update Chat stats
      chat.messageCount += 2;
      chat.updatedAt = Date.now();
      
      if (chat.messageCount === 2) {
        chat.title = `Image: ${content.substring(0, 20)}`;
      }
      await chat.save();

      return res.status(200).json({
        userMessage,
        assistantMessage
      });
    }

    // Extract code snippets from user content (if any)
    const userSnippets = extractCodeSnippets(messageContent);
    
    // Save User Message
    const userMessage = new Message({
      chatId,
      userId: req.user._id,
      role: 'user',
      content: messageContent,
      hasCode: userSnippets.length > 0,
      codeSnippets: userSnippets,
      attachments,
    });
    await userMessage.save();

    // Determine the text model to use (default or dynamic selection)
    let selectedTextModel = req.body.model || DEFAULT_TEXT_MODEL;
    if (!ALLOWED_MODELS.has(selectedTextModel)) {
      selectedTextModel = DEFAULT_TEXT_MODEL;
    }
    const model = imageParts.length > 0 ? VISION_MODEL : selectedTextModel;

    // Determine the Groq API key: use user's custom key if configured, otherwise fallback to system keys
    let apiKey = null;
    if (req.user?.groqApiKey && req.user?.groqApiKeyIv) {
      try {
        apiKey = decrypt(req.user.groqApiKey, req.user.groqApiKeyIv);
      } catch (decryptError) {
        console.error('Failed to decrypt user Groq API key, falling back to system keys:', decryptError);
      }
    }

    if (!apiKey) {
      // Load balance Groq keys consistently by user ID
      const availableKeys = getGroqKeys();
      apiKey = getApiKeyForUser(req.user?._id, availableKeys);
    }

    if (!apiKey) {
      return res.status(500).json({ message: 'No Groq API keys configured on server.' });
    }

    const groq = new Groq({ apiKey });

    // Fetch all messages after saving the current user message.
    // The latest 10 are sent verbatim; anything older is summarized.
    const allMessages = await Message.find({ chatId }).sort({ timestamp: 1 });
    let contextMessages = applyCurrentImagesToContext(
      await buildContextMessages(groq, allMessages),
      imageParts
    );
    
    const isWebSearch = req.body.webSearch === 'true' || req.body.webSearch === true;
    if (isWebSearch && content) {
      const searchResult = await performTavilySearch(content);
      contextMessages.push({
        role: 'system',
        content: `Live Web Search Results for "${content}":\n\n${searchResult}\n\nUse the search results above to answer the user's query accurately. Cite the source URLs if available.`
      });
    }
    
    // Send the message and get response
    const startTime = Date.now();
    let result;
    try {
      result = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: NOVA_SYSTEM_PROMPT
          },
          ...contextMessages
        ],
        model,
      });
    } catch (groqError) {
      console.error('------- GROQ API CRASH -------');
      console.error(groqError);
      console.error('--------------------------------');
      return res.status(502).json({ message: 'Error from AI provider', details: groqError.message });
    }
    
    let responseText = result.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    // Remove <think>...</think> blocks from the model's response
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    
    const processingTime = Date.now() - startTime;

    // Parse code snippets from the model's response
    const assistantSnippets = extractCodeSnippets(responseText);

    // Save Assistant Message
    const assistantMessage = new Message({
      chatId,
      userId: req.user._id,
      role: 'assistant',
      content: responseText,
      hasCode: assistantSnippets.length > 0,
      codeSnippets: assistantSnippets,
      metadata: {
        model,
        processingTime,
      }
    });
    await assistantMessage.save();

    // Update Chat statistics
    chat.messageCount += 2;
    chat.updatedAt = Date.now();
    
    // Automatically generate a title if it's the first message
    if (chat.messageCount === 2) {
      // Very basic title generator based on first message
      chat.title = messageContent.substring(0, 30) + (messageContent.length > 30 ? '...' : '');
    }
    await chat.save();

    return res.status(200).json({
      userMessage,
      assistantMessage
    });

  } catch (error) {
    console.error('Error sending message:', error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Server error processing your message' });
  }
};

// Send an anonymous message (No DB saving, no Auth)
exports.sendAnonymousMessage = async (req, res) => {
  try {
    const { content, history = [] } = req.body;

    if (!content) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    // Determine the text model to use (default or dynamic selection)
    let selectedTextModel = req.body.model || DEFAULT_TEXT_MODEL;
    if (!ALLOWED_MODELS.has(selectedTextModel)) {
      selectedTextModel = DEFAULT_TEXT_MODEL;
    }

    // Load balance Groq keys
    const availableKeys = getGroqKeys();
    const apiKey = getApiKeyForUser(null, availableKeys); // anonymous guest has null userId
    if (!apiKey) {
      return res.status(500).json({ message: 'No Groq API keys configured on server.' });
    }

    const groq = new Groq({ apiKey });

    // Anonymous history lives in frontend state. Add the current message once,
    // then summarize older context if the conversation is longer than 10 messages.
    const allMessages = [
      ...history,
      { role: 'user', content },
    ];
    let contextMessages = await buildContextMessages(groq, allMessages);
    
    const isWebSearch = req.body.webSearch === 'true' || req.body.webSearch === true;
    if (isWebSearch && content) {
      const searchResult = await performTavilySearch(content);
      contextMessages.push({
        role: 'system',
        content: `Live Web Search Results for "${content}":\n\n${searchResult}\n\nUse the search results above to answer the user's query accurately. Cite the source URLs if available.`
      });
    }
    
    // Send the message and get response
    const startTime = Date.now();
    let result;
    try {
      result = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: NOVA_SYSTEM_PROMPT
          },
          ...contextMessages
        ],
        model: selectedTextModel,
      });
    } catch (groqError) {
      console.error('------- GROQ API CRASH -------');
      console.error(groqError);
      console.error('--------------------------------');
      return res.status(502).json({ message: 'Error from AI provider', details: groqError.message });
    }
    
    let responseText = result.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    // Remove <think>...</think> blocks from the model's response
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const processingTime = Date.now() - startTime;

    // Parse code snippets from the model's response
    const assistantSnippets = extractCodeSnippets(responseText);

    const assistantMessage = {
      role: 'assistant',
      content: responseText,
      hasCode: assistantSnippets.length > 0,
      codeSnippets: assistantSnippets,
      timestamp: new Date(),
      metadata: {
        model: selectedTextModel,
        processingTime,
      }
    };

    const userMessage = {
      role: 'user',
      content,
      timestamp: new Date(),
      hasCode: extractCodeSnippets(content).length > 0
    };

    return res.status(200).json({
      userMessage,
      assistantMessage
    });

  } catch (error) {
    console.error('Error sending anonymous message:', error);
    res.status(500).json({ message: 'Server error processing anonymous message' });
  }
};

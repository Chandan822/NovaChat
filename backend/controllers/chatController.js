const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Groq = require('groq-sdk');

const CONTEXT_MESSAGE_LIMIT = 10;
const MAX_IMAGE_FILES = 5;
const MAX_TEXT_FILES = 2;
const MAX_TEXT_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const NOVA_SYSTEM_PROMPT = "You are NovaChat, a highly capable, creative, and clever AI assistant. You can help with writing, analysis, learning, coding, calculations, and general conversation. Output responses using clean, well-formatted markdown. If generating code, use markdown code blocks with the correct language tag.";
const DEFAULT_TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'llama-3.2-11b-vision-preview';
const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
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

    // Load balance Groq keys consistently by user ID
    const availableKeys = getGroqKeys();
    const apiKey = getApiKeyForUser(req.user?._id, availableKeys);
    if (!apiKey) {
      return res.status(500).json({ message: 'No Groq API keys configured on server.' });
    }

    const groq = new Groq({ apiKey });

    // Fetch all messages after saving the current user message.
    // The latest 10 are sent verbatim; anything older is summarized.
    const allMessages = await Message.find({ chatId }).sort({ timestamp: 1 });
    const contextMessages = applyCurrentImagesToContext(
      await buildContextMessages(groq, allMessages),
      imageParts
    );
    
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
    
    const responseText = result.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
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
    const contextMessages = await buildContextMessages(groq, allMessages);
    
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
    
    const responseText = result.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    const processingTime = Date.now() - startTime;

    // Parse code snippets from the model's response
    const assistantSnippets = extractCodeSnippets(responseText);

    const assistantMessage = {
      role: 'assistant',
      content: responseText,
      hasCode: assistantSnippets.length > 0,
      codeSnippets: assistantSnippets,
      metadata: {
        model: selectedTextModel,
        processingTime,
      }
    };

    const userMessage = {
      role: 'user',
      content,
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

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, LogOut, Send, MessageSquare, PlusCircle, User, Loader, Trash2, LogIn, Moon, Sun, Paperclip, X, Image, FileText, Copy, Check, Globe, Menu } from 'lucide-react';
import api from '../api/axios';
import '../ChatDashboard.css';

const MAX_IMAGE_FILES = 5;
const MAX_TEXT_FILES = 2;
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_TEXT_SIZE = 1 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/javascript', 'text/javascript', 'text/css', 'text/html'];
const ALLOWED_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html'];

const CodeBlock = ({ className, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');
  
  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-block-lang">{match ? match[1] : 'code'}</span>
        <button 
          type="button" 
          className="code-copy-btn" 
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className={className} {...props}>
        <code>{children}</code>
      </pre>
    </div>
  );
};

function ChatDashboard() {
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [copiedIndex, setCopiedIndex] = useState(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleCopy = (content, index) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const modelsList = [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', desc: 'Capable and deep reasoning model' },
    { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', desc: 'Fast & capable instruction model' },
    { id: 'openai/gpt-oss-20b', name: 'GPT OSS 20B', desc: 'Open source equivalent model' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', desc: 'Instant-speed general answers' },
  ];

  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userName = localStorage.getItem('userName') || 'User';

  const isLoggedIn = !!localStorage.getItem('token');

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Fetch user chats on mount if logged in
  useEffect(() => {
    if (isLoggedIn) fetchChats();
  }, [isLoggedIn]);

  // Fetch messages when current chat changes (if logged in and selecting a real chat)
  useEffect(() => {
    if (currentChatId && currentChatId !== 'anonymous' && isLoggedIn) {
      fetchMessages(currentChatId);
    } else if (currentChatId === 'anonymous') {
      // Local only, already handled
    } else {
      setMessages([]);
    }
  }, [currentChatId, isLoggedIn]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchChats = async () => {
    try {
      const response = await api.get('/chat');
      setChats(response.data);
      if (response.data.length > 0 && !currentChatId) {
        setCurrentChatId(response.data[0]._id);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        handleLogout();
      }
      console.error('Failed to fetch chats', error);
    }
  };

  const fetchMessages = async (chatId) => {
    try {
      const response = await api.get(`/chat/${chatId}/messages`);
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages', error);
    }
  };

  const handleNewChat = async () => {
    if (!isLoggedIn) {
      setMessages([]);
      setCurrentChatId('anonymous');
      return;
    }
    
    try {
      const response = await api.post('/chat/new', { title: 'New Chat' });
      setChats([response.data, ...chats]);
      setCurrentChatId(response.data._id);
    } catch (error) {
      console.error('Failed to create new chat', error);
    }
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation(); // prevent chat selection
    if (!window.confirm("Are you sure you want to delete this chat?")) return;
    try {
      await api.delete(`/chat/${chatId}`);
      setChats(prev => prev.filter(c => c._id !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete chat', error);
    }
  };

  const getFileKind = (file) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.type)) return 'image';
    const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (ALLOWED_TEXT_TYPES.includes(file.type) || ALLOWED_TEXT_EXTENSIONS.includes(extension)) return 'text';
    return null;
  };

  const validateFiles = (files) => {
    const combinedFiles = [...selectedFiles, ...files];
    const imageFiles = combinedFiles.filter((file) => getFileKind(file) === 'image');
    const textFiles = combinedFiles.filter((file) => getFileKind(file) === 'text');
    const unsupportedFile = combinedFiles.find((file) => !getFileKind(file));
    const oversizedImage = imageFiles.find((file) => file.size > MAX_IMAGE_SIZE);
    const oversizedText = textFiles.find((file) => file.size > MAX_TEXT_SIZE);

    if (unsupportedFile) return 'Only PNG, JPG, WEBP images and small text files are allowed.';
    if (imageFiles.length > MAX_IMAGE_FILES) return `You can attach at most ${MAX_IMAGE_FILES} images.`;
    if (textFiles.length > MAX_TEXT_FILES) return `You can attach at most ${MAX_TEXT_FILES} text files.`;
    if (oversizedImage) return 'Each image must be 2MB or smaller.';
    if (oversizedText) return 'Each text file must be 1MB or smaller.';

    return '';
  };

  const handleFileSelection = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validationError = validateFiles(files);
    if (validationError) {
      setFileError(validationError);
    } else {
      setSelectedFiles((prev) => [...prev, ...files]);
      setFileError('');
    }

    e.target.value = '';
  };

  const removeSelectedFile = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
    setFileError('');
  };

  const formatFileSize = (size) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderAttachments = (attachments = []) => {
    if (!attachments.length) return null;

    return (
      <div className="message-attachments">
        {attachments.map((file, index) => (
          <span key={`${file.fileName}-${index}`} className="attachment-pill">
            {file.kind === 'image' ? <Image size={14} /> : <FileText size={14} />}
            <span>{file.fileName}</span>
          </span>
        ))}
      </div>
    );
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() && selectedFiles.length === 0) return;

    if (!isLoggedIn) {
      // ANONYMOUS MODE
      const newMessage = { role: 'user', content: inputMessage, timestamp: new Date().toISOString() };
      setMessages((prev) => [...prev, newMessage]);
      setInputMessage('');
      setLoading(true);
      
      try {
        const response = await api.post('/chat/anonymous', { 
          content: newMessage.content,
          history: messages,
          model: selectedModel,
          webSearch: webSearchEnabled
        });
        setMessages((prev) => [...prev, response.data.assistantMessage]);
        setCurrentChatId('anonymous');
      } catch (error) {
        console.error('Failed to send anonymous message', error);
      } finally {
        setLoading(false);
      }
      return;
    }

    // LOGGED IN MODE
    let targetChatId = currentChatId;

    // If no active chat, create one first
    if (!targetChatId || targetChatId === 'anonymous') {
      try {
        const response = await api.post('/chat/new', { title: inputMessage.substring(0, 30) });
        targetChatId = response.data._id;
        setChats([response.data, ...chats]);
        setCurrentChatId(targetChatId);
      } catch (error) {
        console.error('Failed to create chat', error);
        return;
      }
    }

    const attachments = selectedFiles.map((file) => ({
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      kind: getFileKind(file),
    }));
    const newMessage = {
      role: 'user',
      content: inputMessage || `Uploaded ${attachments.length} file${attachments.length > 1 ? 's' : ''}.`,
      attachments,
      timestamp: new Date().toISOString(),
    };
    const outgoingFiles = selectedFiles;
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage('');
    setSelectedFiles([]);
    setFileError('');
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('content', newMessage.content);
      formData.append('model', selectedModel);
      formData.append('webSearch', webSearchEnabled);
      outgoingFiles.forEach((file) => formData.append('attachments', file));

      const response = await api.post(`/chat/${targetChatId}/message`, formData);
      setMessages((prev) => {
        return [...prev, response.data.assistantMessage];
      });
      fetchChats();
    } catch (error) {
      setFileError(error.response?.data?.message || 'Failed to send message');
      console.error('Failed to send message', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userName');
    // Reset all chat state so history is not visible after logout
    setChats([]);
    setMessages([]);
    setCurrentChatId(null);
    navigate('/');
  };

  return (
    <div className="dashboard-container" data-theme={theme}>
      {/* Sidebar */}
      <aside className={`chat-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="brand-row">
            <h2>NovaChat</h2>
            <div className="sidebar-header-actions">
              <button
                type="button"
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                className="theme-toggle"
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(true)}
                className="sidebar-toggle-inner"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <Menu size={18} />
              </button>
            </div>
          </div>
          <button onClick={handleNewChat} className="new-chat-btn">
            <PlusCircle size={20} />
            <span>New Chat</span>
          </button>
        </div>
        
        <div className="chat-list">
          {!isLoggedIn && (
            <div className={`chat-list-item ${currentChatId === 'anonymous' ? 'active' : ''}`} onClick={() => setCurrentChatId('anonymous')}>
              <MessageSquare size={18} />
              <span className="chat-title">Anonymous Chat</span>
            </div>
          )}

          {chats.map(chat => (
            <div 
              key={chat._id} 
              className={`chat-list-item ${currentChatId === chat._id ? 'active' : ''}`}
              onClick={() => setCurrentChatId(chat._id)}
            >
              <MessageSquare size={18} />
              <span className="chat-title" title={chat.title}>{chat.title}</span>
              <Trash2 
                size={16} 
                className="delete-icon" 
                onClick={(e) => handleDeleteChat(e, chat._id)}
                style={{ marginLeft: 'auto', opacity: 0.6 }}
              />
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-profile">
            <User size={20} />
            <span>{isLoggedIn ? userName : 'Guest'}</span>
          </div>
          {isLoggedIn ? (
            <button onClick={handleLogout} className="logout-btn" title="Logout">
              <LogOut size={20} />
            </button>
          ) : (
            <button onClick={() => navigate('/login')} className="logout-btn" title="Login">
              <LogIn size={20} />
            </button>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <div className="chat-header">
          {isSidebarCollapsed && (
            <button 
              type="button" 
              className="sidebar-toggle-btn" 
              onClick={() => setIsSidebarCollapsed(false)}
              title="Expand sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu size={18} />
            </button>
          )}
          <div className="chat-header-info">
            <h3>{currentChatId === 'anonymous' ? 'Anonymous Chat' : (currentChatId ? (chats.find(c => c._id === currentChatId)?.title || 'NovaChat') : 'NovaChat')}</h3>
          </div>
          {currentChatId && (
            <div className="chat-header-actions">
              <div className="custom-dropdown" ref={dropdownRef}>
                <button 
                  type="button"
                  className="dropdown-trigger" 
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  title="Choose AI Model"
                >
                  <span>{modelsList.find(m => m.id === selectedModel)?.name || 'Select Model'}</span>
                  <ChevronDown size={15} className={`chevron-icon ${isModelDropdownOpen ? 'open' : ''}`} />
                </button>
                {isModelDropdownOpen && (
                  <div className="dropdown-menu">
                    {modelsList.map((m) => (
                      <div 
                        key={m.id} 
                        className={`dropdown-item ${selectedModel === m.id ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedModel(m.id);
                          setIsModelDropdownOpen(false);
                        }}
                      >
                        <div className="model-item-title">{m.name}</div>
                        <div className="model-item-desc">{m.desc}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {currentChatId ? (
          <>

            <div className="messages-area">
              {messages.length === 0 ? (
                <div className="empty-chat-state">
                  <h3>Start a new conversation</h3>
                  <p>Ask me anything—writing, analysis, learning, coding, or just start a chat.</p>
                  {!isLoggedIn && <p className="guest-note"><strong>Note:</strong> You are chatting anonymously. Messages will not be saved.</p>}
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className={`message-bubble ${msg.role}`}>
                    <div className="message-content">
                      <ReactMarkdown
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            return !inline ? (
                              <CodeBlock className={className} {...props}>{children}</CodeBlock>
                            ) : (
                              <code className={className} {...props}>{children}</code>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                      {renderAttachments(msg.attachments)}
                    </div>
                    <div className="message-footer">
                      {msg.role === 'assistant' && msg.metadata?.model && (
                        <div className="model-badge">
                          {msg.metadata.model === 'llama-3.3-70b-versatile' ? 'Llama 3.3' :
                           msg.metadata.model === 'qwen/qwen3-32b' ? 'Qwen 3 32B' :
                           msg.metadata.model === 'openai/gpt-oss-20b' ? 'GPT OSS 20B' :
                           msg.metadata.model === 'llama-3.1-8b-instant' ? 'Llama 3.1' :
                           msg.metadata.model === 'llama-3.2-11b-vision-preview' ? 'Llama 3.2 Vision' :
                           msg.metadata.model}
                        </div>
                      )}
                      <div className="message-actions">
                        <span className="message-timestamp">
                          {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button type="button" className="copy-btn" onClick={() => handleCopy(msg.content, index)} title="Copy message">
                          {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="message-bubble assistant">
                  <div className="message-content typing-indicator">
                    <Loader className="spinner" size={16} />
                    <span>NovaChat is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              {isLoggedIn && selectedFiles.length > 0 && (
                <div className="selected-files">
                  {selectedFiles.map((file, index) => (
                    <span key={`${file.name}-${index}`} className="selected-file-pill">
                      {getFileKind(file) === 'image' ? <Image size={14} /> : <FileText size={14} />}
                      <span>{file.name}</span>
                      <small>{formatFileSize(file.size)}</small>
                      <button type="button" onClick={() => removeSelectedFile(index)} aria-label={`Remove ${file.name}`}>
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {fileError && <div className="file-error">{fileError}</div>}
              <form onSubmit={handleSendMessage} className="message-form">
                <button
                  type="button"
                  className={`websearch-toggle-btn ${webSearchEnabled ? 'active' : ''}`}
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  title="Search the web for real-time results"
                  aria-label="Toggle web search"
                >
                  <Globe size={20} />
                </button>
                {isLoggedIn && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.css,.html,text/plain,text/markdown,text/csv,application/json,application/javascript,text/javascript,text/css,text/html,image/png,image/jpeg,image/webp"
                      onChange={handleFileSelection}
                      className="file-input"
                    />
                    <button
                      type="button"
                      className="attach-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      title="Attach files"
                      aria-label="Attach files"
                    >
                      <Paperclip size={20} />
                    </button>
                  </>
                )}
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ask NovaChat..."
                  disabled={loading}
                  autoFocus
                />
                <button type="submit" disabled={loading || (!inputMessage.trim() && selectedFiles.length === 0)}>
                  <Send size={20} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <h2>Welcome back, {userName}!</h2>
            <p>Select a chat from the sidebar or start a new one to begin.</p>
            <button onClick={handleNewChat} className="start-learning-btn">
              Start Chatting
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default ChatDashboard;

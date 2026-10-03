import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  MapPin, 
  Search, 
  Mic, 
  MicOff, 
  Volume2, 
  Send, 
  Sparkles, 
  Database, 
  LogIn, 
  LogOut, 
  ShieldCheck, 
  Radio, 
  Check, 
  AlertCircle,
  FileText,
  UserCheck,
  Zap,
  Globe2
} from 'lucide-react';
import { auth, googleProvider, db, firebaseEnabled } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { postApi, responseSource, errorMessage } from '../lib/api';
import { useMicrophone } from '../lib/microphone';

interface GeminiIntelligenceHubProps {
  addSimEvent: (msg: string) => void;
}

export const GeminiIntelligenceHub: React.FC<GeminiIntelligenceHubProps> = ({ addSimEvent }) => {
  const [activeSubTab, setActiveSubTab] = useState<'chatbot' | 'voice_live' | 'transcribe' | 'maps_grounding' | 'search_grounding' | 'firebase_auth'>('chatbot');

  // Firebase Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<string>(firebaseEnabled ? 'Ready' : 'Disabled · local browser memories');

  // Multi-Turn Chatbot State
  const [chatModel, setChatModel] = useState<string>('gemini-3.8-flash');
  const [chatRole, setChatRole] = useState<'general' | 'tactical_commander' | 'world_storyteller' | 'mod_engineer'>('tactical_commander');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model'; text: string; timestamp: string }[]>([
    {
      role: 'model',
      text: 'Greetings, Commander. Living Los Santos AI neural dispatcher online. How may I assist your Los Santos operations or tactical behavior trees today?',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Audio Transcription State (gemini-3.5-transcribe)
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<string>('');
  const [transcriptionText, setTranscriptionText] = useState<string>('');
  const microphone = useMicrophone(text => { setTranscriptionText(text); addSimEvent('Browser audio transcription completed'); });
  const isRecording = microphone.recording;
  const isTranscribing = microphone.pending;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  // Maps Grounding State
  const [mapsQuery, setMapsQuery] = useState<string>('Compare Los Santos Vinewood Hills and Del Perro Pier to their real-world Los Angeles counterparts.');
  const [mapsResult, setMapsResult] = useState<string>('');
  const [isMapsLoading, setIsMapsLoading] = useState<boolean>(false);

  // Search Grounding State
  const [searchQuery, setSearchQuery] = useState<string>('Latest GTA V Enhanced ScriptHookVDotNet and RAGEPluginHook compatibility updates');
  const [searchResult, setSearchResult] = useState<string>('');
  const [isSearchLoading, setIsSearchLoading] = useState<boolean>(false);

  // Live Voice Converse State
  const [liveVoiceText, setLiveVoiceText] = useState<string>('Officer Sterling, what is your 10-20 near Maze Bank?');
  const [selectedVoice, setSelectedVoice] = useState<string>('Puck');
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  // Listen to Firebase Auth
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  // Handle Google Sign In
  const handleGoogleSignIn = async () => {
    if (!auth || !db) { setCloudSyncStatus('Cloud services are disabled for this local companion.'); return; }
    setAuthLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      addSimEvent(`Firebase Auth: Signed in as ${user.displayName || user.email}`);

      // Save user profile to Firestore
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'Player',
        preferredFaction: 'Families',
        savedGameVersion: '1.0.1158.16',
        lastLogin: new Date().toISOString(),
      }, { merge: true });

      setCloudSyncStatus('Profile synced to Firestore');
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        // User closed or cancelled the popup
        setCloudSyncStatus('Sign-in cancelled by user');
        return;
      }
      console.warn('Firebase Auth notice:', err?.message);
      setCloudSyncStatus(`Auth: ${err?.message || 'Failed'}`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    try { await signOut(auth); addSimEvent('Firebase Auth: Signed out'); }
    catch (error) { setCloudSyncStatus(errorMessage(error)); }
  };

  // Send Chatbot message
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = {
      role: 'user' as const,
      text: chatInput,
      timestamp: new Date().toLocaleTimeString(),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setIsChatLoading(true); setRequestError(null);

    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chatModel,
          role: chatRole,
          messages: newHistory.map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success && data.text) {
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: data.text,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
        addSimEvent(`${responseSource(data)} responded to the chat query`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsChatLoading(false);
    }
  };

  // Maps Grounding Query
  const handleRunMapsGrounding = async () => {
    if (!mapsQuery.trim() || isMapsLoading) return;
    setIsMapsLoading(true); setRequestError(null);
    try {
      const res = await fetch('/api/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: mapsQuery }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success) {
        setMapsResult(data.text);
        addSimEvent(`Map query completed: ${responseSource(data)}`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsMapsLoading(false);
    }
  };

  // Search Grounding Query
  const handleRunSearchGrounding = async () => {
    if (!searchQuery.trim() || isSearchLoading) return;
    setIsSearchLoading(true); setRequestError(null);
    try {
      const res = await fetch('/api/search-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.message || `Request failed (${res.status})`);
      setLastSource(responseSource(data));
      if (data.success) {
        setSearchResult(data.text);
        addSimEvent(`Search query completed: ${responseSource(data)}`);
      }
    } catch (err) {
      setRequestError(errorMessage(err));
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleStartRecording = () => { setTranscriptionText(''); void microphone.start(); };
  const handleStopRecording = microphone.stop;

  // This browser control plays a complete TTS response, independently of the game voice bridge.
  const handlePlayVoiceConversation = async () => {
    if (!liveVoiceText.trim() || isPlayingAudio) return;
    setIsPlayingAudio(true); setRequestError(null);
    try {
      const data = await postApi('/api/voice-converse', { text: liveVoiceText, voice: selectedVoice });
      if (!data.audioBase64 || !/^audio\/(wav|wave|x-wav|mpeg|ogg|webm)/i.test(data.mimeType || '')) {
        throw new Error('The audio service did not return a playable audio file.');
      }
      const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      audioRef.current?.pause(); audioRef.current = audio;
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => { setIsPlayingAudio(false); setRequestError('The browser could not decode or play this audio.'); };
      await audio.play();
      setLastSource(data.source || 'Gemini text-to-speech');
      addSimEvent(`Browser audio playback started (${selectedVoice})`);
    } catch (error) { setRequestError(errorMessage(error)); setIsPlayingAudio(false); }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-950/60 via-slate-900 to-cyan-950/50 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h2 className="font-chakra font-bold text-lg text-white tracking-wider">
              GEMINI MULTIMODAL INTELLIGENCE & CLOUD SUITE
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Gemini chat, grounding queries, real microphone transcription and browser text-to-speech. Source labels identify local fallback replies. Cloud profile sign-in is optional and disabled by default.
          </p>
        </div>

        {/* Firebase Auth Status Pill */}
        <div className="flex items-center space-x-2 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
          <Database className="w-4 h-4 text-emerald-400" />
          {currentUser ? (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-emerald-300 font-mono font-bold">
                {currentUser.displayName || currentUser.email}
              </span>
              <button
                onClick={handleSignOut}
                className="text-[10px] text-slate-400 hover:text-rose-400 underline font-mono"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={handleGoogleSignIn}
              disabled={authLoading || !firebaseEnabled}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold text-xs rounded shadow flex items-center space-x-1"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{!firebaseEnabled ? 'CLOUD DISABLED' : authLoading ? 'CONNECTING...' : 'SIGN IN WITH GOOGLE'}</span>
            </button>
          )}
        </div>
      </div>

      {(requestError || microphone.error) && <p role="alert" className="border border-rose-500/40 bg-rose-950/40 rounded-lg p-3 text-sm text-rose-200">{requestError || microphone.error}</p>}
      {lastSource && <p role="status" className="text-xs font-mono text-amber-300">Response source: {lastSource}</p>}
      <p className="text-xs font-mono text-slate-400">Cloud status: {cloudSyncStatus}</p>
      {/* Sub Tabs */}
      <div className="flex bg-slate-900/90 rounded-lg p-1 border border-slate-800 space-x-1 overflow-x-auto">
        {[
          { id: 'chatbot', label: 'GEMINI CHATBOT', icon: Bot },
          { id: 'voice_live', label: 'BROWSER VOICE OUTPUT', icon: Volume2 },
          { id: 'transcribe', label: 'AUDIO TRANSCRIBE', icon: Mic },
          { id: 'maps_grounding', label: 'GOOGLE MAPS GROUNDING', icon: MapPin },
          { id: 'search_grounding', label: 'SEARCH GROUNDING', icon: Search },
          { id: 'firebase_auth', label: 'FIREBASE CLOUD FIRESTORE', icon: Database },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveSubTab(tab.id as any); setRequestError(null); setLastSource(''); }}
              className={`flex items-center space-x-2 px-3 py-2 rounded-md font-chakra font-bold text-xs transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUB-PANEL 1: Multi-Turn Gemini Chatbot */}
      {activeSubTab === 'chatbot' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span>LOS SANTOS NEURAL DISPATCHER & COPILOT</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Multi-turn conversation engine with persistent context and role specializations.
              </p>
            </div>

            <div className="flex items-center space-x-2 text-xs font-mono">
              <div>
                <span className="text-slate-400 mr-1">Model:</span>
                <select
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value as any)}
                  className="bg-slate-950 border border-slate-700 text-emerald-300 rounded px-2 py-1"
                >
                  <option value="gemini-3.8-flash">gemini-3.8-flash (General)</option>
                  
                  
                </select>
              </div>

              <div>
                <span className="text-slate-400 mr-1">Role:</span>
                <select
                  value={chatRole}
                  onChange={(e) => setChatRole(e.target.value as any)}
                  className="bg-slate-950 border border-slate-700 text-amber-300 rounded px-2 py-1"
                >
                  <option value="tactical_commander">Tactical Commander</option>
                  <option value="world_storyteller">World Storyteller</option>
                  <option value="mod_engineer">Mod Systems Engineer</option>
                </select>
              </div>
            </div>
          </div>

          {/* Chat Messages Thread */}
          <div className="h-[420px] overflow-y-auto space-y-3 p-4 bg-[#090d16] rounded-xl border border-slate-800 font-mono text-xs">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 mb-1">
                  <span className="font-chakra font-bold text-slate-300">
                    {msg.role === 'user' ? 'Player' : `Gemini [${chatRole}]`}
                  </span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-tr-none'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {isChatLoading && (
              <div className="flex items-center space-x-2 text-slate-400 font-mono text-xs">
                <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
                <span>Generating response using {chatModel}...</span>
              </div>
            )}
            <div ref={chatScrollRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendChatMessage} className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask about tactical flanking plans, gang warfare lore, or ScriptHook bridge debugging..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isChatLoading}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/30 flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>SEND</span>
            </button>
          </form>
        </div>
      )}

      {/* SUB-PANEL 2: Voice Conversations (gemini-3.8-live / TTS) */}
      {activeSubTab === 'voice_live' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
              <Volume2 className="w-4 h-4 text-purple-400" />
              <span>BROWSER TEXT-TO-SPEECH PREVIEW</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Generate spoken audio from text and play it through this browser. This control is separate from in-game voice.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="text-xs font-mono text-slate-400 block">SPOKEN DIALOGUE LINE:</label>
              <textarea
                value={liveVoiceText}
                onChange={(e) => setLiveVoiceText(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-white font-mono"
              />

              <div className="flex items-center space-x-3 text-xs font-mono">
                <span className="text-slate-400">Prebuilt Voice:</span>
                <select
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-purple-300 rounded px-3 py-1.5"
                >
                  <option value="Puck">Puck (Energetic / Street Swagger)</option>
                  <option value="Charon">Charon (Deep Gravel O.G.)</option>
                  <option value="Kore">Kore (Clear Professional)</option>
                  <option value="Fenrir">Fenrir (Authoritative / Commander)</option>
                  <option value="Zephyr">Zephyr (Calm / Informant)</option>
                </select>
              </div>

              <button
                onClick={handlePlayVoiceConversation}
                disabled={isPlayingAudio || !liveVoiceText.trim()}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-purple-600/20 flex items-center justify-center space-x-2"
              >
                <Volume2 className="w-4 h-4" />
                <span>{isPlayingAudio ? 'GENERATING / PLAYING AUDIO...' : 'GENERATE & PLAY VOICE'}</span>
              </button>
            </div>

            <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 space-y-2 text-xs font-mono">
              <span className="font-chakra font-bold text-emerald-400 text-xs">VOICE INTEGRATION:</span>
              <p className="text-slate-300 leading-relaxed">
                This preview requests a complete audio file from the local companion server. The original LivingLSAIs.dll retains the separate voice bridge on port 8765 and its existing E / T / hold Y controls. Load that script in Story Mode to use game voice.
              </p>
              <div className="p-2 bg-slate-900 rounded border border-slate-800 text-[11px] text-amber-300">
                Browser audio playback must be allowed. Microphone permission is only needed for recording controls. In-game audio and response latency need runtime verification.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-PANEL 3: Audio Transcription (gemini-3.5-transcribe) */}
      {activeSubTab === 'transcribe' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
              <Mic className="w-4 h-4 text-rose-400" />
              <span>AUDIO MICROPHONE TRANSCRIPTION</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Record microphone audio and transcribe into discrete player commands and NPC speech input.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center p-8 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
            <button
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              disabled={isTranscribing}
              aria-label={isRecording ? "Stop microphone recording" : "Start microphone recording"}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all transform active:scale-95 ${
                isRecording
                  ? 'bg-rose-600 text-white animate-pulse shadow-rose-600/50'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-600/30'
              }`}
            >
              {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
            </button>
            <div className="text-xs font-mono text-slate-300">
              {isRecording ? 'RECORDING MICROPHONE... CLICK TO STOP' : 'CLICK TO START MICROPHONE RECORDING'}
            </div>
            {isTranscribing && (
              <div className="flex items-center space-x-2 text-xs font-mono text-emerald-400">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>Transcribing recorded audio…</span>
              </div>
            )}
          </div>

          {transcriptionText && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">TRANSCRIPTION OUTPUT:</span>
              <div className="text-sm font-mono text-emerald-300 italic">
                "{transcriptionText}"
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-PANEL 4: Google Maps Grounding */}
      {activeSubTab === 'maps_grounding' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>GOOGLE MAPS GROUNDING</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Retrieves real-world geographical mapping intel, street routes, and architectural inspirations.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={mapsQuery}
              onChange={(e) => setMapsQuery(e.target.value)}
              placeholder="Ask about real-world Los Angeles landmarks inspiring GTA V locations..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white font-mono"
            />
            <button
              onClick={handleRunMapsGrounding}
              disabled={isMapsLoading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-chakra font-bold text-xs rounded-lg shadow flex items-center space-x-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>SEARCH MAPS</span>
            </button>
          </div>

          {mapsResult && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">
              {mapsResult}
            </div>
          )}
        </div>
      )}

      {/* SUB-PANEL 5: Google Search Grounding */}
      {activeSubTab === 'search_grounding' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
              <Search className="w-4 h-4 text-cyan-400" />
              <span>GOOGLE SEARCH GROUNDING</span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Live web-grounded queries for latest GTA V mod patches, community AI behaviors, and news.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search live GTA V modding news..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white font-mono"
            />
            <button
              onClick={handleRunSearchGrounding}
              disabled={isSearchLoading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-chakra font-bold text-xs rounded-lg shadow flex items-center space-x-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>SEARCH LIVE WEB</span>
            </button>
          </div>

          {searchResult && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">
              {searchResult}
            </div>
          )}
        </div>
      )}

      {/* SUB-PANEL 6: Firebase Cloud Firestore */}
      {activeSubTab === 'firebase_auth' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <div>
              <h3 className="font-chakra font-bold text-white text-base flex items-center space-x-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>FIREBASE AUTHENTICATION & CLOUD FIRESTORE</span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Optional Google sign-in writes a user profile when cloud services are enabled. NPC memories remain in this browser.
              </p>
            </div>
            <div className="text-xs font-mono text-emerald-400 flex items-center space-x-1">
              <ShieldCheck className="w-4 h-4" />
              <span>{firebaseEnabled ? 'Optional cloud profile enabled' : 'Cloud disabled'}</span>
            </div>
          </div>

          {currentUser ? (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center font-bold text-black text-sm">
                  {currentUser.displayName ? currentUser.displayName[0] : 'U'}
                </div>
                <div>
                  <div className="font-chakra font-bold text-white text-sm">{currentUser.displayName || 'Authenticated Player'}</div>
                  <div className="text-slate-400">{currentUser.email}</div>
                  <div className="text-[10px] text-slate-500">UID: {currentUser.uid}</div>
                </div>
              </div>

              <div className="p-3 bg-slate-900 rounded border border-slate-800 text-emerald-300 text-xs">
                Profile sign-in is active. NPC memory and faction backups are not connected to Firestore. Profile path: <code className="text-white">/users/{currentUser.uid}</code>.
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 text-center space-y-3">
              <p className="text-xs text-slate-300 font-mono">
                Local NPC memories are saved in this browser. Cloud profile sign-in is disabled by default; enabling it does not upload your game settings or API keys.
              </p>
              <button
                onClick={handleGoogleSignIn}
                disabled={!firebaseEnabled || authLoading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-chakra font-bold text-xs rounded-lg shadow-lg shadow-emerald-600/20 inline-flex items-center space-x-2"
              >
                <LogIn className="w-4 h-4" />
                <span>{firebaseEnabled ? 'SIGN IN WITH GOOGLE' : 'CLOUD DISABLED'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, 
  MicOff, 
  Send, 
  MapPin, 
  Volume2, 
  VolumeX, 
  Compass, 
  Info, 
  Navigation,
  Loader2,
  ChevronRight
} from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types ---

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  groundingChunks?: any[];
  audioUrl?: string;
}

interface Location {
  latitude: number;
  longitude: number;
}

// --- App Component ---

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const handleSendMessageRef = useRef<any>(null);

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // Keep handleSendMessageRef up to date to avoid stale closures
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [messages, input, location, isAudioEnabled, isLoading]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Get location on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (error) => {
          console.error("Error getting location:", error);
          setLocationError("Impossible d'accéder à votre position. Les recommandations seront moins précises.");
        }
      );
    } else {
      setLocationError("La géolocalisation n'est pas supportée par votre navigateur.");
    }
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = 'fr-FR';

        recognitionRef.current.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          console.log("Speech recognized:", transcript);
          setInput(transcript);
          if (handleSendMessageRef.current) {
            handleSendMessageRef.current(transcript);
          }
          setIsListening(false);
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error("Speech recognition error:", event.error);
          if (event.error === 'not-allowed') {
            setLocationError("L'accès au micro a été refusé. Veuillez vérifier les permissions ou ouvrir l'app dans un nouvel onglet.");
          }
          setIsListening(false);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      } catch (e) {
        console.error("Speech recognition initialization failed:", e);
        setIsSpeechSupported(false);
      }
    } else {
      setIsSpeechSupported(false);
    }
  }, []);

  const toggleListening = () => {
    if (!isSpeechSupported) {
      alert("La reconnaissance vocale n'est pas supportée par votre navigateur ou bloquée par les paramètres de sécurité.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      try {
        // Stop any current speaking
        if (audioContextRef.current && audioContextRef.current.state === 'running') {
          // In a real app we'd stop the source node, but for simplicity we'll just pause the context
          // or let the next playPCM handle it.
        }
        setIsSpeaking(false);
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (error) {
        console.error("Error starting speech recognition:", error);
        setIsListening(false);
      }
    }
  };

  const generateSpeech = async (text: string) => {
    if (!isAudioEnabled) return null;
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return base64Audio || null;
    } catch (error) {
      console.error("Error generating speech:", error);
    }
    return null;
  };

  const playPCM = async (base64Data: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Gemini TTS returns 16-bit PCM (L16)
      const pcmData = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }

      const buffer = audioContext.createBuffer(1, float32Data.length, 24000);
      buffer.getChannelData(0).set(float32Data);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      
      source.onended = () => {
        setIsSpeaking(false);
      };

      setIsSpeaking(true);
      source.start();
    } catch (error) {
      console.error("Error playing PCM audio:", error);
      setIsSpeaking(false);
    }
  };

  const handleSendMessage = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create a placeholder for the assistant message
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Prepare conversation history for Gemini
      const history = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: [
          ...history,
          { role: 'user', parts: [{ text }] }
        ],
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: location ? {
                latitude: location.latitude,
                longitude: location.longitude
              } : undefined
            }
          },
          systemInstruction: "Tu es un concierge touristique chaleureux pour des vacanciers en Mobi-Concept. Aide-les à trouver des activités, restaurants et lieux d'intérêt à proximité. Sois concis et accueillant. Si tu utilises Google Maps, mentionne les lieux spécifiques."
        },
      });

      let fullText = "";
      let groundingChunks: any[] = [];

      for await (const chunk of responseStream) {
        const chunkText = chunk.text || "";
        fullText += chunkText;
        
        // Update the message in real-time
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { ...msg, content: fullText } 
            : msg
        ));

        // Capture grounding metadata if available in the final chunks
        if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
          groundingChunks = chunk.candidates[0].groundingMetadata.groundingChunks;
        }
      }

      // Final update with grounding chunks
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { ...msg, groundingChunks } 
          : msg
      ));

      // Generate speech after the text is complete
      if (isAudioEnabled && fullText) {
        const base64Audio = await generateSpeech(fullText);
        if (base64Audio) {
          await playPCM(base64Audio);
        }
      }
    } catch (error) {
      console.error("Error calling Gemini:", error);
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { ...msg, content: "Désolé, j'ai rencontré une erreur technique. Veuillez réessayer." } 
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-white shadow-2xl overflow-hidden sm:rounded-3xl sm:my-4 sm:h-[calc(100vh-2rem)] relative">
      <AnimatePresence>
        {!hasInteracted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-[#5A5A40] flex flex-col items-center justify-center text-white p-8 text-center"
          >
            <Compass className="w-20 h-20 mb-6 animate-pulse" />
            <h1 className="font-serif text-4xl mb-4">L'Escapade</h1>
            <p className="text-lg mb-8 opacity-90 max-w-xs">Votre concierge personnel pour un séjour inoubliable.</p>
            <button 
              onClick={() => {
                setHasInteracted(true);
                // Initialize audio context on first interaction
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              }}
              className="bg-white text-[#5A5A40] px-8 py-4 rounded-full font-bold text-lg hover:bg-opacity-90 transition-all shadow-xl flex items-center gap-2"
            >
              Démarrer l'expérience
              <ChevronRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-[#5A5A40] text-white p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-full relative">
            <Compass className="w-6 h-6" />
            {isSpeaking && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            )}
          </div>
          <div>
            <h1 className="font-serif text-2xl font-semibold tracking-tight">L'Escapade</h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-white/70 uppercase tracking-widest font-medium">Concierge Mobi-Concept</p>
              {isSpeaking && (
                <div className="flex gap-0.5 items-center h-3">
                  <div className="w-0.5 h-full bg-white/60 animate-[bounce_1s_infinite_0.1s]"></div>
                  <div className="w-0.5 h-full bg-white/60 animate-[bounce_1s_infinite_0.2s]"></div>
                  <div className="w-0.5 h-full bg-white/60 animate-[bounce_1s_infinite_0.3s]"></div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsAudioEnabled(!isAudioEnabled)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title={isAudioEnabled ? "Désactiver l'audio" : "Activer l'audio"}
          >
            {isAudioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full text-xs">
            <MapPin className={cn("w-3 h-3", location ? "text-green-400" : "text-red-400")} />
            <span>{location ? "Position active" : "Position indisponible"}</span>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#f5f5f0]/50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-md mx-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-24 h-24 bg-[#5A5A40]/10 rounded-full flex items-center justify-center"
            >
              <Navigation className="w-10 h-10 text-[#5A5A40]" />
            </motion.div>
            <div className="space-y-2">
              <h2 className="font-serif text-3xl text-[#5A5A40]">Bienvenue à L'Escapade</h2>
              <p className="text-slate-600">Je suis votre guide local. Que souhaitez-vous découvrir aujourd'hui ?</p>
            </div>
            <div className="grid grid-cols-1 gap-3 w-full">
              {[
                "Quels sont les bons restaurants à proximité ?",
                "Y a-t-il des randonnées sympas dans le coin ?",
                "Quelles sont les activités pour enfants aujourd'hui ?",
                "Où se trouve la plage la plus proche ?"
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(suggestion)}
                  className="text-left p-4 bg-white border border-slate-200 rounded-2xl hover:border-[#5A5A40] hover:bg-[#5A5A40]/5 transition-all group flex items-center justify-between"
                >
                  <span className="text-sm font-medium text-slate-700">{suggestion}</span>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#5A5A40] transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col max-w-[85%]",
                msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              <div className={cn(
                "p-4 rounded-3xl shadow-sm",
                msg.role === 'user' 
                  ? "bg-[#5A5A40] text-white rounded-tr-none" 
                  : "bg-white text-slate-800 rounded-tl-none border border-slate-100"
              )}>
                <div className="markdown-body">
                  <Markdown>{msg.content}</Markdown>
                </div>
                
                {msg.groundingChunks && msg.groundingChunks.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> Sources Google Maps
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {msg.groundingChunks.map((chunk, idx) => {
                        if (chunk.maps?.uri) {
                          return (
                            <a 
                              key={idx}
                              href={chunk.maps.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs bg-slate-50 hover:bg-slate-100 text-[#5A5A40] px-3 py-1.5 rounded-full border border-slate-200 flex items-center gap-1 transition-colors"
                            >
                              {chunk.maps.title || "Voir sur Maps"}
                            </a>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 px-2">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-slate-400 ml-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-medium italic">L'Escapade réfléchit...</span>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="p-6 bg-white border-t border-slate-100">
        {locationError && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-800 text-sm">
            <Info className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{locationError}</p>
          </div>
        )}
        
        <div className="flex items-center gap-3">
          <button
            onClick={toggleListening}
            className={cn(
              "p-4 rounded-2xl transition-all relative overflow-hidden",
              !isSpeechSupported && "opacity-50 cursor-not-allowed",
              isListening 
                ? "bg-green-500 text-white animate-pulse" 
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
            title={isSpeechSupported ? (isListening ? "Arrêter" : "Parler") : "Micro non supporté"}
          >
            {isListening ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </button>
          
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Posez votre question ici..."
              className="w-full p-4 pr-14 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-3 text-[#5A5A40] hover:bg-[#5A5A40]/10 rounded-xl transition-all disabled:opacity-30"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

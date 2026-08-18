import { useState, useEffect, useRef } from 'react';
import mammoth from 'mammoth';

// Tipos para Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

type Format = 'bullets' | 'full';

export default function App() {
  const [isConfigured, setIsConfigured] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('hp_apiKey') || '');
  const [model, setModel] = useState(localStorage.getItem('hp_model') || 'meta-llama/Meta-Llama-3-70B-Instruct');
  const [cv, setCv] = useState(localStorage.getItem('hp_cv') || '');
  const [coverLetter, setCoverLetter] = useState(localStorage.getItem('hp_coverLetter') || '');
  const [aptitudes, setAptitudes] = useState(localStorage.getItem('hp_aptitudes') || '');
  const [job, setJob] = useState(localStorage.getItem('hp_job') || '');
  const [format, setFormat] = useState<Format>((localStorage.getItem('hp_format') as Format) || 'bullets');
  const [isUploading, setIsUploading] = useState(false);

  // Estado de entrevista
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [showTimers, setShowTimers] = useState(false);
  
  // Temporizadores
  const [prepTime, setPrepTime] = useState(15);
  const [recordTime, setRecordTime] = useState(60);
  const [timerPhase, setTimerPhase] = useState<'none' | 'prep' | 'record'>('none');
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recognitionRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Inicializar Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'es-ES'; // Podría ser configurable

      let finalTranscript = '';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += trans + ' ';
          } else {
            interimTranscript += trans;
          }
        }
        setTranscript(finalTranscript + interimTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        // Cuando termina de escuchar (por silencio manual o stop)
        if (finalTranscript.trim() !== '') {
          handleGenerateAnswer(finalTranscript);
        }
      };
    }
  }, [cv, job, format, apiKey, model]); // Dependencias para que closure tenga los datos actuales

  // Desplazamiento automático al generar texto
  useEffect(() => {
    if (bottomRef.current && (answer || transcript)) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [answer, transcript]);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err: any) {
        console.error(`Wake Lock error: ${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, target: 'cv' | 'coverLetter' | 'aptitudes') => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);

    try {
      let text = '';
      if (file.type === 'application/pdf') {
        // Cargar dinámicamente PDF.js puro desde CDN para evitar errores de Rollup/Vite en Safari
        if (!(window as any).pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('No se pudo cargar PDF.js'));
            document.head.appendChild(script);
          });
          const pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        }

        const pdfjsLib = (window as any).pdfjsLib;
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages || 0;
        
        for (let i = 1; i <= totalPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          if (content && content.items) {
            const itemsLength = content.items.length || 0;
            for (let j = 0; j < itemsLength; j++) {
              const item = content.items[j];
              if (item && typeof item.str === 'string') {
                text += item.str + ' ';
              }
            }
            text += '\\n';
          }
        }
      } else if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else {
        // Fallback for txt or other readable files
        text = await file.text();
      }

      if (target === 'cv') setCv(text);
      else if (target === 'coverLetter') setCoverLetter(text);
      else setAptitudes(text);
    } catch (err) {
      console.error('Error al procesar el archivo', err);
      alert('Hubo un error al extraer el texto del archivo.');
    } finally {
      setIsUploading(false);
      // Resetear el input file para que permita seleccionar el mismo de nuevo si se requiere
      event.target.value = '';
    }
  };

  const handleSaveConfig = () => {
    localStorage.setItem('hp_apiKey', apiKey);
    localStorage.setItem('hp_model', model);
    localStorage.setItem('hp_cv', cv);
    localStorage.setItem('hp_coverLetter', coverLetter);
    localStorage.setItem('hp_aptitudes', aptitudes);
    localStorage.setItem('hp_job', job);
    localStorage.setItem('hp_format', format);
    setIsConfigured(true);
    requestWakeLock();
  };

  const handleBackToSetup = () => {
    setIsConfigured(false);
    releaseWakeLock();
  };

  const startListening = () => {
    setTranscript('');
    setAnswer('');
    setShowTimers(false);
    setTimerPhase('none');
    clearInterval(timerIntervalRef.current!);
    if (recognitionRef.current) {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleGenerateAnswer = async (question: string) => {
    setIsProcessing(true);
    setAnswer('');
    
    const systemPrompt = `Actúa como el candidato en una entrevista de trabajo. Eres un profesional experimentado.
    Genera una respuesta en primera persona que se pueda leer en voz alta de manera fluida y persuasiva en menos de 60 segundos.
    
    TONO Y ESTILO (Basado en el estándar cualitativo de CVPortatil-AI):
    - La redacción debe ser HUMANA, REALISTA, AUTÉNTICA Y SOBRIA.
    - Usa un lenguaje persuasivo, profesional y adecuado al nivel del puesto.
    - Evita clichés, saludos iniciales, o introducciones innecesarias (ve directo al grano).
    - CERO ALUCINACIONES: Basa la respuesta EXCLUSIVAMENTE en el CV, Carta de Presentación y Competencias aportadas. Está totalmente prohibido inventar experiencia laboral, métricas o funciones.
    - REGLA DE INFERENCIA: Si el reclutador te pregunta por tus fortalezas y/o debilidades, infiérelas de manera estratégica, profesional y autocrítica a partir del nivel de experiencia de tu perfil, mostrando áreas de oportunidad de aprendizaje que no te dejen mal parado, siempre respetando la regla de no alucinar experiencia falsa.
    - Regla gramatical estricta: Evita cacofonías (reemplaza "y" por "e" ante palabras con sonido "i", y "o" por "u" ante sonido "o").
    
    CV DEL CANDIDATO: 
    ${cv}
    
    ${coverLetter ? `CARTA DE PRESENTACIÓN DEL CANDIDATO:\n${coverLetter}\n` : ''}
    ${aptitudes ? `COMPETENCIAS Y APTITUDES CLAVE:\n${aptitudes}\n` : ''}
    PUESTO APLICADO: ${job}
    
    FORMATO DE RESPUESTA REQUERIDO: 
    ${format === 'bullets' ? 'Viñetas clave cortas (Smart Bullets) con viñetas reales "-", fáciles de leer rápidamente para usar como guía visual (máximo 4-5 viñetas, destacando métricas de éxito).' : 'Párrafos completos tipo teleprompter. Textos fluidos y conversacionales, listos para ser leídos en voz alta sin parecer un robot.'}`;

    try {
      const response = await fetch('https://api.deepinfra.com/v1/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
          ],
          stream: true,
          temperature: 0.7,
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      setIsProcessing(false);
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            if (line.replace(/^data: /, '') === '[DONE]') {
              startTimers();
              return;
            }
            try {
              const parsed = JSON.parse(line.replace(/^data: /, ''));
              if (parsed.choices[0].delta.content) {
                setAnswer(prev => prev + parsed.choices[0].delta.content);
              }
            } catch (e) {
              // Ignore parse errors on partial chunks
            }
          }
        }
        startTimers();
      }
    } catch (error) {
      console.error(error);
      setAnswer('Error al conectar con DeepInfra. Verifica tu API Key.');
      setIsProcessing(false);
    }
  };

  const startTimers = () => {
    setShowTimers(true);
    setPrepTime(15);
    setRecordTime(60);
    setTimerPhase('prep');

    timerIntervalRef.current = setInterval(() => {
      setPrepTime(prev => {
        if (prev > 1) return prev - 1;
        // Termina prep, pasa a record
        setTimerPhase('record');
        return 0;
      });
    }, 1000);
  };

  useEffect(() => {
    if (timerPhase === 'record') {
      clearInterval(timerIntervalRef.current!);
      timerIntervalRef.current = setInterval(() => {
        setRecordTime(prev => {
          if (prev > 1) return prev - 1;
          clearInterval(timerIntervalRef.current!);
          setTimerPhase('none');
          return 0;
        });
      }, 1000);
    }
  }, [timerPhase]);

  // Clean up timers and wake lock on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerIntervalRef.current!);
      releaseWakeLock();
    };
  }, []);

  if (!isConfigured) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 p-6 flex flex-col items-center justify-center pt-safe-top pb-safe-bottom">
        <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-xl p-8 space-y-6">
          <h1 className="text-3xl font-bold text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">HirePrompt AI</h1>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">DeepInfra API Key</label>
              <input 
                type="password" 
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="sk-..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Modelo de DeepInfra</label>
              <input 
                type="text" 
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-400">Tu CV / Experiencia</label>
                <label className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
                  {isUploading ? 'Procesando...' : 'Subir archivo (PDF/Docx)'}
                  <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(e, 'cv')} disabled={isUploading} />
                </label>
              </div>
              <textarea 
                value={cv}
                onChange={e => setCv(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32 resize-none"
                placeholder="Pega tu CV aquí o sube un archivo..."
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-400">Carta de Presentación (Opcional)</label>
                <label className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
                  {isUploading ? 'Procesando...' : 'Subir archivo'}
                  <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(e, 'coverLetter')} disabled={isUploading} />
                </label>
              </div>
              <textarea 
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder="Pega tu carta de presentación..."
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-400">Aptitudes y Competencias (Opcional)</label>
                <label className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
                  {isUploading ? 'Procesando...' : 'Subir archivo'}
                  <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={(e) => handleFileUpload(e, 'aptitudes')} disabled={isUploading} />
                </label>
              </div>
              <textarea 
                value={aptitudes}
                onChange={e => setAptitudes(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder="Pega tu lista de aptitudes y competencias clave..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Descripción del Puesto</label>
              <textarea 
                value={job}
                onChange={e => setJob(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                placeholder="¿A qué puesto aplicas?"
              />
            </div>

            <div className="flex items-center justify-between bg-gray-700 p-4 rounded-lg">
              <span className="text-sm font-medium text-gray-300">Formato</span>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setFormat('bullets')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${format === 'bullets' ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-400'}`}
                >
                  Bullets
                </button>
                <button 
                  onClick={() => setFormat('full')}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${format === 'full' ? 'bg-blue-600 text-white' : 'bg-gray-600 text-gray-400'}`}
                >
                  Completo
                </button>
              </div>
            </div>

            <button 
              onClick={handleSaveConfig}
              disabled={!apiKey || !cv || !job}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 transition-all active:scale-95"
            >
              Iniciar Entrevista
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-200 flex flex-col items-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-sans">
      
      {/* Header invisible / de control */}
      <div className="w-full max-w-sm flex justify-between p-4 opacity-30 hover:opacity-100 transition-opacity absolute top-[env(safe-area-inset-top)] z-10">
        <button onClick={handleBackToSetup} className="text-xs text-gray-400 px-2 py-1 border border-gray-700 rounded">
          ← Setup
        </button>
        <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-700'}`}></div>
      </div>

      {/* Contenedor central ultra-estrecho (Eye-Tracking Seguro) */}
      <div className="flex-1 w-full max-w-xs sm:max-w-sm flex flex-col justify-start mt-20 px-4 overflow-y-auto pb-40">
        
        {transcript && (
          <div className="mb-8 text-gray-500 italic text-lg leading-relaxed">
            "{transcript}"
          </div>
        )}

        {isProcessing && !answer && (
          <div className="text-blue-500 animate-pulse text-xl">
            Procesando...
          </div>
        )}

        {answer && (
          <div className="text-white text-xl sm:text-2xl leading-snug whitespace-pre-wrap font-medium">
            {answer}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Controles y Temporizadores fijos abajo */}
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-black to-transparent flex flex-col items-center">
        
        {showTimers && timerPhase !== 'none' && (
          <div className="w-full max-w-xs mb-6 space-y-2">
            {timerPhase === 'prep' && (
              <div>
                <div className="flex justify-between text-xs text-blue-400 mb-1 font-bold">
                  <span>PREPARACIÓN</span>
                  <span>{prepTime}s</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-1000 ease-linear" style={{ width: `${(prepTime / 15) * 100}%` }}></div>
                </div>
              </div>
            )}
            
            {timerPhase === 'record' && (
              <div>
                <div className={`flex justify-between text-xs mb-1 font-bold ${recordTime <= 15 ? (recordTime <= 5 ? 'text-red-500 animate-pulse' : 'text-yellow-500') : 'text-green-500'}`}>
                  <span>GRABACIÓN</span>
                  <span>{recordTime}s</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-1000 ease-linear ${recordTime <= 15 ? (recordTime <= 5 ? 'bg-red-500' : 'bg-yellow-500') : 'bg-green-500'}`} style={{ width: `${(recordTime / 60) * 100}%` }}></div>
                </div>
              </div>
            )}
          </div>
        )}

        {!isListening ? (
          <button 
            onClick={startListening}
            className="w-full max-w-xs py-4 bg-gray-800 text-white rounded-full font-semibold text-lg border border-gray-700 active:bg-gray-700 transition-colors flex items-center justify-center space-x-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <span>Escuchar Pregunta</span>
          </button>
        ) : (
          <button 
            onClick={stopListening}
            className="w-full max-w-xs py-4 bg-red-900/50 text-red-200 rounded-full font-semibold text-lg border border-red-800 active:bg-red-800 transition-colors flex items-center justify-center space-x-2"
          >
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            <span>Detener y Responder</span>
          </button>
        )}
      </div>

    </div>
  );
}

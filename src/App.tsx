import { useState, useEffect, useRef } from 'react';
import { defaultCV, defaultCoverLetter, defaultAptitudes } from './defaults';

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
  const [model] = useState('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  const [cv] = useState(localStorage.getItem('hp_cv') || defaultCV);
  const [coverLetter] = useState(localStorage.getItem('hp_coverLetter') || defaultCoverLetter);
  const [aptitudes] = useState(localStorage.getItem('hp_aptitudes') || defaultAptitudes);
  const [job, setJob] = useState(localStorage.getItem('hp_job') || '');
  const [format, setFormat] = useState<Format>((localStorage.getItem('hp_format') as Format) || 'bullets');

  // Estado de entrevista
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [answer, setAnswer] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');

  // Temporizadores
  const [timerPhase, setTimerPhase] = useState<'none' | 'prep' | 'record'>('none');
  const [prepTime, setPrepTime] = useState(15);
  const [recordTime, setRecordTime] = useState(60);
  const [showTimers, setShowTimers] = useState(false);
  
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);
  const wakeLockRef = useRef<any>(null);

  // Lógica de Auto-Scroll
  useEffect(() => {
    if (isAutoScrolling || timerPhase === 'record') {
      const intervalId = setInterval(() => {
        // scrollBy es relativo. Si el usuario hace scroll con el dedo, simplemente se suma 1px 
        // a la nueva posición sin "pelear" contra él.
        // Hacemos scroll tanto en la ventana global como en el contenedor (por si alguno de los dos tiene el overflow)
        window.scrollBy(0, 1);
        if (containerRef.current) {
          containerRef.current.scrollBy(0, 1);
        }
      }, 30); // 1px cada 30ms = ~33px por segundo (velocidad cómoda de lectura)

      return () => clearInterval(intervalId);
    }
  }, [isAutoScrolling, timerPhase]);

  // Inicializar Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'es-ES'; // Podría ser configurable

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscriptRef.current += trans + ' ';
          } else {
            interimTranscript += trans;
          }
        }
        setTranscript(finalTranscriptRef.current + interimTranscript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        // Cuando termina de escuchar (por silencio manual o stop)
        if (finalTranscriptRef.current.trim() !== '') {
          handleGenerateAnswer(finalTranscriptRef.current);
        }
      };
    }
  }, [cv, job, format, apiKey, model]); // Dependencias para que closure tenga los datos actuales

  // Eliminado el auto-scroll al fondo (bottomRef) porque arruinaba la lectura de teleprompter

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

  const handleSaveConfig = () => {
    localStorage.setItem('hp_apiKey', apiKey);
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
    finalTranscriptRef.current = '';
    clearInterval(timerIntervalRef.current!);
    startTimers(); // EL USUARIO MANDÓ QUE EMPIECE EXACTAMENTE AL PRESIONAR EL BOTÓN
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
    setIsAutoScrolling(false); // Turn off auto-scroll when a new question starts
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    
    
    const systemPrompt = `Actúa como el candidato en una entrevista de trabajo. Eres un profesional experimentado.
    Tu único objetivo es escribir el GUION EXACTO (palabra por palabra) que el candidato leerá en voz alta para responder la pregunta en menos de 60 segundos.
    
    ADAPTACIÓN ESTRATÉGICA AL PUESTO (CRÍTICO):
    - Estás aplicando a este puesto específico: ${job}
    - FILTRA TU CV: NO recites tu perfil completo. Selecciona ÚNICAMENTE las habilidades y experiencias que tengan sentido para ESTE puesto. 
    - ADAPTA EL LENGUAJE: Si vienes de un sector técnico (ej. Telecomunicaciones, IA) y aplicas a algo distinto (ej. Encargado de Supermercado), TRADUCE tu experiencia. Habla de liderazgo de equipos, manejo de operaciones, atención al cliente y resolución de problemas. OMITE por completo la jerga técnica (como "ecosistemas cloud", "APIs", "LLMs", "No-Code") a menos que el puesto lo requiera explícitamente.
    
    CONTEXTO DE LA EMPRESA (LUPA SUPERMERCADOS):
    - Grupo: Semark AC Group S.A.
    - Mercado: ¡Dato Clave! Lupa es LÍDER en superficie comercial en Castilla y León (donde está Salamanca) con un 15,2% de cuota, superando incluso a Mercadona. Tienen una fuerte red de tiendas en Salamanca capital y provincia (Béjar, Ciudad Rodrigo, Santa Marta, etc.).
    - Estrategia: Apuesta por productos frescos, proximidad y fidelidad del cliente local.
    - CUIDADO: NO tienen el premio "Great Place to Work" (no lo menciones). Ensalza su liderazgo regional en Castilla y León.
    
    ANÉCDOTAS Y CASOS DE ÉXITO (Úsalas si te piden ejemplos de situaciones difíciles o logros):
    - Anécdota 1 (Digitalización y reducción de colas): "Ante un incremento desbordado de visitas físicas a tiendas, lideré con mi equipo una estrategia para desviar operaciones a un canal web de autoatención. Invertimos tiempo en educar al cliente en la propia tienda sobre cómo usar la web. Poco a poco, la adopción digital subió, los clientes empezaron a autogestionarse desde casa y descongestionamos las tiendas físicas."
    - Anécdota 2 (Filosofía Caso Recibido, Caso Cerrado): "Notamos que los clientes llegaban malhumorados a los asesores por el clima, el tráfico y las colas. Implementé la filosofía de 'Caso recibido, caso cerrado'. Si no podíamos dar solución inmediata y dependíamos de otra área, nosotros mismos hacíamos el seguimiento interno y manteníamos al cliente informado en cada etapa. Evitamos que el cliente tuviera que volver a la tienda a quejarse por lo mismo, y nuestros indicadores de satisfacción (NPS) subieron drásticamente."
    - Anécdota 3 (Decisión impopular - Cambio a fidelización): "Mi equipo estaba acostumbrado a solo vender líneas nuevas, porque era más rápido. Cuando decidí que debíamos empezar a fidelizar a los clientes actuales (renovando equipos y contratos), fue impopular porque demandaba más tiempo de negociación. Fui honesto con ellos: les demostré con números que esto mejoraría los resultados globales y, por ende, sus comisiones. Entendieron la visión, logramos ser el equipo referente frente a otras supervisiones y ellos consiguieron las comisiones que tanto querían."

    CONCISIÓN Y BREVEDAD (CRÍTICO):
    - NO te enrolles. Tus respuestas deben ser CORTAS, ágiles y contundentes.
    - MÁXIMO 3 PÁRRAFOS BREVES. Recuerda que el candidato tiene que leer esto en menos de 60 segundos.
    - PROHIBIDO repetir la premisa de la pregunta (ej. no digas "En la situación que describes de un sábado por la mañana..."). Ve directo a la acción: "Lo primero que haría sería...".

    REGLAS DE VOCABULARIO (ANTI-IA Y ANTI-ROBOT):
    - ESTÁ ESTRICTAMENTE PROHIBIDO usar vocabulario rebuscado, típico de Inteligencia Artificial o de manual de recursos humanos.
    - PALABRAS Y FRASES TOTALMENTE PROHIBIDAS: "transferibles", "actitudes", "en resumen", "en conclusión", "es importante destacar", "cabe mencionar", "sinergia", "multifacético", "alinear", "fundamental", "crucial", "en mi experiencia", "mi objetivo es".
    - Habla con palabras sencillas, del día a día, como si estuvieras tomando un café con el entrevistador. Si usas palabras rimbombantes, fallarás tu misión.
    - CAMBIO DE SECTOR Y TERMINOLOGÍA: 
      1. Tienes ESTRICTAMENTE PROHIBIDO decir "no tengo experiencia en el sector", "mi falta de experiencia" o disculparte por tu pasado. Aborda el cambio con seguridad: gestionar operaciones complejas, liderar equipos y enfocarse en la eficiencia es igual en cualquier industria; lo único que cambia es el producto. 
      2. NUNCA llames al supermercado "el sector de la alimentación" (un supermercado es mucho más que eso). Llámalo "retail", "gran consumo" o "operaciones de tienda".
      3. Menciona "telecomunicaciones" MÁXIMO UNA VEZ y no te justifiques.

    PREGUNTAS TÉCNICAS (MERMAS, STOCK, ETC):
    - Si te preguntan sobre el manejo de mermas (desperdicios/pérdidas), no alucines procedimientos que no conoces. Basa tu respuesta en tu experiencia universal: control estricto de KPIs, rigor en los procesos operativos, auditoría continua y hacer que el equipo sea responsable y consciente de los números todos los días. El control de mermas es pura disciplina operativa y de inventario.

    PREGUNTAS TRAMPA (DEBILIDADES Y DEFECTOS):
    - ESTÁ ESTRICTAMENTE PROHIBIDO decir que eres "demasiado perfeccionista", "adicto al trabajo", "que te exiges demasiado", o usar debilidades falsas que en el fondo suenen a cumplido. Eso suena robótico, falso y arruina la entrevista.
    - ESTRUCTURA OBLIGATORIA (Debilidad -> Impacto -> Solución): Cuéntalo como una historia fluida, sin decir "mi impacto es...".
    - Elige UNA de estas 3 debilidades reales y altérnalas si te piden más de una. Tienes que contarlas EXACTAMENTE con estas palabras:
      1. DELEGAR: "Mira, una debilidad real es que a veces me cuesta delegar porque estaba muy acostumbrado a bajar a la trinchera y resolver los problemas yo mismo. Eso hacía que me saturara de tareas operativas y, peor aún, que mi equipo no desarrollara autonomía. Así que tuve que aprender a dar un paso atrás y empezar a confiar más en sus capacidades. En lugar de controlarlo todo, les asigné responsabilidades claras y les di el margen para tomar decisiones, estando yo siempre disponible para apoyarlos. Con el tiempo, logramos mejorar nuestros resultados y el equipo se volvió mucho más autónomo, eficiente y motivado."
      2. DECIR QUE SÍ A TODO: "Mira, al principio me costaba un poco decir 'no' a los demás. Como siempre quiero ayudar a todo el mundo, aceptaba cualquier tarea o favor que me pedían otras áreas. El problema fue que eso terminó saturando a mi equipo y nos quitaba tiempo para lo verdaderamente importante, que eran las ventas y atender al cliente. En mi anterior trabajo me di cuenta de este error y lo corregí por completo. Aprendí a poner límites y a priorizar las tareas según las necesidades de la tienda. Gracias a ese cambio, logré que el equipo trabajara mucho más enfocado, el ambiente mejoró y pudimos cumplir con todos los objetivos del turno sin retrasos."
      3. COMUNICACIÓN DEMASIADO DIRECTA: "Al principio de tener tiendas a mi cargo, mi debilidad era que me enfocaba tanto en cumplir los objetivos y los números que mi comunicación con el equipo era demasiado directa y fría. Les exigía resultados sin pararme a motivarlos o a entender sus situaciones, lo que a veces generaba tensión innecesaria. En mi anterior etapa me di cuenta de que para conseguir resultados primero hay que cuidar al equipo. Aprendí a cambiar mi forma de hablarles: empecé a escuchar más, a dar los mensajes con más empatía y a celebrar también los pequeños logros diarios. Gracias a ese cambio, el ambiente de la tienda mejoró muchísimo, el equipo se sintió más valorado y, al final, los resultados de ventas salieron adelante de forma mucho más natural."

    TONO Y ESTILO (100% HUMANO Y ESPONTÁNEO):
    - NO SUENES A TEXTO ESCRITO. Tienes que sonar como una persona hablando en voz alta, de forma relajada y segura. 
    - USA MULETILLAS NATURALES: Arranca las frases con conectores como "Mira...", "Bueno...", "La verdad es que...", "Fíjate que...". ESTÁ TOTALMENTE PROHIBIDO ARRANCAR DICIENDO "En mi experiencia" O CUALQUIER VARIANTE SIMILAR.
    - CERO CORPORATIVISMO BURACOCRÁTICO: Si una anécdota habla de "comisiones", "dinero" o "ganancias", MENCIONA LAS COMISIONES Y EL DINERO. NO las suavices inventando tonterías corporativas como "sesiones de coaching", "metas medibles" o "satisfacción del cliente". Sé crudo, real y directo.
    - RESPETA LAS ANÉCDOTAS AL PIE DE LA LETRA: Si usas una anécdota de la lista, NO LE INVENTES RELLENO. Cuenta exactamente lo que dice la anécdota y nada más. 
    - VÉ DIRECTO A LA ACCIÓN: Cero introducciones de presentación. 
    - PROHIBIDO ENUMERAR Y HACER LISTAS: Nunca digas "Primero...", "Segundo...", o "Mi principal fortaleza es...". Teje tus respuestas en una sola historia fluida y natural. Cero markdown, cero negritas.
    - CERO ALUCINACIONES: Basa la respuesta EXCLUSIVAMENTE en el CV, Carta de Presentación y Competencias aportadas. 
    - Regla gramatical estricta: Evita cacofonías (reemplaza "y" por "e" ante palabras con sonido "i", y "o" por "u" ante sonido "o").
    
    CV DEL CANDIDATO: 
    ${cv}
    
    ${coverLetter ? `CARTA DE PRESENTACIÓN DEL CANDIDATO:\n${coverLetter}\n` : ''}
    ${aptitudes ? `COMPETENCIAS Y APTITUDES CLAVE:\n${aptitudes}\n` : ''}
    PUESTO APLICADO: ${job}
    
    FORMATO DE RESPUESTA REQUERIDO: 
    ${format === 'bullets' ? 'Usa separaciones por guiones (-) muy cortas solo para marcar pausas de respiración, pero MANTÉN el tono de guion conversacional hablado. NO hagas introducciones ni conclusiones, ve directo a los puntos.' : 'Escribe en un solo bloque de texto fluido o párrafos cortos. NO hagas introducciones ni conclusiones, empieza a responder directamente la esencia de la pregunta.'}
    
    PREGUNTA DEL RECLUTADOR:`;

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
      }
    } catch (error) {
      console.error(error);
      setAnswer('Error al conectar con DeepInfra. Verifica tu API Key.');
      setIsProcessing(false);
    }
  };

  function startTimers() {
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
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
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
              <label className="block text-sm font-medium text-gray-400 mb-1">Descripción del Puesto</label>
              <textarea 
                value={job}
                onChange={e => setJob(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32 resize-none"
                placeholder="Pega la oferta de trabajo aquí..."
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
              disabled={!apiKey || !job}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 transition-all active:scale-95"
            >
              Iniciar Entrevista
            </button>
            
            <button 
              onClick={() => {
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(regs => {
                    regs.forEach(r => r.unregister());
                    window.location.reload();
                  });
                } else {
                  window.location.reload();
                }
              }}
              className="w-full text-center text-xs text-gray-500 hover:text-gray-300 pt-2"
            >
              ¿Ves errores o la pantalla negra? Clic aquí para actualizar
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
        <button 
          onClick={() => setIsAutoScrolling(!isAutoScrolling)} 
          className={`text-xs px-2 py-1 border rounded transition-colors ${isAutoScrolling ? 'text-blue-400 border-blue-400' : 'text-gray-500 border-gray-700'}`}
        >
          {isAutoScrolling ? 'Auto-Scroll ON' : 'Auto-Scroll OFF'}
        </button>
        <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-700'}`}></div>
      </div>

      {/* Contenedor central ultra-estrecho (Eye-Tracking Seguro) */}
      <div ref={containerRef} className="flex-1 w-full max-w-xs sm:max-w-sm flex flex-col justify-start mt-20 px-4 overflow-y-auto pb-40">
        
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

"use client";

import React, { useState } from "react";
import Chatbot from "react-chatbot-kit";
import "react-chatbot-kit/build/main.css";

/* ====================== Tipos locales (sin any) ====================== */
type CreateMessageFn = (message: string, options?: Record<string, unknown>) => unknown;

interface ChatState {
  messages: unknown[];
  // el lib añade más propiedades internamente, las dejamos abiertas:
  [key: string]: unknown;
}

/* ====================== ActionProvider ====================== */
class ActionProvider {
  private createMessage: CreateMessageFn;
  private setState: React.Dispatch<React.SetStateAction<ChatState>>;

  constructor(createChatBotMessage: CreateMessageFn, setStateFunc: React.Dispatch<React.SetStateAction<ChatState>>) {
    this.createMessage = createChatBotMessage;
    this.setState = setStateFunc;
  }

  private addMessageToState = (message: unknown) => {
    this.setState((prev: ChatState) => ({
      ...prev,
      messages: [...(prev.messages ?? []), message],
    }));
  };

  handleAccuracyQuestion = () => {
    const message = this.createMessage(
      "Nuestra IA entrega una estimación cercana al rango de un taller local. El costo final siempre se confirma tras una revisión presencial."
    );
    this.addMessageToState(message);
  };

  handleDamageTypesQuestion = () => {
    const message = this.createMessage(
      "Detectamos rayones, abolladuras, grietas y daños de pintura en la mayoría de piezas exteriores (defensa, puertas, cofres, etc.)."
    );
    this.addMessageToState(message);
  };

  handleDefault = () => {
    const message = this.createMessage(
      "No entendí tu pregunta. Puedes subir una foto para analizar el daño o seleccionar una opción de la lista."
    );
    this.addMessageToState(message);
  };
}

/* ====================== MessageParser ====================== */
class MessageParser {
  private actionProvider: ActionProvider;
  // guardamos el state por si lo necesitas luego (historial, etc.)
  private state: ChatState;

  constructor(actionProvider: ActionProvider, state: ChatState) {
    this.actionProvider = actionProvider;
    this.state = state;
  }

  parse(message: string) {
    const text = message.toLowerCase();

    const isAccuracy =
      text.includes("precis") ||
      text.includes("exacta") ||
      text.includes("exacto") ||
      text.includes("cotiz");

    const isDamageTypes =
      text.includes("detecta") ||
      text.includes("qué daños") ||
      text.includes("tipos de daño") ||
      text.includes("daños");

    if (isAccuracy) return this.actionProvider.handleAccuracyQuestion();
    if (isDamageTypes) return this.actionProvider.handleDamageTypesQuestion();

    return this.actionProvider.handleDefault();
  }
}

/* ====================== Widget de opciones (FAQ) ====================== */
interface FaqOptionsProps {
  actionProvider: ActionProvider;
}

const FaqOptions: React.FC<FaqOptionsProps> = ({ actionProvider }) => {
  const options: Array<{ id: number; text: string; handler: () => void }> = [
    { id: 1, text: "¿Qué tan precisa es la cotización?", handler: actionProvider.handleAccuracyQuestion },
    { id: 2, text: "¿Qué tipos de daño detecta?", handler: actionProvider.handleDamageTypesQuestion },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={opt.handler}
          className="rounded-lg bg-indigo-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          type="button"
        >
          {opt.text}
        </button>
      ))}
    </div>
  );
};

/* ====================== Config (sin IConfig / sin any) ====================== */
const chatbotConfig = {
  botName: "FixItBot",
  initialMessages: [
    // La función createChatBotMessage nos la inyecta el lib; aquí se define
    // como una "factory" en tiempo de ejecución, no necesitamos tiparla aquí.
    // Por eso usamos la forma "declarativa" que el lib entiende.
    // Nota: react-chatbot-kit acepta objetos "message" generados internamente.
    // Para iniciales, usa la forma recomendada por su doc:
    // https://fredrikoseberg.github.io/react-chatbot-kit-docs/docs/config/
    // (no necesitamos tipos aquí)
    { type: "bot", id: "init-1", message: "¡Hola! Soy FixItBot, tu asistente virtual." },
    {
      type: "bot",
      id: "init-2",
      message: "Sube una foto del daño para obtener una estimación o elige una pregunta frecuente.",
      widget: "faqOptions",
      withAvatar: true,
      delay: 500,
    },
  ],
  widgets: [
    {
      widgetName: "faqOptions",
      // tipamos el widgetFunc con las props reales que usamos
      widgetFunc: (props: { actionProvider: ActionProvider }) => <FaqOptions {...props} />,
    },
  ],
} as const;

/**
 * El componente Chatbot del paquete tiene typings inconsistentes en algunos entornos.
 * Para evitar choques de tipos (sin usar `any`), declaramos un tipo mínimo aceptable
 * para las props que SÍ usamos y hacemos un type assertion con `unknown`.
 */
type MinimalChatbotProps = {
  config: unknown;
  messageParser: new (actionProvider: ActionProvider, state: ChatState) => MessageParser;
  actionProvider: new (createChatBotMessage: CreateMessageFn, setStateFunc: React.Dispatch<React.SetStateAction<ChatState>>) => ActionProvider;
};

const ChatbotComponent = Chatbot as unknown as React.ComponentType<MinimalChatbotProps>;

/* ====================== Componente Flotante ====================== */
const ChatbotWidget: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[100] h-16 w-16 bg-indigo-600 rounded-full shadow-lg flex items-center justify-center text-white hover:bg-indigo-500 transition-transform hover:scale-110"
          aria-label="Abrir chat de ayuda"
          type="button"
        >
          {/* ícono burbuja */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-5 right-5 z-[100] w-[360px] max-w-[95vw] rounded-xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900"
          role="dialog"
          aria-label="Chat FixItBot"
        >
          <div className="relative">
            <ChatbotComponent
              config={chatbotConfig}
              messageParser={MessageParser}
              actionProvider={ActionProvider}
            />
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-2 -right-2 h-8 w-8 bg-zinc-700 rounded-full text-white font-bold text-lg flex items-center justify-center shadow-md hover:bg-zinc-600"
              aria-label="Cerrar chat"
              type="button"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatbotWidget;

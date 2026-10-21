// Provider registry — one provider per channel; mode auto-detected from env.
// Mock mode is the default (no credentials in the sandbox ⇒ no network calls).

import type { Channel } from "../taxonomy";
import { makeEmailProvider } from "./email";
import { makeMessengerProvider } from "./messenger";
import { makeTelegramProvider } from "./telegram";
import { makeWhatsAppProvider } from "./whatsapp";
import { initMockSeq } from "./mock";
import type { Provider } from "./types";

const providers: Record<Channel, Provider> = {
  email: makeEmailProvider(),
  telegram: makeTelegramProvider(),
  whatsapp: makeWhatsAppProvider(),
  messenger: makeMessengerProvider(),
};

initMockSeq();

export function getProvider(channel: string): Provider {
  const p = providers[channel as Channel];
  if (!p) throw new Error(`unknown channel: ${channel}`);
  return p;
}

export function providerLabels(): { email: string; telegram: string; whatsapp: string; messenger: string } {
  return {
    email: providers.email.label,
    telegram: providers.telegram.label,
    whatsapp: providers.whatsapp.label,
    messenger: providers.messenger.label,
  };
}

export function isMock(channel: Channel): boolean {
  return providers[channel].mode === "mock";
}

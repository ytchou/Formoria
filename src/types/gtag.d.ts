type GtagConfigParams = Record<string, unknown>;
type GtagSetParams = Record<string, unknown>;
type GtagEventParams = Record<string, unknown>;

interface Window {
  gtag(command: 'js', date: Date): void;
  gtag(command: 'config', targetId: string, configParams?: GtagConfigParams): void;
  gtag(command: 'set', params: GtagSetParams): void;
  gtag(command: 'event', eventName: string, eventParams?: GtagEventParams): void;
  dataLayer: Record<string, unknown>[];
}

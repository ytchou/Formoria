import { Logger } from 'next-axiom'

export function createLogger(module: string) {
  return new Logger().with({ module })
}

export { Logger }

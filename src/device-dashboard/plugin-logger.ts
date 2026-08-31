import { Logger } from '@nestjs/common';

export class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === 'debug') {
      super.debug(message);
    }
  }
}

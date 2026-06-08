import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { LogLevel } from '@nestjs/common';

async function bootstrap() {
 
  const requestedLevel = process.env.LOG_LEVEL || 'log';

  
  let logLevels: LogLevel[] = ['log', 'warn', 'error'];


  if (requestedLevel === 'debug') {
    logLevels.push('debug');
  }

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });

  // 5. Start listening on the environment port or fallback to 3000
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap();
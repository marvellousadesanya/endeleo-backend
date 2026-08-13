import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";

// Money is stored as BIGINT and reaches us as JavaScript BigInt, which JSON.stringify
// refuses to serialise. Render it as a string so precision survives the wire — a JSON
// number would silently round anything past 2^53.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // drop unknown properties
      forbidNonWhitelisted: true, // and reject requests that send them
      transform: true,
    }),
  );

  const origins = config.get<string[]>("CORS_ORIGINS") ?? [];
  app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: true });

  const port = config.get<number>("PORT") ?? 4000;
  await app.listen(port);
  new Logger("Bootstrap").log(`Endeleo API listening on http://localhost:${port}/api`);
}

void bootstrap();
